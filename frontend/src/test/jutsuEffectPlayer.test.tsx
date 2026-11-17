import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { playEffect } from '@/animations';
import { JutsuEffectPlayer, type ShadowCapture } from '@/animations/JutsuEffectPlayer';

vi.mock('@/animations', () => ({ playEffect: vi.fn(() => () => undefined) }));

const capture: ShadowCapture = {
  shadow: { url: 'blob:captured-frame', cutout: true, width: 300, height: 420, box: { x: 0.35, y: 0.3, width: 0.3, height: 0.7 }, frameAspect: 16 / 9 },
  anchor: { x: 50, bottom: 0, width: 17, height: 70 },
  cutOffBelow: true,
};

describe('JutsuEffectPlayer', () => {
  beforeEach(() => vi.mocked(playEffect).mockClear());

  it('builds Shadow Clone from the camera capture', () => {
    render(<JutsuEffectPlayer effect="clone" playKey={1} quality={1} capture={capture} />);
    const effect = screen.getByTestId('shadow-clone-effect');
    expect(screen.getAllByTestId('clone-copy')).toHaveLength(5); // default: 5 clones
    effect.querySelectorAll('img').forEach((image) => expect(image.getAttribute('src')).toBe('blob:captured-frame'));
    expect(playEffect).not.toHaveBeenCalled();
  });

  it('plays only smoke without a capture - never stand-in figures', () => {
    render(<JutsuEffectPlayer effect="clone" playKey={1} quality={1} />);
    expect(screen.queryByTestId('shadow-clone-effect')).not.toBeInTheDocument();
    expect(playEffect).toHaveBeenCalledWith(expect.any(HTMLElement), 'smoke_burst', 1, expect.any(Function));
  });

  it('leaves every other jutsu unchanged', () => {
    render(<JutsuEffectPlayer effect="fireball" playKey={1} quality={1} capture={capture} />);
    expect(screen.queryByTestId('shadow-clone-effect')).not.toBeInTheDocument();
    expect(playEffect).toHaveBeenCalledWith(expect.any(HTMLElement), 'fireball', 1, expect.any(Function));
  });

  it('plays nothing before the first activation', () => {
    render(<JutsuEffectPlayer effect="clone" playKey={0} quality={1} capture={capture} />);
    expect(screen.queryByTestId('shadow-clone-effect')).not.toBeInTheDocument();
  });
});
