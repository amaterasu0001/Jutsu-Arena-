import { AnimatePresence, motion } from 'framer-motion';

import type { SignLabel } from '@/components/SequenceTrack';

export interface DetectedSign {
  /** Changes for every accepted sign so the card re-animates. */
  id: number;
  label: SignLabel;
  step: number;
  total: number | null;
}

/** "< TIGER DETECTED >" flash shown when the backend accepts a sign. */
export function SignDetectedCard({ detected }: { detected: DetectedSign | null }) {
  return (
    <AnimatePresence>
      {detected && (
        <motion.div
          key={detected.id}
          className="pointer-events-none absolute inset-x-0 top-[18%] z-40 flex justify-center px-4"
          initial={{ opacity: 0, scale: 1.35, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: -12, transition: { duration: 0.25 } }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
          role="status"
          aria-live="assertive"
        >
          <div className="relative overflow-hidden rounded-2xl border border-accent/50 bg-ink-950/80 px-7 py-4 text-center shadow-[0_0_60px_-10px_rgba(255,60,80,0.65)] backdrop-blur-md">
            <motion.span
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent"
              initial={{ x: '0%' }}
              animate={{ x: '420%' }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
              aria-hidden
            />
            <div className="flex items-center justify-center gap-4">
              <span className="font-display text-4xl leading-none text-accent-soft drop-shadow-[0_0_14px_rgba(255,90,110,0.8)]" aria-hidden>
                {detected.label.kanji}
              </span>
              <p className="font-display text-2xl font-bold uppercase tracking-[0.22em] text-white md:text-3xl">
                <span className="text-accent-soft">&lt;</span> {detected.label.name} detected <span className="text-accent-soft">&gt;</span>
              </p>
            </div>
            {detected.total !== null && (
              <p className="mt-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-fg-muted">
                {detected.step} / {detected.total} signs completed
              </p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
