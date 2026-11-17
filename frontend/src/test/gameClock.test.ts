import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGameClock } from '@/hooks/useGameClock';
import {
  advance,
  displaySeconds,
  endClock,
  formatClock,
  freezeClock,
  GAME_MODES,
  idleClock,
  PREPARATION_MS,
  remainingMs,
  startClock,
  timeWarning,
  unfreezeClock,
} from '@/lib/gameClock';

describe('gameClock (pure)', () => {
  it('has the requested modes, with Normal at 120 s', () => {
    expect(GAME_MODES.easy.seconds).toBe(180);
    expect(GAME_MODES.normal.seconds).toBe(120);
    expect(GAME_MODES.challenge.seconds).toBe(90);
    expect(PREPARATION_MS).toBe(15_000);
  });

  it('does nothing until started', () => {
    const idle = idleClock();
    expect(idle.phase).toBe('idle');
    expect(advance(idle, 1e9)).toBe(idle);
    expect(remainingMs(idle, 1e9)).toBe(0);
  });

  it('runs a 15 s preparation, then the full challenge time', () => {
    let clock = startClock('normal', 1000);
    expect(clock.phase).toBe('preparing');
    expect(displaySeconds(clock, 1000)).toBe(15);
    clock = advance(clock, 1000 + 15_000);
    expect(clock.phase).toBe('running');
    expect(displaySeconds(clock, 16_000)).toBe(120);
    expect(displaySeconds(clock, 16_000 + 999)).toBe(120);
    expect(displaySeconds(clock, 16_000 + 1000)).toBe(119);
  });

  it('never loses time when the preparation tick arrives late', () => {
    const clock = advance(startClock('normal', 0), 15_400); // timer fired 400 ms late
    expect(remainingMs(clock, 15_400)).toBe(120_000 - 400);
  });

  it('ends exactly at zero and never goes negative', () => {
    let clock = advance(startClock('challenge', 0, 0), 89_999);
    expect(clock.phase).toBe('running');
    clock = advance(clock, 90_000);
    expect(clock.phase).toBe('ended');
    expect(remainingMs(clock, 500_000)).toBe(0);
    expect(displaySeconds(clock, 500_000)).toBe(0);
  });

  it('pauses and resumes without losing or gaining time', () => {
    let clock = startClock('normal', 0, 0);
    clock = freezeClock(clock, 'user', 10_000);
    expect(remainingMs(clock, 10_000)).toBe(110_000);
    expect(remainingMs(clock, 600_000)).toBe(110_000); // ten minutes paused
    clock = unfreezeClock(clock, 'user', 600_000);
    expect(remainingMs(clock, 605_000)).toBe(105_000);
  });

  it('stays frozen until both the player and the animation release it', () => {
    let clock = startClock('normal', 0, 0);
    clock = freezeClock(clock, 'effect', 1000);
    clock = freezeClock(clock, 'user', 2000);
    clock = unfreezeClock(clock, 'effect', 3000);
    expect(remainingMs(clock, 9000)).toBe(119_000);
    clock = unfreezeClock(clock, 'user', 9000);
    expect(remainingMs(clock, 10_000)).toBe(118_000);
  });

  it('warns at 30 s and 10 s', () => {
    const clock = startClock('normal', 0, 0);
    expect(timeWarning(clock, 89_999)).toBe('none');
    expect(timeWarning(clock, 90_000)).toBe('warning');
    expect(timeWarning(clock, 110_000)).toBe('critical');
    expect(timeWarning(startClock('normal', 0), 5000)).toBe('none'); // not during preparation
  });

  it('can be ended early and formats the display', () => {
    const ended = endClock(startClock('normal', 0, 0), 30_000);
    expect(ended.phase).toBe('ended');
    expect(formatClock(120)).toBe('2:00');
    expect(formatClock(9)).toBe('0:09');
    expect(formatClock(-3)).toBe('0:00');
  });
});

describe('useGameClock', () => {
  let now = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
  });
  afterEach(() => vi.useRealTimers());

  const step = (ms: number) =>
    act(() => {
      for (let t = 0; t < ms; t += 50) {
        now += 50;
        vi.advanceTimersByTime(50);
      }
    });

  it('does not start counting when the page opens', () => {
    const { result } = renderHook(() => useGameClock(() => now));
    step(5000);
    expect(result.current.state.phase).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('decreases exactly once per second after Start Game', () => {
    const renders: number[] = [];
    const { result } = renderHook(() => {
      const clock = useGameClock(() => now);
      renders.push(clock.seconds);
      return clock;
    });
    act(() => result.current.start('normal'));
    step(PREPARATION_MS);
    expect(result.current.state.phase).toBe('running');
    expect(result.current.seconds).toBe(120);

    const before = renders.length;
    const seen: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      step(1000);
      seen.push(result.current.seconds);
    }
    expect(seen).toEqual([119, 118, 117, 116, 115]);
    expect(renders.length - before).toBe(5); // one re-render per second, none in between
    expect(vi.getTimerCount()).toBe(1); // a single interval
  });

  it('pauses, resumes and stops its timer while paused', () => {
    const { result } = renderHook(() => useGameClock(() => now));
    act(() => result.current.start('normal'));
    step(PREPARATION_MS + 3000);
    expect(result.current.seconds).toBe(117);

    act(() => result.current.pause());
    expect(result.current.paused).toBe(true);
    step(20_000);
    expect(result.current.seconds).toBe(117);
    expect(vi.getTimerCount()).toBe(0);

    act(() => result.current.resume());
    step(2000);
    expect(result.current.seconds).toBe(115);
  });

  it('stops at 0 when time runs out', () => {
    const { result } = renderHook(() => useGameClock(() => now));
    act(() => result.current.start('challenge'));
    step(PREPARATION_MS + 90_000 + 2000);
    expect(result.current.state.phase).toBe('ended');
    expect(result.current.seconds).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer behind on unmount, and a remount starts clean', () => {
    const first = renderHook(() => useGameClock(() => now));
    act(() => first.result.current.start('normal'));
    expect(vi.getTimerCount()).toBe(1);
    first.unmount();
    expect(vi.getTimerCount()).toBe(0);

    const second = renderHook(() => useGameClock(() => now));
    expect(second.result.current.state.phase).toBe('idle');
    act(() => second.result.current.start('normal'));
    expect(vi.getTimerCount()).toBe(1);
  });
});
