"""Shadow Clone Jutsu: a single Ram, copied from the live camera, and refused without a person."""

from __future__ import annotations

import random

from helpers import SIGN_POSES, sign_frame

SESSION = "clone-session"


def hold_ram(client, clock, frames: int = 8, seed: int = 4, **extra) -> list[dict]:
    rng = random.Random(seed)
    events = []
    for _ in range(frames):  # the built-in recogniser sees a Ram pose; nothing is hard-coded
        body = client.post("/api/predict", json={"session_id": SESSION, **sign_frame(SIGN_POSES["ram"], rng=rng), **extra}).json()
        if body["event"]:
            events.append(body["event"])
        clock.advance(0.09)
    return events


def test_shadow_clone_is_a_single_ram_that_needs_a_person(client):
    jutsu = {item["id"]: item for item in client.get("/api/jutsu").json()["jutsu"]}
    assert jutsu["shadow_clone"]["sequence"] == ["ram"]
    assert jutsu["shadow_clone"]["requires_person"] is True
    assert jutsu["fireball"]["requires_person"] is False


def test_recognised_ram_with_a_person_activates_and_is_saved(client, clock):
    events = hold_ram(client, clock, person_visible=True)
    assert [e["type"] for e in events] == ["jutsu_activated"]
    activation = events[0]["activation"]
    assert activation["jutsu_id"] == "shadow_clone" and activation["effect"] == "clone"
    history = client.get("/api/history").json()
    assert history["activations"][0]["jutsu_id"] == "shadow_clone"
    assert history["stats"]["per_jutsu"] == {"shadow_clone": 1}


def test_ram_without_a_person_is_refused_and_not_recorded(client, clock):
    events = hold_ram(client, clock, person_visible=False)
    assert [e["type"] for e in events] == ["person_required"]
    assert "stand in front of your camera" in events[0]["message"]
    assert events[0]["activation"] is None
    history = client.get("/api/history").json()
    assert history["activations"] == [] and history["stats"]["total_activations"] == 0

    # Step into the frame, release and re-form Ram: it works straight away (no lockout).
    for _ in range(4):
        client.post("/api/predict", json={"session_id": SESSION, "hands": []})
        clock.advance(0.09)
    assert [e["type"] for e in hold_ram(client, clock, person_visible=True, seed=6)] == ["jutsu_activated"]


def test_other_jutsu_ignore_the_person_flag(client, clock):
    rng = random.Random(2)
    collected = []
    for sign in ("tiger", "snake", "ram"):
        for _ in range(6):
            body = client.post(
                "/api/predict", json={"session_id": SESSION, "person_visible": False, **sign_frame(SIGN_POSES[sign], rng=rng)}
            ).json()
            if body["event"]:
                collected.append(body["event"])
            clock.advance(0.09)
        for _ in range(4):
            client.post("/api/predict", json={"session_id": SESSION, "hands": []})
            clock.advance(0.09)
    assert collected[-1]["type"] == "jutsu_activated" and collected[-1]["jutsu_id"] == "fireball"


def test_unknown_person_state_does_not_block(client, clock):
    # Clients that do not report person visibility (older ones, scripts) keep working.
    assert [e["type"] for e in hold_ram(client, clock)] == ["jutsu_activated"]
