from __future__ import annotations

import numpy as np
import pytest
from pydantic import ValidationError

from app.computer_vision import FEATURE_COUNT, build_frame, extract_features
from app.computer_vision.features import HAND_FEATURES, PAIR_FEATURES
from app.schemas.landmarks import FrameIn
from helpers import POSES, make_frame, make_hand


def features_of(payload: dict) -> np.ndarray:
    return extract_features(build_frame(FrameIn.model_validate(payload)))


def transform(payload: dict, *, dx: float = 0.0, dy: float = 0.0, scale: float = 1.0) -> dict:
    """Move and uniformly scale every hand (about the image origin, in true proportions)."""
    aspect = payload["image_width"] / payload["image_height"]
    hands = []
    for hand in payload["hands"]:
        landmarks = [
            [(x * aspect * scale) / aspect + dx, y * scale + dy, z * scale] for x, y, z in hand["landmarks"]
        ]
        hands.append({**hand, "landmarks": landmarks})
    return {**payload, "hands": hands}


def test_feature_vector_has_fixed_length_and_is_finite():
    vector = features_of(make_frame("tiger"))
    assert vector.shape == (FEATURE_COUNT,)
    assert vector.dtype == np.float32
    assert np.all(np.isfinite(vector))


def test_features_ignore_position_in_frame():
    base = make_frame("ram")
    moved = transform(base, dx=0.13, dy=-0.21)
    np.testing.assert_allclose(features_of(base), features_of(moved), atol=1e-4)


def test_features_ignore_distance_from_camera():
    base = make_frame("ram")
    closer = transform(base, scale=1.6)
    np.testing.assert_allclose(features_of(base), features_of(closer), atol=1e-4)


def test_features_ignore_camera_resolution():
    """The same physical pose seen by a 4:3 camera must give the same features as 16:9."""
    left_curls, right_curls, _ = POSES["tiger"]
    frames = []
    for width, height in ((1280, 720), (640, 480)):
        aspect = width / height
        hands = [
            make_hand(left_curls, handedness="Left", origin=(0.4, 0.6), aspect=aspect),
            make_hand(right_curls, handedness="Right", origin=(0.4 + 0.1 * (16 / 9) / aspect, 0.6), mirror=True, aspect=aspect),
        ]
        frames.append({"hands": hands, "image_width": width, "image_height": height})
    np.testing.assert_allclose(features_of(frames[0]), features_of(frames[1]), atol=1e-4)


def test_different_poses_give_different_features():
    assert np.linalg.norm(features_of(make_frame("tiger")) - features_of(make_frame("snake"))) > 0.5


def test_missing_hand_is_zero_filled_with_presence_flags():
    vector = features_of(make_frame("tiger", hands=1))  # only the left hand
    left = vector[:HAND_FEATURES]
    right = vector[HAND_FEATURES : HAND_FEATURES * 2]
    pair = vector[HAND_FEATURES * 2 :]
    assert left[0] == 1.0
    assert np.all(right == 0.0)
    assert pair.shape == (PAIR_FEATURES,) and np.all(pair == 0.0)


def test_no_hands_gives_all_zero_vector():
    vector = features_of({"hands": []})
    assert vector.shape == (FEATURE_COUNT,) and not vector.any()


def test_hand_order_in_payload_does_not_matter():
    frame = make_frame("ox")
    swapped = {**frame, "hands": list(reversed(frame["hands"]))}
    np.testing.assert_array_equal(features_of(frame), features_of(swapped))


def test_duplicate_handedness_still_fills_both_slots():
    frame = make_frame("tiger")
    frame["hands"][1]["handedness"] = "Left"
    frame["hands"][1]["score"] = 0.4
    observation = build_frame(FrameIn.model_validate(frame))
    assert observation.hand_count == 2
    assert observation.left.score == pytest.approx(0.95)
    assert observation.right.score == pytest.approx(0.4)


# -- landmark validation ----------------------------------------------------


def test_rejects_wrong_landmark_count():
    frame = make_frame("tiger")
    frame["hands"][0]["landmarks"] = frame["hands"][0]["landmarks"][:20]
    with pytest.raises(ValidationError):
        FrameIn.model_validate(frame)


def test_rejects_more_than_two_hands():
    frame = make_frame("tiger")
    frame["hands"].append(frame["hands"][0])
    with pytest.raises(ValidationError):
        FrameIn.model_validate(frame)


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), 99.0, "abc"])
def test_rejects_non_finite_or_out_of_range_coordinates(bad):
    frame = make_frame("tiger")
    frame["hands"][0]["landmarks"][3][0] = bad
    with pytest.raises(ValidationError):
        FrameIn.model_validate(frame)


def test_rejects_degenerate_hand():
    frame = make_frame("tiger")
    frame["hands"][0]["landmarks"] = [[0.5, 0.5, 0.0]] * 21
    with pytest.raises(ValidationError):
        FrameIn.model_validate(frame)


def test_rejects_unknown_handedness():
    frame = make_frame("tiger")
    frame["hands"][0]["handedness"] = "Middle"
    with pytest.raises(ValidationError):
        FrameIn.model_validate(frame)
