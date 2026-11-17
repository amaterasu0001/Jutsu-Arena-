import { clamp, easeOutCubic, glow, ParticlePool, rand, vignette, wash, windowed, type EffectFactory } from '../engine';

function emitPuff(pool: ParticlePool, x: number, y: number, unit: number, count: number, spread = 1): void {
  for (let i = 0; i < count; i += 1) {
    const angle = rand(0, Math.PI * 2);
    const speed = unit * rand(0.04, 0.34) * spread;
    pool.emit({
      x: x + Math.cos(angle) * unit * 0.02,
      y: y + Math.sin(angle) * unit * 0.02,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.7 - unit * 0.05,
      life: rand(0.7, 1.5),
      size: unit * rand(0.05, 0.13),
      data: rand(0.7, 1),
    });
  }
}

function drawSmoke(ctx: CanvasRenderingContext2D, pool: ParticlePool, dt: number, tint: string, opacity: number): void {
  pool.update(dt, (p, age) => {
    p.vx *= 1 - 1.8 * dt;
    p.vy *= 1 - 1.8 * dt;
    const alpha = Math.sin(Math.min(age * 6, 1) * Math.PI * 0.5) * (1 - age) * 0.5 * p.data * opacity;
    glow(ctx, p.x, p.y, p.size * (0.7 + age * 1.6), tint, alpha);
  });
}

