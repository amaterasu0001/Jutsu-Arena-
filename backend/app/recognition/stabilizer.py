"""Temporal smoothing: turn noisy per-frame predictions into accepted signs.

Everything is measured in milliseconds rather than frames, so the hold time
feels the same whatever the camera frame rate or network latency.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class StabilizerConfig:
    #: How long a sign must stay the confident prediction before it is accepted.
    hold_ms: int = 300
    #: ...and on at least this many frames (guards against a single slow frame).
    min_frames: int = 2
    #: Time without the held sign before the same sign may be accepted again.
    release_ms: int = 250
    #: Minimum time before the *same* sign can be accepted again. A different
    #: sign is never delayed by it, so Tiger -> Snake flows without waiting.
    cooldown_ms: int = 300
    #: Dropouts shorter than this (a blurred frame, a flicker to "unknown" or
    #: to another sign) do not restart the hold.
    glitch_ms: int = 150


@dataclass(frozen=True)
class StabilizerState:
    candidate: str | None
    #: 0..1 progress of the candidate toward acceptance.
    progress: float
    #: Set on exactly the frame a sign is accepted.
    accepted: str | None
    #: True while the candidate is a sign that was already accepted and is still held.
    held: bool


@dataclass
class _Run:
    sign: str
    start_ms: float
    last_match_ms: float
    frames: int


class SignStabilizer:
    """Accept a sign once per hold.

    A sign is accepted when it has been the confident prediction for
    ``hold_ms`` on at least ``min_frames`` frames, and it is not the sign that
    is already being held. Short dropouts (``glitch_ms``) do not restart the
    hold. A *different* confident sign starts its own hold immediately; if the
    previous sign comes back within ``glitch_ms`` (a one-frame flicker), its
    hold resumes where it was. The held sign is released once it has been
    absent for ``release_ms`` - after that, forming it again counts as a new
    sign.
    """

    def __init__(self, config: StabilizerConfig | None = None) -> None:
        self.config = config or StabilizerConfig()
        self.reset()

    def reset(self) -> None:
        self._run: _Run | None = None
        self._previous: _Run | None = None
        self._held: str | None = None
        self._held_seen = 0.0
        self._last_accept: dict[str, float] = {}

    def configure(self, config: StabilizerConfig) -> None:
        self.config = config

    def _track(self, sign: str | None, now_ms: float) -> None:
        cfg = self.config
        run = self._run
        if sign is not None and run is not None and sign == run.sign:
            run.last_match_ms = now_ms
            run.frames += 1
            return
        if sign is None:
            if run is not None and now_ms - run.last_match_ms <= cfg.glitch_ms:
                return  # forgive a short dropout
            self._run = None
            return
        # A different sign. If it is the sign that was just interrupted, and the
        # interruption (the other sign's run) lasted no longer than glitch_ms,
        # it was only a flicker: resume the earlier hold. Otherwise start the new
        # sign's hold right away.
        previous = self._previous
        if (
            previous is not None
            and run is not None
            and previous.sign == sign
            and now_ms - run.start_ms <= cfg.glitch_ms
        ):
            previous.last_match_ms = now_ms
            previous.frames += 1
            self._run, self._previous = previous, None
            return
        self._previous = run
        self._run = _Run(sign=sign, start_ms=now_ms, last_match_ms=now_ms, frames=1)

    def observe(self, sign: str | None, now_ms: float) -> StabilizerState:
        """Feed one frame. ``sign`` is ``None`` for unknown / no hands."""
        cfg = self.config

        # Release the previously accepted sign once it has been gone long enough.
        if self._held is not None:
            if sign == self._held:
                self._held_seen = now_ms
            elif now_ms - self._held_seen >= cfg.release_ms:
                self._held = None

        self._track(sign, now_ms)
        run = self._run
        if run is None:
            return StabilizerState(candidate=None, progress=0.0, accepted=None, held=False)

        held = run.sign == self._held
        elapsed = now_ms - run.start_ms
        progress = 1.0 if cfg.hold_ms <= 0 else min(elapsed / cfg.hold_ms, 1.0)
        last = self._last_accept.get(run.sign)
        cooled = last is None or now_ms - last >= cfg.cooldown_ms
        accepted: str | None = None
        if not held and sign == run.sign and elapsed >= cfg.hold_ms and run.frames >= cfg.min_frames and cooled:
            accepted = run.sign
            self._held = run.sign
            self._held_seen = now_ms
            self._last_accept[run.sign] = now_ms
            held = True

        return StabilizerState(candidate=run.sign, progress=round(progress, 3), accepted=accepted, held=held)
