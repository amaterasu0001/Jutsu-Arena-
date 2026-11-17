"""On-disk training dataset, organised as ``dataset/<label>/samples.jsonl``.

Raw landmarks are stored (not features), so the feature layout can evolve
without recollecting data: features are always recomputed with the current
extractor at training time.
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

import numpy as np

from app.computer_vision import build_frame, extract_features
from app.schemas.landmarks import FrameIn

SAMPLES_FILE = "samples.jsonl"


class DatasetStore:
    def __init__(self, root: Path, labels: list[str]) -> None:
        self._root = root
        self._labels = list(labels)
        self._lock = threading.RLock()
        self._root.mkdir(parents=True, exist_ok=True)

    @property
    def labels(self) -> list[str]:
        return list(self._labels)

    def _file(self, label: str) -> Path:
        if label not in self._labels:
            raise KeyError(label)
        return self._root / label / SAMPLES_FILE

    def _read(self, label: str) -> Iterator[dict]:
        path = self._file(label)
        if not path.is_file():
            return
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue  # skip a corrupted line rather than failing the whole dataset

    def _write(self, label: str, records: list[dict]) -> None:
        path = self._file(label)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(".tmp")
        with temp.open("w", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record, separators=(",", ":")) + "\n")
        temp.replace(path)

    # -- writes -----------------------------------------------------------

    def add_samples(self, label: str, capture_group: str, frames: list[FrameIn]) -> int:
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        lines = []
        for frame in frames:
            record = {
                "id": uuid.uuid4().hex,
                "created_at": now,
                "capture_group": capture_group,
                "image_width": frame.image_width,
                "image_height": frame.image_height,
                "hands": [
                    {
                        "handedness": hand.handedness,
                        "score": round(hand.score, 4),
                        "landmarks": [[round(value, 5) for value in point] for point in hand.landmarks],
                    }
                    for hand in frame.hands
                ],
            }
            lines.append(json.dumps(record, separators=(",", ":")))
        with self._lock:
            path = self._file(label)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                handle.write("".join(line + "\n" for line in lines))
        return len(lines)

    def delete_sample(self, label: str, sample_id: str) -> int:
        with self._lock:
            records = list(self._read(label))
            kept = [record for record in records if record.get("id") != sample_id]
            if len(kept) != len(records):
                self._write(label, kept)
            return len(records) - len(kept)

    def clear_label(self, label: str) -> int:
        with self._lock:
            count = self.count(label)
            path = self._file(label)
            if path.is_file():
                path.unlink()
            return count

    # -- reads ------------------------------------------------------------

    def count(self, label: str) -> int:
        with self._lock:
            return sum(1 for _ in self._read(label))

    def counts(self) -> dict[str, int]:
        return {label: self.count(label) for label in self._labels}

    def group_counts(self) -> dict[str, int]:
        with self._lock:
            return {
                label: len({record.get("capture_group", "") for record in self._read(label)})
                for label in self._labels
            }

    def list_samples(self, label: str, limit: int = 60, newest_first: bool = True) -> list[dict]:
        with self._lock:
            records = list(self._read(label))
        if newest_first:
            records.reverse()
        return records[:limit]

    def first_sample(self, label: str) -> dict | None:
        with self._lock:
            return next(self._read(label), None)

    def fingerprint(self) -> str:
        """Cheap signature of the dataset used to detect changes since training."""
        parts = []
        for label in self._labels:
            path = self._file(label)
            if path.is_file():
                stat = path.stat()
                parts.append(f"{label}:{stat.st_size}:{stat.st_mtime_ns}")
        return "|".join(parts)

    def load_matrix(self, labels: list[str]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Return ``(features, labels, capture_groups)`` for the given labels."""
        features: list[np.ndarray] = []
        targets: list[str] = []
        groups: list[str] = []
        with self._lock:
            for label in labels:
                for record in self._read(label):
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
                    features.append(extract_features(build_frame(frame)))
                    targets.append(label)
                    groups.append(f"{label}/{record.get('capture_group', '')}")
        if not features:
            return np.empty((0, 0), dtype=np.float32), np.empty(0, dtype=object), np.empty(0, dtype=object)
        return np.vstack(features), np.asarray(targets, dtype=object), np.asarray(groups, dtype=object)
