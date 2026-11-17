import { clamp, easeInCubic, easeOutCubic, glow, lerp, ParticlePool, rand, vignette, wash, windowed, type EffectFactory } from '../engine';

// Charge -> swelling fireball that rushes toward the viewer -> impact flash -> fade.
export const fireball: EffectFactory = (quality, width, height) => {
  const unit = Math.min(width, height);
  const embers = new ParticlePool(Math.round(420 * quality));
  const CHARGE = 0.8;
  const TRAVEL_END = 2.3;
  const IMPACT_END = 2.65;

  return {
    duration: 3.3,
    draw({ ctx, t, dt }) {
      const travel = clamp((t - CHARGE) / (TRAVEL_END - CHARGE));
      const fade = 1 - clamp((t - IMPACT_END) / 0.65);
      const cx = width / 2 + Math.sin(t * 9) * unit * 0.006;
      const cy = lerp(height * 0.66, height * 0.48, easeOutCubic(travel));
      const charge = easeOutCubic(t / CHARGE);
      const radius = t < CHARGE ? unit * 0.05 * charge : lerp(unit * 0.05, unit * 0.46, easeInCubic(travel));

      vignette(ctx, width, height, '255, 96, 30', 0.5 * windowed(t, 0, IMPACT_END + 0.4, 0.5));
      ctx.globalCompositeOperation = 'lighter';

      // embers: drawn in during the charge, thrown off the rim while travelling
      if (t < TRAVEL_END) {
        const count = Math.round((t < CHARGE ? 5 : 16) * quality);
        for (let i = 0; i < count; i += 1) {
          const angle = rand(0, Math.PI * 2);
          if (t < CHARGE) {
            const distance = unit * rand(0.2, 0.42);
            embers.emit({
              x: cx + Math.cos(angle) * distance,
              y: cy + Math.sin(angle) * distance,
              vx: -Math.cos(angle) * distance * 1.6,
              vy: -Math.sin(angle) * distance * 1.6,
              life: 0.55,
              size: rand(1.5, 3.5),
            });
          } else {
            const speed = unit * rand(0.15, 0.7);
            embers.emit({
              x: cx + Math.cos(angle) * radius * 0.8,
              y: cy + Math.sin(angle) * radius * 0.8,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed - unit * 0.25,
              life: rand(0.5, 1.2),
              size: rand(2, 7) * (0.6 + travel),
            });
          }
        }
      }
      embers.update(dt, (p, age) => {
        p.vy -= unit * 0.3 * dt;
        const heat = 1 - age;
        glow(ctx, p.x, p.y, p.size * (1.2 + heat * 2), `255, ${Math.round(90 + 150 * heat)}, ${Math.round(30 + 60 * heat)}`, 0.75 * heat * fade);
      });

      // the fireball: layered flame lobes around a white-hot core
      if (t < IMPACT_END) {
        const ball = t < TRAVEL_END ? 1 : 1 - clamp((t - TRAVEL_END) / (IMPACT_END - TRAVEL_END));
        glow(ctx, cx, cy, radius * 2.6, '255, 70, 20', 0.38 * ball);
        for (let i = 0; i < 7; i += 1) {
          const angle = t * (2.5 + i * 0.35) + i * 0.9;
          const offset = radius * 0.3;
          glow(ctx, cx + Math.cos(angle) * offset, cy + Math.sin(angle * 1.3) * offset, radius * (0.95 + 0.12 * Math.sin(t * 13 + i)), '255, 120, 30', 0.34 * ball);
        }
        glow(ctx, cx, cy, radius * 0.95, '255, 205, 90', 0.85 * ball);
        glow(ctx, cx, cy, radius * 0.5, '255, 250, 225', 0.95 * ball);
      }

      // impact
      ctx.globalCompositeOperation = 'source-over';
      const impact = windowed(t, TRAVEL_END - 0.08, IMPACT_END + 0.35, 0.16);
      wash(ctx, width, height, '255, 228, 190', 0.85 * impact);
      if (t > TRAVEL_END) {
        const ring = clamp((t - TRAVEL_END) / 0.8);
        ctx.strokeStyle = `rgba(255, 170, 80, ${0.7 * (1 - ring)})`;
        ctx.lineWidth = unit * 0.03 * (1 - ring) + 1;
        ctx.beginPath();
        ctx.arc(cx, cy, unit * (0.3 + ring * 0.75), 0, Math.PI * 2);
        ctx.stroke();
      }
    },
  };
};
