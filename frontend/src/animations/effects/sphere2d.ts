import { clamp, easeInCubic, easeOutCubic, glow, lerp, rand, vignette, wash, windowed, type EffectFactory } from '../engine';

// Canvas fallback for the energy sphere, used when WebGL is not available.
export const sphere2d: EffectFactory = (quality, width, height) => {
  const unit = Math.min(width, height);
  const cx = width / 2;
  const cy = height / 2;
  const orbiters = Array.from({ length: Math.round(90 * quality) }, () => ({
    radius: rand(1.15, 2.4),
    angle: rand(0, Math.PI * 2),
    speed: rand(2.5, 6) * (Math.random() < 0.5 ? 1 : -1),
    tilt: rand(0.25, 1),
    size: rand(1, 3),
  }));
  const GROW = 0.7;
  const BURST = 2.5;

  return {
    duration: 3.6,
    draw({ ctx, t }) {
      const burst = clamp((t - BURST) / 0.6);
      const fade = 1 - clamp((t - 3.0) / 0.6);
      const base = unit * lerp(0.02, 0.15, easeOutCubic(t / GROW)) * (1 + 0.04 * Math.sin(t * 22));
      const radius = base * (1 + easeInCubic(burst) * 3.2);

      vignette(ctx, width, height, '60, 140, 255', 0.5 * windowed(t, 0, 3.4, 0.4));
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, cx, cy, radius * 3.2, '60, 140, 255', 0.4 * fade);
      glow(ctx, cx, cy, radius * 1.5, '120, 190, 255', 0.8 * fade);
      glow(ctx, cx, cy, radius * 0.8, '235, 245, 255', 0.95 * fade);

      // swirling arcs
      ctx.lineCap = 'round';
      for (let i = 0; i < 9; i += 1) {
        const start = t * (7 + i) * (i % 2 ? 1 : -1) + i;
        ctx.strokeStyle = `rgba(200, 230, 255, ${0.55 * fade})`;
        ctx.lineWidth = unit * 0.004 + 0.6;
        ctx.beginPath();
        ctx.ellipse(cx, cy, radius * (0.55 + i * 0.07), radius * (0.3 + ((i * 37) % 10) / 14), (i * Math.PI) / 9, start, start + 1.6);
        ctx.stroke();
      }

      for (const orbiter of orbiters) {
        const angle = orbiter.angle + t * orbiter.speed;
        const r = radius * orbiter.radius * (1 + burst * 1.5);
        glow(ctx, cx + Math.cos(angle) * r, cy + Math.sin(angle) * r * orbiter.tilt, orbiter.size * 3, '170, 215, 255', 0.8 * fade);
      }

      ctx.globalCompositeOperation = 'source-over';
      wash(ctx, width, height, '210, 232, 255', 0.6 * windowed(t, BURST, BURST + 0.45, 0.12));
    },
  };
};
