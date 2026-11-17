import { Bug } from 'lucide-react';

import type { SignLookup } from '@/components/SequenceTrack';
import { PanelHeading } from '@/components/ui/primitives';
import type { Prediction, RecognitionDebug as DebugData } from '@/types/api';

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const PAIR_LABELS: Record<string, string> = {
  palm_distance: 'Palm distance',
  knuckle_distance: 'Knuckle distance',
  vertical_offset: 'Vertical offset',
  axis_alignment: 'Hand alignment',
  'tip_distance.index': 'Index tips apart',
  'tip_distance.pinky': 'Little tips apart',
};

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
}

function Bar({ value, tone }: { value: number; tone: string }) {
  return (
    <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
      <span className={`absolute inset-y-0 left-0 rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </span>
  );
}

/** Live view of what the recogniser measures. Shows only values the backend actually computed. */
export function RecognitionDebug({ debug, prediction, lookup }: { debug: DebugData | null; prediction: Prediction | null; lookup: SignLookup }) {
  return (
    <section className="panel p-5" aria-label="Recognition debug">
      <PanelHeading
        icon={Bug}
        title="Recognition debug"
        aside={
          debug && (
            <span className="text-[11px] text-fg-faint">
              Engine: <span className="font-semibold text-fg-muted">{debug.engine === 'builtin' ? 'built-in templates' : debug.engine === 'trained' ? 'trained model' : 'none'}</span> · hold{' '}
              {debug.hold_ms} ms
            </span>
          )
        }
      />
      {!debug ? (
        <p className="text-sm text-fg-muted">Waiting for the first frame from the game server…</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            {debug.hands.length === 0 && <p className="text-sm text-fg-muted">No hands detected.</p>}
            {debug.hands.map((hand) => (
              <div key={hand.slot}>
                <p className="eyebrow mb-2">
                  {hand.slot} hand · axis {Math.round(hand.axis_deg)}°
                </p>
                <ul className="space-y-1.5">
                  {hand.extension.map((value, index) => (
                    <li key={FINGERS[index]} className="grid grid-cols-[52px_minmax(0,1fr)_64px] items-center gap-2 text-[11px]">
                      <span className="text-fg-muted">{FINGERS[index]}</span>
                      <Bar value={value} tone={hand.fingers[index] === 'extended' ? 'bg-jade' : hand.fingers[index] === 'curled' ? 'bg-azure' : 'bg-amber'} />
                      <span className="text-right tabular-nums text-fg-faint">{hand.fingers[index]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {Object.keys(debug.pair).length > 0 && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                {Object.entries(PAIR_LABELS).map(([key, label]) =>
                  key in debug.pair ? (
                    <div key={key} className="flex justify-between gap-2">
                      <dt className="text-fg-faint">{label}</dt>
                      <dd className="tabular-nums text-fg-muted">{debug.pair[key].toFixed(2)}</dd>
                    </div>
                  ) : null,
                )}
              </dl>
            )}
          </div>

          <div>
            <p className="eyebrow mb-2">
              Sign scores
              {debug.scores.length > 0 && ` · threshold ${pct(prediction?.threshold)} · lead ${pct(debug.margin)} (needs ${pct(debug.margin_required)})`}
            </p>
            {debug.scores.length === 0 ? (
              <p className="text-sm text-fg-muted">Scores appear when both hands are visible.</p>
            ) : (
              <ul className="space-y-1.5">
                {debug.scores.slice(0, 6).map((entry) => (
                  <li key={entry.sign} className="grid grid-cols-[70px_minmax(0,1fr)_120px] items-center gap-2 text-[11px]">
                    <span className="truncate font-display font-semibold uppercase tracking-wider text-fg-muted">{lookup(entry.sign).name}</span>
                    <Bar value={entry.score} tone={prediction && entry.score >= prediction.threshold ? 'bg-jade' : 'bg-white/30'} />
                    <span className="text-right tabular-nums text-fg-faint">
                      {pct(entry.score)}
                      {entry.calibration !== null && <span title="template / calibration"> ({pct(entry.template)}/{pct(entry.calibration)})</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {debug.unmet.length > 0 && (
              <div className="mt-3 text-[11px] leading-relaxed text-fg-faint">
                <p className="text-fg-muted">Not met for {lookup(debug.scores[0]?.sign ?? '').name || 'the closest sign'}:</p>
                <ul className="mt-1 list-inside list-disc">
                  {debug.unmet.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-3 text-[11px] text-fg-faint">
              Calibrated: {debug.calibrated_signs.length ? debug.calibrated_signs.map((sign) => lookup(sign).name).join(', ') : 'none'}
              {debug.idle_similarity !== null && ` · idle similarity ${pct(debug.idle_similarity)}`}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
