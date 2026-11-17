import { Check, ChevronRight } from 'lucide-react';
import { Fragment } from 'react';

export interface SignLabel {
  name: string;
  kanji: string;
}

export type SignLookup = (signId: string) => SignLabel;

type StepState = 'done' | 'next' | 'pending' | 'plain' | 'missing';

const STEP_STYLES: Record<StepState, string> = {
  done: 'border-jade/50 bg-jade/15 text-jade',
  next: 'border-accent/70 bg-accent/15 text-fg shadow-glow',
  pending: 'border-white/10 bg-white/[0.03] text-fg-muted',
  plain: 'border-white/10 bg-white/[0.04] text-fg',
  missing: 'border-amber/35 bg-amber/[0.07] text-amber',
};

export function SignChip({ label, state = 'plain', size = 'md' }: { label: SignLabel; state?: StepState; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: { box: 'h-8 gap-1.5 px-2 text-[11px]', kanji: 'text-sm' },
    md: { box: 'h-10 gap-2 px-3 text-xs', kanji: 'text-base' },
    lg: { box: 'h-14 gap-2.5 px-4 text-sm', kanji: 'text-2xl' },
  }[size];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-lg border font-display font-semibold uppercase tracking-[0.12em] transition duration-300 ${sizes.box} ${STEP_STYLES[state]}`}
    >
      {state === 'done' ? <Check className="h-3.5 w-3.5" aria-hidden /> : <span className={`${sizes.kanji} leading-none opacity-80`} aria-hidden>{label.kanji}</span>}
      {label.name}
    </span>
  );
}

interface TrackProps {
  sequence: string[];
  lookup: SignLookup;
  /** Number of signs completed; omit for a plain (non-progress) listing. */
  matched?: number;
  /** Signs the model has not been trained on yet (highlighted). */
  missing?: string[];
  size?: 'sm' | 'md' | 'lg';
}

/** A jutsu's sign sequence, optionally showing progress through it. */
export function SequenceTrack({ sequence, lookup, matched, missing = [], size = 'md' }: TrackProps) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Hand sign sequence">
      {sequence.map((signId, index) => {
        let state: StepState = 'plain';
        if (matched !== undefined) state = index < matched ? 'done' : index === matched ? 'next' : 'pending';
        else if (missing.includes(signId)) state = 'missing';
        return (
          <Fragment key={`${signId}-${index}`}>
            {index > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden />}
            <li>
              <SignChip label={lookup(signId)} state={state} size={size} />
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
