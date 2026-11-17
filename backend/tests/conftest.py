from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.core.config import AppConfig  # noqa: E402
from app.core.container import build_container  # noqa: E402
from app.factory import create_app  # noqa: E402


class FakeClock:
    """Manually advanced clock (seconds) so timing logic is deterministic."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def config(tmp_path: Path) -> AppConfig:
    config_dir = tmp_path / "config"
    shutil.copytree(BACKEND_DIR / "config", config_dir)
    return AppConfig(
        config_dir=config_dir,
        dataset_dir=tmp_path / "dataset",
        model_dir=tmp_path / "models",
        database_path=tmp_path / "data" / "test.sqlite3",
        min_samples_per_class=12,
        forest_trees=30,
        sign_cooldown_ms=0,
    )


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def container(config: AppConfig, clock: FakeClock):
    return build_container(config, clock=clock)


@pytest.fixture
def client(container) -> TestClient:
    return TestClient(create_app(container=container))
