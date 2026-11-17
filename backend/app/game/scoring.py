from __future__ import annotations

from dataclasses import dataclass

COMBO_STEP = 0.25
MAX_MULTIPLIER = 3.0


def combo_multiplier(combo: int) -> float:
    """x1 for the first jutsu in a chain, +0.25 per consecutive success, capped at x3."""
    return min(1.0 + COMBO_STEP * max(combo - 1, 0), MAX_MULTIPLIER)


@dataclass
class ScoreState:
    score: int = 0
    combo: int = 0
    best_combo: int = 0
    activations: int = 0
    incorrect: int = 0
    signs_accepted: int = 0

    @property
    def accuracy(self) -> float | None:
        attempts = self.activations + self.incorrect
        return self.activations / attempts if attempts else None

    def register_activation(self, base_points: int) -> tuple[int, float]:
        """Apply a successful jutsu. Returns ``(points_awarded, multiplier)``."""
        self.combo += 1
        self.best_combo = max(self.best_combo, self.combo)
        self.activations += 1
        multiplier = combo_multiplier(self.combo)
        points = int(round(base_points * multiplier))
        self.score += points
        return points, multiplier

    def register_incorrect(self) -> None:
        self.incorrect += 1
        self.combo = 0
