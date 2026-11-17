import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef } from 'react';

import { cloneFormation, figureHeight, liveFormation, type LiveSlot, type StageAnchor } from '@/lib/cloneFormation';
import type { CloneFormation } from '@/types/api';

/** The image the clones are made of: the person captured from the camera. */
export interface CloneSource {
  url: string;
  /** True when the background was removed (transparent PNG cutout). */
  cutout: boolean;
  width: number;
  height: number;
}

interface Props {
  source: CloneSource;
  /**
   * Where the captured person stands on the stage. The clones form around it
   * and a frozen copy of the person is placed exactly over them. ``null`` (no
   * cutout available): framed copies around the centre of the stage.
   */
  anchor: StageAnchor | null;
  /** The person was cut off by the bottom of the frame: fade the clones' lower edge into the smoke. */
  cutOffBelow?: boolean;
  /** Number of clones besides the original. */
  count: number;
  formation: CloneFormation;
  durationMs: number;
  smoke: boolean;
  /** 0.4 (low) .. 1 (high): scales the smoke particle count. */
  quality: number;
  onDone?: () => void;
  className?: string;
}

// Timeline as fractions of the total duration.
const T = {
  firstClone: 0.16,
  cloneStagger: 0.04,
  travel: 0.13,
  exit: 0.9,
  finalTitle: 0.56,
};

interface Burst {
  at: number; // ms
  x: number; // % of width from the left
  bottom: number; // % of height from the bottom
  size: number; // relative puff size
  count: number;
}

// -- smoke -----------------------------------------------------------------------

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  grow: number;
  life: number;
  age: number;
  shade: number;
}

function SmokeCanvas({ bursts, quality, durationMs }: { bursts: Burst[]; quality: number; durationMs: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return; // no canvas support (e.g. tests): the clones still animate
    const particles: Particle[] = [];
    const pending = [...bursts].sort((a, b) => a.at - b.at);
    const start = performance.now();
    let last = start;
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    };
    resize();

    const emit = (burst: Burst) => {
      const w = canvas.width;
      const h = canvas.height;
      const unit = Math.min(w, h);
      const cx = (burst.x / 100) * w;
      // Puffs gather around the feet and drift up past the figure, never sitting on its face.
      const cy = h - (Math.max(0, burst.bottom) / 100) * h - unit * 0.03 * burst.size;
      const n = Math.round(burst.count * quality);
      for (let i = 0; i < n; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = unit * (0.08 + Math.random() * 0.36) * burst.size;
        particles.push({
          x: cx + Math.cos(angle) * unit * 0.02,
          y: cy + Math.sin(angle) * unit * 0.02,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed * 0.35 - unit * 0.05,
          radius: unit * (0.02 + Math.random() * 0.035) * burst.size,
          grow: unit * (0.05 + Math.random() * 0.08) * burst.size,
          life: 0.7 + Math.random() * 0.8,
          age: 0,
          shade: 200 + Math.random() * 45,
        });
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const elapsed = now - start;
      while (pending.length && pending[0].at <= elapsed) emit(pending.shift() as Burst);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i];
        p.age += dt / p.life;
        if (p.age >= 1) {
          particles.splice(i, 1);
          continue;
        }
        p.vx *= 1 - 1.6 * dt;
        p.vy *= 1 - 1.6 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const r = p.radius + p.grow * p.age;
        const alpha = Math.sin(Math.min(p.age * 5, 1) * Math.PI * 0.5) * (1 - p.age) ** 1.5 * 0.2;
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        const shade = Math.round(p.shade);
        gradient.addColorStop(0, `rgba(${shade}, ${shade}, ${shade + 10}, ${alpha})`);
        gradient.addColorStop(0.6, `rgba(${shade - 30}, ${shade - 30}, ${shade - 15}, ${alpha * 0.45})`);
        gradient.addColorStop(1, 'rgba(120, 120, 140, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (elapsed < durationMs + 2000 && (pending.length || particles.length || elapsed < durationMs)) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      particles.length = 0;
      canvas.width = canvas.height = 0; // release the bitmap
    };
  }, [bursts, quality, durationMs]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" style={{ zIndex: 60 }} aria-hidden />;
}

// -- figures --------------------------------------------------------------------

