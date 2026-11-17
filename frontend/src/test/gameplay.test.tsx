import { act, render, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { playEffect } from '@/animations';
import { JutsuEffect } from '@/animations/JutsuEffect';
import { SignDetectedCard } from '@/components/SignDetectedCard';
import { usePredictionLoop } from '@/hooks/usePredictionLoop';
import type { TrackedFrame } from '@/lib/hands';
import { ApiError, api, OFFLINE_MESSAGE } from '@/services/api';
import type { GameEvent } from '@/types/api';

import { predictResponse } from './fixtures';

vi.mock('@/animations', () => ({ playEffect: vi.fn() }));
vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return { ...actual, api: { predict: vi.fn() } };
});

const playEffectMock = vi.mocked(playEffect);
const predictMock = vi.mocked(api.predict);

const frame = (timestamp = 0): TrackedFrame => ({
  timestamp,
  image_width: 1280,
  image_height: 720,
  hands: [{ handedness: 'Left', score: 0.98765, landmarks: Array.from({ length: 21 }, () => [0.123456789, 0.5, -0.01] as [number, number, number]) }],
});

const activationEvent: GameEvent = {
  id: 3,
  type: 'jutsu_activated',
  sign: 'ram',
  signs: ['tiger', 'snake', 'ram'],
  jutsu_id: 'fireball',
  message: 'Fireball Jutsu activated',
  activation: {
    activation_id: 1,
    jutsu_id: 'fireball',
    jutsu_name: 'Fireball Jutsu',
    element: 'fire',
    effect: 'fireball',
    base_points: 100,
    multiplier: 1,
    points: 100,
    combo: 1,
    sequence: ['tiger', 'snake', 'ram'],
    new_achievements: [],
  },
};

