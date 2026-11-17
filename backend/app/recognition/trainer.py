"""Train and evaluate the hand-sign classifier from the collected dataset."""

from __future__ import annotations

import json
import warnings
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
from sklearn.base import clone
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold, cross_val_predict

from app.computer_vision import FEATURE_COUNT, FEATURE_VERSION
from app.core.config import IDLE_LABEL
from app.recognition.dataset import DatasetStore

MODEL_FILE = "sign_classifier.joblib"
REPORT_FILE = "sign_classifier.report.json"


class InsufficientDataError(Exception):
    """Raised when the dataset cannot support training yet."""


@dataclass(frozen=True)
class TrainingPlan:
    eligible: list[str]
    skipped: dict[str, int]
    counts: dict[str, int]
    blocking_reason: str | None

    @property
    def can_train(self) -> bool:
        return self.blocking_reason is None


def plan_training(counts: dict[str, int], min_samples: int, min_classes: int) -> TrainingPlan:
    """Decide which labels have enough samples and whether training may run."""
    eligible = [label for label, count in counts.items() if count >= min_samples]
    skipped = {label: count for label, count in counts.items() if 0 < count < min_samples}
    signs = [label for label in eligible if label != IDLE_LABEL]

    reason: str | None = None
    if sum(counts.values()) == 0:
        reason = "The dataset is empty. Capture samples for at least two hand signs first."
    elif not signs:
        reason = (
            f"No hand sign has the minimum of {min_samples} samples yet. "
            "Keep capturing before training."
        )
    elif len(eligible) < min_classes:
        reason = (
            f"Only {len(eligible)} class has {min_samples}+ samples. A classifier needs at least "
            f"{min_classes} classes to tell signs apart - capture another sign or the idle pose."
        )
    return TrainingPlan(eligible=eligible, skipped=skipped, counts=counts, blocking_reason=reason)


def _evaluate(
    estimator: RandomForestClassifier,
    features: np.ndarray,
    targets: np.ndarray,
    groups: np.ndarray,
    labels: list[str],
) -> tuple[dict | None, str | None]:
    """Cross-validate and return ``(evaluation, note_if_unavailable)``."""
    class_sizes = {label: int(np.sum(targets == label)) for label in labels}
    groups_per_class = {label: len(set(groups[targets == label])) for label in labels}
    min_groups = min(groups_per_class.values())
    group_aware = min_groups >= 2

    if group_aware:
        folds = min(5, min_groups)
        splitter = StratifiedGroupKFold(n_splits=folds, shuffle=True, random_state=7)
        split_args = {"groups": groups}
        method = "stratified group k-fold cross-validation"
        note = (
            "Each capture burst was kept entirely in either the training or the test fold, so "
            "these numbers reflect how the model handles bursts it has never seen."
        )
    else:
        folds = min(5, min(class_sizes.values()))
        if folds < 2:
            return None, "Not enough samples per class to run cross-validation."
        splitter = StratifiedKFold(n_splits=folds, shuffle=True, random_state=7)
        split_args = {}
        method = "stratified k-fold cross-validation"
        note = (
            "At least one sign was captured in a single burst, so frames from the same burst "
            "appear in both training and test folds. These numbers are optimistic - capture each "
            "sign in several separate bursts for a trustworthy estimate."
        )

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            predicted = cross_val_predict(
                clone(estimator), features, targets, cv=splitter, method="predict", **split_args
            )
    except ValueError as exc:
        return None, f"Evaluation could not be completed: {exc}"

    precision, recall, f1, support = precision_recall_fscore_support(
        targets, predicted, labels=labels, zero_division=0
    )
    matrix = confusion_matrix(targets, predicted, labels=labels)
    evaluation = {
        "method": method,
        "folds": folds,
        "group_aware": group_aware,
        "accuracy": float(accuracy_score(targets, predicted)),
        "macro_f1": float(f1_score(targets, predicted, labels=labels, average="macro", zero_division=0)),
        "per_class": {
            label: {
                "precision": float(precision[index]),
                "recall": float(recall[index]),
                "f1": float(f1[index]),
                "support": int(support[index]),
            }
            for index, label in enumerate(labels)
        },
        "confusion_matrix": {"labels": labels, "matrix": matrix.astype(int).tolist()},
        "note": note,
    }
    return evaluation, None


def train_model(
    dataset: DatasetStore,
    model_dir: Path,
    *,
    min_samples: int,
    min_classes: int,
    n_estimators: int = 150,
) -> dict:
    """Train on every eligible label, evaluate with cross-validation and save.

    Returns the training report. Raises :class:`InsufficientDataError` when the
    dataset is empty or incomplete.
    """
    plan = plan_training(dataset.counts(), min_samples, min_classes)
    if not plan.can_train:
        raise InsufficientDataError(plan.blocking_reason)

    fingerprint = dataset.fingerprint()
    features, targets, groups = dataset.load_matrix(plan.eligible)
    labels = sorted(set(targets.tolist()))
    usable = {label: int(np.sum(targets == label)) for label in labels}
    if len(labels) < min_classes or any(count < min_samples for count in usable.values()):
        raise InsufficientDataError(
            "Some stored samples are unreadable, leaving too little valid data to train."
        )

    estimator = RandomForestClassifier(
        n_estimators=n_estimators,
        class_weight="balanced",
        min_samples_leaf=1,
        random_state=7,
        n_jobs=1,
    )
    evaluation, evaluation_note = _evaluate(estimator, features, targets, groups, labels)

    # The deployed model is fitted on all eligible data; the metrics above come
    # from held-out folds of that same data.
    estimator.fit(features, targets)

    report = {
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "classes": [str(label) for label in estimator.classes_],
        "samples_per_class": usable,
        "skipped_classes": plan.skipped,
        "total_samples": int(len(targets)),
        "feature_version": FEATURE_VERSION,
        "feature_count": FEATURE_COUNT,
        "n_estimators": n_estimators,
        "dataset_fingerprint": fingerprint,
        "evaluation": evaluation,
        "evaluation_note": evaluation_note,
    }

    model_dir.mkdir(parents=True, exist_ok=True)
    temp_model = model_dir / (MODEL_FILE + ".tmp")
    joblib.dump({"model": estimator, "report": report}, temp_model)
    temp_model.replace(model_dir / MODEL_FILE)
    (model_dir / REPORT_FILE).write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report
