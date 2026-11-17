import { act, render, renderHook, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShadowCloneEffect } from '@/animations/ShadowCloneEffect';
import App from '@/App';
import { usePersonPresence } from '@/hooks/usePersonPresence';
import { cloneFormation, frameBoxToStage, liveFormation } from '@/lib/cloneFormation';
import { api } from '@/services/api';
import * as segmentation from '@/services/personSegmentation';
import { alphaBounds, captureShadow, detectPerson, fitWithin, maskCoverage } from '@/services/personSegmentation';

import { mockApi } from './fixtures';

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return { ...actual, api: {} };
});
vi.mock('@/animations', () => ({ playEffect: vi.fn(() => () => undefined) }));

const SOURCE = { url: 'blob:captured-frame', cutout: true, width: 300, height: 420 };

// -- geometry ------------------------------------------------------------------------

describe('frameBoxToStage', () => {
  it('maps a box 1:1 when the frame and the stage have the same shape', () => {
    expect(frameBoxToStage({ x: 0.4, y: 0.3, width: 0.2, height: 0.7 }, 16 / 9, 16 / 9)).toEqual({ x: 50, bottom: 0, width: 20, height: 70 });
  });

  it('accounts for object-fit: cover cropping the sides of a wider frame', () => {
    // 2:1 frame on a 16:9 stage: shown 1.125x wider than the stage, 6.25% cropped per side.
    const anchor = frameBoxToStage({ x: 0, y: 0, width: 0.5, height: 1 }, 2, 16 / 9);
    expect(anchor.width).toBeCloseTo(56.25);
    expect(anchor.x).toBeCloseTo(-6.25 + 56.25 / 2);
  });

  it('accounts for cropping the top and bottom of a taller frame', () => {
    const anchor = frameBoxToStage({ x: 0.25, y: 0.5, width: 0.5, height: 0.5 }, 4 / 3, 16 / 9);
    expect(anchor.height).toBeCloseTo(66.67, 1);
    expect(anchor.bottom).toBeCloseTo(-16.67, 1); // the person continues below the visible stage
  });
});

describe('liveFormation', () => {
  it('places 5 clones around the player: left, right, centre background, upper-left, upper-right', () => {
    const anchor = { x: 50, bottom: 0, width: 20, height: 70 };
    const [original, left, right, centreBack, upperLeft, upperRight] = liveFormation(anchor, 5, 'surround');
    expect(original).toMatchObject({ x: 0, bottom: 0, height: 70, depth: 0 });
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
    expect(centreBack.x).toBe(0);
    // it rises so that its head shows above the player's head instead of hiding behind them
    expect(centreBack.bottom + centreBack.height).toBeGreaterThan(original.bottom + original.height + 0.2 * centreBack.height);
    expect(upperLeft.x).toBeLessThan(left.x);
    expect(upperRight.x).toBeGreaterThan(right.x);
    expect(upperLeft.bottom).toBeGreaterThan(left.bottom);
    for (const clone of [centreBack, upperLeft, upperRight]) expect(clone.height).toBeLessThan(original.height);
  });

  it('follows the player and stays on the stage', () => {
    const atLeftEdge = liveFormation({ x: 15, bottom: 0, width: 22, height: 70 }, 7, 'surround');
    expect(atLeftEdge[0].x).toBe(-35);
    for (const slot of atLeftEdge) expect(Math.abs(slot.x)).toBeLessThanOrEqual(44);
  });

  it('keeps the existing formation tables for every count', () => {
    for (const count of [2, 3, 5, 7]) expect(cloneFormation(count, 'arrow')).toHaveLength(count + 1);
  });
});

// -- segmentation helpers ----------------------------------------------------------------

describe('person segmentation helpers', () => {
  it('scales without changing the aspect ratio', () => {
    expect(fitWithin(1280, 720, 720)).toEqual({ width: 720, height: 405 });
  });

  it('finds the person box and measures coverage', () => {
    const alpha = new Uint8ClampedArray(100);
    for (let y = 3; y <= 6; y += 1) for (let x = 4; x <= 5; x += 1) alpha[y * 10 + x] = 255;
    expect(alphaBounds(alpha, 10, 10, 25, 0)).toEqual({ x: 4, y: 3, width: 2, height: 4 });
    expect(maskCoverage([0.9, 0.8, 0.1, 0.0])).toBe(0.5);
  });

  it('never invents a capture without a camera image', async () => {
    expect(await captureShadow(null, true)).toEqual({ kind: 'no_camera' });
    expect(await detectPerson(null)).toEqual({ status: 'absent', coverage: 0 });
  });
});

