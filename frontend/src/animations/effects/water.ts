import { clamp, easeInOut, glow, ParticlePool, rand, vignette, wash, windowed, type EffectFactory } from '../engine';

// A wave swells up from below, crests with a burst of spray, then drains away.
export const water: EffectFactory = (quality, width, height) => {
  const unit = Math.min(width, height);
  const droplets = new ParticlePool(Math.round(320 * quality));
  const layers = [
    { color: '18, 74, 160', alpha: 0.5, speed: 1.1, amp: 0.05, phase: 0, lift: 0.0 },
    { color: '32, 120, 220', alpha: 0.5, speed: 1.7, amp: 0.04, phase: 1.7, lift: 0.07 },
    { color: '70, 170, 255', alpha: 0.45, speed: 2.4, amp: 0.03, phase: 3.1, lift: 0.14 },
    { color: '160, 225, 255', alpha: 0.35, speed: 3.2, amp: 0.02, phase: 4.4, lift: 0.2 },
  ];
  const CREST = 1.7;
  let sprayed = false;

  return {
    duration: 3.5,
    draw({ ctx, t, dt }) {
      // water level: rise to the crest, hold briefly, fall
      const rise = easeInOut(t / CREST);
      const fall = easeInOut((t - CREST - 0.35) / 1.3);
      const level = clamp(rise - fall);
      const fade = 1 - clamp((t - 2.9) / 0.6);

      vignette(ctx, width, height, '40, 130, 255', 0.45 * windowed(t, 0, 3.3, 0.5));
      wash(ctx, width, height, '20, 90, 200', 0.12 * level);

      for (const layer of layers) {
        const base = height * (1.05 - level * (0.62 - layer.lift));
        ctx.beginPath();
        ctx.moveTo(0, height);
        const steps = 36;
        for (let i = 0; i <= steps; i += 1) {
          const x = (i / steps) * width;
          const wave =
            Math.sin((x / width) * 7 + t * layer.speed * 2 + layer.phase) * layer.amp +
            Math.sin((x / width) * 15 - t * layer.speed * 3 + layer.phase * 2) * layer.amp * 0.4;
          ctx.lineTo(x, base + wave * height * (0.5 + level));
        }
        ctx.lineTo(width, height);
        ctx.closePath();
        const gradient = ctx.createLinearGradient(0, base - height * 0.1, 0, height);
        gradient.addColorStop(0, `rgba(${layer.color}, ${layer.alpha * fade})`);
        gradient.addColorStop(1, `rgba(${layer.color}, ${layer.alpha * 0.35 * fade})`);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'lighter';

      // continuous mist off the wave tops
      if (level > 0.2 && t < 2.8) {
        for (let i = 0; i < Math.round(4 * quality); i += 1) {
          droplets.emit({
            x: rand(0, width),
            y: height * (1.05 - level * 0.62) + rand(-10, 20),
            vx: rand(-40, 40),
            vy: -rand(40, 160),
            life: rand(0.5, 1),
            size: rand(1.2, 3),
          });
        }
      }
      // the splash at the crest
      if (!sprayed && t >= CREST) {
        sprayed = true;
        for (let i = 0; i < Math.round(170 * quality); i += 1) {
          const angle = rand(-Math.PI * 0.95, -Math.PI * 0.05);
          const speed = unit * rand(0.3, 1.25);
          droplets.emit({
            x: width / 2 + rand(-width * 0.3, width * 0.3),
            y: height * 0.5 + rand(-20, 30),
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: rand(0.7, 1.5),
            size: rand(1.5, 5),
          });
        }
      }
      droplets.update(dt, (p, age) => {
        p.vy += unit * 1.5 * dt; // gravity
        glow(ctx, p.x, p.y, p.size * 2.4, '170, 225, 255', 0.8 * (1 - age) * fade);
      });

      // light catching the crest
      glow(ctx, width / 2, height * 0.5, unit * 0.55, '120, 200, 255', 0.3 * windowed(t, CREST - 0.3, CREST + 0.7, 0.3));
      ctx.globalCompositeOperation = 'source-over';
      wash(ctx, width, height, '200, 235, 255', 0.4 * windowed(t, CREST - 0.05, CREST + 0.35, 0.12));
    },
  };
};
