// Minimal canvas effect runner shared by all 2D jutsu effects.

export interface EffectFrame {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** Seconds since the effect started. */
  t: number;
  /** Seconds since the previous frame (clamped). */
  dt: number;
}

export interface CanvasEffect {
  duration: number;
  draw: (frame: EffectFrame) => void;
}

/** `quality` is 0.4 (low) .. 1 (high) and scales particle counts. */
export type EffectFactory = (quality: number, width: number, height: number) => CanvasEffect;

export type Dispose = () => void;

export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const rand = (min: number, max: number) => min + Math.random() * (max - min);
export const easeOutCubic = (t: number) => 1 - (1 - clamp(t)) ** 3;
export const easeInCubic = (t: number) => clamp(t) ** 3;
export const easeInOut = (t: number) => {
  const x = clamp(t);
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
};
/** 0 → 1 → 0 window between `start` and `end`, with soft edges of width `edge`. */
export const windowed = (t: number, start: number, end: number, edge = 0.25) =>
  clamp((t - start) / edge) * clamp((end - t) / edge);

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  /** Free slot for per-effect data (hue, rotation, ...). */
  data: number;
}

/** Fixed-capacity particle pool: no allocations while the effect runs. */
export class ParticlePool {
  readonly items: Particle[] = [];
  constructor(private readonly capacity: number) {}

  emit(particle: Omit<Particle, 'maxLife' | 'data'> & { data?: number }): void {
    if (this.items.length >= this.capacity) return;
    this.items.push({ ...particle, maxLife: particle.life, data: particle.data ?? 0 });
  }

  /** Advance every particle; `visit` draws it. Dead particles are removed. */
  update(dt: number, visit: (particle: Particle, age: number) => void): void {
    const items = this.items;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const p = items[i];
      p.life -= dt;
      if (p.life <= 0) {
        items[i] = items[items.length - 1];
        items.pop();
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      visit(p, 1 - p.life / p.maxLife);
    }
  }
}

/** Soft glowing dot (additive blending is set by the caller). */
export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha = 1): void {
  if (radius <= 0 || alpha <= 0) return;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(${color}, ${alpha})`);
  gradient.addColorStop(1, `rgba(${color}, 0)`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** Full-frame colour wash, used for screen glows and flashes. */
export function wash(ctx: CanvasRenderingContext2D, width: number, height: number, color: string, alpha: number): void {
  if (alpha <= 0) return;
  ctx.fillStyle = `rgba(${color}, ${clamp(alpha)})`;
  ctx.fillRect(0, 0, width, height);
}

/** Coloured vignette that brightens the edges of the frame. */
export function vignette(ctx: CanvasRenderingContext2D, width: number, height: number, color: string, alpha: number): void {
  if (alpha <= 0) return;
  const gradient = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.25, width / 2, height / 2, Math.max(width, height) * 0.75);
  gradient.addColorStop(0, `rgba(${color}, 0)`);
  gradient.addColorStop(1, `rgba(${color}, ${clamp(alpha)})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

/**
 * Run a 2D effect inside `container`. A canvas is created for the run and
 * removed when the effect ends or the returned dispose function is called.
 */
export function runCanvasEffect(container: HTMLElement, factory: EffectFactory, quality: number, onDone: () => void): Dispose {
  const canvas = document.createElement('canvas');
  canvas.className = 'absolute inset-0 h-full w-full';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const rect = container.getBoundingClientRect();
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);
  const dpr = Math.min(window.devicePixelRatio || 1, quality >= 1 ? 2 : 1.25);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  let raf = 0;
  let finished = false;
  const cleanup = () => {
    cancelAnimationFrame(raf);
    canvas.remove();
  };

  if (!ctx) {
    cleanup();
    queueMicrotask(onDone);
    return () => undefined;
  }

  const effect = factory(quality, width, height);
  const started = performance.now();
  let previous = started;

  const loop = (now: number) => {
    const t = (now - started) / 1000;
    const dt = Math.min((now - previous) / 1000, 0.05);
    previous = now;
    if (t >= effect.duration) {
      finished = true;
      cleanup();
      onDone();
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    effect.draw({ ctx, width, height, t, dt });
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    if (!finished) cleanup();
  };
}
