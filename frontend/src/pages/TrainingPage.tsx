import { AnimatePresence, motion } from 'framer-motion';
import {
  Brain,
  Camera,
  CameraOff,
  Check,
  CircleCheck,
  Database,
  Fingerprint,
  Info,
  Layers,
  LoaderCircle,
  Save,
  ScanLine,
  Target,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { CameraStage } from '@/components/CameraStage';
import { HandSkeleton } from '@/components/HandSkeleton';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Badge, Meter, PageHeader, PanelHeading } from '@/components/ui/primitives';
import { EmptyState, ErrorState, Notice } from '@/components/ui/States';
import { useBackend } from '@/context/BackendContext';
import { useSettings } from '@/context/SettingsContext';
import { useToast } from '@/context/ToastContext';
import { useApi } from '@/hooks/useApi';
import { useCamera } from '@/hooks/useCamera';
import { useHandTracker } from '@/hooks/useHandTracker';
import { usePredictionLoop } from '@/hooks/usePredictionLoop';
import { Page } from '@/layouts/AppLayout';
import { formatDateTime, percent, plural, randomId, titleCase } from '@/lib/format';
import { toFramePayload, type TrackedFrame } from '@/lib/hands';
import { readFlag, writeFlag } from '@/lib/storage';
import { api, errorMessage } from '@/services/api';
import { sound } from '@/services/sound';
import type { Evaluation, FramePayload, LabelStatus, ModelInfo, Prediction, TrainingStatus } from '@/types/api';

const IDLE_LABEL = 'none';
const BURST_SIZES = [10, 20, 40];
/** Frames captured (and saved automatically) by "Quick calibrate". */
const CALIBRATION_BURST = 12;
const BURST_INTERVAL_MS = 160;
const BURST_TIMEOUT_MS = 12_000;
const GUIDE_KEY = 'jutsu-arena.training-guide-dismissed';

interface PendingSample {
  key: string;
  group: string;
  frame: FramePayload;
}

type CaptureState = { phase: 'idle' } | { phase: 'countdown'; seconds: number } | { phase: 'capturing'; taken: number; total: number };

const labelName = (label: string) => (label === IDLE_LABEL ? 'Idle' : titleCase(label));

// -- setup guide --------------------------------------------------------------

function SetupGuide({ status, calibrationMin, onDismiss }: { status: TrainingStatus; calibrationMin: number; onDismiss: () => void }) {
  const steps = [
    { title: 'Optional', text: 'All twelve signs already work in the arena with the built-in recogniser. Come here only if a sign is not picked up the way you form it.' },
    { title: 'Quick calibrate', text: `Pick the sign, start the camera and press Quick calibrate. ${CALIBRATION_BURST} frames are captured and saved — from ${calibrationMin} samples on, that sign is matched against your own pose immediately.` },
    { title: 'Idle pose', text: 'Calibrate Idle too (relaxed hands, moving between signs) if a sign triggers when you are not making it.' },
    { title: 'Full model', text: 'Optionally collect more samples for every sign and train a personal model. Auto mode switches to it once it covers all twelve signs.' },
  ];
  return (
    <section className="panel mb-6 overflow-hidden p-5 md:p-6" aria-label="Setup guide">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow !text-accent-soft">Optional</p>
          <h2 className="mt-1 text-xl font-bold uppercase text-fg">Personalise recognition — only if you need to</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-muted">
            No setup is required to play: built-in pose templates recognise every sign. Saved samples personalise those signs right away. A trained model is a further,
            optional step: a sign needs at least <strong className="text-fg">{status.min_samples_per_class} samples</strong> to be included, and{' '}
            <strong className="text-fg">{status.recommended_samples_per_class}+ per sign</strong> is recommended. Variety matters more than volume.
          </p>
        </div>
        <button type="button" onClick={onDismiss} className="rounded-md p-1.5 text-fg-faint transition hover:bg-white/[0.06] hover:text-fg" aria-label="Hide setup guide">
          <X className="h-4 w-4" />
        </button>
      </div>
      <ol className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.title} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <span className="hud-value text-2xl text-accent-soft">0{index + 1}</span>
            <p className="mt-2 font-display text-sm font-semibold uppercase tracking-[0.12em] text-fg">{step.title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{step.text}</p>
          </li>
        ))}
      </ol>
      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-fg-faint">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Samples of the <strong className="text-fg-muted">Idle</strong> class (relaxed hands, hands moving between signs) teach the recogniser what is <em>not</em> a
          sign and reduce false recognitions — with the built-in recogniser and with a trained model.
        </span>
      </p>
    </section>
  );
}

