"""Synthetic hand landmarks for tests.

These are geometric stand-ins for real hands (a wrist, a palm and five fingers
whose curl can be set). They exercise the full pipeline deterministically but
say nothing about accuracy on real webcam data.
"""

from __future__ import annotations

import math
import random

# Direction (degrees from "up") and base offset of each finger on a unit palm.
_FINGERS = [(-55, -0.45, 0.35), (-18, -0.28, 1.0), (0, 0.0, 1.05), (16, 0.26, 1.0), (34, 0.48, 0.9)]
_SEGMENT = 0.32


def make_hand(
    curls: tuple[float, float, float, float, float],
    *,
    handedness: str,
    origin: tuple[float, float] = (0.5, 0.6),
    size: float = 0.12,
    jitter: float = 0.0,
    rng: random.Random | None = None,
    mirror: bool = False,
    aspect: float = 16 / 9,
) -> dict:
    """Build one hand. ``curls`` are 0 (straight) .. 1 (fully folded) per finger."""
    rng = rng or random.Random(0)
    points: list[tuple[float, float, float]] = [(0.0, 0.0, 0.0)]
    for (angle_deg, base_x, base_y), curl in zip(_FINGERS, curls):
        angle = math.radians(angle_deg)
        x, y = base_x, base_y
        points.append((x, y, 0.0))
        for segment in range(3):
            bend = angle + curl * (segment + 1) * math.radians(80)
            x += math.sin(bend) * _SEGMENT
            y += math.cos(bend) * _SEGMENT
            points.append((x, y, -0.1 * curl * (segment + 1)))

    landmarks = []
    for x, y, z in points:
        if mirror:
            x = -x
        x += rng.gauss(0, jitter)
        y += rng.gauss(0, jitter)
        # image coordinates: y grows downward; x and z are normalised by width
        landmarks.append([origin[0] + x * size / aspect, origin[1] - y * size, z * size / aspect])
    return {"handedness": handedness, "score": 0.95, "landmarks": landmarks}


# Distinct two-hand poses used as stand-ins for signs in tests.
POSES: dict[str, tuple[tuple[float, ...], tuple[float, ...], float]] = {
    "tiger": ((0.0, 0.0, 1.0, 1.0, 1.0), (0.0, 0.0, 1.0, 1.0, 1.0), 0.10),
    "snake": ((1.0, 1.0, 1.0, 1.0, 1.0), (1.0, 1.0, 1.0, 1.0, 1.0), 0.08),
    "ram": ((1.0, 0.0, 0.0, 1.0, 1.0), (1.0, 0.0, 0.0, 1.0, 1.0), 0.12),
    "ox": ((0.0, 0.0, 0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 0.0, 0.0), 0.20),
    "none": ((0.3, 0.3, 0.3, 0.3, 0.3), (0.5, 0.5, 0.5, 0.5, 0.5), 0.45),
}


def make_frame(pose: str, *, rng: random.Random | None = None, jitter: float = 0.01, hands: int = 2) -> dict:
    """A full frame payload (as sent to the API) for one of the test poses."""
    rng = rng or random.Random(0)
    left_curls, right_curls, gap = POSES[pose]
    centre = 0.5 + rng.uniform(-0.1, 0.1)
    height = 0.6 + rng.uniform(-0.08, 0.08)
    size = 0.12 * rng.uniform(0.8, 1.25)
    frame_hands = [
        make_hand(left_curls, handedness="Left", origin=(centre - gap / 2, height), size=size, jitter=jitter, rng=rng),
        make_hand(
            right_curls, handedness="Right", origin=(centre + gap / 2, height), size=size, jitter=jitter, rng=rng, mirror=True
        ),
    ]
    return {"hands": frame_hands[:hands], "image_width": 1280, "image_height": 720}


def make_batch(pose: str, count: int, seed: int = 0) -> list[dict]:
    rng = random.Random(seed)
    return [make_frame(pose, rng=rng) for _ in range(count)]


# -- articulated synthetic hands ------------------------------------------------
#
# A small 3D hand model (palm length = 1) whose fingers flex towards the palm,
# that can be rotated in the image plane (``angle``: 0 = fingers up, 90 =
# pointing right, 180 = down) and turned about its own long axis (``yaw``).
# Used to check that the built-in sign templates are internally consistent:
# each sign's own arrangement scores highest and non-sign poses score low. It is
# NOT evidence of accuracy on real webcam landmarks.

_BASES = [(-0.28, 0.22), (-0.30, 0.95), (-0.10, 1.0), (0.10, 0.97), (0.30, 0.90)]
_SEGMENTS = [(0.36, 0.30, 0.27), (0.45, 0.27, 0.22), (0.50, 0.30, 0.24), (0.46, 0.28, 0.23), (0.36, 0.22, 0.20)]
_SPREAD = [-48.0, -6.0, 0.0, 5.0, 11.0]


