import { clamp, easeInOut, glow, ParticlePool, rand, vignette, windowed, type EffectFactory } from '../engine';

interface Streak {
  delay: number;
  y: number;
  amplitude: number;
  frequency: number;
  phase: number;
  speed: number;
  length: number;
  width: number;
}

// Ribbons of air sweep across the arena and wind into a spiral at the centre.
export const wind: EffectFactory = (quality, width, height) => {
  const unit = Math.min(width, height);
  const leaves = new ParticlePool(Math.round(90 * quality));
  const streaks: Streak[] = Array.from({ length: Math.round(34 * quality) + 8 }, () => ({
    delay: rand(0, 1.7),
    y: rand(0.08, 0.92),
    amplitude: rand(0.02, 0.09),
    frequency: rand(1.5, 4),
    phase: rand(0, Math.PI * 2),
    speed: rand(1.0, 1.9),
    length: rand(0.18, 0.4),
    width: rand(1, 3.4),
  }));
  const cx = width / 2;
  const cy = height / 2;

  return {
    duration: 3.1,
    draw({ ctx, t, dt }) {
      const fade = 1 - clamp((t - 2.5) / 0.6);
      vignette(ctx, width, height, '90, 235, 210', 0.4 * windowed(t, 0, 2.9, 0.4));
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';

      // sweeping streaks, each a short segment travelling along a sine path
      for (const streak of streaks) {
        const head = (t - streak.delay) * streak.speed * 0.75;
        if (head < 0 || head - streak.length > 1.1) continue;
        const segments = 14;
        for (let i = 0; i < segments; i += 1) {
          const a = head - (streak.length * i) / segments;
          const b = head - (streak.length * (i + 1)) / segments;
          if (a < -0.05 || b > 1.05) continue;
          const point = (u: number) => ({
            x: (u * 1.2 - 0.1) * width,
            y: (streak.y + Math.sin(u * streak.frequency * Math.PI + streak.phase) * streak.amplitude) * height,
          });
          const from = point(a);
          const to = point(b);
          ctx.strokeStyle = `rgba(190, 255, 240, ${0.55 * (1 - i / segments) * fade})`;
          ctx.lineWidth = streak.width * (1 - i / segments) + 0.4;
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(to.x, to.y);
          ctx.stroke();
        }
      }

      // central spiral that tightens, then releases
      const spin = windowed(t, 0.5, 2.7, 0.5);
      if (spin > 0) {
        const tighten = easeInOut((t - 0.5) / 1.6);
        for (let arm = 0; arm < 3; arm += 1) {
          ctx.beginPath();
          for (let i = 0; i <= 60; i += 1) {
            const u = i / 60;
            const angle = u * Math.PI * 3.2 + t * 6.5 + (arm * Math.PI * 2) / 3;
            const radius = unit * (0.05 + u * (0.46 - 0.2 * tighten));
            const x = cx + Math.cos(angle) * radius;
            const y = cy + Math.sin(angle) * radius * 0.62;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `rgba(150, 250, 230, ${0.5 * spin})`;
          ctx.lineWidth = unit * 0.006 + 1;
          ctx.stroke();
        }
        glow(ctx, cx, cy, unit * 0.28, '130, 245, 220', 0.3 * spin);
      }

      // debris carried by the gust
      if (t < 2.4) {
        for (let i = 0; i < Math.round(2 * quality); i += 1) {
          leaves.emit({ x: -10, y: rand(0.1, 0.9) * height, vx: width * rand(0.5, 1.0), vy: rand(-0.1, 0.1) * height, life: rand(1, 1.8), size: rand(3, 7), data: rand(0, 6) });
        }
      }
      leaves.update(dt, (p, age) => {
        p.vy += Math.sin(age * 14 + p.data) * unit * 1.2 * dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(age * 12 + p.data);
        ctx.fillStyle = `rgba(200, 255, 235, ${0.7 * (1 - age) * fade})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      ctx.globalCompositeOperation = 'source-over';
    },
  };
};
