"""Personal calibration: match live poses against the user's own saved samples.

Any frames saved in the Training Studio double as calibration data. As soon as
a sign has a handful of samples (one short burst), live frames are compared
with them directly - nearest neighbours on the compact pose descriptor from
:func:`app.computer_vision.pose.descriptor` - with no training step.

The match tolerance of each sign adapts to how much the user's samples vary
*between* capture sessions (bursts), which is what a live attempt will look
like - consecutive frames inside one burst are nearly identical and would make
the tolerance far too tight. Samples of the idle class act as counter-examples.
"""

from __future__ import annotations

import math
import threading
from dataclasses import dataclass

import numpy as np

from app.computer_vision import build_frame
from app.computer_vision.pose import FramePose, describe_frame, descriptor
from app.recognition.dataset import DatasetStore
from app.schemas.landmarks import FrameIn

#: Fewest two-hand samples before a sign counts as calibrated.
DEFAULT_MIN_SAMPLES = 8
#: At most this many samples per sign are kept for matching (newest win).
MAX_SAMPLES_PER_SIGN = 400
_NEIGHBOURS = 3
_TOLERANCE_MIN = 0.08
_TOLERANCE_MAX = 0.50
#: "Something else" mass when turning similarities into relative confidences.
_OTHER_PRIOR = 0.15


@dataclass(frozen=True)
class CalibrationEntry:
    samples: np.ndarray
    tolerance: float


def _rms_distances(sample: np.ndarray, samples: np.ndarray) -> np.ndarray:
    return np.sqrt(np.mean((samples - sample) ** 2, axis=1))


def _tolerance(samples: np.ndarray, groups: list[str]) -> float:
    """Match tolerance from the spread of the samples.

    With two or more bursts: the typical distance from a sample to the nearest
    sample of a *different* burst, so a fresh attempt scores about 0.6.
    With a single burst: three times the typical nearest-neighbour distance.
    """
    if len(samples) < 2:
        return _TOLERANCE_MAX
    labels = np.asarray(groups)
    cross_burst = len(set(groups)) >= 2
    nearest = []
    for index in range(len(samples)):
        mask = labels != labels[index] if cross_burst else np.arange(len(samples)) != index
        if mask.any():
            nearest.append(float(_rms_distances(samples[index], samples[mask]).min()))
    if not nearest:
        return _TOLERANCE_MAX
    scale = 1.0 if cross_burst else 3.0
    return float(min(_TOLERANCE_MAX, max(_TOLERANCE_MIN, scale * float(np.median(nearest)))))


def relative_confidences(similarities: dict[str, float]) -> dict[str, float]:
    """How much better each label matches than every other recorded label.

    ``similarity / (sum of all similarities + prior)``: close to the raw
    similarity when one label clearly wins, much lower when the pose resembles
    several recorded signs or none of them.
    """
    total = sum(similarities.values()) + _OTHER_PRIOR
    return {label: value / total for label, value in similarities.items()}


class CalibrationIndex:
    """Cached nearest-neighbour index over the saved samples, rebuilt when the dataset changes."""

    def __init__(self, dataset: DatasetStore, min_samples: int = DEFAULT_MIN_SAMPLES) -> None:
        self._dataset = dataset
        self.min_samples = min_samples
        self._lock = threading.Lock()
        self._fingerprint: str | None = None
        self._entries: dict[str, CalibrationEntry] = {}

    def _build(self) -> dict[str, CalibrationEntry]:
        entries: dict[str, CalibrationEntry] = {}
        for label in self._dataset.labels:
            vectors: list[np.ndarray] = []
            groups: list[str] = []
            for record in self._dataset.list_samples(label, limit=MAX_SAMPLES_PER_SIGN):
                try:
                    frame = FrameIn.model_validate(
                        {
                            "hands": record["hands"],
                            "image_width": record.get("image_width", 1280),
                            "image_height": record.get("image_height", 720),
                        }
                    )
                except (KeyError, ValueError):
                    continue
                pose = describe_frame(build_frame(frame))
                if pose.left is not None and pose.right is not None:
                    vectors.append(descriptor(pose.left, pose.right))
                    groups.append(str(record.get("capture_group", "")))
            if len(vectors) >= self.min_samples:
                samples = np.vstack(vectors)
                entries[label] = CalibrationEntry(samples=samples, tolerance=_tolerance(samples, groups))
        return entries

    def entries(self) -> dict[str, CalibrationEntry]:
        # The fingerprint is a handful of file stats, cheap enough to check on
        # every frame, so newly saved samples take effect immediately.
        with self._lock:
            fingerprint = self._dataset.fingerprint()
            if fingerprint != self._fingerprint:
                self._entries = self._build()
                self._fingerprint = fingerprint
            return self._entries

    def invalidate(self) -> None:
        with self._lock:
            self._fingerprint = None

    def calibrated(self) -> dict[str, int]:
        """Calibrated labels and how many usable samples each has."""
        return {label: len(entry.samples) for label, entry in self.entries().items()}

    def similarities(self, pose: FramePose) -> dict[str, float]:
        """0..1 similarity of the live pose to each calibrated label."""
        if pose.left is None or pose.right is None:
            return {}
        entries = self.entries()
        if not entries:
            return {}
        # Compare in both hand orders: handedness labels can flip while hands overlap.
        live = (descriptor(pose.left, pose.right), descriptor(pose.right, pose.left))
        result: dict[str, float] = {}
        for label, entry in entries.items():
            k = min(_NEIGHBOURS, len(entry.samples))
            best = math.inf
            for vector in live:
                distances = np.sort(_rms_distances(vector, entry.samples))[:k]
                best = min(best, float(distances.mean()))
            result[label] = math.exp(-0.5 * (best / entry.tolerance) ** 2)
        return result
