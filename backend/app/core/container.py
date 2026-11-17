"""Builds and holds the application's services (one instance per app)."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable

from app.core.config import IDLE_LABEL, AppConfig
from app.database import AchievementRepository, Database, HistoryRepository, SettingsRepository
from app.game.achievements import AchievementService
from app.game.service import GameService
from app.jutsu import GameRegistry
from app.recognition.calibration import CalibrationIndex
from app.recognition.classifier import SignClassifier
from app.recognition.dataset import DatasetStore
from app.recognition.engine import SignRecognizer
from app.recognition.training_job import TrainingJobManager


@dataclass
class Container:
    config: AppConfig
    registry: GameRegistry
    dataset: DatasetStore
    classifier: SignClassifier
    calibration: CalibrationIndex
    recognizer: SignRecognizer
    database: Database
    settings: SettingsRepository
    history: HistoryRepository
    achievements: AchievementService
    training: TrainingJobManager
    game: GameService


def build_container(config: AppConfig, clock: Callable[[], float] = time.monotonic) -> Container:
    registry = GameRegistry(config.config_dir)
    dataset = DatasetStore(config.dataset_dir, registry.sign_ids + [IDLE_LABEL])
    classifier = SignClassifier(config.model_dir)
    calibration = CalibrationIndex(dataset, min_samples=config.calibration_min_samples)
    recognizer = SignRecognizer(registry.template_recognizer(), calibration, classifier, registry.sign_ids)
    database = Database(config.database_path)
    settings = SettingsRepository(database)
    history = HistoryRepository(database)
    achievements = AchievementService(registry, history, AchievementRepository(database), classifier)
    training = TrainingJobManager(
        dataset,
        classifier,
        config.model_dir,
        min_samples=config.min_samples_per_class,
        min_classes=config.min_classes,
        n_estimators=config.forest_trees,
        on_trained=lambda _report: achievements.evaluate(config.default_player_id),
    )
    game = GameService(config, registry, recognizer, settings, history, achievements, clock=clock)
    return Container(
        config=config,
        registry=registry,
        dataset=dataset,
        classifier=classifier,
        calibration=calibration,
        recognizer=recognizer,
        database=database,
        settings=settings,
        history=history,
        achievements=achievements,
        training=training,
        game=game,
    )
