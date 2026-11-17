"""Built-in (training-free) recognition, personal calibration and easy-mode play.

These tests use the articulated synthetic hands from ``helpers``. They check
that the templates are internally consistent, that non-sign poses are
rejected, and that the whole pipeline works without any training. They do not
measure accuracy on real webcam landmarks - only real use can do that.
"""

from __future__ import annotations

import json
import random
import shutil

import pytest

from app.computer_vision import build_frame
from app.computer_vision.pose import describe_frame
from app.core.config import AppConfig
from app.jutsu import GameRegistry, RegistryError
from app.schemas.landmarks import FrameIn
from helpers import NON_SIGN_POSES, SIGN_POSES, sign_frame

SESSION = "builtin-session"
SIGNS = ["rat", "ox", "tiger", "rabbit", "dragon", "snake", "horse", "ram", "monkey", "bird", "dog", "boar"]


@pytest.fixture(scope="module")
def recognizer():
    return GameRegistry(AppConfig().config_dir).template_recognizer()


def matches(recognizer, payload: dict):
    return recognizer.match(describe_frame(build_frame(FrameIn.model_validate(payload))))


def mirror(payload: dict) -> dict:
    """The same frame as a mirrored camera would deliver it."""
    flipped = json.loads(json.dumps(payload))
    for hand in flipped["hands"]:
        hand["landmarks"] = [[1.0 - x, y, z] for x, y, z in hand["landmarks"]]
        hand["handedness"] = "Left" if hand["handedness"] == "Right" else "Right"
    return flipped


# -- templates ------------------------------------------------------------------


def test_all_twelve_signs_have_a_builtin_template(recognizer):
    assert sorted(recognizer.sign_ids) == sorted(SIGNS)
    assert sorted(SIGN_POSES) == sorted(SIGNS)


@pytest.mark.parametrize("sign", SIGNS)
def test_each_sign_pose_is_recognised_as_itself(recognizer, sign):
    rng = random.Random(7)
    correct = 0
    for index in range(60):
        payload = sign_frame(SIGN_POSES[sign], rng=rng, swap_labels=index % 2 == 1)
        best, runner_up = matches(recognizer, payload)[:2]
        if best.sign_id == sign and best.score >= 0.6 and best.score - runner_up.score >= 0.1:
            correct += 1
    assert correct >= 57, f"{sign}: {correct}/60"


@pytest.mark.parametrize("pose", sorted(NON_SIGN_POSES))
def test_non_sign_poses_score_low(recognizer, pose):
    rng = random.Random(3)
    for _ in range(40):
        best = matches(recognizer, sign_frame(NON_SIGN_POSES[pose], rng=rng))[0]
        assert best.score < 0.45, (pose, best.sign_id, best.score)


@pytest.mark.parametrize("sign", ["tiger", "rat", "dog", "ox", "monkey", "boar"])
def test_mirroring_and_hand_size_do_not_change_the_result(recognizer, sign):
    rng = random.Random(11)
    payload = sign_frame(SIGN_POSES[sign], rng=rng)
    assert matches(recognizer, payload)[0].sign_id == sign
    assert matches(recognizer, mirror(payload))[0].sign_id == sign
    small = sign_frame(SIGN_POSES[sign], rng=random.Random(11), vary=False)
    for hand in small["hands"]:
        hand["landmarks"] = [[0.5 + (x - 0.5) * 0.5, 0.5 + (y - 0.5) * 0.5, z * 0.5] for x, y, z in hand["landmarks"]]
    assert matches(recognizer, small)[0].sign_id == sign


def test_near_miss_reports_what_is_off(recognizer):
    # Tiger with the middle fingers raised is not Tiger.
    a, b = (dict(kwargs) for kwargs in SIGN_POSES["tiger"])
    a["curls"] = b["curls"] = (0.0, 0.0, 0.0, 1.0, 1.0)
    found = {m.sign_id: m for m in matches(recognizer, sign_frame((a, b), vary=False))}
    tiger = found["tiger"]
    assert tiger.score < 0.6
    assert any("middle" in condition.label for condition in tiger.weakest(3))


def test_invalid_recognition_config_is_rejected(tmp_path):
    config_dir = tmp_path / "config"
    shutil.copytree(AppConfig().config_dir, config_dir)
    path = config_dir / "signs.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["signs"][0]["recognition"]["rules"].append({"feature": "elbow_angle", "max": 1})
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(RegistryError, match="elbow_angle"):
        GameRegistry(config_dir)


# -- API: first-time play without training --------------------------------------


def hold_sign(client, clock, pose, frames: int = 10, seed: int = 5, **extra) -> list[dict]:
    rng = random.Random(seed)
    responses = []
    for _ in range(frames):
        payload = sign_frame(pose, rng=rng) if pose is not None else {"hands": []}
        response = client.post("/api/predict", json={"session_id": SESSION, **payload, **extra})
        assert response.status_code == 200, response.text
        responses.append(response.json())
        clock.advance(0.08)
    return responses


def events(responses) -> list[dict]:
    return [r["event"] for r in responses if r["event"]]


def test_fireball_activates_out_of_the_box(client, clock):
    collected = []
    for sign in ("tiger", "snake", "ram"):
        collected += events(hold_sign(client, clock, SIGN_POSES[sign]))
        hold_sign(client, clock, None, frames=4)
    assert [e["type"] for e in collected] == ["sign_accepted", "sign_accepted", "jutsu_activated"]
    assert collected[-1]["activation"]["jutsu_id"] == "fireball"


