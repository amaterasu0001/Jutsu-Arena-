from __future__ import annotations

import pytest

from app.sequence_engine import (
    SequenceConfigError,
    SequenceDefinition,
    SequenceEngine,
    SequenceEventType,
    validate_definitions,
)

FIREBALL = SequenceDefinition("fireball", ("tiger", "snake", "ram"))
WATER = SequenceDefinition("water", ("rat", "tiger", "snake"))
CLONE = SequenceDefinition("clone", ("ram", "snake", "tiger"))


@pytest.fixture
def engine() -> SequenceEngine:
    return SequenceEngine([FIREBALL, WATER, CLONE], timeout_ms=5000, lockout_ms=2000)


def feed(engine: SequenceEngine, signs: list[str], start_ms: float = 0, step_ms: float = 500):
    return [engine.on_sign(sign, start_ms + index * step_ms) for index, sign in enumerate(signs)]


def test_correct_sequence_activates_jutsu(engine):
    first, second, third = feed(engine, ["tiger", "snake", "ram"])
    assert first.type is SequenceEventType.SIGN_ACCEPTED
    assert second.type is SequenceEventType.SIGN_ACCEPTED
    assert third.type is SequenceEventType.JUTSU_ACTIVATED
    assert third.jutsu_id == "fireball"
    assert third.signs == ("tiger", "snake", "ram")
    assert engine.snapshot(1000).signs == ()


def test_progress_is_tracked_per_candidate(engine):
    engine.on_sign("tiger", 0)
    snapshot = engine.snapshot(100)
    assert snapshot.signs == ("tiger",)
    assert snapshot.candidates == (("fireball", 1, 3),)
    assert snapshot.time_remaining_ms == 4900


def test_incorrect_sequence_does_not_activate_and_resets(engine):
    events = feed(engine, ["tiger", "ox"])
    assert events[1].type is SequenceEventType.INCORRECT_SEQUENCE
    assert events[1].signs == ("tiger", "ox")
    assert engine.snapshot(1000).signs == ()
    # the wrong attempt must not leak into the next one
    third = engine.on_sign("ram", 1500)
    assert third.type is SequenceEventType.SIGN_ACCEPTED


def test_player_can_retry_after_incorrect_sequence(engine):
    feed(engine, ["tiger", "ox"])
    events = feed(engine, ["tiger", "snake", "ram"], start_ms=2000)
    assert events[-1].type is SequenceEventType.JUTSU_ACTIVATED


def test_first_sign_that_starts_nothing_is_no_match_not_incorrect(engine):
    event = engine.on_sign("dragon", 0)
    assert event.type is SequenceEventType.NO_MATCH
    assert engine.snapshot(0).signs == ()


def test_duplicate_activation_is_prevented_by_lockout(engine):
    feed(engine, ["tiger", "snake", "ram"])  # activates at t=1000
    assert engine.snapshot(1500).locked
    assert engine.on_sign("tiger", 1500) is None
    assert engine.on_sign("ram", 2900) is None
    assert engine.snapshot(2900).signs == ()
    # after the lockout a new sequence can begin
    assert engine.on_sign("tiger", 3100).type is SequenceEventType.SIGN_ACCEPTED


def test_timeout_resets_partial_sequence(engine):
    engine.on_sign("tiger", 0)
    assert engine.tick(4000) is None
    event = engine.tick(5001)
    assert event.type is SequenceEventType.SEQUENCE_TIMEOUT
    assert event.signs == ("tiger",)
    assert engine.snapshot(5001).signs == ()
    assert engine.tick(9000) is None  # reported once


def test_timeout_is_measured_between_signs(engine):
    engine.on_sign("tiger", 0)
    engine.on_sign("snake", 4500)
    assert engine.tick(9000) is None
    assert engine.on_sign("ram", 9000).type is SequenceEventType.JUTSU_ACTIVATED


def test_multiple_jutsu_are_matched_independently(engine):
    assert feed(engine, ["rat", "tiger", "snake"])[-1].jutsu_id == "water"
    assert feed(engine, ["ram", "snake", "tiger"], start_ms=10_000)[-1].jutsu_id == "clone"


def test_target_mode_only_matches_the_selected_jutsu(engine):
    engine.set_target("fireball")
    assert engine.on_sign("rat", 0).type is SequenceEventType.NO_MATCH
    assert feed(engine, ["tiger", "snake", "ram"], start_ms=100)[-1].jutsu_id == "fireball"


def test_changing_target_clears_progress(engine):
    engine.on_sign("tiger", 0)
    engine.set_target("water")
    assert engine.snapshot(10).signs == ()
    engine.set_target("does-not-exist")
    assert engine.target is None


def test_reset_clears_buffer_and_lockout(engine):
    feed(engine, ["tiger", "snake", "ram"])
    engine.reset()
    assert not engine.snapshot(1100).locked
    assert engine.on_sign("tiger", 1100).type is SequenceEventType.SIGN_ACCEPTED


def test_config_rejects_prefix_conflicts_duplicates_and_empty_sequences():
    with pytest.raises(SequenceConfigError):
        validate_definitions([FIREBALL, SequenceDefinition("x", ("tiger", "snake"))])
    with pytest.raises(SequenceConfigError):
        validate_definitions([FIREBALL, SequenceDefinition("x", FIREBALL.signs)])
    with pytest.raises(SequenceConfigError):
        validate_definitions([SequenceDefinition("x", ())])
    with pytest.raises(SequenceConfigError):  # a single sign that starts another sequence
        validate_definitions([FIREBALL, SequenceDefinition("x", ("tiger",))])


def test_single_sign_sequence_activates_on_one_sign():
    engine = SequenceEngine([FIREBALL, SequenceDefinition("clone", ("ram",))])
    event = engine.on_sign("ram", 0)
    assert event.type is SequenceEventType.JUTSU_ACTIVATED and event.jutsu_id == "clone"
    # Ram still finishes Fireball when it comes after Tiger -> Snake.
    engine.on_sign("tiger", 5000)
    engine.on_sign("snake", 5500)
    assert engine.on_sign("ram", 6000).jutsu_id == "fireball"


def test_pause_freezes_the_countdown_and_ignores_signs():
    engine = SequenceEngine([SequenceDefinition("fireball", ("tiger", "snake", "ram"))], timeout_ms=20000)
    engine.on_sign("tiger", 0)
    engine.pause(5000)
    assert engine.on_sign("snake", 6000) is None  # ignored while paused
    assert engine.tick(60_000) is None  # no timeout while paused
    assert engine.snapshot(60_000).time_remaining_ms == 15000 and engine.snapshot(60_000).paused
    engine.resume(60_000)
    assert engine.snapshot(60_000).time_remaining_ms == 15000  # continues where it stopped
    assert engine.on_sign("snake", 61_000).type is SequenceEventType.SIGN_ACCEPTED
    assert engine.tick(61_000 + 20_001) is not None  # the normal timeout still applies


def test_default_time_between_signs_is_twenty_seconds():
    assert SequenceEngine([SequenceDefinition("fireball", ("tiger", "snake"))]).timeout_ms == 20000
