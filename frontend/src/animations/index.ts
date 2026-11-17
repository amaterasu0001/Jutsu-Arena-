import { runCanvasEffect, type Dispose, type EffectFactory } from './engine';
import { earth } from './effects/earth';
import { fireball } from './effects/fireball';
import { lightning } from './effects/lightning';
import { clone, smokeBurst, transform } from './effects/smoke';
import { sphere2d } from './effects/sphere2d';
import { water } from './effects/water';
import { wind } from './effects/wind';

const CANVAS_EFFECTS: Record<string, EffectFactory> = { fireball, water, clone, transform, lightning, wind, earth, smoke_burst: smokeBurst };

/** Effect keys a jutsu can use in jutsu.json (`smoke_burst` is internal). */
export const EFFECT_KEYS = [...Object.keys(CANVAS_EFFECTS).filter((key) => key !== 'smoke_burst'), 'sphere'];

/**
 * Play a jutsu effect inside `container` (which must be positioned). Returns a
 * function that stops the effect early and frees its resources. `onDone` fires
 * only when the effect finishes on its own.
 */
export function playEffect(container: HTMLElement, effect: string, quality: number, onDone: () => void): Dispose {
  if (effect !== 'sphere') {
    return runCanvasEffect(container, CANVAS_EFFECTS[effect] ?? sphere2d, quality, onDone);
  }

  // The 3D sphere pulls in three.js on demand; fall back to canvas without WebGL.
  let disposed = false;
  let inner: Dispose | null = null;
  const fallback = () => {
    if (!disposed) inner = runCanvasEffect(container, sphere2d, quality, onDone);
  };
  import('./effects/sphere3d')
    .then(({ runSphereEffect }) => {
      if (disposed) return;
      try {
        inner = runSphereEffect(container, quality, onDone);
      } catch {
        fallback();
      }
    })
    .catch(fallback);

  return () => {
    disposed = true;
    inner?.();
  };
}