def _rotate_y(point, degrees):
    a = math.radians(degrees)
    x, y, z = point
    return (x * math.cos(a) + z * math.sin(a), y, -x * math.sin(a) + z * math.cos(a))


def _rotate_z(point, degrees):
    # In-plane rotation: angle 0 keeps fingers pointing up (+y local = up in image).
    a = math.radians(degrees)
    x, y, z = point
    return (x * math.cos(a) + y * math.sin(a), -x * math.sin(a) + y * math.cos(a), z)


def local_hand(curls) -> list[tuple[float, float, float]]:
    """21 landmarks in the hand's own frame (y along the fingers, -z out of the palm)."""
    points = [(0.0, 0.0, 0.0)]
    for finger, ((bx, by), lengths, spread, curl) in enumerate(zip(_BASES, _SEGMENTS, _SPREAD, curls)):
        x, y, z = bx, by, 0.0
        points.append((x, y, z))
        flex = 0.0
        if finger == 0:
            # The thumb swings across the palm as it folds.
            spread = spread + 90.0 * curl
            joint_flex = (10.0 * curl, 25.0 * curl, 20.0 * curl)
        else:
            joint_flex = (80.0 * curl, 100.0 * curl, 70.0 * curl)
        for length, bend in zip(lengths, joint_flex):
            flex += bend
            s = math.radians(spread)
            f = math.radians(flex)
            x += length * math.sin(s) * math.cos(f)
            y += length * math.cos(s) * math.cos(f)
            z -= length * math.sin(f)
            points.append((x, y, z))
    # MediaPipe order: wrist, thumb 1-4, index 5-8, ... built above in that order.
    return points


def posed_hand(
    curls,
    *,
    handedness: str,
    wrist: tuple[float, float],
    angle: float = 0.0,
    yaw: float = 0.0,
    mirror: bool = False,
    size: float = 0.11,
    centre: tuple[float, float] = (0.5, 0.62),
    jitter: float = 0.0,
    rng: random.Random | None = None,
    aspect: float = 16 / 9,
) -> dict:
    """One hand placed in the image. ``wrist`` is in palm units from ``centre`` (y down)."""
    rng = rng or random.Random(0)
    landmarks = []
    for point in local_hand(curls):
        x, y, z = point
        if mirror:
            x = -x
        x, y, z = _rotate_y((x, y, z), -yaw if mirror else yaw)
        x, y, z = _rotate_z((x, y, z), angle)
        # local +y is "up", image y grows downward
        img_x = centre[0] + (wrist[0] + x + rng.gauss(0, jitter)) * size / aspect
        img_y = centre[1] + (wrist[1] - y + rng.gauss(0, jitter)) * size
        landmarks.append([img_x, img_y, (z + rng.gauss(0, jitter)) * size / aspect])
    return {"handedness": handedness, "score": 0.93, "landmarks": landmarks}


UP, FOLD = 0.0, 1.0
#: Per sign: (hand A kwargs, hand B kwargs). Hand A is the sign's role "a"
#: (the diagram's left hand) and is placed on the image's left.
SIGN_POSES: dict[str, tuple[dict, dict]] = {
    "rat": (
        dict(curls=(FOLD, UP, UP, FOLD, FOLD), wrist=(-0.12, 0.3), yaw=80, mirror=True),
        dict(curls=(UP, UP, UP, FOLD, FOLD), wrist=(0.15, -0.6), yaw=40),
    ),
    "ox": (
        dict(curls=(UP,) * 5, wrist=(0.0, 0.4), mirror=True),
        dict(curls=(UP,) * 5, wrist=(0.55, -0.2), angle=-90),
    ),
    "tiger": (
        dict(curls=(UP, UP, FOLD, FOLD, FOLD), wrist=(-0.3, 0.3), yaw=70, mirror=True),
        dict(curls=(UP, UP, FOLD, FOLD, FOLD), wrist=(0.3, 0.3), yaw=70),
    ),
    "rabbit": (
        dict(curls=(UP, UP, FOLD, FOLD, FOLD), wrist=(-0.6, 0.3), mirror=True),
        dict(curls=(FOLD, FOLD, FOLD, FOLD, UP), wrist=(0.5, 0.4), yaw=30),
    ),
    "dragon": (
        dict(curls=(UP, FOLD, FOLD, FOLD, UP), wrist=(-0.12, 0.3), yaw=80, mirror=True),
        dict(curls=(UP, FOLD, FOLD, FOLD, UP), wrist=(0.12, 0.3), yaw=80),
    ),
    "snake": (
        dict(curls=(FOLD,) * 5, wrist=(-0.12, 0.3), yaw=80, mirror=True),
        dict(curls=(FOLD,) * 5, wrist=(0.12, 0.3), yaw=80),
    ),
    "horse": (
        dict(curls=(UP, UP, FOLD, FOLD, FOLD), wrist=(-1.15, 0.4), angle=28, yaw=20, mirror=True),
        dict(curls=(UP, UP, FOLD, FOLD, FOLD), wrist=(1.15, 0.4), angle=-28, yaw=20),
    ),
    "ram": (
        dict(curls=(FOLD, UP, UP, FOLD, FOLD), wrist=(-0.3, 0.3), yaw=70, mirror=True),
        dict(curls=(FOLD, UP, UP, FOLD, FOLD), wrist=(0.3, 0.3), yaw=70),
    ),
    "monkey": (
        dict(curls=(UP,) * 5, wrist=(-0.5, 0.0), angle=90, yaw=75, mirror=True),
        dict(curls=(UP,) * 5, wrist=(0.5, -0.2), angle=-90, yaw=75),
    ),
    "bird": (
        dict(curls=(UP, UP, FOLD, FOLD, UP), wrist=(-0.12, 0.3), yaw=80, mirror=True),
        dict(curls=(UP, UP, FOLD, FOLD, UP), wrist=(0.12, 0.3), yaw=80),
    ),
    "dog": (
        dict(curls=(UP,) * 5, wrist=(-0.55, -0.45), angle=90, yaw=60, mirror=True),
        dict(curls=(FOLD,) * 5, wrist=(0.0, 0.6)),
    ),
    "boar": (
        dict(curls=(FOLD,) * 5, wrist=(-0.5, -0.5), angle=165, mirror=True),
        dict(curls=(FOLD,) * 5, wrist=(0.5, -0.5), angle=-165),
    ),
}

