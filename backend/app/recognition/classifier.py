"""Load the trained model and run single-frame inference."""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np

from app.computer_vision import FEATURE_COUNT, FEATURE_VERSION
from app.recognition.trainer import MODEL_FILE

logger = logging.getLogger("jutsu_arena.classifier")

NO_MODEL_MESSAGE = (
    "No trained model yet. Open the Training Studio, capture samples for at least two hand "
    "signs and train the model."
)


@dataclass(frozen=True)
class RawPrediction:
    label: str
    confidence: float
    #: Class probabilities, highest first.
    ranked: list[tuple[str, float]]


class SignClassifier:
    """Thread-safe holder for the current model."""

    def __init__(self, model_dir: Path) -> None:
        self._path = model_dir / MODEL_FILE
        self._lock = threading.Lock()
        self._model = None
        self._report: dict | None = None
        self._message = NO_MODEL_MESSAGE
        self.load()

    def load(self) -> bool:
        """(Re)load the model from disk. Returns whether a usable model is loaded."""
        model, report, message = None, None, NO_MODEL_MESSAGE
        if self._path.is_file():
            try:
                bundle = joblib.load(self._path)
                candidate, candidate_report = bundle["model"], bundle["report"]
                if candidate_report.get("feature_version") != FEATURE_VERSION or (
                    getattr(candidate, "n_features_in_", FEATURE_COUNT) != FEATURE_COUNT
                ):
                    message = (
                        "The saved model was trained with an older feature format. "
                        "Retrain it from the Training Studio."
                    )
                else:
                    model, report = candidate, candidate_report
                    message = "Model loaded."
            except Exception as exc:  # corrupted or incompatible file
                logger.warning("Could not load model %s: %s", self._path, exc)
                message = "The saved model file could not be read. Retrain it from the Training Studio."
        with self._lock:
            self._model, self._report, self._message = model, report, message
        return model is not None

    @property
    def ready(self) -> bool:
        return self._model is not None

    @property
    def message(self) -> str:
        return self._message

    @property
    def report(self) -> dict | None:
        return self._report

    @property
    def classes(self) -> list[str]:
        report = self._report
        return list(report["classes"]) if report else []

    def predict(self, features: np.ndarray) -> RawPrediction | None:
        with self._lock:
            model = self._model
        if model is None:
            return None
        probabilities = model.predict_proba(features.reshape(1, -1))[0]
        order = np.argsort(probabilities)[::-1]
        ranked = [(str(model.classes_[index]), float(probabilities[index])) for index in order]
        return RawPrediction(label=ranked[0][0], confidence=ranked[0][1], ranked=ranked)
