"""Run model training on a background thread so the API stays responsive."""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from app.recognition.classifier import SignClassifier
from app.recognition.dataset import DatasetStore
from app.recognition.trainer import InsufficientDataError, train_model

logger = logging.getLogger("jutsu_arena.training")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class TrainingJobManager:
    def __init__(
        self,
        dataset: DatasetStore,
        classifier: SignClassifier,
        model_dir: Path,
        *,
        min_samples: int,
        min_classes: int,
        n_estimators: int,
        on_trained: Callable[[dict], None] | None = None,
    ) -> None:
        self._dataset = dataset
        self._classifier = classifier
        self._model_dir = model_dir
        self._min_samples = min_samples
        self._min_classes = min_classes
        self._n_estimators = n_estimators
        self._on_trained = on_trained
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._state = {"state": "idle", "started_at": None, "finished_at": None, "message": None}

    def status(self) -> dict:
        with self._lock:
            return dict(self._state)

    @property
    def running(self) -> bool:
        return self.status()["state"] == "running"

    def start(self) -> bool:
        """Start training. Returns False when a job is already running."""
        with self._lock:
            if self._state["state"] == "running":
                return False
            self._state = {
                "state": "running",
                "started_at": _now(),
                "finished_at": None,
                "message": "Training in progress...",
            }
            self._thread = threading.Thread(target=self._run, name="sign-training", daemon=True)
            self._thread.start()
        return True

    def wait(self, timeout: float | None = None) -> None:
        thread = self._thread
        if thread is not None:
            thread.join(timeout)

    def _finish(self, state: str, message: str) -> None:
        with self._lock:
            self._state = {**self._state, "state": state, "finished_at": _now(), "message": message}

    def _run(self) -> None:
        try:
            report = train_model(
                self._dataset,
                self._model_dir,
                min_samples=self._min_samples,
                min_classes=self._min_classes,
                n_estimators=self._n_estimators,
            )
            self._classifier.load()
            if self._on_trained is not None:
                try:
                    self._on_trained(report)
                except Exception:  # a hook failure must not mark training as failed
                    logger.exception("Post-training hook failed")
            self._finish(
                "completed",
                f"Trained on {report['total_samples']} samples across {len(report['classes'])} classes.",
            )
        except InsufficientDataError as exc:
            self._finish("failed", str(exc))
        except Exception as exc:
            logger.exception("Training failed")
            self._finish("failed", f"Training failed: {exc}")
