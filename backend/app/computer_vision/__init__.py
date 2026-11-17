"""Landmark handling: validation helpers, hand-slot assignment and feature extraction.

Hand landmarks are detected in the browser (MediaPipe Hand Landmarker). This
package turns those landmarks into the feature vectors used for both training
and real-time inference, so the two can never drift apart.
"""

from app.computer_vision.features import FEATURE_COUNT, FEATURE_VERSION, extract_features
from app.computer_vision.landmarks import FrameObservation, HandObservation, build_frame

__all__ = [
    "FEATURE_COUNT",
    "FEATURE_VERSION",
    "FrameObservation",
    "HandObservation",
    "build_frame",
    "extract_features",
]