// -- label list ---------------------------------------------------------------

function LabelList({
  status,
  selected,
  onSelect,
  kanji,
  calibrated,
}: {
  status: TrainingStatus;
  selected: string;
  onSelect: (label: string) => void;
  kanji: (label: string) => string;
  calibrated: Set<string>;
}) {
  return (
    <section className="panel p-3" aria-label="Sign classes">
      <div className="px-2 pb-2 pt-1">
        <PanelHeading icon={Layers} title="Classes" aside={<span className="text-xs text-fg-faint">{plural(status.total_samples, 'sample')}</span>} />
      </div>
      <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-1">
        {status.labels.map((label: LabelStatus) => {
          const active = label.label === selected;
          const tone = label.sample_count >= status.recommended_samples_per_class ? 'success' : label.eligible ? 'info' : label.sample_count > 0 ? 'warning' : 'neutral';
          return (
            <li key={label.label}>
              <button
                type="button"
                onClick={() => onSelect(label.label)}
                aria-pressed={active}
                className={`w-full rounded-xl border p-2.5 text-left transition ${
                  active ? 'border-accent/60 bg-accent/10 shadow-glow' : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/[0.05] text-sm text-fg-muted" aria-hidden>
                      {label.is_idle ? '∅' : kanji(label.label)}
                    </span>
                    <span className="truncate font-display text-xs font-semibold uppercase tracking-[0.12em] text-fg">{label.is_idle ? 'Idle' : label.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {calibrated.has(label.label) && <Fingerprint className="h-3.5 w-3.5 text-azure" aria-label="Calibrated to your hands" />}
                    {label.in_model && <CircleCheck className="h-3.5 w-3.5 text-jade" aria-label="In the trained model" />}
                    <span className="hud-value text-xs text-fg-muted">{label.sample_count}</span>
                  </span>
                </span>
                <Meter className="mt-2" value={label.sample_count} max={status.recommended_samples_per_class} tone={tone} label={`${label.name} samples`} />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="px-2 pb-1 pt-3 text-[11px] leading-relaxed text-fg-faint">
        Bars fill at {status.recommended_samples_per_class} samples. <Fingerprint className="inline h-3 w-3 text-azure" aria-hidden /> = calibrated (used by the built-in
        recogniser). <CircleCheck className="inline h-3 w-3 text-jade" aria-hidden /> = included in the trained model.
      </p>
    </section>
  );
}

// -- sample thumbnails --------------------------------------------------------

function SampleThumb({ frame, mirrored, onDelete, label }: { frame: FramePayload; mirrored: boolean; onDelete: () => void; label: string }) {
  return (
    <div className="group relative aspect-square overflow-hidden rounded-lg border border-white/[0.07] bg-ink-900">
      <HandSkeleton hands={frame.hands} aspect={frame.image_width / frame.image_height} mirrored={mirrored} className="h-full w-full p-1" label={label} />
      <button
        type="button"
        onClick={onDelete}
        className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-md bg-ink-950/85 text-fg-muted opacity-0 transition hover:bg-ember hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
        aria-label={`Delete ${label}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// -- model panel --------------------------------------------------------------

function ConfusionMatrix({ evaluation }: { evaluation: Evaluation }) {
  const { labels, matrix } = evaluation.confusion_matrix;
  const max = Math.max(1, ...matrix.flat());
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5 text-[10px]">
        <caption className="sr-only">Confusion matrix: rows are the true sign, columns are the predicted sign</caption>
        <thead>
          <tr>
            <th className="p-1 text-left font-normal text-fg-faint">true ↓ / predicted →</th>
            {labels.map((label) => (
              <th key={label} scope="col" className="p-1 font-display font-semibold uppercase tracking-wider text-fg-muted">
                {labelName(label).slice(0, 4)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, rowIndex) => (
            <tr key={labels[rowIndex]}>
              <th scope="row" className="pr-2 text-left font-display font-semibold uppercase tracking-wider text-fg-muted">
                {labelName(labels[rowIndex])}
              </th>
              {row.map((value, columnIndex) => {
                const correct = rowIndex === columnIndex;
                const strength = value / max;
                return (
                  <td
                    key={columnIndex}
                    className="h-7 min-w-7 rounded text-center tabular-nums text-fg"
                    style={{ background: value === 0 ? 'rgba(255,255,255,0.03)' : correct ? `rgba(52, 211, 153, ${0.15 + strength * 0.5})` : `rgba(226, 59, 78, ${0.25 + strength * 0.5})` }}
                  >
                    {value || ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelPanel({ status, training, onTrain }: { status: TrainingStatus; training: boolean; onTrain: () => void }) {
  const model: ModelInfo = status.model;
  const evaluation = model.evaluation;
  const skipped = Object.entries(status.model.skipped_classes);
  return (
    <section className="panel p-5" aria-label="Model">
      <PanelHeading icon={Brain} title="Model" aside={<Badge tone={model.ready ? 'success' : 'warning'}>{model.ready ? 'Trained' : 'Not trained'}</Badge>} />

      <Button variant="primary" className="w-full" icon={Brain} loading={training} disabled={!status.can_train} onClick={onTrain}>
        {training ? 'Training…' : model.ready ? 'Retrain model' : 'Train model'}
      </Button>
      {status.blocking_reason && !training && (
        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-amber">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {status.blocking_reason}
        </p>
      )}
      {!status.blocking_reason && (
        <p className="mt-3 text-xs leading-relaxed text-fg-faint">
          {status.eligible_classes} classes have {status.min_samples_per_class}+ samples and will be trained. Classes below the minimum are skipped.
        </p>
      )}
      {status.job.state === 'failed' && status.job.message && (
        <div className="mt-3">
          <Notice tone="danger" icon={TriangleAlert} title="Training failed">
            {status.job.message}
          </Notice>
        </div>
      )}
      {model.ready && status.dataset_changed_since_training && !training && (
        <div className="mt-3">
          <Notice tone="info" icon={Info}>
            The dataset has changed since the last training run. Retrain to use the new samples.
          </Notice>
        </div>
      )}

      {model.ready && (
        <div className="mt-5 space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="eyebrow !text-[10px]">Trained</dt>
              <dd className="mt-1 text-fg">{formatDateTime(model.trained_at)}</dd>
            </div>
            <div>
              <dt className="eyebrow !text-[10px]">Data used</dt>
              <dd className="mt-1 text-fg">
                {model.total_samples} samples · {model.classes.length} classes
              </dd>
            </div>
          </dl>

          {evaluation ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <p className="eyebrow !text-[10px]">Accuracy</p>
                  <p className="hud-value mt-1 text-2xl text-fg">{percent(evaluation.accuracy, 1)}</p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <p className="eyebrow !text-[10px]">Macro F1</p>
                  <p className="hud-value mt-1 text-2xl text-fg">{percent(evaluation.macro_f1, 1)}</p>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-fg-faint">
                Measured with {evaluation.folds}-fold {evaluation.method}. {evaluation.note}
              </p>
              <table className="w-full text-xs">
                <caption className="sr-only">Per-class metrics</caption>
                <thead>
                  <tr className="text-left text-fg-faint">
                    <th scope="col" className="pb-1.5 font-normal">Class</th>
                    <th scope="col" className="pb-1.5 text-right font-normal">Precision</th>
                    <th scope="col" className="pb-1.5 text-right font-normal">Recall</th>
                    <th scope="col" className="pb-1.5 text-right font-normal">Samples</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {Object.entries(evaluation.per_class).map(([label, metrics]) => (
                    <tr key={label} className="border-t border-white/[0.05]">
                      <th scope="row" className="py-1.5 text-left font-display font-semibold uppercase tracking-wider text-fg">{labelName(label)}</th>
                      <td className="py-1.5 text-right text-fg-muted">{percent(metrics.precision)}</td>
                      <td className="py-1.5 text-right text-fg-muted">{percent(metrics.recall)}</td>
                      <td className="py-1.5 text-right text-fg-muted">{metrics.support}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ConfusionMatrix evaluation={evaluation} />
            </>
          ) : (
            <Notice tone="info" icon={Info} title="No evaluation available">
              {model.evaluation_note ?? 'There was not enough data to evaluate this model.'}
            </Notice>
          )}
          {skipped.length > 0 && (
            <p className="text-[11px] leading-relaxed text-fg-faint">
              Skipped (too few samples): {skipped.map(([label, count]) => `${labelName(label)} (${count})`).join(', ')}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function LiveTest({ prediction, live }: { prediction: Prediction | null; live: boolean }) {
  return (
    <section className="panel p-5" aria-label="Live recognition test">
      <PanelHeading
        icon={Target}
        title="Live test"
        aside={prediction && prediction.engine !== 'none' && <Badge tone="info">{prediction.engine === 'builtin' ? 'Built-in' : 'Trained model'}</Badge>}
      />
      {!live || !prediction ? (
        <p className="text-sm leading-relaxed text-fg-muted">Start the camera to see what the active recogniser predicts for each frame.</p>
      ) : prediction.status === 'model_missing' ? (
        <p className="text-sm leading-relaxed text-fg-muted">{prediction.message}</p>
      ) : (
        <>
          <p className={`hud-value text-2xl ${prediction.status === 'recognized' ? 'text-jade' : prediction.sign ? 'text-fg' : 'text-fg-faint'}`}>
            {prediction.sign ? labelName(prediction.sign).toUpperCase() : prediction.status === 'no_hands' ? 'NO HANDS' : 'UNKNOWN SIGN'}
          </p>
          <p className="mt-1 text-xs text-fg-faint">{prediction.message ?? (prediction.status === 'recognized' ? 'Stable — this would be accepted in the arena.' : 'Hold steady…')}</p>
          {prediction.hint && <p className="mt-1 text-xs text-fg-faint">{prediction.hint}</p>}
          {prediction.calibrated && <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-azure">Matched using your calibration</p>}
          <ul className="mt-4 space-y-2.5">
            {prediction.top.map((entry) => (
              <li key={entry.sign}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-display font-semibold uppercase tracking-wider text-fg-muted">{labelName(entry.sign)}</span>
                  <span className="tabular-nums text-fg-muted">{percent(entry.confidence)}</span>
                </div>
                <Meter value={entry.confidence} tone={entry.confidence >= prediction.threshold && entry.sign !== IDLE_LABEL ? 'success' : 'neutral'} label={`${entry.sign} probability`} />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-fg-faint">Signs below {percent(prediction.threshold)} confidence are reported as unknown (adjust in Settings → Recognition).</p>
        </>
      )}
    </section>
  );
}

// -- page ---------------------------------------------------------------------

export default function TrainingPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionId = useMemo(() => randomId('train'), []);
  const [searchParams, setSearchParams] = useSearchParams();

  const { settings } = useSettings();
  const { push } = useToast();
  const { refresh: refreshBackend } = useBackend();
  const camera = useCamera(videoRef, settings.camera_device_id);
  const status = useApi(api.trainingStatus);
  const signs = useApi(api.signs);

  const requested = searchParams.get('sign');
  const labels = status.data?.labels ?? [];
  const selected = labels.some((label) => label.label === requested) ? (requested as string) : (labels[0]?.label ?? 'rat');
  const selectedStatus = labels.find((label) => label.label === selected);
  const requiredHands = selected === IDLE_LABEL ? 1 : (signs.data?.signs.find((sign) => sign.id === selected)?.hands_required ?? 2);
  const saved = useApi(() => api.listSamples(selected, 24), [selected]);

  const [pending, setPending] = useState<PendingSample[]>([]);
  const [capture, setCapture] = useState<CaptureState>({ phase: 'idle' });
  const [burstSize, setBurstSize] = useState(20);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [guideHidden, setGuideHidden] = useState(() => readFlag(GUIDE_KEY));
  const latestFrame = useRef<TrackedFrame | null>(null);
  const captureTimers = useRef<number[]>([]);
  /** Set by Quick calibrate: save the burst as soon as it finishes. */
  const autoSave = useRef(false);

  const loop = usePredictionLoop({ sessionId, trackSequence: false });
  const live = camera.status === 'active';
  const { submit, clear: clearLoop } = loop;
  const onFrame = useCallback(
    (frame: TrackedFrame) => {
      latestFrame.current = frame;
      submit(frame);
    },
    [submit],
  );
  const tracker = useHandTracker({ videoRef, canvasRef, active: live, showLandmarks: true, mirrored: settings.mirror_camera, onFrame });

  const stopCapture = useCallback(() => {
    captureTimers.current.forEach((timer) => window.clearTimeout(timer));
    captureTimers.current = [];
    setCapture({ phase: 'idle' });
  }, []);

  useEffect(() => {
    if (!live) {
      clearLoop();
      latestFrame.current = null;
      stopCapture();
    }
  }, [live, clearLoop, stopCapture]);
  useEffect(() => stopCapture, [stopCapture]);

  // Captured-but-unsaved samples belong to the sign that was selected at the time.
  useEffect(() => {
    setPending([]);
    stopCapture();
  }, [selected, stopCapture]);

  // Poll while a training job is running.
  const jobState = status.data?.job.state;
  const reloadStatus = status.reload;
  const reloadSigns = signs.reload;
  const previousJob = useRef(jobState);
  useEffect(() => {
    if (jobState === 'running') {
      const timer = window.setInterval(() => void reloadStatus(), 800);
      return () => window.clearInterval(timer);
    }
  }, [jobState, reloadStatus]);
  useEffect(() => {
    if (previousJob.current === 'running' && jobState === 'completed') {
      push('success', 'Model trained', status.data?.job.message ?? undefined);
      void reloadSigns();
      void refreshBackend();
    }
    if (previousJob.current === 'running' && jobState === 'failed') push('error', 'Training failed', status.data?.job.message ?? undefined);
    previousJob.current = jobState;
  }, [jobState, status.data, push, reloadSigns, refreshBackend]);

  const usableFrame = useCallback((): FramePayload | null => {
    const frame = latestFrame.current;
    if (!frame || performance.now() - frame.timestamp > 500 || frame.hands.length < requiredHands) return null;
    return toFramePayload(frame);
  }, [requiredHands]);

  const captureOne = useCallback(() => {
    const frame = usableFrame();
    if (!frame) {
      push('info', requiredHands === 2 ? 'Both hands must be visible' : 'No hand visible', 'Bring your hands fully into the frame, then capture again.');
      return;
    }
    sound.capture();
    setPending((current) => [...current, { key: randomId('s'), group: randomId('single'), frame }]);
  }, [usableFrame, requiredHands, push]);

  const captureBurst = useCallback((size?: number) => {
    stopCapture();
    const group = randomId('burst');
    const total = size ?? burstSize;
    let taken = 0;
    const startedAt = performance.now() + 3000;

    const shoot = () => {
      if (performance.now() - startedAt > BURST_TIMEOUT_MS) {
        stopCapture();
        push('info', 'Burst stopped early', `Captured ${taken} of ${total} — the required hands were not visible for the rest.`);
        return;
      }
      const frame = usableFrame();
      if (frame) {
        taken += 1;
        sound.capture();
        setPending((current) => [...current, { key: randomId('s'), group, frame }]);
        setCapture({ phase: 'capturing', taken, total });
      }
      if (taken >= total) {
        stopCapture();
        return;
      }
      captureTimers.current.push(window.setTimeout(shoot, BURST_INTERVAL_MS));
    };

    setCapture({ phase: 'countdown', seconds: 3 });
    [2, 1].forEach((seconds, index) => {
      captureTimers.current.push(window.setTimeout(() => setCapture({ phase: 'countdown', seconds }), (index + 1) * 1000));
    });
    captureTimers.current.push(
      window.setTimeout(() => {
        setCapture({ phase: 'capturing', taken: 0, total });
        shoot();
      }, 3000),
    );
  }, [burstSize, stopCapture, usableFrame, push]);

  const reloadSaved = saved.reload;
  const savePending = useCallback(async () => {
    if (!pending.length) return;
    setSaving(true);
    try {
      const groups = new Map<string, FramePayload[]>();
      pending.forEach((sample) => groups.set(sample.group, [...(groups.get(sample.group) ?? []), sample.frame]));
      let savedCount = 0;
      let rejected = 0;
      for (const [group, frames] of groups) {
        const result = await api.saveSamples(selected, group, frames);
        savedCount += result.saved;
        rejected += result.rejected;
      }
      setPending([]);
      push('success', `Saved ${plural(savedCount, 'sample')} for ${labelName(selected)}`, rejected ? `${rejected} skipped: a required hand was missing.` : undefined);
      await Promise.all([reloadStatus(), reloadSaved(), reloadSigns()]);
    } catch (error) {
      push('error', 'Samples were not saved', errorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [pending, selected, push, reloadStatus, reloadSaved, reloadSigns]);

  // Quick calibrate: once the burst ends, save it without the review step.
  useEffect(() => {
    if (capture.phase !== 'idle' || !autoSave.current) return;
    autoSave.current = false;
    if (pending.length) void savePending();
  }, [capture.phase, pending.length, savePending]);

  const quickCalibrate = useCallback(() => {
    autoSave.current = true;
    captureBurst(CALIBRATION_BURST);
  }, [captureBurst]);

  const cancelCapture = useCallback(() => {
    autoSave.current = false;
    stopCapture();
  }, [stopCapture]);

  const deleteSaved = useCallback(
    async (sampleId: string) => {
      try {
        await api.deleteSample(selected, sampleId);
        await Promise.all([reloadStatus(), reloadSaved()]);
      } catch (error) {
        push('error', 'Could not delete the sample', errorMessage(error));
      }
    },
    [selected, push, reloadStatus, reloadSaved],
  );

  const clearSaved = useCallback(async () => {
    setConfirmClear(false);
    try {
      const result = await api.clearSamples(selected);
      push('info', `Deleted ${plural(result.deleted, 'sample')}`, `${labelName(selected)} has no saved samples now.`);
      await Promise.all([reloadStatus(), reloadSaved(), reloadSigns()]);
    } catch (error) {
      push('error', 'Could not delete the samples', errorMessage(error));
    }
  }, [selected, push, reloadStatus, reloadSaved, reloadSigns]);

  const train = useCallback(async () => {
    try {
      await api.train();
      await reloadStatus();
    } catch (error) {
      push('error', 'Training could not start', errorMessage(error));
      await reloadStatus();
    }
  }, [push, reloadStatus]);

  const dismissGuide = () => {
    writeFlag(GUIDE_KEY, true);
    setGuideHidden(true);
  };

  const kanji = useCallback((label: string) => signs.data?.signs.find((sign) => sign.id === label)?.kanji ?? '·', [signs.data]);
  const calibrated = useMemo(() => new Set((signs.data?.signs ?? []).filter((sign) => sign.recognition_source === 'calibrated').map((sign) => sign.id)), [signs.data]);
  const calibrationMin = signs.data?.signs[0]?.calibration_min_samples ?? 8;
  const handsOk = tracker.presence.count >= requiredHands;
  const busy = capture.phase !== 'idle';

  if (status.loading && !status.data) {
    return (
      <Page>
        <div className="skeleton h-10 w-80" />
        <div className="skeleton mt-6 h-[520px]" />
      </Page>
    );
  }
  if (!status.data) {
    return (
      <Page>
        <PageHeader eyebrow="Training Studio" title="Teach the recogniser" />
        <ErrorState message={status.error ?? 'The training status could not be loaded.'} offline={status.offline} onRetry={() => void status.reload()} />
      </Page>
    );
  }

  const data = status.data;
  const training = data.job.state === 'running';

  return (
    <Page>
      <PageHeader
        eyebrow="Training Studio"
        title="Teach the recogniser"
        description="Optional: calibrate any sign to your own hands in a few seconds, or record a full dataset and train a personal model. Everything stays on this computer."
        actions={
          <>
            {guideHidden && (
              <Button
                variant="ghost"
                icon={Info}
                onClick={() => {
                  writeFlag(GUIDE_KEY, false);
                  setGuideHidden(false);
                }}
              >
                Setup guide
              </Button>
            )}
            {live && (
              <Button icon={CameraOff} onClick={camera.stop}>
                Stop camera
              </Button>
            )}
          </>
        }
      />

      {!guideHidden && <SetupGuide status={data} calibrationMin={calibrationMin} onDismiss={dismissGuide} />}

      <div className="grid gap-6 xl:grid-cols-[250px_minmax(0,1fr)_360px]">
        <LabelList status={data} selected={selected} onSelect={(label) => setSearchParams({ sign: label }, { replace: true })} kanji={kanji} calibrated={calibrated} />

        <div className="min-w-0 space-y-5">
          <CameraStage
            videoRef={videoRef}
            canvasRef={canvasRef}
            cameraStatus={camera.status}
            cameraError={camera.error}
            trackerStatus={tracker.status}
            trackerError={tracker.error}
            mirrored={settings.mirror_camera}
            onStart={() => {
              sound.unlock();
              void camera.start();
            }}
          >
            {live && (
              <div className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-between p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="rounded-md border border-white/10 bg-ink-950/75 px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-fg backdrop-blur">
                    Recording: <span className="text-accent-soft">{labelName(selected)}</span>
                  </span>
                  <span
                    className={`rounded-md border px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.16em] backdrop-blur ${
                      handsOk ? 'border-jade/40 bg-ink-950/75 text-jade' : 'border-amber/40 bg-ink-950/75 text-amber'
                    }`}
                    role="status"
                  >
                    {tracker.presence.count === 0 ? 'No hands detected' : tracker.presence.count === 1 ? 'One hand detected' : 'Both hands detected'}
                    {!handsOk && tracker.presence.count === 1 && ' — need both'}
                  </span>
                </div>
                <AnimatePresence>
                  {capture.phase === 'countdown' && (
                    <motion.p
                      key={capture.seconds}
                      initial={{ scale: 1.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="hud-value absolute inset-0 grid place-items-center text-8xl text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)]"
                    >
                      {capture.seconds}
                    </motion.p>
                  )}
                </AnimatePresence>
                {capture.phase === 'capturing' && (
                  <div className="mx-auto w-full max-w-sm rounded-xl border border-white/10 bg-ink-950/80 p-3 backdrop-blur">
                    <div className="mb-2 flex justify-between font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-fg">
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-ember" /> Capturing
                      </span>
                      <span className="tabular-nums">
                        {capture.taken} / {capture.total}
                      </span>
                    </div>
                    <Meter value={capture.taken} max={capture.total} label="Burst progress" />
                  </div>
                )}
              </div>
            )}
          </CameraStage>

          <section className="panel p-5" aria-label="Capture">
            <PanelHeading
              icon={ScanLine}
              title={`Capture — ${labelName(selected)}`}
              aside={
                <span className="text-xs text-fg-faint">
                  {selectedStatus?.sample_count ?? 0} saved · {plural(selectedStatus?.capture_groups ?? 0, 'burst')}
                </span>
              }
            />
            <div className="flex flex-wrap items-center gap-3">
              {busy ? (
                <Button variant="danger" icon={X} onClick={cancelCapture}>
                  Stop capture
                </Button>
              ) : (
                <>
                  <Button variant="primary" icon={Fingerprint} onClick={quickCalibrate} disabled={!live || tracker.status !== 'ready' || saving}>
                    Quick calibrate
                  </Button>
                  <Button icon={Camera} onClick={() => captureBurst()} disabled={!live || tracker.status !== 'ready'}>
                    Capture burst
                  </Button>
                </>
              )}
              <div className="flex items-center rounded-lg border border-white/10 p-0.5" role="group" aria-label="Burst size">
                {BURST_SIZES.map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setBurstSize(size)}
                    aria-pressed={burstSize === size}
                    disabled={busy}
                    className={`h-8 rounded-md px-3 font-display text-xs font-semibold tabular-nums transition ${burstSize === size ? 'bg-accent/20 text-fg' : 'text-fg-muted hover:text-fg'}`}
                  >
                    {size}
                  </button>
                ))}
              </div>
              <Button icon={Check} onClick={captureOne} disabled={!live || tracker.status !== 'ready' || busy}>
                Single frame
              </Button>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-fg-muted">
              {selected === IDLE_LABEL
                ? 'Idle: keep your hands relaxed, apart, or moving between signs — anything that is not a sign. One hand is enough.'
                : `Quick calibrate captures ${CALIBRATION_BURST} frames after a 3-second countdown and saves them straight away. Capture burst lets you review frames before saving. Keep holding the sign while frames are captured, shifting position and angle slightly. Frames without both hands are skipped.`}
            </p>

            <div className="hairline my-5" />

            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-display text-xs font-semibold uppercase tracking-[0.16em] text-fg">
                Captured, not saved yet <span className="ml-1 text-fg-faint">({pending.length})</span>
              </h3>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setPending([])} disabled={!pending.length || saving}>
                  Discard
                </Button>
                <Button size="sm" variant="primary" icon={Save} onClick={() => void savePending()} loading={saving} disabled={!pending.length || busy}>
                  Save {pending.length || ''} to dataset
                </Button>
              </div>
            </div>
            {pending.length ? (
              <div className="grid max-h-[280px] grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-6 lg:grid-cols-8">
                {pending.map((sample, index) => (
                  <SampleThumb
                    key={sample.key}
                    frame={sample.frame}
                    mirrored={settings.mirror_camera}
                    label={`captured sample ${index + 1}`}
                    onDelete={() => setPending((current) => current.filter((item) => item.key !== sample.key))}
                  />
                ))}
              </div>
            ) : (
              <EmptyState icon={Camera} title="Nothing captured" description="Captured frames appear here as hand skeletons. Review them, delete any wrong poses, then save." />
            )}
          </section>

          <section className="panel p-5" aria-label="Saved samples">
            <PanelHeading
              icon={Database}
              title={`Saved samples — ${labelName(selected)}`}
              aside={
                <Button size="sm" variant="danger" icon={Trash2} onClick={() => setConfirmClear(true)} disabled={!saved.data?.total}>
                  Delete all
                </Button>
              }
            />
            {saved.loading && !saved.data ? (
              <div className="flex items-center gap-2 text-sm text-fg-muted">
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Loading samples…
              </div>
            ) : saved.error ? (
              <Notice tone="danger" icon={TriangleAlert}>
                {saved.error}
              </Notice>
            ) : saved.data && saved.data.samples.length ? (
              <>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
                  {saved.data.samples.map((sample, index) => (
                    <SampleThumb key={sample.id} frame={sample} mirrored={settings.mirror_camera} label={`saved sample ${index + 1}`} onDelete={() => void deleteSaved(sample.id)} />
                  ))}
                </div>
                <p className="mt-3 text-xs text-fg-faint">
                  Showing the {saved.data.samples.length} most recent of {saved.data.total}. Hover a sample to delete it.
                </p>
              </>
            ) : (
              <EmptyState icon={Database} title="No saved samples" description={`Nothing has been saved for ${labelName(selected)} yet.`} />
            )}
          </section>
        </div>

        <aside className="space-y-5">
          <ModelPanel status={data} training={training} onTrain={() => void train()} />
          <LiveTest prediction={live ? (loop.response?.prediction ?? null) : null} live={live} />
          {loop.offline && live && (
            <Notice tone="danger" icon={TriangleAlert} title="Game server offline">
              Captured frames stay in this tab, but they cannot be saved until the backend is back.
            </Notice>
          )}
        </aside>
      </div>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={`Delete all ${labelName(selected)} samples?`}
        description={`This permanently removes ${saved.data?.total ?? 0} saved samples for this class. The trained model is not changed until you retrain.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button variant="danger" icon={Trash2} onClick={() => void clearSaved()}>
              Delete samples
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">You will need to capture new samples before this class can be trained again.</p>
      </Modal>
    </Page>
  );
}