#: Two-hand poses that are not signs (relaxed hands, waving, half-formed shapes).
NON_SIGN_POSES: dict[str, tuple[dict, dict]] = {
    "open_hands_apart": (
        dict(curls=(UP,) * 5, wrist=(-1.6, 0.3), mirror=True),
        dict(curls=(UP,) * 5, wrist=(1.6, 0.3)),
    ),
    "fists_apart": (
        dict(curls=(FOLD,) * 5, wrist=(-1.8, 0.3), mirror=True),
        dict(curls=(FOLD,) * 5, wrist=(1.8, 0.3)),
    ),
    "relaxed_half_curl": (
        dict(curls=(0.4, 0.45, 0.5, 0.55, 0.6), wrist=(-1.4, 0.6), angle=15, mirror=True),
        dict(curls=(0.4, 0.45, 0.5, 0.55, 0.6), wrist=(1.4, 0.6), angle=-15),
    ),
    "one_pointing_one_open": (
        dict(curls=(FOLD, UP, FOLD, FOLD, FOLD), wrist=(-1.5, 0.0), angle=20, mirror=True),
        dict(curls=(UP,) * 5, wrist=(1.5, 0.4), angle=-10),
    ),
    "waving_tilted": (
        dict(curls=(0.1, 0.1, 0.1, 0.2, 0.2), wrist=(-1.2, 0.0), angle=-35, mirror=True),
        dict(curls=(0.2, 0.2, 0.3, 0.3, 0.3), wrist=(1.3, 0.2), angle=40),
    ),
}


def sign_frame(
    pose: tuple[dict, dict],
    *,
    rng: random.Random | None = None,
    jitter: float = 0.02,
    vary: bool = True,
    swap_labels: bool = False,
) -> dict:
    """A frame payload for a two-hand arrangement, with natural variation."""
    rng = rng or random.Random(0)
    size = 0.11 * (rng.uniform(0.75, 1.3) if vary else 1.0)
    centre = (0.5 + rng.uniform(-0.12, 0.12), 0.6 + rng.uniform(-0.08, 0.08)) if vary else (0.5, 0.6)
    tilt = rng.uniform(-8, 8) if vary else 0.0
    hands = []
    for kwargs, label in zip(pose, ("Left", "Right")):
        params = dict(kwargs)
        curls = tuple(min(1.0, max(0.0, c + (rng.uniform(-0.15, 0.15) if vary else 0.0))) for c in params.pop("curls"))
        # Rotate the whole arrangement slightly (wrist positions and hand angles together).
        wx, wy = params.pop("wrist")
        a = math.radians(tilt)
        wrist = (wx * math.cos(a) - wy * math.sin(a), wx * math.sin(a) + wy * math.cos(a))
        params["angle"] = params.get("angle", 0.0) + tilt
        params["yaw"] = params.get("yaw", 0.0) + (rng.uniform(-10, 10) if vary else 0.0)
        hand_label = ("Right" if label == "Left" else "Left") if swap_labels else label
        hands.append(
            posed_hand(curls, handedness=hand_label, wrist=wrist, size=size, centre=centre, jitter=jitter, rng=rng, **params)
        )
    return {"hands": hands, "image_width": 1280, "image_height": 720}
