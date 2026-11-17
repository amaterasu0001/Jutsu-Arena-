from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from app.core.config import IDLE_LABEL
from app.core.container import Container
from app.recognition.trainer import plan_training
from app.schemas.training import ModelInfo


def get_container(request: Request) -> Container:
    return request.app.state.container


ContainerDep = Annotated[Container, Depends(get_container)]


def trained_signs(container: Container) -> list[str]:
    return [label for label in container.classifier.classes if label != IDLE_LABEL]


def active_engine(container: Container) -> str:
    """The recogniser the default player's settings resolve to right now."""
    settings = container.settings.get(container.config.default_player_id)
    return container.recognizer.resolve(settings.recognition_engine)


def recognizable_signs(container: Container) -> list[str]:
    """Signs the active recogniser can actually report."""
    engine = active_engine(container)
    if engine == "builtin":
        return container.recognizer.templates.sign_ids
    if engine == "trained":
        return trained_signs(container)
    return []


def calibrated_signs(container: Container) -> dict[str, int]:
    return {label: count for label, count in container.calibration.calibrated().items() if label != IDLE_LABEL}


def model_info(container: Container) -> ModelInfo:
    classifier = container.classifier
    report = classifier.report
    if report is None:
        return ModelInfo(ready=False, message=classifier.message)
    return ModelInfo(
        ready=True,
        message=classifier.message,
        trained_at=report["trained_at"],
        classes=report["classes"],
        trained_signs=trained_signs(container),
        samples_per_class=report["samples_per_class"],
        skipped_classes=report.get("skipped_classes", {}),
        total_samples=report["total_samples"],
        feature_count=report["feature_count"],
        evaluation=report.get("evaluation"),
        evaluation_note=report.get("evaluation_note"),
    )


def training_plan(container: Container):
    config = container.config
    return plan_training(container.dataset.counts(), config.min_samples_per_class, config.min_classes)
