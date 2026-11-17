import { clamp, glow, ParticlePool, rand, vignette, wash, windowed, type EffectFactory } from '../engine';

type Point = { x: number; y: number };

/** Jagged bolt between two points by recursive midpoint displacement. */
function bolt(from: Point, to: Point, roughness: number, depth: number): Point[] {
  if (depth === 0) return [from, to];
  const mid = {
    x: (from.x + to.x) / 2 + rand(-roughness, roughness),
    y: (from.y + to.y) / 2 + rand(-roughness, roughness) * 0.4,
  };
  const left = bolt(from, mid, roughness / 2, depth - 1);
  const right = bolt(mid, to, roughness / 2, depth - 1);
  return [...left, ...right.slice(1)];
}

interface Strike {
  time: number;
  paths: Point[][];
  impact: Point;
  sparked: boolean;
}

// A sequence of forked strikes with hard flashes and scattering sparks.
export const lightning: EffectFactory = (quality, width, height) => {
  const unit = Math.min(width, height);
  const sparks = new ParticlePool(Math.round(240 * quality));
  const LIFE = 0.34;

  const strikes: Strike[] = [0.15, 0.55, 0.95, 1.5, 1.85].map((time, index) => {
    const from = { x: width * rand(0.2, 0.8), y: -10 };
    const impact = { x: width * (index === 4 ? 0.5 : rand(0.15, 0.85)), y: height * rand(0.62, 0.9) };
    const main = bolt(from, impact, unit * 0.16, 6);
    const paths = [main];
    const branches = Math.round(2 + 2 * quality);
    for (let i = 0; i < branches; i += 1) {
      const origin = main[Math.floor(rand(0.2, 0.75) * main.length)];
      const end = { x: origin.x + rand(-0.3, 0.3) * width, y: origin.y + rand(0.08, 0.3) * height };
      paths.push(bolt(origin, end, unit * 0.07, 4));
    }
    return { time, paths, impact, sparked: false };
  });

  const stroke = (ctx: CanvasRenderingContext2D, path: Point[], lineWidth: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i += 1) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
  };

  return {
    duration: 2.9,
    draw({ ctx, t, dt }) {
      vignette(ctx, width, height, '70, 150, 255', 0.5 * windowed(t, 0, 2.7, 0.3));

      let flash = 0;
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (const strike of strikes) {
        const age = t - strike.time;
        if (age < 0 || age > LIFE) continue;
        const power = 1 - age / LIFE;
        const flicker = age < 0.05 || Math.sin(age * 90) > -0.3 ? 1 : 0.35;
        flash = Math.max(flash, power * power);

        if (!strike.sparked) {
          strike.sparked = true;
          for (let i = 0; i < Math.round(40 * quality); i += 1) {
            const angle = rand(-Math.PI, 0);
            const speed = unit * rand(0.2, 1.1);
            sparks.emit({ x: strike.impact.x, y: strike.impact.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: rand(0.3, 0.8), size: rand(1, 2.6) });
          }
        }

        strike.paths.forEach((path, index) => {
          const scale = index === 0 ? 1 : 0.5;
          ctx.shadowColor = 'rgba(110, 190, 255, 1)';
          ctx.shadowBlur = 24;
          stroke(ctx, path, unit * 0.014 * scale * power + 1, `rgba(90, 170, 255, ${0.6 * power * flicker})`);
          ctx.shadowBlur = 0;
          stroke(ctx, path, unit * 0.005 * scale * power + 0.8, `rgba(235, 248, 255, ${power * flicker})`);
        });
        glow(ctx, strike.impact.x, strike.impact.y, unit * 0.32 * power, '150, 210, 255', 0.8 * power);
      }
      ctx.shadowBlur = 0;

      sparks.update(dt, (p, age) => {
        p.vy += unit * 1.6 * dt;
        const alpha = 1 - age;
        ctx.strokeStyle = `rgba(190, 228, 255, ${alpha})`;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
        ctx.stroke();
      });

      // crackling residue in the air between strikes
      const residue = windowed(t, 0.2, 2.4, 0.3);
      for (let i = 0; i < Math.round(3 * quality); i += 1) {
        glow(ctx, rand(0, width), rand(0, height), unit * rand(0.01, 0.03), '160, 215, 255', 0.5 * residue * Math.random());
      }

      ctx.globalCompositeOperation = 'source-over';
      wash(ctx, width, height, '215, 235, 255', clamp(flash) * 0.6);
    },
  };
};
