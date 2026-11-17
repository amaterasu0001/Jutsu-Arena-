"""Convert validated landmark payloads into consistent left/right hand slots."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.schemas.landmarks import FrameIn, HandIn


@dataclass(frozen=True)
class HandObservation:
    handedness: str
    score: float
    #: ``(21, 3)`` array in aspect-corrected image units (x and z scaled by w/h).
    points: np.ndarray


@dataclass(frozen=True)
class FrameObservation:
    left: HandObservation | None
    right: HandObservation | None

    @property
    def hand_count(self) -> int:
        return int(self.left is not None) + int(self.right is not None)


def _to_observation(hand: HandIn, aspect: float) -> HandObservation:
    points = np.asarray(hand.landmarks, dtype=np.float64)
    # MediaPipe normalises x by image width and y by image height. Scaling x
    # (and z, which uses the same scale as x) by the aspect ratio restores true
    # proportions so features do not depend on the camera's resolution.
    points[:, 0] *= aspect
    points[:, 2] *= aspect
    return HandObservation(handedness=hand.handedness, score=hand.score, points=points)


def build_frame(frame: FrameIn) -> FrameObservation:
    """Assign detected hands to stable ``left`` / ``right`` slots.

    The handedness label reported by the detector decides the slot. When both
    hands receive the same label (common while hands overlap in a seal), the
    more confident detection keeps its slot and the other takes the free one,
    so two visible hands always produce two populated slots.
    """
    aspect = frame.image_width / frame.image_height
    hands = [_to_observation(hand, aspect) for hand in frame.hands]
    if not hands:
        return FrameObservation(left=None, right=None)

    if len(hands) == 1:
        hand = hands[0]
        if hand.handedness == "Left":
            return FrameObservation(left=hand, right=None)
        return FrameObservation(left=None, right=hand)

    first, second = hands[0], hands[1]
    if first.handedness != second.handedness:
        left = first if first.handedness == "Left" else second
        right = second if left is first else first
        return FrameObservation(left=left, right=right)

    # Same label twice: trust the higher-scoring detection.
    primary, other = (first, second) if first.score >= second.score else (second, first)
    if primary.handedness == "Left":
        return FrameObservation(left=primary, right=other)
    return FrameObservation(left=other, right=primary)
