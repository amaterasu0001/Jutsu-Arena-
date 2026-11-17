import { useId } from 'react';

/** Original geometric emblem: a hexagonal seal with three converging strokes. */
export function Emblem({ className = 'h-9 w-9' }: { className?: string }) {
  const gradient = useId();
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={gradient} x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="rgb(var(--accent-soft))" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <path d="M24 3 42.2 13.5v21L24 45 5.8 34.500v-21L24 3Z" fill="#0b0b12" stroke={`url(#${gradient})`} strokeWidth="2.500" strokeLinejoin="round" />
      <path d="M24 12v12M24 24l-9.500 6.500M24 24l9.500 6.500" stroke={`url(#${gradient})`} strokeWidth="3" strokeLinecap="round" />
      <circle cx="24" cy="24" r="3.200" fill="#f4f4fa" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Emblem />
      <span className={`leading-none ${compact ? 'hidden sm:block' : ''}`}>
        <span className="block font-display text-[10px] font-semibold uppercase tracking-[0.42em] text-accent-soft">Naruto</span>
        <span className="mt-1 block font-display text-[15px] font-bold uppercase tracking-[0.2em] text-fg">Jutsu Arena</span>
      </span>
    </span>
  );
}
