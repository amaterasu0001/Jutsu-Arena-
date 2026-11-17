// Original sound effects synthesised with the Web Audio API (no audio assets).

type Tone = {
  type: OscillatorType;
  from: number;
  to: number;
  duration: number;
  gain: number;
  delay?: number;
};

let context: AudioContext | null = null;
let enabled = true;

function audio(): AudioContext | null {
  if (!enabled || typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context ??= new Ctor();
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  return context;
}

function tone(ctx: AudioContext, { type, from, to, duration, gain, delay = 0 }: Tone): void {
  const start = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(to, 1), start + duration);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.03, duration / 3));
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(envelope).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function noise(ctx: AudioContext, duration: number, gain: number, from: number, to: number, delay = 0): void {
  const start = ctx.currentTime + delay;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 0.8;
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(to, 20), start + duration);
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + duration * 0.15);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(envelope).connect(ctx.destination);
  source.start(start);
  source.stop(start + duration + 0.02);
}

const EFFECT_SOUNDS: Record<string, (ctx: AudioContext) => void> = {
  fireball: (ctx) => {
    noise(ctx, 1.6, 0.22, 300, 2400);
    tone(ctx, { type: 'sawtooth', from: 70, to: 180, duration: 1.2, gain: 0.1 });
    noise(ctx, 0.7, 0.3, 1800, 120, 1.5);
  },
  water: (ctx) => {
    noise(ctx, 2.0, 0.2, 500, 1500);
    tone(ctx, { type: 'sine', from: 180, to: 520, duration: 1.0, gain: 0.07 });
    noise(ctx, 0.8, 0.22, 2600, 400, 1.4);
  },
  clone: (ctx) => {
    noise(ctx, 0.5, 0.26, 900, 200);
    [0.25, 0.45, 0.65].forEach((delay) => noise(ctx, 0.3, 0.14, 700, 250, delay));
  },
  transform: (ctx) => {
    noise(ctx, 0.6, 0.26, 1200, 200);
    tone(ctx, { type: 'triangle', from: 440, to: 1320, duration: 0.5, gain: 0.08, delay: 0.1 });
    tone(ctx, { type: 'triangle', from: 660, to: 1760, duration: 0.5, gain: 0.06, delay: 0.3 });
  },
  lightning: (ctx) => {
    [0, 0.35, 0.8].forEach((delay) => {
      noise(ctx, 0.22, 0.3, 5000, 900, delay);
      tone(ctx, { type: 'square', from: 1400, to: 90, duration: 0.2, gain: 0.07, delay });
    });
    noise(ctx, 1.2, 0.16, 200, 60, 0.9);
  },
  wind: (ctx) => {
    noise(ctx, 2.2, 0.2, 400, 1800);
    noise(ctx, 1.4, 0.14, 1600, 500, 0.8);
  },
  earth: (ctx) => {
    tone(ctx, { type: 'sine', from: 80, to: 36, duration: 1.6, gain: 0.3 });
    noise(ctx, 1.4, 0.2, 240, 80);
    noise(ctx, 0.4, 0.2, 500, 120, 0.9);
  },
  sphere: (ctx) => {
    tone(ctx, { type: 'sawtooth', from: 120, to: 620, duration: 2.0, gain: 0.07 });
    tone(ctx, { type: 'sine', from: 240, to: 1240, duration: 2.0, gain: 0.06 });
    noise(ctx, 2.0, 0.12, 900, 3200);
    noise(ctx, 0.8, 0.26, 2600, 160, 2.0);
  },
};

export const sound = {
  setEnabled(value: boolean): void {
    enabled = value;
  },
  /** Call from a user gesture so later sounds are allowed to play. */
  unlock(): void {
    audio();
  },
  signAccepted(): void {
    const ctx = audio();
    if (!ctx) return;
    tone(ctx, { type: 'triangle', from: 660, to: 990, duration: 0.14, gain: 0.09 });
  },
  incorrect(): void {
    const ctx = audio();
    if (!ctx) return;
    tone(ctx, { type: 'sawtooth', from: 220, to: 110, duration: 0.3, gain: 0.09 });
    tone(ctx, { type: 'sawtooth', from: 233, to: 98, duration: 0.3, gain: 0.07, delay: 0.04 });
  },
  timeout(): void {
    const ctx = audio();
    if (!ctx) return;
    tone(ctx, { type: 'sine', from: 420, to: 210, duration: 0.25, gain: 0.07 });
  },
  capture(): void {
    const ctx = audio();
    if (!ctx) return;
    tone(ctx, { type: 'sine', from: 1200, to: 1500, duration: 0.05, gain: 0.05 });
  },
  achievement(): void {
    const ctx = audio();
    if (!ctx) return;
    [523, 659, 784, 1047].forEach((frequency, index) =>
      tone(ctx, { type: 'triangle', from: frequency, to: frequency, duration: 0.22, gain: 0.08, delay: index * 0.09 }),
    );
  },
  jutsu(effect: string): void {
    const ctx = audio();
    if (!ctx) return;
    (EFFECT_SOUNDS[effect] ?? EFFECT_SOUNDS.sphere)(ctx);
  },
};
