"""HTTP-level tests, including the full collect -> train -> play loop on synthetic landmarks."""

from __future__ import annotations

import random

import pytest

from helpers import make_batch, make_frame

SESSION = "test-session-1"


def post_samples(client, label: str, count: int = 14, bursts: int = 2):
    for burst in range(bursts):
        response = client.post(
            "/api/training/samples",
            json={"label": label, "capture_group": f"burst-{burst}", "samples": make_batch(label, count, seed=burst + len(label))},
        )
        assert response.status_code == 200, response.text


def train(client, container, labels=("tiger", "snake", "ram", "ox", "none")):
    """Train a model on the simple test poses and switch the recogniser to it.

    (Those poses are crude stand-ins, so the built-in templates are not used here;
    they are covered in test_builtin_recognition.py.)
    """
    for label in labels:
        post_samples(client, label)
    response = client.post("/api/training/train")
    assert response.status_code == 202, response.text
    container.training.wait(60)
    status = client.get("/api/training/status").json()
    assert status["job"]["state"] == "completed", status["job"]
    assert client.put("/api/settings", json={"recognition_engine": "trained"}).status_code == 200
    return status


def hold(client, clock, pose: str | None, frames: int = 9, **extra):
    """Send several frames of one pose (None = no hands). Returns all responses."""
    rng = random.Random(42)
    responses = []
    for _ in range(frames):
        payload = make_frame(pose, rng=rng) if pose else {"hands": []}
        response = client.post("/api/predict", json={"session_id": SESSION, **payload, **extra})
        assert response.status_code == 200, response.text
        responses.append(response.json())
        clock.advance(0.08)
    return responses


def events(responses) -> list[dict]:
    return [response["event"] for response in responses if response["event"]]


def perform(client, clock, poses: list[str], **extra) -> list[dict]:
    collected = []
    for pose in poses:
        collected += events(hold(client, clock, pose, **extra))
        hold(client, clock, None, frames=4, **extra)
    return collected


# -- basics -------------------------------------------------------------------


