from __future__ import annotations

from app.recognition import tuning
from app.recognition.engine import MODE_PRESETS, sensitivity_offset
from app.recognition.stabilizer import SignStabilizer, StabilizerConfig


def run(stabilizer: SignStabilizer, signs: list[str | None], step_ms: float = 80, start_ms: float = 0):
    return [stabilizer.observe(sign, start_ms + index * step_ms) for index, sign in enumerate(signs)]


def accepted(states) -> list[str]:
    return [state.accepted for state in states if state.accepted]


def make(**overrides) -> SignStabilizer:
    # 80 ms frames: a 240 ms hold is accepted on the 4th frame of a run.
    defaults = dict(hold_ms=240, min_frames=3, release_ms=160, cooldown_ms=0, glitch_ms=80)
    return SignStabilizer(StabilizerConfig(**{**defaults, **overrides}))


def test_sign_is_accepted_only_after_the_hold_time():
    states = run(make(), ["tiger"] * 4)
    assert [state.accepted for state in states] == [None, None, None, "tiger"]
    assert [state.progress for state in states] == [0.0, 0.333, 0.667, 1.0]


def test_hold_time_is_independent_of_frame_rate():
    slow = run(make(hold_ms=500, min_frames=2), ["tiger"] * 4, step_ms=200)  # 5 fps
    fast = run(make(hold_ms=500, min_frames=2), ["tiger"] * 20, step_ms=40)  # 25 fps
    assert [i for i, s in enumerate(slow) if s.accepted] == [3]  # t = 600 ms
    assert [i for i, s in enumerate(fast) if s.accepted] == [13]  # t = 520 ms


def test_min_frames_guards_against_a_single_slow_frame():
    states = run(make(hold_ms=100, min_frames=3), ["tiger"] * 3, step_ms=500)
    assert [state.accepted for state in states] == [None, None, "tiger"]


def test_held_sign_is_accepted_once():
    states = run(make(), ["tiger"] * 30)
    assert accepted(states) == ["tiger"]
    assert states[-1].held


def test_flickering_predictions_are_not_accepted():
    states = run(make(glitch_ms=0), ["tiger", "snake", "tiger", "ram", None, "tiger", "snake"] * 3)
    assert accepted(states) == []


def test_short_dropout_is_forgiven():
    states = run(make(), ["tiger", "tiger", None, "tiger", "tiger"])
    assert accepted(states) == ["tiger"]


def test_same_sign_requires_release_before_reacceptance():
    stabilizer = make()
    first = run(stabilizer, ["tiger"] * 6)  # t = 0 .. 400
    brief_gap = run(stabilizer, [None] + ["tiger"] * 6, start_ms=480)  # 80 ms gap < release_ms
    released = run(stabilizer, [None, None, None] + ["tiger"] * 4, start_ms=1040)  # 240 ms gap
    assert accepted(first) == ["tiger"]
    assert accepted(brief_gap) == []
    assert accepted(released) == ["tiger"]


def test_switching_directly_to_another_sign_is_accepted():
    states = run(make(), ["tiger"] * 5 + ["snake"] * 7)
    assert accepted(states) == ["tiger", "snake"]


def test_cooldown_never_delays_a_different_sign():
    stabilizer = make(cooldown_ms=5000, glitch_ms=0, hold_ms=200)
    states = run(stabilizer, ["tiger"] * 3 + ["snake"] * 3, step_ms=100)
    # tiger at t=200, snake held from t=300 -> accepted at t=500 despite the cooldown
    assert [(i, s.accepted) for i, s in enumerate(states) if s.accepted] == [(2, "tiger"), (5, "snake")]


def test_cooldown_delays_repeating_the_same_sign():
    stabilizer = make(cooldown_ms=1000, glitch_ms=0, hold_ms=200, release_ms=100)
    first = run(stabilizer, ["tiger"] * 3, step_ms=100)  # accepted at t=200
    run(stabilizer, [None] * 2, step_ms=100, start_ms=300)  # released
    early = run(stabilizer, ["tiger"] * 4, step_ms=100, start_ms=500)  # held long enough, but cooling down
    late = run(stabilizer, ["tiger"] * 3, step_ms=100, start_ms=1200)
    assert accepted(first) == ["tiger"] and accepted(early) == [] and accepted(late) == ["tiger"]


def test_a_new_sign_starts_its_hold_immediately():
    # No waiting for the old sign's dropout window: snake's hold starts on its first frame.
    states = run(make(glitch_ms=200), ["tiger"] * 4 + ["snake"] * 4)
    assert [(i, s.accepted) for i, s in enumerate(states) if s.accepted] == [(3, "tiger"), (7, "snake")]


def test_one_frame_flicker_to_another_sign_resumes_the_hold():
    states = run(make(), ["tiger", "tiger", "ram", "tiger", "tiger"])
    assert accepted(states) == ["tiger"]
    assert states[3].accepted == "tiger"  # t=240: the hold kept running through the flicker


def test_tiger_snake_ram_flow_without_pauses():
    # Natural continuous performance: each sign held ~0.4 s, no relaxed frames between.
    stabilizer = make(hold_ms=300, min_frames=2, release_ms=250, cooldown_ms=300, glitch_ms=150)
    states = run(stabilizer, ["tiger"] * 5 + ["snake"] * 5 + ["ram"] * 5, step_ms=90)
    assert accepted(states) == ["tiger", "snake", "ram"]
    assert [i for i, s in enumerate(states) if s.accepted] == [4, 9, 14]  # 360 ms into each hold


def test_unknown_frames_reset_progress():
    states = run(make(glitch_ms=0), ["tiger", "tiger", None, "tiger", "tiger", "tiger"])
    assert accepted(states) == []
    assert states[2].candidate is None and states[2].progress == 0.0


def test_reset_forgets_the_held_sign():
    stabilizer = make()
    run(stabilizer, ["tiger"] * 5)
    stabilizer.reset()
    assert accepted(run(stabilizer, ["tiger"] * 4, start_ms=1000)) == ["tiger"]


def test_sensitivity_maps_to_threshold():
    assert tuning.confidence_threshold(0) > tuning.confidence_threshold(50) > tuning.confidence_threshold(100)
    assert 0.4 < tuning.confidence_threshold(100) and tuning.confidence_threshold(0) <= 0.8
    assert sensitivity_offset(0) > sensitivity_offset(50) == 0 > sensitivity_offset(100)


def test_modes_get_stricter_from_easy_to_strict():
    easy, balanced, strict = MODE_PRESETS["easy"], MODE_PRESETS["balanced"], MODE_PRESETS["strict"]
    assert easy.threshold_offset < balanced.threshold_offset < strict.threshold_offset
    assert easy.margin < balanced.margin < strict.margin
    assert easy.glitch_ms > balanced.glitch_ms > strict.glitch_ms
