"""Real-time prediction and sequence control."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import ContainerDep
from app.schemas.game import (
    PredictRequest,
    PredictResponse,
    SequencePauseRequest,
    SequenceResetRequest,
    SequenceResetResponse,
)

router = APIRouter(tags=["gameplay"])


@router.post("/predict", response_model=PredictResponse)
def predict(request: PredictRequest, container: ContainerDep) -> PredictResponse:
    """Classify one frame of landmarks and advance the session's game state."""
    return container.game.process_frame(request)


@router.post("/sequence/reset", response_model=SequenceResetResponse)
def reset_sequence(request: SequenceResetRequest, container: ContainerDep) -> SequenceResetResponse:
    sequence, game = container.game.reset(request.session_id, request.reset_score)
    return SequenceResetResponse(session_id=request.session_id, sequence=sequence, game=game)


@router.post("/sequence/pause", response_model=SequenceResetResponse)
def pause_sequence(request: SequencePauseRequest, container: ContainerDep) -> SequenceResetResponse:
    """Pause or resume the session: the time between signs stops counting while paused."""
    sequence, game = container.game.set_paused(request.session_id, request.paused)
    return SequenceResetResponse(session_id=request.session_id, sequence=sequence, game=game)
