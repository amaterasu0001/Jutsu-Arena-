// Timestamp-based challenge clock. Pure functions, no timers: the remaining
// time is always computed from timestamps, never by decrementing a counter, so
// re-renders, duplicate effects or slow frames cannot speed it up or reset it.

export type GameMode = 'easy' | 'normal' | 'challenge';
export type ClockPhase = 'idle' | 'preparing' | 'running' | 'ended';
/** Why the clock is frozen: the player paused, or a jutsu animation is playing. */
export type FreezeReason = 'user' | 'effect';

export const GAME_MODES: Record<GameMode, { label: string; seconds: number; note: string }> = {
  easy: { label: 'Easy', seconds: 180, note: '3 minutes — beginner friendly' },
  normal: { label: 'Normal', seconds: 120, note: '2 minutes' },
  challenge: { label: 'Challenge', seconds: 90, note: '90 seconds' },
};

export const PREPARATION_MS = 15_000;
export const WARNING_MS = 30_000;
export const CRITICAL_MS = 10_000;

export interface ClockState {
  phase: ClockPhase;
  mode: GameMode;
  /** Length of the current phase (preparation or challenge). */
  phaseMs: number;
  /** Time of the current phase used up before the current running segment. */
  consumedMs: number;
  /** When the current running segment started; null while frozen. */
  segmentStart: number | null;
  freeze: FreezeReason[];
}

export function idleClock(mode: GameMode = 'normal'): ClockState {
  return { phase: 'idle', mode, phaseMs: 0, consumedMs: 0, segmentStart: null, freeze: [] };
}

export function startClock(mode: GameMode, now: number, preparationMs = PREPARATION_MS): ClockState {
  if (preparationMs <= 0) return { phase: 'running', mode, phaseMs: GAME_MODES[mode].seconds * 1000, consumedMs: 0, segmentStart: now, freeze: [] };
  return { phase: 'preparing', mode, phaseMs: preparationMs, consumedMs: 0, segmentStart: now, freeze: [] };
}

function used(state: ClockState, now: number): number {
  return state.consumedMs + (state.segmentStart === null ? 0 : Math.max(0, now - state.segmentStart));
}

/** Milliseconds left in the current phase (never negative). */
export function remainingMs(state: ClockState, now: number): number {
  if (state.phase === 'idle') return 0;
  if (state.phase === 'ended') return 0;
  return Math.max(0, state.phaseMs - used(state, now));
}

/** Whole seconds shown to the player: 120 until a full second has passed, ... 1, then 0. */
export function displaySeconds(state: ClockState, now: number): number {
  return Math.ceil(remainingMs(state, now) / 1000);
}

/**
 * Advance phase transitions that are due at ``now``: preparation -> running
 * (the challenge starts with its full time) and running -> ended.
 */
export function advance(state: ClockState, now: number): ClockState {
  if (state.phase === 'preparing' && remainingMs(state, now) === 0) {
    const overshoot = used(state, now) - state.phaseMs;
    const challengeMs = GAME_MODES[state.mode].seconds * 1000;
    const next: ClockState = { ...state, phase: 'running', phaseMs: challengeMs, consumedMs: 0, segmentStart: state.freeze.length ? null : now - overshoot };
    return advance(next, now);
  }
  if (state.phase === 'running' && remainingMs(state, now) === 0) {
    return { ...state, phase: 'ended', consumedMs: state.phaseMs, segmentStart: null };
  }
  return state;
}

export function freezeClock(state: ClockState, reason: FreezeReason, now: number): ClockState {
  if (state.phase !== 'preparing' && state.phase !== 'running') return state;
  if (state.freeze.includes(reason)) return state;
  const freeze = [...state.freeze, reason];
  if (state.segmentStart === null) return { ...state, freeze };
  return { ...state, freeze, consumedMs: used(state, now), segmentStart: null };
}

export function unfreezeClock(state: ClockState, reason: FreezeReason, now: number): ClockState {
  if (!state.freeze.includes(reason)) return state;
  const freeze = state.freeze.filter((item) => item !== reason);
  if (freeze.length || (state.phase !== 'preparing' && state.phase !== 'running')) return { ...state, freeze };
  return { ...state, freeze, segmentStart: now };
}

export function endClock(state: ClockState, now: number): ClockState {
  if (state.phase === 'idle' || state.phase === 'ended') return state;
  return { ...state, phase: 'ended', consumedMs: Math.min(state.phaseMs, used(state, now)), segmentStart: null, freeze: [] };
}

export type TimeWarning = 'none' | 'warning' | 'critical';

export function timeWarning(state: ClockState, now: number): TimeWarning {
  if (state.phase !== 'running') return 'none';
  const left = remainingMs(state, now);
  if (left <= CRITICAL_MS) return 'critical';
  if (left <= WARNING_MS) return 'warning';
  return 'none';
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}
