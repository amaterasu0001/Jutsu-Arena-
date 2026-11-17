from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import ContainerDep, trained_signs
from app.schemas.catalog import HistoryResponse, PlayerStats, TrainingProgress

router = APIRouter(tags=["history"])


@router.get("/history", response_model=HistoryResponse)
def get_history(container: ContainerDep, limit: int = Query(100, ge=1, le=500)) -> HistoryResponse:
    player_id = container.config.default_player_id
    stats = container.history.stats(player_id)
    counts = container.dataset.counts()
    sign_ids = container.registry.sign_ids
    return HistoryResponse(
        activations=container.history.list_activations(player_id, limit),
        stats=PlayerStats(
            **stats,
            distinct_jutsu=len(stats["per_jutsu"]),
            jutsu_total=len(container.registry.jutsu),
        ),
        achievements=container.achievements.overview(player_id),
        training=TrainingProgress(
            signs_total=len(sign_ids),
            signs_with_samples=sum(1 for sign in sign_ids if counts.get(sign, 0) > 0),
            signs_trained=len(trained_signs(container)),
            total_samples=sum(counts.values()),
            model_ready=container.classifier.ready,
        ),
    )


@router.delete("/history", status_code=204)
def clear_history(container: ContainerDep) -> None:
    """Erase activations, stats and achievements (training data is untouched)."""
    container.history.clear(container.config.default_player_id)
