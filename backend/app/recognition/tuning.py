"""Map the user-facing sensitivity setting to the trained model's confidence threshold.

The built-in recogniser uses :func:`app.recognition.engine.sensitivity_offset`.
"""

from __future__ import annotations


def confidence_threshold(sensitivity: int) -> float:
    """Higher sensitivity -> lower confidence needed (0 -> 0.80, 100 -> 0.45)."""
    clamped = max(0, min(100, sensitivity))
    return round(0.80 - 0.35 * clamped / 100.0, 3)
