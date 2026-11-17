import { useCallback, useEffect, useRef, useState } from 'react';

import {
  advance,
  displaySeconds,
  endClock,
  freezeClock,
  idleClock,
  startClock,
  timeWarning,
  unfreezeClock,
  type ClockState,
  type FreezeReason,
  type GameMode,
  type TimeWarning,
} from '@/lib/gameClock';

export interface GameClock {
  state: ClockState;
  /** Whole seconds left in the current phase; changes exactly once per second. */
  seconds: number;
  warning: TimeWarning;
  /** True while a phase is counting down (not paused, not frozen by an animation). */
  ticking: boolean;
  paused: boolean;
  start: (mode: GameMode) => void;
  pause: () => void;
  resume: () => void;
  freeze: (reason: FreezeReason) => void;
  unfreeze: (reason: FreezeReason) => void;
  end: () => void;
  reset: (mode?: GameMode) => void;
}

interface Snapshot {
  state: ClockState;
  seconds: number;
  warning: TimeWarning;
}

const TICK_MS = 200;

/**
 * Challenge clock for the arena. State lives in a ref and is derived from
 * timestamps; a single interval (only while counting down) re-renders the
 * component when the displayed second or the phase changes - at most once per
 * second. The interval is cleared on pause, on end and on unmount, so leaving
 * and re-entering the page can never leave a second timer running.
 */
export function useGameClock(now: () => number = () => performance.now()): GameClock {
  const clock = useRef<ClockState>(idleClock());
  const nowRef = useRef(now);
  nowRef.current = now;
  const [snapshot, setSnapshot] = useState<Snapshot>({ state: clock.current, seconds: 0, warning: 'none' });

  const publish = useCallback((next: ClockState) => {
    const at = nowRef.current();
    const advanced = advance(next, at);
    clock.current = advanced;
    const seconds = displaySeconds(advanced, at);
    const warning = timeWarning(advanced, at);
    setSnapshot((previous) =>
      previous.state === advanced && previous.seconds === seconds && previous.warning === warning ? previous : { state: advanced, seconds, warning },
    );
  }, []);

  const ticking = (snapshot.state.phase === 'preparing' || snapshot.state.phase === 'running') && snapshot.state.freeze.length === 0;

  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => publish(clock.current), TICK_MS);
    return () => window.clearInterval(timer);
  }, [ticking, publish]);

  const start = useCallback((mode: GameMode) => publish(startClock(mode, nowRef.current())), [publish]);
  const pause = useCallback(() => publish(freezeClock(clock.current, 'user', nowRef.current())), [publish]);
  const resume = useCallback(() => publish(unfreezeClock(clock.current, 'user', nowRef.current())), [publish]);
  const freeze = useCallback((reason: FreezeReason) => publish(freezeClock(clock.current, reason, nowRef.current())), [publish]);
  const unfreeze = useCallback((reason: FreezeReason) => publish(unfreezeClock(clock.current, reason, nowRef.current())), [publish]);
  const end = useCallback(() => publish(endClock(clock.current, nowRef.current())), [publish]);
  const reset = useCallback((mode?: GameMode) => publish(idleClock(mode ?? clock.current.mode)), [publish]);

  return {
    state: snapshot.state,
    seconds: snapshot.seconds,
    warning: snapshot.warning,
    ticking,
    paused: snapshot.state.freeze.includes('user'),
    start,
    pause,
    resume,
    freeze,
    unfreeze,
    end,
    reset,
  };
}