/** A stylised standing figure with hands raised in a seal. Original silhouette art. */
function drawSilhouette(ctx: CanvasRenderingContext2D, x: number, groundY: number, size: number, alpha: number): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.translate(x, groundY);
  ctx.scale(size, size);
  ctx.globalAlpha = alpha;
  const body = ctx.createLinearGradient(0, -1, 0, 0);
  body.addColorStop(0, 'rgba(236, 236, 248, 0.95)');
  body.addColorStop(1, 'rgba(150, 150, 190, 0.55)');
  ctx.fillStyle = body;
  ctx.shadowColor = 'rgba(210, 210, 255, 0.9)';
  ctx.shadowBlur = 18;

  ctx.beginPath(); // head
  ctx.arc(0, -0.86, 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath(); // torso and legs
  ctx.moveTo(-0.15, -0.74);
  ctx.quadraticCurveTo(0, -0.79, 0.15, -0.74);
  ctx.lineTo(0.13, -0.38);
  ctx.lineTo(0.17, 0);
  ctx.lineTo(0.04, 0);
  ctx.lineTo(0, -0.3);
  ctx.lineTo(-0.04, 0);
  ctx.lineTo(-0.17, 0);
  ctx.lineTo(-0.13, -0.38);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath(); // arms meeting in front of the chest
  ctx.moveTo(-0.15, -0.72);
  ctx.lineTo(-0.23, -0.52);
  ctx.lineTo(-0.02, -0.56);
  ctx.lineTo(0.02, -0.56);
  ctx.lineTo(0.23, -0.52);
  ctx.lineTo(0.15, -0.72);
  ctx.lineTo(0.09, -0.6);
  ctx.lineTo(-0.09, -0.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Smoke bursts, a line of doubles steps out of the haze, then they dissolve.
export const clone: EffectFactory = (quality, width, height) => {
  const unit = Math.min(width, height);
  const smoke = new ParticlePool(Math.round(260 * quality));
  const slots = [-0.36, -0.18, 0, 0.18, 0.36].map((offset, index) => ({
    x: width / 2 + offset * width,
    appear: 0.35 + Math.abs(index - 2) * 0.22,
    size: unit * (index === 2 ? 0.62 : 0.52 - Math.abs(index - 2) * 0.03),
    puffed: false,
    vanished: false,
  }));
  const ground = height * 0.94;
  const VANISH = 2.35;
  let opened = false;

  return {
    duration: 3.2,
    draw({ ctx, t, dt }) {
      vignette(ctx, width, height, '170, 170, 220', 0.35 * windowed(t, 0, 3, 0.4));
      if (!opened) {
        opened = true;
        emitPuff(smoke, width / 2, height * 0.62, unit, Math.round(46 * quality), 1.5);
      }

      for (const slot of slots) {
        if (!slot.puffed && t >= slot.appear) {
          slot.puffed = true;
          emitPuff(smoke, slot.x, ground - slot.size * 0.5, unit, Math.round(22 * quality));
        }
        if (!slot.vanished && t >= VANISH) {
          slot.vanished = true;
          emitPuff(smoke, slot.x, ground - slot.size * 0.5, unit, Math.round(20 * quality));
        }
        const visible = easeOutCubic((t - slot.appear) / 0.35) * (1 - clamp((t - VANISH) / 0.25));
        const bob = Math.sin(t * 2.2 + slot.x) * unit * 0.004;
        drawSilhouette(ctx, slot.x, ground + bob, slot.size, visible * 0.85);
      }

      ctx.globalCompositeOperation = 'lighter';
      drawSmoke(ctx, smoke, dt, '200, 200, 225', 1);
      ctx.globalCompositeOperation = 'source-over';
      wash(ctx, width, height, '235, 235, 250', 0.35 * windowed(t, 0, 0.3, 0.1));
    },
  };
};

// A thick burst of smoke, a spinning ring of light and a shower of sparkles.
export const transform: EffectFactory = (quality, width, height) => {
  const unit = Math.min(width, height);
  const smoke = new ParticlePool(Math.round(220 * quality));
  const sparkles = new ParticlePool(Math.round(120 * quality));
  const cx = width / 2;
  const cy = height * 0.55;
  let burst = 0;

  const star = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, alpha: number) => {
    ctx.fillStyle = `rgba(250, 225, 255, ${alpha})`;
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const radius = i % 2 === 0 ? size : size * 0.22;
      const angle = (i / 8) * Math.PI * 2;
      ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
    }
    ctx.closePath();
    ctx.fill();
  };

  return {
    duration: 2.9,
    draw({ ctx, t, dt }) {
      vignette(ctx, width, height, '190, 110, 255', 0.42 * windowed(t, 0, 2.7, 0.4));

      // two bursts: the vanish and the reveal
      const due = t >= 1.25 ? 2 : 1;
      while (burst < due) {
        burst += 1;
        emitPuff(smoke, cx, cy, unit, Math.round(80 * quality), 1.6);
        for (let i = 0; i < Math.round(55 * quality); i += 1) {
          const angle = rand(0, Math.PI * 2);
          const speed = unit * rand(0.15, 0.75);
          sparkles.emit({ x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: rand(0.6, 1.3), size: unit * rand(0.008, 0.022) });
        }
      }

      ctx.globalCompositeOperation = 'lighter';
      drawSmoke(ctx, smoke, dt, '205, 170, 240', 1.1);

      // rotating ring of light that widens with each burst
      for (const start of [0, 1.25]) {
        const ring = clamp((t - start) / 0.9);
        if (ring <= 0 || ring >= 1) continue;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * 3);
        ctx.strokeStyle = `rgba(230, 170, 255, ${0.8 * (1 - ring)})`;
        ctx.lineWidth = unit * 0.012 * (1 - ring) + 1;
        ctx.setLineDash([unit * 0.05, unit * 0.03]);
        ctx.beginPath();
        ctx.arc(0, 0, unit * (0.08 + easeOutCubic(ring) * 0.42), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      sparkles.update(dt, (p, age) => {
        p.vx *= 1 - 1.5 * dt;
        p.vy = p.vy * (1 - 1.5 * dt) + unit * 0.25 * dt;
        const twinkle = 0.55 + 0.45 * Math.sin(age * 30 + p.x);
        star(ctx, p.x, p.y, p.size * (1 - age * 0.5), (1 - age) * twinkle);
      });

      glow(ctx, cx, cy, unit * 0.4, '225, 170, 255', 0.5 * (windowed(t, 0, 0.5, 0.15) + windowed(t, 1.2, 1.75, 0.15)));
      ctx.globalCompositeOperation = 'source-over';
      wash(ctx, width, height, '245, 225, 255', 0.5 * (windowed(t, 0, 0.25, 0.08) + windowed(t, 1.22, 1.5, 0.08)));
    },
  };
};

// Just the smoke of the Shadow Clone effect, with no figures. Used when there is
// no camera capture of the player to clone (for example the Jutsu Library
// preview): the clones are only ever copies of the real player, never stand-ins.
export const smokeBurst: EffectFactory = (quality, width, height) => {
  const unit = Math.min(width, height);
  const smoke = new ParticlePool(Math.round(220 * quality));
  const spots = [-0.32, -0.16, 0, 0.16, 0.32].map((offset, index) => ({ x: width / 2 + offset * width, at: 0.3 + Math.abs(index - 2) * 0.2, done: false }));
  let opened = false;
  return {
    duration: 2.6,
    draw({ ctx, t, dt }) {
      vignette(ctx, width, height, '170, 170, 220', 0.3 * windowed(t, 0, 2.4, 0.4));
      if (!opened) {
        opened = true;
        emitPuff(smoke, width / 2, height * 0.62, unit, Math.round(46 * quality), 1.5);
      }
      for (const spot of spots) {
        if (!spot.done && t >= spot.at) {
          spot.done = true;
          emitPuff(smoke, spot.x, height * 0.7, unit, Math.round(18 * quality));
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      drawSmoke(ctx, smoke, dt, '200, 200, 225', 1);
      ctx.globalCompositeOperation = 'source-over';
      wash(ctx, width, height, '235, 235, 250', 0.3 * windowed(t, 0, 0.3, 0.1));
    },
  };
};