def test_health_reports_builtin_recognition_without_a_model(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["model_ready"] is False
    assert body["recognition_engine"] == "builtin"
    assert len(body["recognizable_signs"]) == 12 and body["calibrated_signs"] == []
    assert body["signs_total"] == 12 and body["jutsu_total"] == 8


def test_signs_and_jutsu_catalogues(client):
    signs = client.get("/api/signs").json()["signs"]
    assert [sign["id"] for sign in signs] == [
        "rat", "ox", "tiger", "rabbit", "dragon", "snake", "horse", "ram", "monkey", "bird", "dog", "boar",
    ]
    assert all(sign["recognition_status"] == "untrained" and sign["metrics"] is None for sign in signs)
    assert all(sign["recognition_source"] == "builtin" and sign["calibration_samples"] == 0 for sign in signs)
    assert all(sign["hands_required"] == 2 for sign in signs)

    jutsu = client.get("/api/jutsu").json()["jutsu"]
    assert len(jutsu) == 8
    fireball = next(item for item in jutsu if item["id"] == "fireball")
    assert fireball["sequence"] == ["tiger", "snake", "ram"]
    # The built-in recogniser covers every sign, so every jutsu is playable from the start.
    assert all(item["unlocked"] and item["missing_signs"] == [] for item in jutsu)


def test_trained_engine_without_model_never_invents_a_sign(client, clock):
    client.put("/api/settings", json={"recognition_engine": "trained"})
    responses = hold(client, clock, "tiger", frames=12)
    assert all(r["prediction"]["status"] == "model_missing" for r in responses)
    assert all(r["prediction"]["sign"] is None and r["event"] is None for r in responses)
    assert all(r["model_ready"] is False for r in responses)
    assert responses[-1]["hands"] == {"count": 2, "left": True, "right": True}
    assert "Training Studio" in responses[-1]["prediction"]["message"]
    jutsu = client.get("/api/jutsu").json()["jutsu"]
    assert not any(item["unlocked"] for item in jutsu)


def test_predict_with_no_hands(client, clock):
    response = hold(client, clock, None, frames=1)[0]
    assert response["prediction"]["status"] == "no_hands"
    assert response["hands"] == {"count": 0, "left": False, "right": False}


# -- validation ---------------------------------------------------------------


@pytest.mark.parametrize(
    "mutate",
    [
        lambda p: p["hands"][0]["landmarks"].pop(),
        lambda p: p["hands"][0]["landmarks"][0].__setitem__(0, 1e9),
        lambda p: p["hands"][0].__setitem__("handedness", "Up"),
        lambda p: p["hands"].extend([p["hands"][0], p["hands"][0]]),
        lambda p: p.__setitem__("session_id", "bad id!"),
        lambda p: p.__setitem__("image_height", 0),
        lambda p: p.__setitem__("unexpected", True),
        lambda p: p["hands"][0].__setitem__("landmarks", "nope"),
    ],
)
def test_predict_rejects_invalid_payloads(client, mutate):
    payload = {"session_id": SESSION, **make_frame("tiger")}
    mutate(payload)
    response = client.post("/api/predict", json=payload)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error" and error["message"]


def test_malformed_json_is_handled(client):
    response = client.post("/api/predict", content="{oops", headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_unknown_route_returns_json_error(client):
    response = client.get("/api/nope")
    assert response.status_code == 404 and "error" in response.json()


# -- training -----------------------------------------------------------------


def test_training_is_blocked_on_empty_dataset(client):
    status = client.get("/api/training/status").json()
    assert status["can_train"] is False and "empty" in status["blocking_reason"]
    response = client.post("/api/training/train")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "insufficient_data"


def test_training_is_blocked_with_a_single_class(client):
    post_samples(client, "tiger")
    response = client.post("/api/training/train")
    assert response.status_code == 400
    assert "at least 2 classes" in response.json()["error"]["message"]


def test_samples_for_unknown_label_or_missing_hand_are_rejected(client):
    unknown = client.post(
        "/api/training/samples", json={"label": "giraffe", "capture_group": "a", "samples": make_batch("tiger", 2)}
    )
    assert unknown.status_code == 404

    one_hand = [make_frame("tiger", hands=1) for _ in range(3)]
    rejected = client.post("/api/training/samples", json={"label": "tiger", "capture_group": "a", "samples": one_hand})
    assert rejected.status_code == 400 and rejected.json()["error"]["code"] == "no_valid_samples"

    mixed = client.post(
        "/api/training/samples",
        json={"label": "tiger", "capture_group": "a", "samples": one_hand + make_batch("tiger", 2)},
    )
    assert mixed.status_code == 200
    assert mixed.json()["saved"] == 2 and mixed.json()["rejected"] == 3

    idle = client.post("/api/training/samples", json={"label": "none", "capture_group": "a", "samples": one_hand})
    assert idle.status_code == 200 and idle.json()["saved"] == 3


def test_sample_listing_and_deletion(client):
    post_samples(client, "tiger", count=3, bursts=1)
    listing = client.get("/api/training/samples", params={"label": "tiger"}).json()
    assert listing["total"] == 3 and len(listing["samples"][0]["hands"]) == 2

    sample_id = listing["samples"][0]["id"]
    assert client.delete(f"/api/training/samples/tiger/{sample_id}").json() == {"deleted": 1, "total_for_label": 2}
    assert client.delete(f"/api/training/samples/tiger/{sample_id}").status_code == 404
    assert client.delete("/api/training/samples/tiger").json()["deleted"] == 2


def test_train_reports_real_metrics_and_updates_catalogues(client, container):
    status = train(client, container)
    model = status["model"]
    assert model["ready"] is True
    assert sorted(model["trained_signs"]) == ["ox", "ram", "snake", "tiger"]
    assert model["evaluation"]["group_aware"] is True
    assert model["total_samples"] == 5 * 28
    assert status["dataset_changed_since_training"] is False

    signs = {sign["id"]: sign for sign in client.get("/api/signs").json()["signs"]}
    assert signs["tiger"]["recognition_status"] == "trained"
    assert signs["tiger"]["metrics"]["support"] == 28
    assert signs["tiger"]["reference_hands"] is not None
    assert signs["rat"]["recognition_status"] == "untrained" and signs["rat"]["metrics"] is None

    jutsu = {item["id"]: item for item in client.get("/api/jutsu").json()["jutsu"]}
    assert jutsu["fireball"]["unlocked"] is True
    assert jutsu["water_style"]["unlocked"] is False and jutsu["water_style"]["missing_signs"] == ["rat"]

    post_samples(client, "tiger", count=1, bursts=1)
    assert client.get("/api/training/status").json()["dataset_changed_since_training"] is True


# -- gameplay -----------------------------------------------------------------


def test_trained_sign_is_recognised_after_the_hold_time(client, container, clock):
    train(client, container)
    responses = hold(client, clock, "tiger", frames=10)
    statuses = [r["prediction"]["status"] for r in responses]
    assert statuses[0] == "recognizing" and statuses[-1] == "recognized"
    assert all(r["prediction"]["sign"] == "tiger" for r in responses)
    assert [e["type"] for e in events(responses)] == ["sign_accepted"]  # accepted once per hold
    assert responses[-1]["sequence"]["signs"] == ["tiger"]
    assert responses[-1]["sequence"]["candidates"] == [{"jutsu_id": "fireball", "matched": 1, "total": 3}]


def test_idle_pose_and_single_hand_are_unknown(client, container, clock):
    train(client, container)
    idle = hold(client, clock, "none", frames=8)
    assert all(r["prediction"]["status"] == "unknown" and r["prediction"]["sign"] is None for r in idle)
    assert events(idle) == []

    rng = random.Random(1)
    one_hand = client.post("/api/predict", json={"session_id": SESSION, **make_frame("tiger", rng=rng, hands=1)}).json()
    assert one_hand["prediction"]["status"] == "unknown"
    assert one_hand["hands"]["count"] == 1


def test_low_confidence_is_reported_as_unknown(client, container, clock):
    train(client, container)
    client.put("/api/settings", json={"recognition_sensitivity": 0})
    original = container.classifier.predict

    def uncertain(features):
        raw = original(features)
        return type(raw)(label=raw.label, confidence=0.5, ranked=[(raw.label, 0.5), *raw.ranked[1:]])

    container.classifier.predict = uncertain
    responses = hold(client, clock, "tiger", frames=8)
    assert all(r["prediction"]["status"] == "unknown" and r["prediction"]["sign"] is None for r in responses)
    assert events(responses) == []


def test_correct_sequence_activates_jutsu_and_scores(client, container, clock):
    train(client, container)
    result = perform(client, clock, ["tiger", "snake", "ram"])
    assert [e["type"] for e in result] == ["sign_accepted", "sign_accepted", "jutsu_activated"]

    activation = result[-1]["activation"]
    assert activation["jutsu_id"] == "fireball" and activation["effect"] == "fireball"
    assert activation["points"] == 100 and activation["combo"] == 1
    assert [a["id"] for a in activation["new_achievements"]] == ["first_spark"]

    state = hold(client, clock, None, frames=1)[0]
    assert state["game"]["score"] == 100 and state["game"]["activations"] == 1
    assert state["game"]["accuracy"] == 1.0 and state["sequence"]["signs"] == []

    history = client.get("/api/history").json()
    assert history["stats"]["total_activations"] == 1 and history["stats"]["total_score"] == 100
    assert history["activations"][0]["jutsu_name"] == "Fireball Jutsu"
    assert history["activations"][0]["sequence"] == ["tiger", "snake", "ram"]
    unlocked = {a["id"] for a in history["achievements"] if a["unlocked"]}
    assert unlocked == {"first_spark", "apprentice_of_signs"}


def test_incorrect_sequence_does_not_activate_or_score(client, container, clock):
    train(client, container)
    result = perform(client, clock, ["tiger", "ox", "snake"])
    assert [e["type"] for e in result] == ["sign_accepted", "incorrect_sequence", "no_match"]
    assert "Incorrect sequence" in result[1]["message"]

    state = hold(client, clock, None, frames=1)[0]
    assert state["game"]["score"] == 0 and state["game"]["activations"] == 0
    assert state["game"]["incorrect"] == 1 and state["game"]["accuracy"] == 0.0
    assert client.get("/api/history").json()["stats"]["total_activations"] == 0


def test_holding_the_final_sign_does_not_activate_twice(client, container, clock):
    train(client, container)
    perform(client, clock, ["tiger", "snake"])
    held = hold(client, clock, "ram", frames=60)  # ~5 s, well past the lockout
    assert [e["type"] for e in events(held)] == ["jutsu_activated"]
    assert client.get("/api/history").json()["stats"]["total_activations"] == 1


def test_combo_grows_and_breaks(client, container, clock):
    train(client, container)

    def cast(poses):
        result = perform(client, clock, poses)
        clock.advance(3)  # let the activation lockout pass
        return result

    first = cast(["tiger", "snake", "ram"])[-1]["activation"]
    second = cast(["ram"])[-1]["activation"]  # Shadow Clone: a single Ram
    assert (first["combo"], first["points"]) == (1, 100)
    assert (second["combo"], second["multiplier"], second["points"]) == (2, 1.25, 150)

    cast(["tiger", "ox"])  # incorrect -> combo broken
    third = cast(["tiger", "snake", "ram"])[-1]["activation"]
    assert third["combo"] == 1 and third["points"] == 100

    stats = client.get("/api/history").json()["stats"]
    assert stats["best_combo"] == 2 and stats["incorrect_sequences"] == 1
    assert stats["accuracy"] == pytest.approx(0.75)


def test_sequence_timeout_resets_without_penalty(client, container, clock):
    train(client, container)
    perform(client, clock, ["tiger"])
    clock.advance(30)
    response = hold(client, clock, None, frames=1)[0]
    assert response["event"]["type"] == "sequence_timeout"
    assert response["sequence"]["signs"] == [] and response["game"]["incorrect"] == 0


def test_target_mode_and_reset(client, container, clock):
    train(client, container)
    result = perform(client, clock, ["ram"], target_jutsu_id="fireball")
    assert result[0]["type"] == "no_match" and "begins with Tiger" in result[0]["message"]

    perform(client, clock, ["tiger"], target_jutsu_id="fireball")
    reset = client.post("/api/sequence/reset", json={"session_id": SESSION, "reset_score": True}).json()
    assert reset["sequence"]["signs"] == [] and reset["game"]["score"] == 0


def test_classify_only_mode_does_not_touch_the_sequence(client, container, clock):
    train(client, container)
    responses = hold(client, clock, "tiger", frames=10, track_sequence=False)
    assert responses[-1]["prediction"]["status"] == "recognized"
    assert events(responses) == [] and responses[-1]["sequence"]["signs"] == []


# -- configuration, settings, history ----------------------------------------


def test_jutsu_sequence_can_be_edited_and_is_validated(client, container, clock):
    ok = client.put("/api/jutsu/fireball", json={"sequence": ["ox", "tiger"]})
    assert ok.status_code == 200 and ok.json()["sequence"] == ["ox", "tiger"]
    assert client.get("/api/jutsu").json()["jutsu"][0]["sequence"] == ["ox", "tiger"]

    for bad in (["ox", "giraffe"], ["rat", "tiger"], ["tiger", "tiger"]):  # unknown / prefix of water / repeat
        response = client.put("/api/jutsu/fireball", json={"sequence": bad})
        assert response.status_code == 400 and response.json()["error"]["code"] == "invalid_sequence"
    assert client.put("/api/jutsu/fireball", json={"sequence": ["ox"]}).status_code == 400  # starts Lightning Style
    assert client.put("/api/jutsu/fireball", json={"sequence": []}).status_code == 422
    assert client.put("/api/jutsu/missing", json={"sequence": ["ox", "tiger"]}).status_code == 404

    train(client, container)
    result = perform(client, clock, ["ox", "tiger"])
    assert result[-1]["type"] == "jutsu_activated" and result[-1]["jutsu_id"] == "fireball"


def test_settings_persist_and_validate(client, config):
    defaults = client.get("/api/settings").json()
    assert defaults["mirror_camera"] is True and defaults["theme"] == "crimson"

    updated = client.put("/api/settings", json={"theme": "azure", "sound_enabled": False, "camera_device_id": "cam-1"})
    assert updated.json()["theme"] == "azure" and updated.json()["mirror_camera"] is True

    assert client.put("/api/settings", json={"theme": "rainbow"}).status_code == 422
    assert client.put("/api/settings", json={"recognition_sensitivity": 500}).status_code == 422

    # a fresh app on the same database sees the saved values
    from app.core.container import build_container
    from app.factory import create_app
    from fastapi.testclient import TestClient

    fresh = TestClient(create_app(container=build_container(config)))
    stored = fresh.get("/api/settings").json()
    assert stored["theme"] == "azure" and stored["sound_enabled"] is False and stored["camera_device_id"] == "cam-1"

    cleared = fresh.put("/api/settings", json={"camera_device_id": None}).json()
    assert cleared["camera_device_id"] is None and cleared["theme"] == "azure"
    assert fresh.post("/api/settings/reset").json() == defaults


def test_history_can_be_cleared(client, container, clock):
    train(client, container)
    perform(client, clock, ["tiger", "snake", "ram"])
    assert client.delete("/api/history").status_code == 204
    history = client.get("/api/history").json()
    assert history["activations"] == [] and history["stats"]["total_activations"] == 0
    assert not any(a["unlocked"] for a in history["achievements"])
    assert history["training"]["signs_trained"] == 4  # training data is untouched
