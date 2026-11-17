import { motion } from 'framer-motion';
import { ChevronDown, GraduationCap, Hand, Info } from 'lucide-react';

import { HandSkeleton } from '@/components/HandSkeleton';
import { DiagramLegend, SignDiagram } from '@/components/SignDiagram';
import { ButtonLink } from '@/components/ui/Button';
import { Badge, Meter, PageHeader, StatTile, type Tone } from '@/components/ui/primitives';
import { ErrorState, LoadingGrid, Notice } from '@/components/ui/States';
import { useSettings } from '@/context/SettingsContext';
import { useApi } from '@/hooks/useApi';
import { Page } from '@/layouts/AppLayout';
import { formatDateTime, percent } from '@/lib/format';
import { api } from '@/services/api';
import type { RecognitionStatus, Sign } from '@/types/api';

const STATUS: Record<RecognitionStatus, { label: string; tone: Tone; detail: string }> = {
  untrained: { label: 'Not trained', tone: 'neutral', detail: 'No samples recorded yet.' },
  collecting: { label: 'Collecting', tone: 'warning', detail: 'More samples are needed before this sign can be trained.' },
  ready_to_train: { label: 'Ready to train', tone: 'info', detail: 'Enough samples recorded. Train the model to start recognising it.' },
  trained: { label: 'Recognised', tone: 'success', detail: 'Included in the current model.' },
};

const SOURCE: Record<Exclude<Sign['recognition_source'], 'unavailable'>, { label: string; tone: Tone; detail: string }> = {
  builtin: { label: 'Built-in', tone: 'info', detail: 'Recognised by the built-in templates — no training needed.' },
  calibrated: { label: 'Calibrated', tone: 'success', detail: 'Built-in templates, personalised with your own samples.' },
  trained: { label: 'Trained model', tone: 'success', detail: 'Recognised by the model trained on your samples.' },
};

function SignCard({ sign, index, mirrored }: { sign: Sign; index: number; mirrored: boolean }) {
  const status = sign.recognition_source === 'unavailable' ? STATUS[sign.recognition_status] : SOURCE[sign.recognition_source];
  const needed = Math.max(0, sign.min_samples - sign.sample_count);
  const calibrationNeeded = Math.max(0, sign.calibration_min_samples - sign.sample_count);

  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.4), duration: 0.4 }}
      className="panel panel-hover flex flex-col p-5"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-white/10 bg-gradient-to-br from-accent/20 to-transparent text-3xl text-fg" aria-hidden>
            {sign.kanji}
          </span>
          <div>
            <p className="eyebrow">Sign {String(sign.order).padStart(2, '0')}</p>
            <h2 className="text-xl font-bold uppercase text-fg">{sign.name}</h2>
          </div>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </header>

      <p className="mt-3 text-sm leading-relaxed text-fg-muted">{sign.description}</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/[0.06] bg-ink-900/60 p-2">
          <p className="eyebrow mb-1 px-1 !text-[9.5px]">Guide</p>
          <SignDiagram diagram={sign.diagram} />
        </div>
        <div className="flex flex-col rounded-xl border border-white/[0.06] bg-ink-900/60 p-2">
          <p className="eyebrow mb-1 px-1 !text-[9.5px]">Your recorded pose</p>
          {sign.reference_hands ? (
            <HandSkeleton hands={sign.reference_hands} aspect={sign.reference_aspect ?? 16 / 9} mirrored={mirrored} className="m-auto h-full max-h-32 w-full" label={`Your recorded ${sign.name} pose`} />
          ) : (
            <p className="m-auto px-2 text-center text-xs leading-relaxed text-fg-faint">Appears after you record this sign.</p>
          )}
        </div>
      </div>

      <details className="group mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 font-display text-xs font-semibold uppercase tracking-[0.14em] text-fg-muted transition hover:text-fg">
          How to form it
          <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden />
        </summary>
        <ol className="space-y-1.5 px-3 pb-3 text-[13px] leading-relaxed text-fg-muted">
          {sign.how_to.map((step, stepIndex) => (
            <li key={stepIndex} className="flex gap-2">
              <span className="hud-value text-accent-soft">{stepIndex + 1}.</span>
              {step}
            </li>
          ))}
        </ol>
      </details>

      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <dt className="eyebrow">Training samples</dt>
            <dd className="hud-value text-fg">
              {sign.sample_count}
              <span className="text-fg-faint"> / {sign.recommended_samples} recommended</span>
            </dd>
          </div>
          <Meter value={sign.sample_count} max={sign.recommended_samples} tone={status.tone === 'neutral' ? 'accent' : status.tone} label={`${sign.name} training samples`} />
          <p className="mt-1.5 text-xs text-fg-faint">
            {sign.recognition_source === 'unavailable'
              ? needed > 0 && sign.sample_count > 0
                ? `${needed} more needed to reach the minimum of ${sign.min_samples}.`
                : status.detail
              : sign.recognition_source === 'builtin'
                ? calibrationNeeded > 0 && sign.sample_count > 0
                  ? `${status.detail} ${calibrationNeeded} more two-hand samples will calibrate it to your hands.`
                  : status.detail
                : status.detail}
          </p>
        </div>
        <div>
          <dt className="eyebrow mb-1.5">Recognition quality</dt>
          {sign.metrics ? (
            <dd className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Precision', value: percent(sign.metrics.precision) },
                { label: 'Recall', value: percent(sign.metrics.recall) },
                { label: 'F1', value: percent(sign.metrics.f1) },
              ].map((metric) => (
                <div key={metric.label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] py-2">
                  <p className="hud-value text-base text-fg">{metric.value}</p>
                  <p className="text-[10px] uppercase tracking-wider text-fg-faint">{metric.label}</p>
                </div>
              ))}
            </dd>
          ) : (
            <dd className="text-xs leading-relaxed text-fg-faint">
              {sign.recognition_status === 'trained'
                ? 'Trained, but there was too little data to measure quality.'
                : 'Not measured. Quality figures only exist for a model trained on your samples — real-world accuracy of the built-in templates has not been measured.'}
            </dd>
          )}
        </div>
        {sign.used_in.length > 0 && (
          <div>
            <dt className="eyebrow mb-1.5">Used in</dt>
            <dd className="flex flex-wrap gap-1.5">
              {sign.used_in.map((name) => (
                <Badge key={name}>{name}</Badge>
              ))}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-auto pt-5">
        <ButtonLink className="w-full" to={`/training?sign=${sign.id}`} icon={GraduationCap} variant={sign.recognition_status === 'trained' ? 'secondary' : 'primary'}>
          {sign.sample_count > 0 ? 'Add samples' : 'Calibrate this sign'}
        </ButtonLink>
      </div>
    </motion.article>
  );
}

