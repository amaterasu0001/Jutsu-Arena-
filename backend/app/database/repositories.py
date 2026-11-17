from __future__ import annotations

import json
import threading
from datetime import datetime, timezone

from app.database.db import Database
from app.schemas.catalog import SettingsModel


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


#: Defaults that changed between versions: {field: old default}.
SUPERSEDED_DEFAULTS: dict[str, object] = {
    "sequence_timeout_seconds": 6,  # raised to 20 s between signs
    "hold_ms": 500,  # lowered to 300 ms
}


def _valid_settings(values: dict) -> SettingsModel:
    """Build settings, dropping only the individual values that are no longer valid."""
    try:
        return SettingsModel(**values)
    except ValueError:
        pass
    kept: dict = {}
    for key, value in values.items():
        try:
            SettingsModel(**{**kept, key: value})
        except ValueError:
            continue
        kept[key] = value
    return SettingsModel(**kept)


class SettingsRepository:
    """Per-player preferences, cached in memory because prediction reads them every frame."""

    def __init__(self, database: Database) -> None:
        self._db = database
        self._cache: dict[str, SettingsModel] = {}
        self._lock = threading.Lock()

    def get(self, player_id: str) -> SettingsModel:
        with self._lock:
            cached = self._cache.get(player_id)
        if cached is not None:
            return cached

        with self._db.connect() as connection:
            rows = connection.execute(
                "SELECT key, value FROM settings WHERE player_id = ?", (player_id,)
            ).fetchall()
        stored = {}
        for row in rows:
            try:
                stored[row["key"]] = json.loads(row["value"])
            except json.JSONDecodeError:
                continue
        known = {key: value for key, value in stored.items() if key in SettingsModel.model_fields}
        # Older versions stored every field on each save, which froze the defaults
        # of the time. Values equal to a superseded default were never chosen by
        # the player, so they follow the current default instead.
        for key, old_default in SUPERSEDED_DEFAULTS.items():
            if known.get(key) == old_default:
                known.pop(key)
        settings = _valid_settings(known)
        with self._lock:
            self._cache[player_id] = settings
        return settings

    def update(self, player_id: str, changes: dict) -> SettingsModel:
        merged = SettingsModel(**{**self.get(player_id).model_dump(), **changes})
        # Only the fields the player changed are stored, so improved defaults
        # still reach every setting they never touched.
        stored = merged.model_dump()
        with self._db.write() as connection:
            connection.executemany(
                "INSERT INTO settings (player_id, key, value) VALUES (?, ?, ?) "
                "ON CONFLICT (player_id, key) DO UPDATE SET value = excluded.value",
                [(player_id, key, json.dumps(stored[key])) for key in changes if key in stored],
            )
        with self._lock:
            self._cache[player_id] = merged
        return merged

    def reset(self, player_id: str) -> SettingsModel:
        with self._db.write() as connection:
            connection.execute("DELETE FROM settings WHERE player_id = ?", (player_id,))
        defaults = SettingsModel()
        with self._lock:
            self._cache[player_id] = defaults
        return defaults


class HistoryRepository:
    def __init__(self, database: Database) -> None:
        self._db = database

    def add_activation(
        self,
        *,
        player_id: str,
        session_id: str,
        jutsu_id: str,
        jutsu_name: str,
        element: str,
        points: int,
        combo: int,
        sequence: list[str],
    ) -> int:
        with self._db.write() as connection:
            cursor = connection.execute(
                "INSERT INTO activations "
                "(player_id, session_id, jutsu_id, jutsu_name, element, points, combo, sequence, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (player_id, session_id, jutsu_id, jutsu_name, element, points, combo, json.dumps(sequence), _now()),
            )
            connection.execute(
                "INSERT INTO player_stats (player_id, best_combo) VALUES (?, ?) "
                "ON CONFLICT (player_id) DO UPDATE SET best_combo = MAX(best_combo, excluded.best_combo)",
                (player_id, combo),
            )
            return int(cursor.lastrowid)

    def record_incorrect(self, player_id: str) -> None:
        with self._db.write() as connection:
            connection.execute(
                "INSERT INTO player_stats (player_id, incorrect_sequences) VALUES (?, 1) "
                "ON CONFLICT (player_id) DO UPDATE SET incorrect_sequences = incorrect_sequences + 1",
                (player_id,),
            )

    def list_activations(self, player_id: str, limit: int = 100) -> list[dict]:
        with self._db.connect() as connection:
            rows = connection.execute(
                "SELECT id, jutsu_id, jutsu_name, element, points, combo, sequence, created_at "
                "FROM activations WHERE player_id = ? ORDER BY id DESC LIMIT ?",
                (player_id, limit),
            ).fetchall()
        return [{**dict(row), "sequence": json.loads(row["sequence"])} for row in rows]

    def stats(self, player_id: str) -> dict:
        with self._db.connect() as connection:
            totals = connection.execute(
                "SELECT COUNT(*) AS total, COALESCE(SUM(points), 0) AS score "
                "FROM activations WHERE player_id = ?",
                (player_id,),
            ).fetchone()
            per_jutsu = connection.execute(
                "SELECT jutsu_id, COUNT(*) AS count FROM activations WHERE player_id = ? GROUP BY jutsu_id",
                (player_id,),
            ).fetchall()
            player = connection.execute(
                "SELECT best_combo, incorrect_sequences FROM player_stats WHERE player_id = ?",
                (player_id,),
            ).fetchone()
        total = int(totals["total"])
        incorrect = int(player["incorrect_sequences"]) if player else 0
        attempts = total + incorrect
        return {
            "total_activations": total,
            "total_score": int(totals["score"]),
            "best_combo": int(player["best_combo"]) if player else 0,
            "incorrect_sequences": incorrect,
            "accuracy": (total / attempts) if attempts else None,
            "per_jutsu": {row["jutsu_id"]: int(row["count"]) for row in per_jutsu},
        }

    def clear(self, player_id: str) -> None:
        with self._db.write() as connection:
            connection.execute("DELETE FROM activations WHERE player_id = ?", (player_id,))
            connection.execute("DELETE FROM player_stats WHERE player_id = ?", (player_id,))
            connection.execute("DELETE FROM achievements WHERE player_id = ?", (player_id,))


class AchievementRepository:
    def __init__(self, database: Database) -> None:
        self._db = database

    def unlocked(self, player_id: str) -> dict[str, str]:
        with self._db.connect() as connection:
            rows = connection.execute(
                "SELECT achievement_id, unlocked_at FROM achievements WHERE player_id = ?",
                (player_id,),
            ).fetchall()
        return {row["achievement_id"]: row["unlocked_at"] for row in rows}

    def unlock(self, player_id: str, achievement_id: str) -> bool:
        """Returns True when this call newly unlocked the achievement."""
        with self._db.write() as connection:
            cursor = connection.execute(
                "INSERT OR IGNORE INTO achievements (player_id, achievement_id, unlocked_at) VALUES (?, ?, ?)",
                (player_id, achievement_id, _now()),
            )
            return cursor.rowcount > 0
