from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    player_id TEXT NOT NULL,
    key       TEXT NOT NULL,
    value     TEXT NOT NULL,
    PRIMARY KEY (player_id, key)
);

CREATE TABLE IF NOT EXISTS activations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id  TEXT NOT NULL,
    session_id TEXT NOT NULL,
    jutsu_id   TEXT NOT NULL,
    jutsu_name TEXT NOT NULL,
    element    TEXT NOT NULL,
    points     INTEGER NOT NULL,
    combo      INTEGER NOT NULL,
    sequence   TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activations_player ON activations (player_id, id DESC);

CREATE TABLE IF NOT EXISTS player_stats (
    player_id           TEXT PRIMARY KEY,
    best_combo          INTEGER NOT NULL DEFAULT 0,
    incorrect_sequences INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS achievements (
    player_id      TEXT NOT NULL,
    achievement_id TEXT NOT NULL,
    unlocked_at    TEXT NOT NULL,
    PRIMARY KEY (player_id, achievement_id)
);
"""


class Database:
    """Small SQLite wrapper: one short-lived connection per operation."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._write_lock = threading.Lock()
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.executescript(SCHEMA)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self._path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @contextmanager
    def write(self) -> Iterator[sqlite3.Connection]:
        with self._write_lock, self.connect() as connection:
            yield connection