function CloneImage({ source, tone, glow, fadeBelow }: { source: CloneSource; tone: string; glow: string; fadeBelow: boolean }) {
  const fade = fadeBelow ? 'linear-gradient(to top, transparent 0%, #000 22%)' : undefined;
  if (source.cutout) {
    return (
      <img
        src={source.url}
        alt=""
        draggable={false}
        className="relative h-full w-auto max-w-none select-none"
        style={{ filter: `${tone} drop-shadow(0 0 14px ${glow}) drop-shadow(0 10px 16px rgba(0,0,0,0.6))`, maskImage: fade, WebkitMaskImage: fade }}
      />
    );
  }
  return (
    <div
      className="relative h-full overflow-hidden rounded-2xl border-2 bg-ink-950"
      style={{ aspectRatio: `${source.width} / ${source.height}`, borderColor: 'rgba(150,175,255,0.55)', boxShadow: `0 0 28px ${glow}, 0 18px 30px rgba(0,0,0,0.6)`, filter: tone }}
    >
      <img
        src={source.url}
        alt=""
        draggable={false}
        className="h-full w-full select-none object-cover"
        style={{ maskImage: 'radial-gradient(ellipse 80% 85% at 50% 45%, #000 62%, transparent 100%)', WebkitMaskImage: 'radial-gradient(ellipse 80% 85% at 50% 45%, #000 62%, transparent 100%)' }}
      />
    </div>
  );
}

/** A clone: emerges from smoke where the player stands, then moves to its slot. */
function Clone({ source, slot, origin, order, durationMs, fadeBelow }: { source: CloneSource; slot: LiveSlot; origin: { x: number; bottom: number }; order: number; durationMs: number; fadeBelow: boolean }) {
  const appear = T.firstClone + order * T.cloneStagger;
  const spawned = appear + 0.05;
  const arrived = Math.min(T.exit - 0.05, spawned + T.travel);
  const opacity = Math.max(0.55, 0.95 - slot.depth * 0.09);
  const tone = `brightness(${(1 - slot.depth * 0.09).toFixed(2)}) saturate(${(1 - slot.depth * 0.06).toFixed(2)})${slot.depth >= 3 ? ' blur(0.6px)' : ''}`;
  const from = { left: `${50 + origin.x}%`, bottom: `${origin.bottom}%` };
  const to = { left: `${50 + slot.x}%`, bottom: `${slot.bottom}%` };

  return (
    <motion.div
      className="absolute"
      style={{ height: `${slot.height}%`, x: '-50%', zIndex: 50 - slot.depth * 10, originY: 1 }}
      initial={{ ...from, opacity: 0, scale: 0.5 }}
      animate={{
        left: [from.left, from.left, from.left, to.left, to.left, to.left],
        bottom: [from.bottom, from.bottom, from.bottom, to.bottom, to.bottom, to.bottom],
        opacity: [0, 0, opacity, opacity, opacity, 0],
        scale: [0.5, 0.5, 0.82, 1, 1, 1.04],
      }}
      transition={{ duration: durationMs / 1000, times: [0, appear, spawned, arrived, T.exit, 1], ease: 'easeOut' }}
      data-testid="clone-copy"
    >
      {/* Every clone bobs on the same clock, so the formation moves in sync. */}
      <motion.div className="relative h-full" animate={{ y: [0, -6, 0] }} transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}>
        <CloneImage source={source} tone={tone} glow="rgba(130, 160, 255, 0.45)" fadeBelow={fadeBelow} />
      </motion.div>
    </motion.div>
  );
}

/** The player frozen at the moment of capture, exactly over their live image, in front of the background clones. */
function FrozenOriginal({ source, slot, durationMs }: { source: CloneSource; slot: LiveSlot; durationMs: number }) {
  return (
    <motion.div
      className="absolute"
      style={{ left: `${50 + slot.x}%`, bottom: `${slot.bottom}%`, height: `${slot.height}%`, x: '-50%', zIndex: 45 }}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 1, 0] }}
      transition={{ duration: durationMs / 1000, times: [0, 0.03, T.exit, 1] }}
      data-testid="clone-original"
    >
      <img src={source.url} alt="" draggable={false} className="h-full w-auto max-w-none select-none" style={{ filter: 'drop-shadow(0 0 10px rgba(255,120,140,0.45))' }} />
    </motion.div>
  );
}

// -- the effect --------------------------------------------------------------------

/**
 * Shadow Clone Jutsu built from the player's own captured camera image: every
 * clone is a copy of the same captured person. Plays once on mount (remount
 * with a new `key` to replay) and calls `onDone` when finished.
 */
