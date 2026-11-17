"""Feature extraction shared by training and real-time inference.

Per hand (87 values, zeros when the hand is missing):
    * presence flag
    * 21 landmarks relative to the wrist, divided by the hand's own scale
    * fingertip-to-wrist, thumb-to-fingertip and adjacent-fingertip distances
    * cosine of two joint angles per finger (curl)

Between hands (21 values, zeros unless both hands are present):
    * presence flag, wrist offset, relative scale
    * distances between matching fingertips, fingertips to the other wrist,
      and between palm centres - all divided by the mean hand scale

Nothing depends on where the hands are in the frame or how far they are from
the camera.
"""

from __future__ import annotations

import numpy as np

from app.computer_vision.landmarks import FrameObservation

#: Bump whenever the layout below changes; saved models record the version.
FEATURE_VERSION = 1

WRIST = 0
FINGERTIPS = (4, 8, 12, 16, 20)
PALM = (0, 5, 9, 13, 17)
#: (base, joint, joint, tip) for thumb, index, middle, ring, pinky.
FINGER_CHAINS = ((1, 2, 3, 4), (5, 6, 7, 8), (9, 10, 11, 12), (13, 14, 15, 16), (17, 18, 19, 20))

HAND_FEATURES = 1 + 63 + 5 + 4 + 4 + 10
PAIR_FEATURES = 1 + 3 + 1 + 5 + 5 + 5 + 1
FEATURE_COUNT = HAND_FEATURES * 2 + PAIR_FEATURES

_EPS = 1e-6
_CLIP = 10.0


def hand_scale(points: np.ndarray) -> float:
    """Characteristic palm size, robust to finger pose."""
    spans = (
        np.linalg.norm(points[5] - points[0]),
        np.linalg.norm(points[9] - points[0]),
        np.linalg.norm(points[17] - points[0]),
        np.linalg.norm(points[5] - points[17]),
    )
    return max(float(np.mean(spans)), _EPS)


def _joint_cosine(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    v1, v2 = a - b, c - b
    denom = np.linalg.norm(v1) * np.linalg.norm(v2)
    if denom < _EPS:
        return 0.0
    return float(np.dot(v1, v2) / denom)


def _hand_block(points: np.ndarray | None) -> np.ndarray:
    if points is None:
        return np.zeros(HAND_FEATURES, dtype=np.float64)

    relative = (points - points[WRIST]) / hand_scale(points)
    tips = relative[list(FINGERTIPS)]
    tip_to_wrist = np.linalg.norm(tips, axis=1)
    thumb_to_tips = np.linalg.norm(tips[1:] - tips[0], axis=1)
    adjacent_tips = np.linalg.norm(tips[1:] - tips[:-1], axis=1)

    curls: list[float] = []
    for a, b, c, d in FINGER_CHAINS:
        curls.append(_joint_cosine(relative[a], relative[b], relative[c]))
        curls.append(_joint_cosine(relative[b], relative[c], relative[d]))

    return np.concatenate(
        ([1.0], relative.ravel(), tip_to_wrist, thumb_to_tips, adjacent_tips, curls)
    )


def _pair_block(left: np.ndarray | None, right: np.ndarray | None) -> np.ndarray:
    if left is None or right is None:
        return np.zeros(PAIR_FEATURES, dtype=np.float64)

    left_scale, right_scale = hand_scale(left), hand_scale(right)
    mean_scale = (left_scale + right_scale) / 2.0
    tips = list(FINGERTIPS)

    wrist_offset = (right[WRIST] - left[WRIST]) / mean_scale
    scale_ratio = np.log(right_scale / left_scale)
    tip_to_tip = np.linalg.norm(right[tips] - left[tips], axis=1) / mean_scale
    right_tips_to_left_wrist = np.linalg.norm(right[tips] - left[WRIST], axis=1) / mean_scale
    left_tips_to_right_wrist = np.linalg.norm(left[tips] - right[WRIST], axis=1) / mean_scale
    palm_distance = (
        np.linalg.norm(right[list(PALM)].mean(axis=0) - left[list(PALM)].mean(axis=0)) / mean_scale
    )

    return np.concatenate(
        (
            [1.0],
            wrist_offset,
            [scale_ratio],
            tip_to_tip,
            right_tips_to_left_wrist,
            left_tips_to_right_wrist,
            [palm_distance],
        )
    )


def extract_features(frame: FrameObservation) -> np.ndarray:
    """Return the fixed-length feature vector for one frame."""
    left = frame.left.points if frame.left is not None else None
    right = frame.right.points if frame.right is not None else None
    features = np.concatenate((_hand_block(left), _hand_block(right), _pair_block(left, right)))
    return np.clip(np.nan_to_num(features), -_CLIP, _CLIP).astype(np.float32)
