"""Match accepted hand signs against configured jutsu sequences.

The engine knows nothing about cameras, landmarks or classifiers: it receives
sign ids that were already accepted upstream, plus a timestamp, and reports
what happened.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class SequenceConfigError(ValueError):
    """Raised when the configured sequences are ambiguous or malformed."""


@dataclass(frozen=True)
class SequenceDefinition:
    jutsu_id: str
    signs: tuple[str, ...]


class SequenceEventType(str, Enum):
    SIGN_ACCEPTED = "sign_accepted"
    JUTSU_ACTIVATED = "jutsu_activated"
    INCORRECT_SEQUENCE = "incorrect_sequence"
    #: A first sign that starts no available sequence. Not penalised.
    NO_MATCH = "no_match"
    SEQUENCE_TIMEOUT = "sequence_timeout"


@dataclass(frozen=True)
class SequenceEvent:
    type: SequenceEventType
    sign: str | None = None
    #: The signs involved (the attempt, including the sign that ended it).
    signs: tuple[str, ...] = ()
    jutsu_id: str | None = None


@dataclass(frozen=True)
class SequenceSnapshot:
    signs: tuple[str, ...]
    #: ``(jutsu_id, matched, total)`` for every sequence still reachable.
    candidates: tuple[tuple[str, int, int], ...]
    target_jutsu_id: str | None
    timeout_ms: int
    time_remaining_ms: int | None
    locked: bool
    paused: bool = False


def validate_definitions(definitions: list[SequenceDefinition]) -> None:
    """Reject configurations the engine cannot match unambiguously."""
    seen: dict[tuple[str, ...], str] = {}
    for definition in definitions:
        if len(definition.signs) < 1:
            raise SequenceConfigError(f"Sequence for '{definition.jutsu_id}' needs at least one sign.")
        if definition.signs in seen:
            raise SequenceConfigError(
                f"'{definition.jutsu_id}' and '{seen[definition.signs]}' use the same sequence."
            )
        seen[definition.signs] = definition.jutsu_id
    for a in definitions:
        for b in definitions:
            if a is not b and len(a.signs) < len(b.signs) and b.signs[: len(a.signs)] == a.signs:
                raise SequenceConfigError(
                    f"The sequence for '{a.jutsu_id}' is the beginning of '{b.jutsu_id}', "
                    "so the longer one could never be completed."
                )


@dataclass
class SequenceEngine:
    definitions: list[SequenceDefinition]
    timeout_ms: int = 20000
    #: After an activation, signs are ignored for this long (prevents duplicates).
    lockout_ms: int = 2500

    _buffer: list[str] = field(default_factory=list, init=False)
    _last_sign_ms: float | None = field(default=None, init=False)
    _locked_until_ms: float = field(default=0.0, init=False)
    _target: str | None = field(default=None, init=False)
    _paused_at_ms: float | None = field(default=None, init=False)

    def __post_init__(self) -> None:
        validate_definitions(self.definitions)

    # -- configuration ----------------------------------------------------

    def set_definitions(self, definitions: list[SequenceDefinition]) -> None:
        validate_definitions(definitions)
        self.definitions = definitions
        if self._target is not None and all(d.jutsu_id != self._target for d in definitions):
            self._target = None
        self.reset()

    def set_target(self, jutsu_id: str | None) -> None:
        """Restrict matching to one jutsu (``None`` = match any)."""
        if jutsu_id is not None and all(d.jutsu_id != jutsu_id for d in self.definitions):
            jutsu_id = None
        if jutsu_id != self._target:
            self._target = jutsu_id
            self.reset()

    @property
    def target(self) -> str | None:
        return self._target

    def reset(self) -> None:
        self._buffer = []
        self._last_sign_ms = None
        self._locked_until_ms = 0.0

    def cancel_lockout(self) -> None:
        """Drop the post-activation lockout (used when an activation is refused)."""
        self._locked_until_ms = 0.0

    # -- pausing ----------------------------------------------------------

    @property
    def paused(self) -> bool:
        return self._paused_at_ms is not None

    def pause(self, now_ms: float) -> None:
        """Freeze the time-between-signs countdown (and ignore signs) until :meth:`resume`."""
        if self._paused_at_ms is None:
            self._paused_at_ms = now_ms

    def resume(self, now_ms: float) -> None:
        """Continue exactly where :meth:`pause` stopped: the paused time is not counted."""
        if self._paused_at_ms is None:
            return
        paused_for = max(0.0, now_ms - self._paused_at_ms)
        if self._last_sign_ms is not None:
            self._last_sign_ms += paused_for
        if self._locked_until_ms:
            self._locked_until_ms += paused_for
        self._paused_at_ms = None

    # -- matching ---------------------------------------------------------

    def _active(self) -> list[SequenceDefinition]:
        if self._target is None:
            return self.definitions
        return [d for d in self.definitions if d.jutsu_id == self._target]

    def _candidates(self, buffer: list[str]) -> list[SequenceDefinition]:
        length = len(buffer)
        prefix = tuple(buffer)
        return [d for d in self._active() if d.signs[:length] == prefix]

    def tick(self, now_ms: float) -> SequenceEvent | None:
        """Call every frame; reports a timeout when the player waits too long."""
        if self._paused_at_ms is not None:
            return None
        if (
            self._buffer
            and self._last_sign_ms is not None
            and now_ms - self._last_sign_ms > self.timeout_ms
        ):
            expired = tuple(self._buffer)
            self._buffer = []
            self._last_sign_ms = None
            return SequenceEvent(SequenceEventType.SEQUENCE_TIMEOUT, signs=expired)
        return None

    def on_sign(self, sign: str, now_ms: float) -> SequenceEvent | None:
        """Feed one accepted sign. Returns ``None`` while locked after an activation or paused."""
        if self._paused_at_ms is not None or now_ms < self._locked_until_ms:
            return None

        attempt = self._buffer + [sign]
        candidates = self._candidates(attempt)

        if not candidates:
            had_progress = bool(self._buffer)
            self._buffer = []
            self._last_sign_ms = None
            event_type = (
                SequenceEventType.INCORRECT_SEQUENCE if had_progress else SequenceEventType.NO_MATCH
            )
            return SequenceEvent(event_type, sign=sign, signs=tuple(attempt))

        completed = next((d for d in candidates if len(d.signs) == len(attempt)), None)
        if completed is not None:
            self._buffer = []
            self._last_sign_ms = None
            self._locked_until_ms = now_ms + self.lockout_ms
            return SequenceEvent(
                SequenceEventType.JUTSU_ACTIVATED,
                sign=sign,
                signs=tuple(attempt),
                jutsu_id=completed.jutsu_id,
            )

        self._buffer = attempt
        self._last_sign_ms = now_ms
        return SequenceEvent(SequenceEventType.SIGN_ACCEPTED, sign=sign, signs=tuple(attempt))

    def snapshot(self, now_ms: float) -> SequenceSnapshot:
        if self._paused_at_ms is not None:
            now_ms = self._paused_at_ms  # the countdown is frozen while paused
        remaining: int | None = None
        if self._buffer and self._last_sign_ms is not None:
            remaining = max(0, int(self.timeout_ms - (now_ms - self._last_sign_ms)))
        candidates = tuple(
            (d.jutsu_id, len(self._buffer), len(d.signs)) for d in self._candidates(self._buffer)
        )
        return SequenceSnapshot(
            signs=tuple(self._buffer),
            candidates=candidates,
            target_jutsu_id=self._target,
            timeout_ms=self.timeout_ms,
            time_remaining_ms=remaining,
            locked=now_ms < self._locked_until_ms,
            paused=self._paused_at_ms is not None,
        )
