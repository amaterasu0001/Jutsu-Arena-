"""Schemas for dataset collection and model training."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.landmarks import FrameIn, HandIn


class SampleBatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=32)
    #: Identifies one capture burst so evaluation can keep bursts together.
    capture_group: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    samples: list[FrameIn] = Field(min_length=1)


class SampleBatchOut(BaseModel):
    label: str
    saved: int
    rejected: int
    total_for_label: int
    message: str


class StoredSample(BaseModel):
    id: str
    label: str
    created_at: str
    capture_group: str
    image_width: int
    image_height: int
    hands: list[HandIn]


class SampleListOut(BaseModel):
    label: str
    total: int
    samples: list[StoredSample]


class DeleteOut(BaseModel):
    deleted: int
    total_for_label: int


class ClassMetrics(BaseModel):
    precision: float
    recall: float
    f1: float
    support: int


class ConfusionMatrix(BaseModel):
    labels: list[str]
    matrix: list[list[int]]


class EvaluationOut(BaseModel):
    method: str
    folds: int
    group_aware: bool
    accuracy: float
    macro_f1: float
    per_class: dict[str, ClassMetrics]
    confusion_matrix: ConfusionMatrix
    note: str


class ModelInfo(BaseModel):
    ready: bool
    message: str
    trained_at: str | None = None
    classes: list[str] = Field(default_factory=list)
    trained_signs: list[str] = Field(default_factory=list)
    samples_per_class: dict[str, int] = Field(default_factory=dict)
    skipped_classes: dict[str, int] = Field(default_factory=dict)
    total_samples: int = 0
    feature_count: int = 0
    evaluation: EvaluationOut | None = None
    evaluation_note: str | None = None


class LabelStatus(BaseModel):
    label: str
    name: str
    is_idle: bool
    sample_count: int
    capture_groups: int
    eligible: bool
    in_model: bool


class TrainingJob(BaseModel):
    state: Literal["idle", "running", "completed", "failed"]
    started_at: str | None = None
    finished_at: str | None = None
    message: str | None = None


class TrainingStatus(BaseModel):
    min_samples_per_class: int
    recommended_samples_per_class: int
    min_classes: int
    total_samples: int
    labels: list[LabelStatus]
    eligible_classes: int
    can_train: bool
    blocking_reason: str | None
    dataset_changed_since_training: bool
    job: TrainingJob
    model: ModelInfo


class TrainStartOut(BaseModel):
    started: bool
    message: str
    job: TrainingJob
