import { clamp, easeInCubic, easeOutCubic, glow, ParticlePool, rand, vignette, wash, windowed, type EffectFactory } from '../engine';

interface Pillar {
  x: number;
  width: number;
  height: number;
  delay: number;
  lean: number;
  /** Jagged top edge as offsets (0..1 across, 0..1 down). */
  top: Array<[number, number]>;
  kicked: boolean;
}

// The ground shakes and a wall of stone pillars drives up through the dust.
export const earth: EffectFactory = (quality, width, height) => {
  const unit = Math.min(width, height);
  const dust = new ParticlePool(Math.round(200 * quality));
  const rocks = new ParticlePool(Math.round(70 * quality));
  const count = 7;
  const pillars: Pillar[] = Array.from({ length: count }, (_, index) => {
    const centre = Math.abs(index - (count - 1) / 2) / ((count - 1) / 2);
    return {
      x: width * (0.08 + (index / (count - 1)) * 0.84) + rand(-0.02, 0.02) * width,
      width: unit * rand(0.14, 0.2),
      height: height * (0.74 - centre * 0.3 + rand(-0.05, 0.05)),
      delay: 0.3 + centre * 0.45 + rand(0, 0.1),
      lean: rand(-0.09, 0.09),
      top: [
        [0, rand(0.04, 0.12)],
        [rand(0.2, 0.35), rand(0, 0.04)],
        [rand(0.5, 0.65), rand(0.03, 0.1)],
        [rand(0.75, 0.85), 0],
        [1, rand(0.05, 0.14)],
      ],
      kicked: false,
    };
  });
  const SINK = 2.4;

  return {
    duration: 3.3,
    draw({ ctx, t, dt }) {
      const fade = 1 - clamp((t - 2.75) / 0.55);
      const quake = windowed(t, 0.1, 1.6, 0.25);
      vignette(ctx, width, height, '200, 140, 60', 0.45 * windowed(t, 0, 3.1, 0.4));

      ctx.save();
      ctx.translate(rand(-1, 1) * unit * 0.012 * quake, rand(-1, 1) * unit * 0.012 * quake);

      for (const pillar of pillars) {
        const rise = easeOutCubic((t - pillar.delay) / 0.5) * (1 - easeInCubic((t - SINK) / 0.7));
        if (rise <= 0) continue;

        if (!pillar.kicked) {
          pillar.kicked = true;
          for (let i = 0; i < Math.round(16 * quality); i += 1) {
            dust.emit({ x: pillar.x + rand(-0.5, 0.5) * pillar.width, y: height, vx: rand(-0.2, 0.2) * unit, vy: -rand(0.05, 0.4) * unit, life: rand(0.8, 1.6), size: unit * rand(0.04, 0.1) });
          }
          for (let i = 0; i < Math.round(6 * quality); i += 1) {
            rocks.emit({ x: pillar.x, y: height * 0.95, vx: rand(-0.5, 0.5) * unit, vy: -rand(0.6, 1.3) * unit, life: rand(0.8, 1.4), size: unit * rand(0.008, 0.022), data: rand(0, 6) });
          }
        }

        const tall = pillar.height * rise;
        const half = pillar.width / 2;
        const topY = height - tall;
        ctx.save();
        ctx.translate(pillar.x, height);
        ctx.transform(1, 0, pillar.lean, 1, 0, 0);
        ctx.translate(-pillar.x, -height);

        const stone = ctx.createLinearGradient(pillar.x - half, 0, pillar.x + half, 0);
        stone.addColorStop(0, `rgba(96, 74, 52, ${0.96 * fade})`);
        stone.addColorStop(0.45, `rgba(150, 118, 82, ${0.96 * fade})`);
        stone.addColorStop(1, `rgba(58, 44, 32, ${0.96 * fade})`);
        ctx.fillStyle = stone;
        ctx.beginPath();
        ctx.moveTo(pillar.x - half, height + 4);
        for (const [across, down] of pillar.top) ctx.lineTo(pillar.x - half + across * pillar.width, topY + down * pillar.height * 0.5);
        ctx.lineTo(pillar.x + half, height + 4);
        ctx.closePath();
        ctx.fill();

        // lit facet and cracks
        ctx.fillStyle = `rgba(236, 200, 150, ${0.16 * fade})`;
        ctx.beginPath();
        ctx.moveTo(pillar.x - half, height);
        ctx.lineTo(pillar.x - half, topY + pillar.top[0][1] * pillar.height * 0.5);
        ctx.lineTo(pillar.x - half * 0.35, topY + pillar.top[1][1] * pillar.height * 0.5);
        ctx.lineTo(pillar.x - half * 0.55, height);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = `rgba(30, 22, 16, ${0.55 * fade})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pillar.x + half * 0.1, topY + tall * 0.12);
        ctx.lineTo(pillar.x - half * 0.15, topY + tall * 0.34);
        ctx.lineTo(pillar.x + half * 0.2, topY + tall * 0.55);
        ctx.lineTo(pillar.x + half * 0.05, topY + tall * 0.8);
        ctx.stroke();
        ctx.restore();
      }

      // flying rock fragments
      rocks.update(dt, (p, age) => {
        p.vy += unit * 2.2 * dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(age * 9 + p.data);
        ctx.fillStyle = `rgba(140, 108, 76, ${(1 - age * 0.6) * fade})`;
        ctx.beginPath();
        ctx.moveTo(-p.size, -p.size * 0.6);
        ctx.lineTo(p.size * 0.8, -p.size);
        ctx.lineTo(p.size, p.size * 0.7);
        ctx.lineTo(-p.size * 0.5, p.size);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });

      // rolling dust along the ground
      if (t > 0.1 && t < 2.6) {
        for (let i = 0; i < Math.round(2 * quality); i += 1) {
          dust.emit({ x: rand(0, width), y: height + 10, vx: rand(-0.15, 0.15) * unit, vy: -rand(0.03, 0.18) * unit, life: rand(0.9, 1.7), size: unit * rand(0.05, 0.12) });
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      dust.update(dt, (p, age) => {
        p.vx *= 1 - dt;
        p.vy *= 1 - dt;
        glow(ctx, p.x, p.y, p.size * (0.8 + age * 1.5), '190, 150, 100', 0.3 * Math.sin(Math.min(age * 5, 1) * Math.PI * 0.5) * (1 - age) * fade);
      });
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();

      wash(ctx, width, height, '240, 210, 160', 0.28 * windowed(t, 0.28, 0.6, 0.1));
    },
  };
};