export function ShadowCloneEffect({ source, anchor, cutOffBelow = false, count, formation, durationMs, smoke, quality, onDone, className = '' }: Props) {
  const reduceMotion = useReducedMotion();
  const seconds = durationMs / 1000;
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const timer = window.setTimeout(() => done.current?.(), durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs]);

  // With a cutout the clones form around the player's real position; without
  // one, framed copies of the captured frame form around the stage centre.
  const slots = useMemo<LiveSlot[]>(() => {
    if (anchor) return liveFormation(anchor, count, formation);
    const height = figureHeight(source.width, source.height) * 0.75;
    return cloneFormation(count, formation).map((slot) => ({ ...slot, height: height * slot.scale }));
  }, [anchor, count, formation, source.width, source.height]);
  const original = slots[0];
  const clones = useMemo(() => slots.slice(1), [slots]);
  const originX = original.x;
  const originBottom = anchor ? anchor.bottom : 3;

  const bursts = useMemo<Burst[]>(() => {
    const list: Burst[] = [{ at: durationMs * 0.03, x: 50 + originX, bottom: originBottom, size: 1.4, count: 34 }];
    clones.forEach((slot, index) => {
      const appear = (T.firstClone + index * T.cloneStagger) * durationMs;
      list.push({ at: appear, x: 50 + originX, bottom: originBottom, size: 0.8, count: 8 });
      list.push({ at: appear + T.travel * durationMs * 0.8, x: 50 + slot.x, bottom: slot.bottom, size: 0.9 * slot.scale, count: 10 });
    });
    slots.forEach((slot) => list.push({ at: T.exit * durationMs, x: 50 + slot.x, bottom: slot.bottom, size: 0.9 * slot.scale, count: 12 }));
    return list;
  }, [slots, clones, originX, originBottom, durationMs]);

  const focusX = 50 + originX;
  return (
    <motion.div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      animate={reduceMotion ? undefined : { x: [0, -9, 8, -6, 4, -2, 0] }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      role="img"
      aria-label={`Shadow Clone Jutsu: ${clones.length} clones of you, copied from your camera`}
      data-testid="shadow-clone-effect"
    >
      {/* Cinematic lighting: darken the edges, keep the player and the formation lit. */}
      <motion.div
        className="absolute inset-0"
        style={{ background: `radial-gradient(ellipse 75% 80% at ${focusX}% 70%, rgba(140,160,255,0.12), rgba(6,6,14,0.55) 85%)` }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ duration: seconds, times: [0, 0.06, 0.9, 1] }}
      />

      {anchor && source.cutout && <FrozenOriginal source={source} slot={original} durationMs={durationMs} />}
      {clones.map((slot, index) => (
        <Clone
          key={index}
          source={source}
          slot={slot}
          origin={{ x: originX, bottom: originBottom }}
          order={index}
          durationMs={durationMs}
          fadeBelow={cutOffBelow && source.cutout}
        />
      ))}

      {smoke && <SmokeCanvas bursts={bursts} quality={quality} durationMs={durationMs} />}

      {/* Flash */}
      <motion.div className="absolute inset-0 bg-white" style={{ zIndex: 70 }} initial={{ opacity: 0 }} animate={{ opacity: [0, 0.85, 0] }} transition={{ duration: 0.4, times: [0, 0.15, 1] }} />

      {/* Titles */}
      <motion.p
        className="absolute inset-x-0 top-[3%] text-center font-display text-2xl font-bold uppercase tracking-[0.18em] text-white md:text-4xl"
        style={{ zIndex: 80, textShadow: '0 0 28px rgba(255,90,110,0.9), 0 4px 22px rgba(0,0,0,0.9)' }}
        initial={{ opacity: 0, scale: 1.6 }}
        animate={{ opacity: [0, 1, 1, 0], scale: [1.6, 1, 1, 0.96] }}
        transition={{ duration: seconds * 0.34, times: [0, 0.12, 0.8, 1] }}
      >
        Shadow Clone Jutsu!
      </motion.p>
      <motion.div
        className="absolute inset-x-0 top-[3%] text-center"
        style={{ zIndex: 80 }}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: [0, 0, 1, 1, 0], y: [-10, -10, 0, 0, -6] }}
        transition={{ duration: seconds, times: [0, T.finalTitle, T.finalTitle + 0.06, 0.95, 1] }}
      >
        <p className="whitespace-nowrap font-display text-sm font-bold uppercase tracking-[0.2em] text-white sm:text-lg md:text-2xl" style={{ textShadow: '0 0 24px rgba(130,160,255,0.9), 0 4px 20px rgba(0,0,0,0.9)' }}>
          Shadow Clone Jutsu activated!
        </p>
        <p className="mt-1 font-display text-[11px] font-semibold uppercase tracking-[0.3em] text-white/75">
          {clones.length} clones · {formation === 'surround' ? 'surrounding formation' : formation === 'line' ? 'battle line' : 'arrowhead'}
        </p>
      </motion.div>
    </motion.div>
  );
}
