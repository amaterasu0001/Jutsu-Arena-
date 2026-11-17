"""Dataset, training, model loading and inference (on synthetic landmarks)."""

from __future__ import annotations

import pytest

from app.computer_vision import build_frame, extract_features
from app.core.config import IDLE_LABEL
from app.recognition.classifier import SignClassifier
from app.recognition.dataset import DatasetStore
from app.recognition.trainer import MODEL_FILE, InsufficientDataError, plan_training, train_model
from app.schemas.landmarks import FrameIn
from helpers import make_batch, make_frame

LABELS = ["tiger", "snake", "ram", "ox", IDLE_LABEL]


def frames(pose: str, count: int, seed: int = 0) -> list[FrameIn]:
    return [FrameIn.model_validate(frame) for frame in make_batch(pose, count, seed)]


@pytest.fixture
def dataset(tmp_path) -> DatasetStore:
    return DatasetStore(tmp_path / "dataset", LABELS)


def fill(dataset: DatasetStore, poses=("tiger", "snake", "ram"), per_burst: int = 10, bursts: int = 2) -> None:
    for pose in poses:
        for burst in range(bursts):
            dataset.add_samples(pose, f"burst{burst}", frames(pose, per_burst, seed=hash((pose, burst)) % 1000))


def test_dataset_is_organised_by_label_and_counts_samples(dataset, tmp_path):
    dataset.add_samples("tiger", "a", frames("tiger", 5))
    dataset.add_samples("snake", "a", frames("snake", 3))
    assert dataset.counts() == {"tiger": 5, "snake": 3, "ram": 0, "ox": 0, IDLE_LABEL: 0}
    assert (tmp_path / "dataset" / "tiger" / "samples.jsonl").is_file()


def test_delete_sample_and_clear_label(dataset):
    dataset.add_samples("tiger", "a", frames("tiger", 4))
    sample_id = dataset.list_samples("tiger")[0]["id"]
    assert dataset.delete_sample("tiger", sample_id) == 1
    assert dataset.delete_sample("tiger", sample_id) == 0
    assert dataset.count("tiger") == 3
    assert dataset.clear_label("tiger") == 3
    assert dataset.count("tiger") == 0


def test_unknown_label_is_rejected(dataset):
    with pytest.raises(KeyError):
        dataset.add_samples("giraffe", "a", frames("tiger", 1))


def test_corrupted_lines_are_skipped(dataset, tmp_path):
    dataset.add_samples("tiger", "a", frames("tiger", 2))
    with (tmp_path / "dataset" / "tiger" / "samples.jsonl").open("a", encoding="utf-8") as handle:
        handle.write("{not json\n")
    assert dataset.count("tiger") == 2


def test_training_plan_guards_against_empty_and_incomplete_datasets():
    empty = plan_training({"tiger": 0, "snake": 0}, min_samples=10, min_classes=2)
    assert not empty.can_train and "empty" in empty.blocking_reason

    too_few = plan_training({"tiger": 4, "snake": 9}, min_samples=10, min_classes=2)
    assert not too_few.can_train and too_few.skipped == {"tiger": 4, "snake": 9}

    one_class = plan_training({"tiger": 30, "snake": 2}, min_samples=10, min_classes=2)
    assert not one_class.can_train and "at least 2 classes" in one_class.blocking_reason

    only_idle = plan_training({IDLE_LABEL: 30, "tiger": 0}, min_samples=10, min_classes=2)
    assert not only_idle.can_train

    ok = plan_training({"tiger": 30, "snake": 12, "ram": 3}, min_samples=10, min_classes=2)
    assert ok.can_train and ok.eligible == ["tiger", "snake"] and ok.skipped == {"ram": 3}


def test_training_refuses_empty_dataset(dataset, tmp_path):
    with pytest.raises(InsufficientDataError):
        train_model(dataset, tmp_path / "models", min_samples=10, min_classes=2, n_estimators=10)
    assert not (tmp_path / "models" / MODEL_FILE).exists()


def test_train_save_load_and_predict(dataset, tmp_path):
    fill(dataset)
    dataset.add_samples("ox", "a", frames("ox", 3))  # below the minimum: must be skipped
    model_dir = tmp_path / "models"

    report = train_model(dataset, model_dir, min_samples=10, min_classes=2, n_estimators=30)

    assert report["classes"] == ["ram", "snake", "tiger"]
    assert report["skipped_classes"] == {"ox": 3}
    assert report["total_samples"] == 60
    evaluation = report["evaluation"]
    assert evaluation["group_aware"] is True and evaluation["folds"] == 2
    assert set(evaluation["per_class"]) == {"ram", "snake", "tiger"}
    assert sum(sum(row) for row in evaluation["confusion_matrix"]["matrix"]) == 60
    assert 0.0 <= evaluation["accuracy"] <= 1.0

    classifier = SignClassifier(model_dir)
    assert classifier.ready and classifier.classes == ["ram", "snake", "tiger"]

    for pose in ("tiger", "snake", "ram"):
        unseen = FrameIn.model_validate(make_frame(pose, jitter=0.012))
        prediction = classifier.predict(extract_features(build_frame(unseen)))
        assert prediction.label == pose
        assert prediction.ranked[0][1] == prediction.confidence
        assert abs(sum(p for _, p in prediction.ranked) - 1.0) < 1e-6


def test_single_burst_per_class_is_flagged_as_optimistic(dataset, tmp_path):
    fill(dataset, bursts=1, per_burst=12)
    report = train_model(dataset, tmp_path / "models", min_samples=10, min_classes=2, n_estimators=20)
    assert report["evaluation"]["group_aware"] is False
    assert "optimistic" in report["evaluation"]["note"]


def test_classifier_without_model_reports_setup_message(tmp_path):
    classifier = SignClassifier(tmp_path / "missing")
    assert not classifier.ready
    assert "Training Studio" in classifier.message
    assert classifier.predict(extract_features(build_frame(FrameIn.model_validate(make_frame("tiger"))))) is None


def test_corrupted_model_file_is_handled(tmp_path):
    tmp_path.joinpath(MODEL_FILE).write_bytes(b"this is not a model")
    classifier = SignClassifier(tmp_path)
    assert not classifier.ready
    assert "could not be read" in classifier.message


def test_model_from_older_feature_version_is_not_used(dataset, tmp_path, monkeypatch):
    fill(dataset)
    model_dir = tmp_path / "models"
    train_model(dataset, model_dir, min_samples=10, min_classes=2, n_estimators=10)
    monkeypatch.setattr("app.recognition.classifier.FEATURE_VERSION", 999)
    classifier = SignClassifier(model_dir)
    assert not classifier.ready and "older feature format" in classifier.message
