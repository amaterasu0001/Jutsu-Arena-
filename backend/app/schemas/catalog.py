"""Schemas for signs, jutsu, history, settings and health."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.landmarks import HandIn
from app.schemas.training import ClassMetrics


class SignDiagram(BaseModel):
    left: list[str]
    right: list[str]
    layout: str
    caption: str


class SignOut(BaseModel):
    id: str
    name: str
    kanji: str
    order: int
    description: str
    how_to: list[str]
    hands_required: int
    diagram: SignDiagram
    recognition_status: Literal["untrained", "collecting", "ready_to_train", "trained"]
    #: How the active recogniser identifies this sign right now.
    recognition_source: Literal["builtin", "calibrated", "trained", "unavailable"]
    #: Saved two-hand samples used for personal calibration (0 until there are enough).
    calibration_samples: int
    calibration_min_samples: int
    sample_count: int
    min_samples: int
    recommended_samples: int
    metrics: ClassMetrics | None = None
    used_in: list[str] = Field(default_factory=list)
    reference_hands: list[HandIn] | None = None
    reference_aspect: float | None = None


class SignsResponse(BaseModel):
    signs: list[SignOut]
    model_ready: bool
    recognition_engine: Literal["builtin", "trained", "none"]
    trained_at: str | None
    evaluation_note: str | None


class JutsuOut(BaseModel):
    id: str
    name: str
    subtitle: str
    element: str
    difficulty: Literal["Beginner", "Intermediate", "Advanced"]
    points: int
    effect: str
    description: str
    sequence: list[str]
    #: The effect copies the player from the live camera, so they must be in frame.
    requires_person: bool = False
    unlocked: bool
    missing_signs: list[str]
    times_activated: int


class JutsuResponse(BaseModel):
    jutsu: list[JutsuOut]
    note: str


class JutsuUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sequence: list[str] = Field(min_length=1, max_length=6)


class ActivationRecord(BaseModel):
    id: int
    jutsu_id: str
    jutsu_name: str
    element: str
    points: int
    combo: int
    sequence: list[str]
    created_at: str


class PlayerStats(BaseModel):
    total_activations: int
    total_score: int
    best_combo: int
    incorrect_sequences: int
    accuracy: float | None
    distinct_jutsu: int
    jutsu_total: int
    per_jutsu: dict[str, int]


class AchievementOut(BaseModel):
    id: str
    name: str
    description: str
    icon: str
    metric: str
    threshold: int
    progress: int
    unlocked: bool
    unlocked_at: str | None


class TrainingProgress(BaseModel):
    signs_total: int
    signs_with_samples: int
    signs_trained: int
    total_samples: int
    model_ready: bool


class HistoryResponse(BaseModel):
    activations: list[ActivationRecord]
    stats: PlayerStats
    achievements: list[AchievementOut]
    training: TrainingProgress


class SettingsModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    camera_device_id: str | None = Field(None, max_length=256)
    mirror_camera: bool = True
    show_landmarks: bool = True
    sound_enabled: bool = True
    effects_quality: Literal["low", "medium", "high"] = "high"
    recognition_sensitivity: int = Field(50, ge=0, le=100)
    #: easy = forgiving thresholds; strict = fewer false detections.
    recognition_mode: Literal["easy", "balanced", "strict"] = "easy"
    #: How long a sign must be held steady before it is accepted.
    hold_ms: int = Field(300, ge=150, le=1500)
    #: auto = trained model once it covers every sign, otherwise built-in templates.
    recognition_engine: Literal["auto", "builtin", "trained"] = "auto"
    debug_overlay: bool = False
    # Personalised Shadow Clone effect
    clone_count: Literal[2, 3, 5, 7] = 5
    clone_duration: Literal["short", "normal", "long"] = "normal"
    clone_smoke: bool = True
    clone_sound: bool = True
    clone_formation: Literal["surround", "line", "arrow"] = "surround"
    #: Time allowed between two signs of a sequence.
    sequence_timeout_seconds: int = Field(20, ge=10, le=60)
    #: Length of a timed challenge: easy 180 s, normal 120 s, challenge 90 s.
    game_mode: Literal["easy", "normal", "challenge"] = "normal"
    theme: Literal["crimson", "azure", "violet"] = "crimson"


class SettingsUpdate(BaseModel):
    """Partial update: only provided fields are changed."""

    model_config = ConfigDict(extra="forbid")

    camera_device_id: str | None = Field(None, max_length=256)
    mirror_camera: bool | None = None
    show_landmarks: bool | None = None
    sound_enabled: bool | None = None
    effects_quality: Literal["low", "medium", "high"] | None = None
    recognition_sensitivity: int | None = Field(None, ge=0, le=100)
    recognition_mode: Literal["easy", "balanced", "strict"] | None = None
    hold_ms: int | None = Field(None, ge=150, le=1500)
    recognition_engine: Literal["auto", "builtin", "trained"] | None = None
    debug_overlay: bool | None = None
    clone_count: Literal[2, 3, 5, 7] | None = None
    clone_duration: Literal["short", "normal", "long"] | None = None
    clone_smoke: bool | None = None
    clone_sound: bool | None = None
    clone_formation: Literal["surround", "line", "arrow"] | None = None
    sequence_timeout_seconds: int | None = Field(None, ge=10, le=60)
    game_mode: Literal["easy", "normal", "challenge"] | None = None
    theme: Literal["crimson", "azure", "violet"] | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    model_ready: bool
    model_message: str
    trained_signs: list[str]
    #: Recogniser in use: built-in templates (no training needed) or the trained model.
    recognition_engine: Literal["builtin", "trained", "none"]
    recognizable_signs: list[str]
    calibrated_signs: list[str]
    signs_total: int
    jutsu_total: int
    total_samples: int
    training_state: str
