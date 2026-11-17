"""Recognition speed, continuous sign flow, pausing and settings storage."""

from __future__ import annotations

import json
import random

from app.recognition.smoothing import ScoreSmoother
from helpers import SIGN_POSES, sign_frame

SESSION = "speed-session"
STEP_S = 0.09  # the browser sends a frame about every 90 ms


def stream(client, clock, signs: list[str | None], seed: int = 3, **extra) -> list[dict]:
    rng = random.Random(seed)
    responses = []
    for sign in signs:
        payload = sign_frame(SIGN_POSES[sign], rng=rng) if sign else {"hands": []}
        response = client.post("/api/predict", json={"session_id": SESSION, **payload, **extra})
        assert response.status_code == 200, response.text
        responses.append(response.json())
        clock.advance(STEP_S)
    return responses


def accepted(responses) -> list[tuple[int, str]]:
    return [(i, r["event"]["sign"]) for i, r in enumerate(responses) if r["event"] and r["event"]["sign"]]


def test_a_held_sign_is_accepted_within_about_a_third_of_a_second(client, clock):
    responses = stream(client, clock, ["tiger"] * 8)
    (index, sign), = accepted(responses)
    assert sign == "tiger"
    assert index * STEP_S * 1000 <= 400  # accepted on the frame 360 ms after the sign appeared
    assert responses[0]["prediction"]["sign"] == "tiger"  # shown as "recognizing" on the very first frame


def test_tiger_snake_ram_performed_continuously_activates_fireball(client, clock):
    # Each sign held ~0.45 s, flowing straight into the next with no relaxed frames.
    responses = stream(client, clock, ["tiger"] * 5 + ["snake"] * 5 + ["ram"] * 5)
    events = [r["event"] for r in responses if r["event"]]
    assert [e["type"] for e in events] == ["sign_accepted", "sign_accepted", "jutsu_activated"]
    assert [i for i, _ in accepted(responses)] == [4, 9, 14]


def test_holding_a_sign_never_duplicates_it(client, clock):
    responses = stream(client, clock, ["tiger"] * 60)  # 5.4 s
    assert [e["type"] for e in (r["event"] for r in responses) if e] == ["sign_accepted"]


def test_pause_freezes_time_between_signs_and_ignores_signs(client, clock):
    stream(client, clock, ["tiger"] * 6)
    paused = client.post("/api/sequence/pause", json={"session_id": SESSION, "paused": True}).json()
    assert paused["sequence"]["paused"] is True and paused["sequence"]["signs"] == ["tiger"]
    remaining = paused["sequence"]["time_remaining_ms"]

    clock.advance(120)  # two minutes away from the game
    during = stream(client, clock, ["snake"] * 8)
    assert all(r["event"] is None for r in during)
    assert during[-1]["sequence"]["time_remaining_ms"] == remaining

    resumed = client.post("/api/sequence/pause", json={"session_id": SESSION, "paused": False}).json()
    assert resumed["sequence"]["paused"] is False and resumed["sequence"]["signs"] == ["tiger"]
    after = stream(client, clock, [None, None, "snake", "snake", "snake", "snake", "snake", "snake"])
    assert [e["sign"] for e in (r["event"] for r in after) if e] == ["snake"]


def test_default_timing_settings(client):
    settings = client.get("/api/settings").json()
    assert settings["hold_ms"] == 300
    assert settings["sequence_timeout_seconds"] == 20
    assert settings["game_mode"] == "normal"
    assert client.put("/api/settings", json={"sequence_timeout_seconds": 5}).status_code == 422
    assert client.put("/api/settings", json={"game_mode": "easy"}).json()["game_mode"] == "easy"


def test_only_changed_settings_are_stored(client, container):
    client.put("/api/settings", json={"theme": "azure"})
    with container.database.connect() as connection:
        rows = dict(connection.execute("SELECT key, value FROM settings").fetchall())
    assert rows == {"theme": json.dumps("azure")}


def test_superseded_defaults_and_invalid_values_do_not_wipe_other_settings(container, config):
    # A database written by an older version: every field pinned, old defaults included.
    old = {"theme": "violet", "sound_enabled": False, "sequence_timeout_seconds": 6, "hold_ms": 500, "recognition_sensitivity": 999}
    with container.database.write() as connection:
        connection.executemany(
            "INSERT INTO settings (player_id, key, value) VALUES ('local', ?, ?)",
            [(key, json.dumps(value)) for key, value in old.items()],
        )
    from app.core.container import build_container

    settings = build_container(config).settings.get("local")
    assert settings.theme == "violet" and settings.sound_enabled is False  # kept
    assert settings.sequence_timeout_seconds == 20 and settings.hold_ms == 300  # old defaults -> new defaults
    assert settings.recognition_sensitivity == 50  # only the invalid value falls back


def test_smoother_removes_single_frame_dips_but_follows_real_changes():
    smoother = ScoreSmoother(time_constant_ms=100)
    smoother.update({"tiger": 0.8}, 0)
    dip = smoother.update({"tiger": 0.3}, 90)["tiger"]
    assert dip > 0.45  # a one-frame dip below a 0.56 threshold would otherwise restart the hold
    for t in range(180, 720, 90):
        smoothed = smoother.update({"tiger": 0.0, "snake": 0.9}, t)
    assert smoothed["snake"] > 0.85 and smoothed["tiger"] < 0.1
    assert smoother.update({"ram": 0.7}, 5000) == {"ram": 0.7}  # after a long gap it starts fresh
