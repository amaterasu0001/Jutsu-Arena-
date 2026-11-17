"""Dataset collection and model training."""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import ContainerDep, model_info, training_plan
from app.core.config import IDLE_LABEL
from app.core.container import Container
from app.core.errors import ConflictError, InvalidRequestError, NotFoundError
from app.schemas.training import (
    DeleteOut,
    LabelStatus,
    SampleBatchIn,
    SampleBatchOut,
    SampleListOut,
    TrainingStatus,
    TrainStartOut,
)

router = APIRouter(prefix="/training", tags=["training"])


def _require_label(container: Container, label: str) -> None:
    if label not in container.dataset.labels:
        raise NotFoundError(f"Unknown label '{label}'.")


def _hands_required(container: Container, label: str) -> int:
    sign = container.registry.sign(label)
    return sign.hands_required if sign else 1


@router.get("/status", response_model=TrainingStatus)
def training_status(container: ContainerDep) -> TrainingStatus:
    config = container.config
    plan = training_plan(container)
    groups = container.dataset.group_counts()
    classes = set(container.classifier.classes)
    report = container.classifier.report

    labels = [
        LabelStatus(
            label=sign.id,
            name=sign.name,
            is_idle=False,
            sample_count=plan.counts.get(sign.id, 0),
            capture_groups=groups.get(sign.id, 0),
            eligible=sign.id in plan.eligible,
            in_model=sign.id in classes,
        )
        for sign in container.registry.signs
    ]
    labels.append(
        LabelStatus(
            label=IDLE_LABEL,
            name="Idle (no sign)",
            is_idle=True,
            sample_count=plan.counts.get(IDLE_LABEL, 0),
            capture_groups=groups.get(IDLE_LABEL, 0),
            eligible=IDLE_LABEL in plan.eligible,
            in_model=IDLE_LABEL in classes,
        )
    )
    return TrainingStatus(
        min_samples_per_class=config.min_samples_per_class,
        recommended_samples_per_class=config.recommended_samples_per_class,
        min_classes=config.min_classes,
        total_samples=sum(plan.counts.values()),
        labels=labels,
        eligible_classes=len(plan.eligible),
        can_train=plan.can_train and not container.training.running,
        blocking_reason=plan.blocking_reason,
        dataset_changed_since_training=(
            report is not None and report.get("dataset_fingerprint") != container.dataset.fingerprint()
        ),
        job=container.training.status(),
        model=model_info(container),
    )


@router.post("/samples", response_model=SampleBatchOut)
def add_samples(batch: SampleBatchIn, container: ContainerDep) -> SampleBatchOut:
    """Save captured landmark samples. Frames without the hands a sign needs are rejected."""
    _require_label(container, batch.label)
    if len(batch.samples) > container.config.max_samples_per_request:
        raise InvalidRequestError(
            f"Too many samples in one request (max {container.config.max_samples_per_request})."
        )

    required = _hands_required(container, batch.label)
    valid = [frame for frame in batch.samples if len(frame.hands) >= required]
    rejected = len(batch.samples) - len(valid)
    if not valid:
        needs = "both hands" if required == 2 else "at least one hand"
        raise InvalidRequestError(
            f"None of the samples show {needs}, so nothing was saved.", code="no_valid_samples"
        )

    saved = container.dataset.add_samples(batch.label, batch.capture_group, valid)
    message = f"Saved {saved} sample{'s' if saved != 1 else ''}."
    if rejected:
        message += f" {rejected} skipped because a required hand was missing."
    return SampleBatchOut(
        label=batch.label,
        saved=saved,
        rejected=rejected,
        total_for_label=container.dataset.count(batch.label),
        message=message,
    )


@router.get("/samples", response_model=SampleListOut)
def list_samples(
    container: ContainerDep,
    label: str = Query(min_length=1, max_length=32),
    limit: int = Query(48, ge=1, le=200),
) -> SampleListOut:
    _require_label(container, label)
    records = container.dataset.list_samples(label, limit=limit)
    return SampleListOut(
        label=label,
        total=container.dataset.count(label),
        samples=[{**record, "label": label} for record in records],
    )


@router.delete("/samples/{label}/{sample_id}", response_model=DeleteOut)
def delete_sample(label: str, sample_id: str, container: ContainerDep) -> DeleteOut:
    _require_label(container, label)
    deleted = container.dataset.delete_sample(label, sample_id)
    if not deleted:
        raise NotFoundError("That sample no longer exists.")
    return DeleteOut(deleted=deleted, total_for_label=container.dataset.count(label))


@router.delete("/samples/{label}", response_model=DeleteOut)
def clear_label(label: str, container: ContainerDep) -> DeleteOut:
    _require_label(container, label)
    deleted = container.dataset.clear_label(label)
    return DeleteOut(deleted=deleted, total_for_label=0)


@router.post("/train", response_model=TrainStartOut, status_code=202)
def start_training(container: ContainerDep) -> TrainStartOut:
    """Start training in the background. Poll ``/training/status`` for the result."""
    plan = training_plan(container)
    if not plan.can_train:
        raise InvalidRequestError(plan.blocking_reason or "Not enough data to train.", code="insufficient_data")
    if not container.training.start():
        raise ConflictError("Training is already running.", code="training_in_progress")
    return TrainStartOut(started=True, message="Training started.", job=container.training.status())