export default function HandSignsPage() {
  const { data, loading, error, offline, reload } = useApi(api.signs);
  const { settings } = useSettings();
  const signs = data?.signs ?? [];
  const trained = signs.filter((sign) => sign.recognition_status === 'trained').length;
  const recognisable = signs.filter((sign) => sign.recognition_source !== 'unavailable').length;
  const calibrated = signs.filter((sign) => sign.recognition_source === 'calibrated').length;
  const samples = signs.reduce((total, sign) => total + sign.sample_count, 0);

  return (
    <Page>
      <PageHeader
        eyebrow="Hand Signs"
        title="The twelve signs"
        description="Every jutsu is built from these two-handed signs. All twelve are recognised out of the box by built-in pose templates; your own recordings can personalise any of them."
      />

      {loading ? (
        <LoadingGrid count={6} className="h-[520px]" />
      ) : error || !data ? (
        <ErrorState message={error ?? 'The sign list could not be loaded.'} offline={offline} onRetry={() => void reload()} />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <StatTile
              label="Signs recognisable"
              value={`${recognisable} / ${signs.length}`}
              hint={
                data.recognition_engine === 'trained'
                  ? `Trained model · ${formatDateTime(data.trained_at)}`
                  : data.recognition_engine === 'builtin'
                    ? `Built-in recogniser · ${calibrated} calibrated`
                    : 'No recogniser available'
              }
              icon={Hand}
            />
            <StatTile label="Samples recorded" value={samples} hint="Across all twelve signs" />
            <div className="panel flex flex-col justify-center gap-3 p-4">
              <p className="eyebrow">Diagram key</p>
              <DiagramLegend />
            </div>
          </div>

          <div className="mb-6 space-y-3">
            <Notice icon={Info} title="About the guides">
              The diagrams and steps are simplified, game-defined guides shown from your own point of view, based on commonly shown references. The built-in recogniser
              checks exactly these poses (which fingers are extended, how the hands touch and are oriented). If you form a sign differently, save a short burst of it in the
              Training Studio: from {signs[0]?.calibration_min_samples ?? 8} samples on, that sign is matched against your own recording too.
            </Notice>
            {data.evaluation_note && trained > 0 && (
              <Notice icon={Info} title="How quality is measured">
                Precision, recall and F1 come from cross-validation on your own recorded samples. {data.evaluation_note}
              </Notice>
            )}
          </div>

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {signs.map((sign, index) => (
              <SignCard key={sign.id} sign={sign} index={index} mirrored={settings.mirror_camera} />
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
