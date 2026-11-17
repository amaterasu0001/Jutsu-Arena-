from __future__ import annotations

from fastapi import APIRouter

from app import __version__
from app.api.deps import ContainerDep, active_engine, calibrated_signs, recognizable_signs, trained_signs
from app.schemas.catalog import HealthResponse

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthResponse)
def health(container: ContainerDep) -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=__version__,
        model_ready=container.classifier.ready,
        model_message=container.classifier.message,
        trained_signs=trained_signs(container),
        recognition_engine=active_engine(container),
        recognizable_signs=recognizable_signs(container),
        calibrated_signs=sorted(calibrated_signs(container)),
        signs_total=len(container.registry.signs),
        jutsu_total=len(container.registry.jutsu),
        total_samples=sum(container.dataset.counts().values()),
        training_state=container.training.status()["state"],
    )
