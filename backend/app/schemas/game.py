"""Schemas for prediction, sequence tracking and gameplay state."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.landmarks import FrameIn

SESSION_ID_PATTERN = r"^[A-Za-z0-9_-]{6,64}$"

PredictionStatus = Literal["no_hands", "model_missing", "unknown", "recognizing", "recognized"]
EventType = Literal[
    "sign_accepted", "jutsu_activated", "incorrect_sequence", "no_match", "sequence_timeout", "person_required"
]


class PredictRequest(FrameIn):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(pattern=SESSION_ID_PATTERN)
    #: When false only classification + smoothing run (used by the Training Studio).
    track_sequence: bool = True
    #: Restrict matching to one jutsu (practice mode). ``None`` = free play.
    target_jutsu_id: str | None = Field(None, max_length=64)
    #: Include per-finger measurements and every sign's score in the response.
    debug: bool = False
    #: Whether the browser currently sees a person (local segmentation). ``None``
    #: = unknown; jutsu that copy the player from the camera need ``True``.
    person_visible: bool | None = None


class SequencePauseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(pattern=SESSION_ID_PATTERN)
    paused: bool


class SequenceResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(pattern=SESSION_ID_PATTERN)
    reset_score: bool = False


class HandsStatus(BaseModel):
    count: int
    left: bool
    right: bool


class TopPrediction(BaseModel):
    sign: str
    confidence: float


EngineName = Literal["builtin", "trained", "none"]


class PredictionOut(BaseModel):
    status: PredictionStatus
    sign: str | None = None
    confidence: float = 0.0
    threshold: float
    stability: float = 0.0
    message: str | None = None
    top: list[TopPrediction] = Field(default_factory=list)
    #: Which recogniser produced this prediction.
    engine: EngineName = "none"
    #: True when the user's own calibration samples contributed to the sign's score.
    calibrated: bool = False
    #: The sign a near-miss pose is closest to and what is off (built-in engine only).
    closest: str | None = None
    hint: str | None = None


class HandDebug(BaseModel):
    slot: Literal["left", "right"]
    #: 0 (curled) .. 1 (extended) for thumb, index, middle, ring, pinky.
    extension: list[float]
    fingers: list[Literal["extended", "half", "curled"]]
    #: Direction from wrist to knuckles in degrees: 0 = up, 90 = right, 180 = down.
    axis_deg: float


class SignScore(BaseModel):
    sign: str
    score: float
    template: float | None = None
    calibration: float | None = None


class DebugOut(BaseModel):
    engine: EngineName
    hands: list[HandDebug] = Field(default_factory=list)
    #: Relations between the detected left and right hand (palm-size units).
    pair: dict[str, float] = Field(default_factory=dict)
    scores: list[SignScore] = Field(default_factory=list)
    #: Conditions of the best-matching sign that are not met.
    unmet: list[str] = Field(default_factory=list)
    margin: float = 0.0
    margin_required: float = 0.0
    idle_similarity: float | None = None
    calibrated_signs: list[str] = Field(default_factory=list)
    hold_ms: int = 0


class SequenceCandidate(BaseModel):
    jutsu_id: str
    matched: int
    total: int


class SequenceOut(BaseModel):
    signs: list[str]
    candidates: list[SequenceCandidate]
    target_jutsu_id: str | None
    timeout_ms: int
    time_remaining_ms: int | None
    locked: bool
    #: True while the game is paused: the countdown is frozen and signs are ignored.
    paused: bool = False


class GameOut(BaseModel):
    score: int
    combo: int
    best_combo: int
    activations: int
    incorrect: int
    signs_accepted: int
    accuracy: float | None
    next_multiplier: float


class AchievementUnlock(BaseModel):
    id: str
    name: str
    description: str
    icon: str


class ActivationOut(BaseModel):
    activation_id: int
    jutsu_id: str
    jutsu_name: str
    element: str
    effect: str
    base_points: int
    multiplier: float
    points: int
    combo: int
    sequence: list[str]
    new_achievements: list[AchievementUnlock] = Field(default_factory=list)


class EventOut(BaseModel):
    id: int
    type: EventType
    sign: str | None = None
    signs: list[str] = Field(default_factory=list)
    jutsu_id: str | None = None
    message: str
    activation: ActivationOut | None = None


class PredictResponse(BaseModel):
    session_id: str
    model_ready: bool
    hands: HandsStatus
    prediction: PredictionOut
    sequence: SequenceOut
    game: GameOut
    event: EventOut | None = None
    debug: DebugOut | None = None


class SequenceResetResponse(BaseModel):
    session_id: str
    sequence: SequenceOut
    game: GameOut
