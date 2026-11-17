import { useEffect, useRef } from 'react';

import { playEffect } from '@/animations';

interface Props {
  /** Effect key from the jutsu config, or null for nothing. */
  effect: string | null;
  /** Change this to (re)play the effect. */
  playKey: number;
  /** 0.4 (low) .. 1 (high). */
  quality: number;
  onDone?: () => void;
  className?: string;
}

/** Overlay that plays one jutsu effect and cleans up after itself. Never blocks input. */
export function JutsuEffect({ effect, playKey, quality, onDone, className = '' }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const live = useRef({ quality, onDone });
  live.current = { quality, onDone };

  useEffect(() => {
    const host = hostRef.current;
    if (!effect || !host || playKey <= 0) return;
    return playEffect(host, effect, live.current.quality, () => live.current.onDone?.());
  }, [effect, playKey]);

  return <div ref={hostRef} data-testid="jutsu-effect" className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden />;
}
