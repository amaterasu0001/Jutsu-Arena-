"""Environment driven application configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]

#: Reserved dataset label for "hands visible but no sign is being made".
IDLE_LABEL = "none"


def load_env_file(path: Path) -> None:
    """Load KEY=VALUE pairs from ``path`` without overriding real env vars."""
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _resolve(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else BACKEND_DIR / path


def _int(name: str, default: int, minimum: int = 0) -> int:
    try:
        return max(minimum, int(os.environ.get(name, default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class AppConfig:
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")

    config_dir: Path = BACKEND_DIR / "config"
    dataset_dir: Path = BACKEND_DIR / "dataset"
    model_dir: Path = BACKEND_DIR / "trained_models"
    database_path: Path = BACKEND_DIR / "data" / "jutsu_arena.sqlite3"

    # Training
    min_samples_per_class: int = 20
    recommended_samples_per_class: int = 80
    min_classes: int = 2
    max_samples_per_request: int = 300
    forest_trees: int = 150

    # Recognition stability (the hold time and mode are per-player settings)
    release_ms: int = 250
    sign_cooldown_ms: int = 300
    min_hold_frames: int = 2
    #: Time constant of the score smoothing (0 disables it).
    score_smoothing_ms: int = 100
    #: Saved samples a sign needs before they are used for personal calibration.
    calibration_min_samples: int = 8

    # Gameplay
    activation_lockout_ms: int = 2500
    session_ttl_seconds: int = 1800
    default_player_id: str = "local"

    @classmethod
    def from_env(cls) -> "AppConfig":
        load_env_file(BACKEND_DIR / ".env")
        env = os.environ
        origins = tuple(
            origin.strip()
            for origin in env.get("JUTSU_CORS_ORIGINS", ",".join(cls.cors_origins)).split(",")
            if origin.strip()
        )
        return cls(
            host=env.get("JUTSU_HOST", cls.host),
            port=_int("JUTSU_PORT", cls.port, 1),
            cors_origins=origins or cls.cors_origins,
            config_dir=_resolve(env.get("JUTSU_CONFIG_DIR", "config")),
            dataset_dir=_resolve(env.get("JUTSU_DATASET_DIR", "dataset")),
            model_dir=_resolve(env.get("JUTSU_MODEL_DIR", "trained_models")),
            database_path=_resolve(env.get("JUTSU_DATABASE_PATH", "data/jutsu_arena.sqlite3")),
            min_samples_per_class=_int("JUTSU_MIN_SAMPLES_PER_CLASS", cls.min_samples_per_class, 5),
            recommended_samples_per_class=_int(
                "JUTSU_RECOMMENDED_SAMPLES_PER_CLASS", cls.recommended_samples_per_class, 5
            ),
            forest_trees=_int("JUTSU_FOREST_TREES", cls.forest_trees, 10),
            release_ms=_int("JUTSU_RELEASE_MS", cls.release_ms, 0),
            sign_cooldown_ms=_int("JUTSU_SIGN_COOLDOWN_MS", cls.sign_cooldown_ms, 0),
            min_hold_frames=_int("JUTSU_MIN_HOLD_FRAMES", cls.min_hold_frames, 1),
            score_smoothing_ms=_int("JUTSU_SCORE_SMOOTHING_MS", cls.score_smoothing_ms, 0),
            calibration_min_samples=_int("JUTSU_CALIBRATION_MIN_SAMPLES", cls.calibration_min_samples, 3),
            activation_lockout_ms=_int("JUTSU_ACTIVATION_LOCKOUT_MS", cls.activation_lockout_ms, 0),
            session_ttl_seconds=_int("JUTSU_SESSION_TTL_SECONDS", cls.session_ttl_seconds, 60),
        )