describe('JutsuEffect', () => {
  let dispose = vi.fn<() => void>();

  beforeEach(() => {
    dispose = vi.fn<() => void>();
    playEffectMock.mockReset().mockReturnValue(dispose);
  });

  it('does not play anything until a jutsu is activated', () => {
    render(<JutsuEffect effect={null} playKey={0} quality={1} />);
    render(<JutsuEffect effect="fireball" playKey={0} quality={1} />);
    expect(playEffectMock).not.toHaveBeenCalled();
  });

  it('plays the activated jutsu effect once, with the chosen quality', () => {
    const { getByTestId, rerender } = render(<JutsuEffect effect="fireball" playKey={1} quality={0.7} />);
    expect(playEffectMock).toHaveBeenCalledTimes(1);
    expect(playEffectMock).toHaveBeenCalledWith(getByTestId('jutsu-effect'), 'fireball', 0.7, expect.any(Function));

    rerender(<JutsuEffect effect="fireball" playKey={1} quality={0.7} />);
    expect(playEffectMock).toHaveBeenCalledTimes(1);
  });

  it('replays when the play key changes and stops the previous run first', () => {
    const { rerender } = render(<JutsuEffect effect="fireball" playKey={1} quality={1} />);
    rerender(<JutsuEffect effect="fireball" playKey={2} quality={1} />);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(playEffectMock).toHaveBeenCalledTimes(2);
  });

  it('switches effect when a different jutsu is activated', () => {
    const { rerender } = render(<JutsuEffect effect="fireball" playKey={1} quality={1} />);
    rerender(<JutsuEffect effect="lightning" playKey={2} quality={1} />);
    expect(playEffectMock.mock.calls[1][1]).toBe('lightning');
  });

  it('reports completion and frees resources on unmount', () => {
    const onDone = vi.fn();
    const { unmount } = render(<JutsuEffect effect="water" playKey={1} quality={1} onDone={onDone} />);
    playEffectMock.mock.calls[0][3]();
    expect(onDone).toHaveBeenCalledTimes(1);
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('never blocks interaction with the page underneath', () => {
    const { getByTestId } = render(<JutsuEffect effect="fireball" playKey={1} quality={1} />);
    expect(getByTestId('jutsu-effect').className).toContain('pointer-events-none');
  });
});

describe('usePredictionLoop', () => {
  beforeEach(() => {
    predictMock.mockReset();
    vi.spyOn(performance, 'now').mockReturnValue(10_000);
  });

  const advance = (ms: number) => vi.mocked(performance.now).mockReturnValue(10_000 + ms);

  it('sends rounded landmarks (never video) and exposes the backend answer', async () => {
    predictMock.mockResolvedValue(predictResponse());
    const { result } = renderHook(() => usePredictionLoop({ sessionId: 'session-1', trackSequence: true, targetJutsuId: 'fireball' }));

    act(() => result.current.submit(frame()));
    await waitFor(() => expect(result.current.response).not.toBeNull());

    const body = predictMock.mock.calls[0][0];
    expect(body).toMatchObject({ session_id: 'session-1', track_sequence: true, target_jutsu_id: 'fireball', image_width: 1280, image_height: 720 });
    expect(Object.keys(body).sort()).toEqual(['hands', 'image_height', 'image_width', 'session_id', 'target_jutsu_id', 'track_sequence']);
    expect(body.hands[0].landmarks[0]).toEqual([0.12346, 0.5, -0.01]);
    expect(body.hands[0].score).toBe(0.988);
  });

  it('asks for debug data only when the overlay is on', async () => {
    predictMock.mockResolvedValue(predictResponse());
    const { result, rerender } = renderHook(({ debug }) => usePredictionLoop({ sessionId: 'session-1', trackSequence: true, debug }), { initialProps: { debug: false } });
    act(() => result.current.submit(frame()));
    await waitFor(() => expect(result.current.response).not.toBeNull());
    expect(predictMock.mock.calls[0][0]).not.toHaveProperty('debug');

    rerender({ debug: true });
    advance(200);
    act(() => result.current.submit(frame()));
    await waitFor(() => expect(predictMock).toHaveBeenCalledTimes(2));
    expect(predictMock.mock.calls[1][0]).toMatchObject({ debug: true });
  });

  it('slows down to a heartbeat while no hands are visible', async () => {
    predictMock.mockResolvedValue(predictResponse());
    const empty = (): TrackedFrame => ({ ...frame(), hands: [] });
    const { result } = renderHook(() => usePredictionLoop({ sessionId: 'session-1', trackSequence: true, intervalMs: 90 }));
    act(() => result.current.submit(empty()));
    await act(async () => undefined);
    advance(150);
    act(() => result.current.submit(empty()));
    expect(predictMock).toHaveBeenCalledTimes(1);
    act(() => result.current.submit(frame())); // hands are back: normal rate
    expect(predictMock).toHaveBeenCalledTimes(2);
    await act(async () => undefined);
    advance(500);
    act(() => result.current.submit(empty()));
    expect(predictMock).toHaveBeenCalledTimes(3);
  });

  it('never overlaps requests and throttles the send rate', async () => {
    let resolve: (value: ReturnType<typeof predictResponse>) => void = () => undefined;
    predictMock.mockReturnValueOnce(new Promise((done) => (resolve = done))).mockResolvedValue(predictResponse());
    const { result } = renderHook(() => usePredictionLoop({ sessionId: 'session-1', trackSequence: true, intervalMs: 90 }));

    act(() => result.current.submit(frame()));
    advance(500);
    act(() => result.current.submit(frame())); // first request still in flight
    expect(predictMock).toHaveBeenCalledTimes(1);

    await act(async () => resolve(predictResponse()));
    act(() => result.current.submit(frame())); // free again: sent at +500 ms
    expect(predictMock).toHaveBeenCalledTimes(2);
    await act(async () => undefined);

    advance(530);
    act(() => result.current.submit(frame())); // only 30 ms after the last send
    expect(predictMock).toHaveBeenCalledTimes(2);

    advance(600);
    act(() => result.current.submit(frame()));
    expect(predictMock).toHaveBeenCalledTimes(3);
  });

  it('delivers each game event exactly once', async () => {
    const onEvent = vi.fn();
    predictMock.mockResolvedValue(predictResponse({ event: activationEvent }));
    const { result } = renderHook(() => usePredictionLoop({ sessionId: 'session-1', trackSequence: true, onEvent }));

    act(() => result.current.submit(frame()));
    await waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1));
    expect(onEvent.mock.calls[0][0]).toMatchObject({ type: 'jutsu_activated', jutsu_id: 'fireball' });

    advance(1000);
    act(() => result.current.submit(frame()));
    await waitFor(() => expect(predictMock).toHaveBeenCalledTimes(2));
    await act(async () => undefined);
    expect(onEvent).toHaveBeenCalledTimes(1); // same event id repeated by the server
  });

  it('goes offline on a network failure, backs off, and recovers', async () => {
    predictMock.mockRejectedValueOnce(new ApiError('network', OFFLINE_MESSAGE)).mockResolvedValue(predictResponse());
    const { result } = renderHook(() => usePredictionLoop({ sessionId: 'session-1', trackSequence: true }));

    act(() => result.current.submit(frame()));
    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(result.current.response).toBeNull();

    advance(500);
    act(() => result.current.submit(frame())); // inside the offline back-off window
    expect(predictMock).toHaveBeenCalledTimes(1);

    advance(2000);
    act(() => result.current.submit(frame()));
    await waitFor(() => expect(result.current.offline).toBe(false));
    expect(result.current.response).not.toBeNull();
  });

  it('reports a rejected request without going offline', async () => {
    predictMock.mockRejectedValue(new ApiError('http', 'Invalid request data (hands): bad', 422, 'validation_error'));
    const { result } = renderHook(() => usePredictionLoop({ sessionId: 'session-1', trackSequence: true }));
    act(() => result.current.submit(frame()));
    await waitFor(() => expect(result.current.error).toMatch(/invalid request data/i));
    expect(result.current.offline).toBe(false);
  });

  it('ignores answers that arrive after the camera was stopped', async () => {
    let resolve: (value: ReturnType<typeof predictResponse>) => void = () => undefined;
    predictMock.mockReturnValue(new Promise((done) => (resolve = done)));
    const onEvent = vi.fn();
    const { result } = renderHook(() => usePredictionLoop({ sessionId: 'session-1', trackSequence: true, onEvent }));

    act(() => result.current.submit(frame()));
    act(() => result.current.clear());
    await act(async () => resolve(predictResponse({ event: activationEvent })));
    expect(result.current.response).toBeNull();
    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe('SignDetectedCard', () => {
  it('announces an accepted sign with its place in the sequence', () => {
    const { getByRole, rerender, queryByRole } = render(<SignDetectedCard detected={{ id: 1, label: { name: 'Tiger', kanji: '寅' }, step: 1, total: 3 }} />);
    expect(getByRole('status')).toHaveTextContent(/Tiger detected/i);
    expect(getByRole('status')).toHaveTextContent('1 / 3 signs completed');
    rerender(<SignDetectedCard detected={null} />);
    return waitFor(() => expect(queryByRole('status')).toBeNull());
  });
});
