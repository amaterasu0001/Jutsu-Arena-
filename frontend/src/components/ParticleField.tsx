import { useEffect, useRef } from 'react';

import { QUALITY_SCALE, useSettings } from '@/context/SettingsContext';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  hue: 0 | 1 | 2;
}

const COLORS = ['226, 59, 78', '62, 166, 255', '139, 92, 246'];

/** Slow-drifting embers behind a section. Pauses when off-screen or the tab is hidden. */
export function ParticleField({ density = 1, className = '' }: { density?: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { settings } = useSettings();
  const quality = QUALITY_SCALE[settings.effects_quality];

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    let raf = 0;
    let visible = true;
    let last = performance.now();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const spawn = (anywhere: boolean): Particle => ({
      x: Math.random() * width,
      y: anywhere ? Math.random() * height : height + 8,
      vx: (Math.random() - 0.5) * 8,
      vy: -(6 + Math.random() * 18),
      size: 0.6 + Math.random() * 1.8,
      alpha: 0.15 + Math.random() * 0.5,
      hue: Math.random() < 0.5 ? 0 : Math.random() < 0.6 ? 1 : 2,
    });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.round(((width * height) / 16000) * density * quality);
      particles = Array.from({ length: Math.min(target, 140) }, () => spawn(true));
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) {
        last = now;
        return;
      }
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      ctx.clearRect(0, 0, width, height);
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        p.x += (p.vx + Math.sin(now / 1400 + i) * 4) * dt;
        p.y += p.vy * dt;
        if (p.y < -10 || p.x < -10 || p.x > width + 10) particles[i] = spawn(false);
        const fade = Math.min(1, p.y / (height * 0.35));
        ctx.fillStyle = `rgba(${COLORS[p.hue]}, ${p.alpha * fade})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    observer.observe(canvas);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      resizeObserver.disconnect();
    };
  }, [density, quality]);

  return <canvas ref={canvasRef} className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} aria-hidden />;
}
