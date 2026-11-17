"""Interpretable hand-pose descriptors used by the built-in sign recogniser.

Unlike :mod:`app.computer_vision.features` (a long vector meant for a trained
classifier), everything here has a direct geometric meaning - "how extended is
the index finger", "do the two index fingertips touch", "is this hand lying
horizontally" - so hand signs can be described by readable rules.

All lengths are divided by the hand's own palm size, so nothing depends on
the distance to the camera, the image resolution or the hand's size. Cross-hand
measurements use image-plane (x, y) positions only: MediaPipe's z is relative
to each hand's own wrist, so it cannot be compared between two hands.

Image coordinates: x grows to the right of the raw (un-mirrored) camera frame,
y grows downward.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.computer_vision.features import FINGER_CHAINS, FINGERTIPS, PALM, WRIST, hand_scale
from app.computer_vision.landmarks import FrameObservation

FINGER_NAMES = ("thumb", "index", "middle", "ring", "pinky")
_EPS = 1e-6


def ramp(value: float, low: float, high: float) -> float:
    """0 below ``low``, 1 above ``high``, linear in between."""
    if high == low:
        return 1.0 if value >= high else 0.0
    return float(min(1.0, max(0.0, (value - low) / (high - low))))


def _unit2d(vector: np.ndarray) -> np.ndarray:
    v = np.asarray(vector[:2], dtype=np.float64)
    norm = float(np.linalg.norm(v))
    return v / norm if norm > _EPS else np.array([0.0, -1.0])


def _chain_straightness(points: np.ndarray, chain: tuple[int, ...]) -> float:
    """Straight-line length over path length along a joint chain (1 = perfectly straight)."""
    path = sum(float(np.linalg.norm(points[b] - points[a])) for a, b in zip(chain, chain[1:]))
    if path < _EPS:
        return 0.0
    return float(np.linalg.norm(points[chain[-1]] - points[chain[0]])) / path


@dataclass(frozen=True)
class HandPose:
    """Descriptors for one hand."""

    #: 0 (curled) .. 1 (straight) for thumb, index, middle, ring, pinky.
    extension: tuple[float, float, float, float, float]
    #: Unit vector (image plane) from the wrist towards the knuckles.
    axis: np.ndarray
    #: Unit vectors (image plane) from each finger's base to its tip.
    finger_dirs: np.ndarray
    #: Palm centre and wrist in image coordinates (x, y).
    palm_center: np.ndarray
    wrist: np.ndarray
    knuckles: np.ndarray
    tips: np.ndarray
    scale: float

    @property
    def axis_up(self) -> float:
        """+1 when the knuckles point straight up, -1 straight down."""
        return float(-self.axis[1])

    @property
    def horizontal(self) -> float:
        """1 when the hand lies horizontally, 0 when vertical."""
        return float(abs(self.axis[0]))

    def finger_up(self, finger: int) -> float:
        """+1 when the finger points straight up in the image, -1 down."""
        return float(-self.finger_dirs[finger][1])


def describe_hand(points: np.ndarray) -> HandPose:
    scale = hand_scale(points)
    wrist = points[WRIST]

    extension: list[float] = []
    # Thumb: measured in the palm's own frame (u = wrist -> knuckles, v = little
    # finger -> index side). A folded thumb lies across the fingers, so its tip
    # is on the little-finger side of the index knuckle (tv < 0). A thumb spread
    # out sticks past the index side (tv > 0); a thumb raised alongside the
    # index finger reaches beyond the knuckles (tu > 0) without crossing them.
    u = points[[5, 9, 13, 17]].mean(axis=0) - wrist
    u = u / max(float(np.linalg.norm(u)), _EPS)
    across = points[5] - points[17]
    v = across - float(np.dot(across, u)) * u
    v = v / max(float(np.linalg.norm(v)), _EPS)
    offset = points[4] - points[5]
    tv = float(np.dot(offset, v)) / scale
    tu = float(np.dot(offset, u)) / scale
    extension.append(max(ramp(tv, -0.12, 0.2), ramp(tu, 0.0, 0.3) * ramp(tv, -0.3, 0.0)))

    # Fingers: combine straightness with "the tip is further from the wrist
    # than the middle joint" - each alone is fooled by some viewing angles.
    for base, pip, _dip, tip in FINGER_CHAINS[1:]:
        straight = _chain_straightness(points, (base, pip, _dip, tip))
        reach = float(np.linalg.norm(points[tip] - wrist)) / max(float(np.linalg.norm(points[pip] - wrist)), _EPS)
        extension.append(0.5 * ramp(straight, 0.60, 0.90) + 0.5 * ramp(reach, 0.95, 1.20))

    knuckle_center = points[[5, 9, 13, 17]].mean(axis=0)
    finger_dirs = np.array([_unit2d(points[chain[-1]] - points[chain[0]]) for chain in FINGER_CHAINS])
    return HandPose(
        extension=tuple(round(value, 4) for value in extension),  # type: ignore[arg-type]
        axis=_unit2d(knuckle_center - wrist),
        finger_dirs=finger_dirs,
        palm_center=points[list(PALM)].mean(axis=0)[:2],
        wrist=wrist[:2],
        knuckles=points[9][:2],
        tips=points[list(FINGERTIPS)][:, :2],
        scale=scale,
    )


def pair_features(a: HandPose, b: HandPose) -> dict[str, float]:
    """Relations between two hands, in units of the mean palm size.

    ``a`` and ``b`` are roles (for example "the flat hand" and "the fist"), not
    necessarily the user's left and right hands.
    """
    s = max((a.scale + b.scale) / 2.0, _EPS)
    features = {
        "palm_distance": float(np.linalg.norm(a.palm_center - b.palm_center)) / s,
        "wrist_distance": float(np.linalg.norm(a.wrist - b.wrist)) / s,
        "knuckle_distance": float(np.linalg.norm(a.knuckles - b.knuckles)) / s,
        # Positive when hand a is higher in the image than hand b.
        "a_above_b": float(b.palm_center[1] - a.palm_center[1]) / s,
        "vertical_offset": abs(float(b.palm_center[1] - a.palm_center[1])) / s,
        # 1 = both hands point the same way, -1 = opposite ways, 0 = crossed at right angles.
        "axis_alignment": float(np.dot(a.axis, b.axis)),
        "axis_cross": 1.0 - abs(float(np.dot(a.axis, b.axis))),
    }
    for index, name in enumerate(FINGER_NAMES):
        features[f"tip_distance.{name}"] = float(np.linalg.norm(a.tips[index] - b.tips[index])) / s
    return features


def hand_features(prefix: str, hand: HandPose) -> dict[str, float]:
    features = {
        f"{prefix}.axis_up": hand.axis_up,
        f"{prefix}.horizontal": hand.horizontal,
    }
    for index, name in enumerate(FINGER_NAMES):
        features[f"{prefix}.extension.{name}"] = float(hand.extension[index])
        features[f"{prefix}.finger_up.{name}"] = hand.finger_up(index)
    return features


def role_features(a: HandPose, b: HandPose) -> dict[str, float]:
    """Every named feature a sign rule can refer to, for one role assignment."""
    return {**hand_features("a", a), **hand_features("b", b), **pair_features(a, b)}


@dataclass(frozen=True)
class FramePose:
    left: HandPose | None
    right: HandPose | None

    @property
    def hand_count(self) -> int:
        return int(self.left is not None) + int(self.right is not None)


def describe_frame(frame: FrameObservation) -> FramePose:
    return FramePose(
        left=describe_hand(frame.left.points) if frame.left is not None else None,
        right=describe_hand(frame.right.points) if frame.right is not None else None,
    )


#: Order of the compact descriptor used for personal calibration matching.
DESCRIPTOR_PAIR_KEYS = (
    "palm_distance",
    "wrist_distance",
    "knuckle_distance",
    "a_above_b",
    "axis_alignment",
    *(f"tip_distance.{name}" for name in FINGER_NAMES),
)


def descriptor(a: HandPose, b: HandPose) -> np.ndarray:
    """Compact, roughly unit-scaled vector describing a two-hand pose.

    Used to compare a live frame with a user's own calibration samples.
    """
    pair = pair_features(a, b)
    distances = [min(pair[key], 3.0) / 1.5 for key in DESCRIPTOR_PAIR_KEYS]
    return np.concatenate(
        (
            np.asarray(a.extension) * 1.5,
            np.asarray(b.extension) * 1.5,
            a.axis,
            b.axis,
            a.finger_dirs[1],
            b.finger_dirs[1],
            np.asarray(distances),
        )
    ).astype(np.float64)