// -- the effect -------------------------------------------------------------------------

describe('ShadowCloneEffect (live capture)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the frozen player and 5 copies of the same captured image, then finishes', () => {
    const onDone = vi.fn();
    render(
      <ShadowCloneEffect source={SOURCE} anchor={{ x: 50, bottom: 0, width: 18, height: 70 }} cutOffBelow count={5} formation="surround" durationMs={4000} smoke quality={1} onDone={onDone} />,
    );
    const effect = screen.getByTestId('shadow-clone-effect');
    expect(screen.getAllByTestId('clone-original')).toHaveLength(1);
    expect(screen.getAllByTestId('clone-copy')).toHaveLength(5);
    const images = effect.querySelectorAll('img');
    expect(images).toHaveLength(6);
    images.forEach((image) => expect(image.getAttribute('src')).toBe('blob:captured-frame'));
    expect(within(effect).getByText('Shadow Clone Jutsu!')).toBeInTheDocument();
    expect(within(effect).getByText('Shadow Clone Jutsu activated!')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3999));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('frames the captured frame when no cutout is available, without stretching it', () => {
    render(<ShadowCloneEffect source={{ ...SOURCE, cutout: false, width: 720, height: 405 }} anchor={null} count={5} formation="surround" durationMs={4000} smoke={false} quality={1} />);
    const effect = screen.getByTestId('shadow-clone-effect');
    expect(screen.queryByTestId('clone-original')).not.toBeInTheDocument(); // the live video is the original
    const frames = effect.querySelectorAll('img.object-cover');
    expect(frames).toHaveLength(5);
    expect((frames[0].parentElement as HTMLElement).style.aspectRatio).toBe('720 / 405');
    expect(effect.querySelector('canvas')).toBeNull(); // smoke switched off
  });
});

// -- presence hook -----------------------------------------------------------------------

describe('usePersonPresence', () => {
  afterEach(() => vi.useRealTimers());

  it('reports presence from the local check and stops when the camera is off', async () => {
    vi.useFakeTimers();
    const detect = vi.spyOn(segmentation, 'detectPerson').mockResolvedValue({ status: 'present', coverage: 0.3 });
    const videoRef = { current: document.createElement('video') };
    const { result, rerender, unmount } = renderHook(({ active }) => usePersonPresence(videoRef, active), { initialProps: { active: true } });
    await act(async () => undefined);
    expect(result.current).toBe('present');

    detect.mockResolvedValue({ status: 'absent', coverage: 0 });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current).toBe('absent');

    rerender({ active: false });
    expect(result.current).toBe('off');
    const calls = detect.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(detect.mock.calls.length).toBe(calls); // no checks while the camera is off
    unmount();
  });
});

// -- pages -------------------------------------------------------------------------------

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('pages', () => {
  beforeEach(() => {
    Object.assign(api, mockApi());
  });

  it('settings offer clone options and no photo upload', async () => {
    renderAt('/settings');
    const section = await screen.findByRole('region', { name: 'Shadow Clone Jutsu' });
    expect(within(section).getByText(/camera image at that moment is captured/i)).toBeInTheDocument();
    expect(within(section).getByRole('radio', { name: '5' })).toHaveAttribute('aria-checked', 'true');
    expect(within(section).getByText(/never uploaded or saved/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/upload photo/i)).not.toBeInTheDocument();
  });

  it('the Jutsu Library explains that clones come from the live camera', async () => {
    const shadowClone = { ...(await mockApi().jutsu()).jutsu[0], id: 'shadow_clone', name: 'Shadow Clone Jutsu', effect: 'clone', sequence: ['ram'], requires_person: true };
    vi.mocked(api.jutsu).mockResolvedValue({ note: '', jutsu: [shadowClone] });
    renderAt('/jutsu');
    expect(await screen.findByText('The clones are copied live from your camera the moment you form Ram.')).toBeInTheDocument();
    expect(screen.queryByText(/upload your photo/i)).not.toBeInTheDocument();
  });

  it('the arena shows the person status once the camera runs', async () => {
    renderAt('/play');
    expect(await screen.findByRole('button', { name: 'Start game' })).toBeDisabled();
    expect(screen.queryByTestId('person-status')).not.toBeInTheDocument(); // camera not started yet
  });
});
