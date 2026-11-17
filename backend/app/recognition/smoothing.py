"""Short temporal smoothing of per-sign scores.

Landmarks jitter from frame to frame, so a correctly held sign can dip below
the threshold on a single frame. Without smoothing, that one frame restarts the
hold timer and the sign takes much longer to be accepted. An exponential moving
average over a ~0.1 s window irons out those dips while adding only about one
frame of lag. It is time-based, so it behaves the same at any frame rate.
"""

from __future__ import annotations

import math


class ScoreSmoother:
    def __init__(self, time_constant_ms: float = 100.0, max_gap_ms: float = 400.0) -> None:
        self.time_constant_ms = time_constant_ms
        #: After a longer gap (no hands, paused stream) start from scratch.
        self.max_gap_ms = max_gap_ms
        self.reset()

    def reset(self) -> None:
        self._scores: dict[str, float] = {}
        self._last_ms: float | None = None

    def update(self, scores: dict[str, float], now_ms: float) -> dict[str, float]:
        """Blend ``scores`` into the running average and return the smoothed scores."""
        if self.time_constant_ms <= 0 or not scores:
            self.reset()
            return dict(scores)
        if self._last_ms is None or now_ms - self._last_ms > self.max_gap_ms or now_ms < self._last_ms:
            self._scores = dict(scores)
        else:
            alpha = 1.0 - math.exp(-(now_ms - self._last_ms) / self.time_constant_ms)
            labels = set(scores) | set(self._scores)
            self._scores = {
                label: (1 - alpha) * self._scores.get(label, 0.0) + alpha * scores.get(label, 0.0) for label in labels
            }
        self._last_ms = now_ms
        return dict(self._scores)