@pytest.mark.parametrize("sign", SIGNS)
def test_every_sign_is_accepted_without_training(client, clock, sign):
    responses = hold_sign(client, clock, SIGN_POSES[sign], track_sequence=False)
    final = responses[-1]["prediction"]
    assert final["status"] == "recognized" and final["sign"] == sign
    assert final["engine"] == "builtin" and final["calibrated"] is False
    assert responses[-1]["model_ready"] is True


def test_sign_is_accepted_after_the_configured_hold_time(client, clock):
    client.put("/api/settings", json={"hold_ms": 800})
    responses = hold_sign(client, clock, SIGN_POSES["tiger"], frames=14)
    accepted_at = [i for i, r in enumerate(responses) if r["event"] and r["event"]["type"] == "sign_accepted"]
    assert accepted_at == [10]  # first frame at which 800 ms have passed (80 ms per frame)
    assert responses[5]["prediction"]["status"] == "recognizing"
    assert 0.4 < responses[5]["prediction"]["stability"] < 0.8


def test_holding_a_sign_counts_once_and_reforming_counts_again(client, clock):
    first = hold_sign(client, clock, SIGN_POSES["tiger"], frames=40)  # 3.2 s hold
    assert [e["type"] for e in events(first)] == ["sign_accepted"]
    hold_sign(client, clock, None, frames=5)
    client.post("/api/sequence/reset", json={"session_id": SESSION})
    again = hold_sign(client, clock, SIGN_POSES["tiger"], frames=10)
    assert [e["type"] for e in events(again)] == ["sign_accepted"]


@pytest.mark.parametrize("pose", sorted(NON_SIGN_POSES))
def test_non_sign_poses_never_trigger(client, clock, pose):
    responses = hold_sign(client, clock, NON_SIGN_POSES[pose], frames=25)
    assert all(r["prediction"]["sign"] is None for r in responses)
    assert all(r["prediction"]["status"] == "unknown" for r in responses)
    assert events(responses) == []


def test_one_hand_is_reported_clearly(client, clock):
    payload = sign_frame(SIGN_POSES["tiger"])
    payload["hands"] = payload["hands"][:1]
    body = client.post("/api/predict", json={"session_id": SESSION, **payload}).json()
    assert body["prediction"]["status"] == "unknown" and body["prediction"]["sign"] is None
    assert "One hand detected" in body["prediction"]["message"]
    assert body["hands"]["count"] == 1


def test_debug_payload_explains_the_prediction(client, clock):
    body = hold_sign(client, clock, SIGN_POSES["dog"], frames=1, debug=True)[0]
    debug = body["debug"]
    assert debug["engine"] == "builtin"
    assert [hand["slot"] for hand in debug["hands"]] == ["left", "right"]
    assert all(len(hand["extension"]) == 5 for hand in debug["hands"])
    assert {score["sign"] for score in debug["scores"]} == set(SIGNS)
    assert debug["scores"][0]["sign"] == "dog"
    assert "palm_distance" in debug["pair"] and debug["hold_ms"] == 300
    assert hold_sign(client, clock, SIGN_POSES["dog"], frames=1)[0]["debug"] is None


def test_strict_mode_needs_a_closer_match_than_easy(client, clock):
    easy = hold_sign(client, clock, SIGN_POSES["horse"], frames=1)[0]["prediction"]["threshold"]
    client.put("/api/settings", json={"recognition_mode": "strict"})
    strict = hold_sign(client, clock, SIGN_POSES["horse"], frames=1)[0]["prediction"]["threshold"]
    assert strict > easy


# -- personal calibration -------------------------------------------------------


def save(client, label: str, pose, count: int, seed: int = 1):
    rng = random.Random(seed)
    samples = [sign_frame(pose, rng=rng) for _ in range(count)]
    response = client.post("/api/training/samples", json={"label": label, "capture_group": f"cal-{seed}", "samples": samples})
    assert response.status_code == 200, response.text


def test_calibration_teaches_a_personal_variant_without_training(client, clock):
    # This player forms Ox their own way: two open hands side by side - a pose
    # the built-in template does not accept.
    personal = NON_SIGN_POSES["open_hands_apart"]
    before = hold_sign(client, clock, personal, frames=10, track_sequence=False)
    assert all(r["prediction"]["sign"] is None for r in before)

    save(client, "ox", personal, count=10)
    after = hold_sign(client, clock, personal, frames=10, track_sequence=False, seed=9)
    final = after[-1]["prediction"]
    assert final["status"] == "recognized" and final["sign"] == "ox" and final["calibrated"] is True

    signs = {sign["id"]: sign for sign in client.get("/api/signs").json()["signs"]}
    assert signs["ox"]["recognition_source"] == "calibrated" and signs["ox"]["calibration_samples"] == 10
    assert client.get("/api/health").json()["calibrated_signs"] == ["ox"]


def test_too_few_samples_do_not_count_as_calibration(client, clock):
    save(client, "ox", NON_SIGN_POSES["open_hands_apart"], count=4)
    responses = hold_sign(client, clock, NON_SIGN_POSES["open_hands_apart"], frames=10, track_sequence=False)
    assert all(r["prediction"]["sign"] is None for r in responses)


def test_idle_samples_suppress_matching_poses(client, clock):
    save(client, "none", SIGN_POSES["horse"], count=12)
    responses = hold_sign(client, clock, SIGN_POSES["horse"], frames=10, track_sequence=False, seed=4)
    assert all(r["prediction"]["sign"] is None for r in responses)
    assert "idle" in responses[-1]["prediction"]["message"].lower()
