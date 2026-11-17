import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  Bug,
  CameraOff,
  Crosshair,
  Eye,
  FlipHorizontal2,
  GraduationCap,
  History as HistoryIcon,
  Hourglass,
  ListChecks,
  RefreshCw,
  Repeat,
  RotateCcw,
  SlidersHorizontal,
  Trophy,
  TriangleAlert,
  Volume2,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { JutsuEffectPlayer, type ShadowCapture } from '@/animations/JutsuEffectPlayer';
import { CameraStage } from '@/components/CameraStage';
import { ChallengePanel, ChallengeTimer, GameOverPanel, PreparationOverlay } from '@/components/ChallengeHud';
import { RecognitionDebug } from '@/components/RecognitionDebug';
import { SequenceTrack, SignChip, type SignLookup } from '@/components/SequenceTrack';
import { SignDetectedCard, type DetectedSign } from '@/components/SignDetectedCard';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Badge, Meter, PageHeader, PanelHeading, Toggle } from '@/components/ui/primitives';
import { Notice } from '@/components/ui/States';
import { QUALITY_SCALE, useSettings } from '@/context/SettingsContext';
import { useToast } from '@/context/ToastContext';
import { useCamera } from '@/hooks/useCamera';
import { useCatalog } from '@/hooks/useCatalog';
import { useGameClock } from '@/hooks/useGameClock';
import { usePersonPresence, type PresenceStatus } from '@/hooks/usePersonPresence';
import { useHandTracker } from '@/hooks/useHandTracker';
import { usePredictionLoop } from '@/hooks/usePredictionLoop';
import { Page } from '@/layouts/AppLayout';
import { currentSignLabel, deriveArenaPhase, PHASE_COPY, type PhaseTone } from '@/lib/arenaState';
import { frameBoxToStage } from '@/lib/cloneFormation';
import type { GameMode } from '@/lib/gameClock';
import { elementMeta } from '@/lib/elements';
import { formatNumber, percent, randomId } from '@/lib/format';
import { api, errorMessage } from '@/services/api';
import { captureShadow, releaseShadow } from '@/services/personSegmentation';
import { sound } from '@/services/sound';
import type { Activation, GameEvent, GameState, Jutsu, PredictResponse, SequenceState, Settings } from '@/types/api';

const EMPTY_GAME: GameState = {
  score: 0,
  combo: 0,
  best_combo: 0,
  activations: 0,
  incorrect: 0,
  signs_accepted: 0,
  accuracy: null,
  next_multiplier: 1,
};

const TONE_STYLES: Record<PhaseTone, { dot: string; text: string }> = {
  idle: { dot: 'bg-fg-faint', text: 'text-fg-muted' },
  info: { dot: 'bg-azure', text: 'text-azure' },
  active: { dot: 'bg-accent', text: 'text-accent-soft' },
  success: { dot: 'bg-jade', text: 'text-jade' },
  warning: { dot: 'bg-amber', text: 'text-amber' },
  danger: { dot: 'bg-ember', text: 'text-[#ff9aa6]' },
};

interface Feedback {
  id: number;
  tone: 'danger' | 'warning' | 'info';
  title: string;
  detail: string;
}

// -- HUD pieces ---------------------------------------------------------------

function HandPill({ side, detected }: { side: 'Left' | 'Right'; detected: boolean }) {
  return (
    <span
      className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 font-display text-[10.5px] font-semibold uppercase tracking-[0.16em] backdrop-blur ${
        detected ? 'border-jade/40 bg-ink-950/70 text-jade' : 'border-white/10 bg-ink-950/60 text-fg-faint'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${detected ? 'bg-jade shadow-[0_0_8px_#34d399]' : 'bg-fg-faint'}`} />
      {side} hand: {detected ? 'Detected' : 'Not found'}
    </span>
  );
}

const PERSON_COPY: Record<PresenceStatus, { text: string; tone: 'ok' | 'warn' | 'idle' }> = {
  off: { text: 'Camera off', tone: 'idle' },
  checking: { text: 'Looking for you…', tone: 'idle' },
  present: { text: 'Person detected', tone: 'ok' },
  absent: { text: 'Please stand in front of your camera.', tone: 'warn' },
  unavailable: { text: 'Person check unavailable', tone: 'idle' },
};

function PersonPill({ status }: { status: PresenceStatus }) {
  const copy = PERSON_COPY[status];
  const style = copy.tone === 'ok' ? 'border-jade/40 text-jade' : copy.tone === 'warn' ? 'border-amber/40 text-amber' : 'border-white/10 text-fg-faint';
  return (
    <span className={`flex items-center gap-2 rounded-md border bg-ink-950/70 px-2.5 py-1.5 font-display text-[10.5px] font-semibold uppercase tracking-[0.16em] backdrop-blur ${style}`} data-testid="person-status">
      <span className={`h-1.5 w-1.5 rounded-full ${copy.tone === 'ok' ? 'bg-jade shadow-[0_0_8px_#34d399]' : copy.tone === 'warn' ? 'bg-amber' : 'bg-fg-faint'}`} />
      {copy.text}
    </span>
  );
}

type CloneStage = 'idle' | 'capturing' | 'creating' | 'playing' | 'activated';

const CLONE_STAGE_COPY: Partial<Record<CloneStage, string>> = {
  capturing: 'Capturing your shadow',
  creating: 'Creating clones',
  activated: 'Shadow Clone Jutsu activated',
};

const Scoreboard = memo(function Scoreboard({ game }: { game: GameState }) {
  return (
    <section className="panel p-5" aria-label="Score">
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow">Score</p>
          <p className="hud-value mt-1 text-4xl text-fg">{formatNumber(game.score)}</p>
        </div>
        <motion.div
          key={game.combo}
          initial={{ scale: game.combo > 0 ? 1.35 : 1, opacity: 0.6 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 18 }}
          className="text-right"
        >
          <p className="eyebrow">Combo</p>
          <p className={`hud-value mt-1 text-4xl ${game.combo > 0 ? 'text-gradient' : 'text-fg-faint'}`}>x{game.combo}</p>
        </motion.div>
      </div>
      <div className="hairline my-4" />
      <dl className="grid grid-cols-3 gap-3 text-center">
        {[
          { label: 'Jutsu', value: String(game.activations) },
          { label: 'Accuracy', value: percent(game.accuracy) },
          { label: 'Best combo', value: `x${game.best_combo}` },
        ].map((item) => (
          <div key={item.label}>
            <dt className="eyebrow !text-[10px]">{item.label}</dt>
            <dd className="hud-value mt-1 text-lg text-fg">{item.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-center text-xs text-fg-faint">
        Next jutsu scores <span className="font-semibold text-fg-muted">x{game.next_multiplier.toFixed(2)}</span>. An incorrect sequence breaks the combo.
      </p>
    </section>
  );
});

interface ObjectiveProps {
  jutsu: Jutsu[];
  lookup: SignLookup;
  sequence: SequenceState | null;
  target: string | null;
  onTarget: (jutsuId: string | null) => void;
}

const Objective = memo(function Objective({ jutsu, lookup, sequence, target, onTarget }: ObjectiveProps) {
  const matched = sequence?.signs.length ?? 0;
  const byId = useMemo(() => new Map(jutsu.map((item) => [item.id, item])), [jutsu]);
  const targetJutsu = target ? byId.get(target) : undefined;
  const candidates = (sequence?.candidates ?? []).map((candidate) => byId.get(candidate.jutsu_id)).filter((item): item is Jutsu => Boolean(item));
  const listed = targetJutsu ? [targetJutsu] : matched > 0 ? candidates : jutsu.filter((item) => item.unlocked);
  const remaining = sequence?.time_remaining_ms ?? null;

  return (
    <section className="panel p-5" aria-label="Sequence progress">
      <PanelHeading
        icon={Crosshair}
        title="Sequence"
        aside={
          <span className="hud-value text-sm text-fg-muted">
            {matched} / {targetJutsu ? targetJutsu.sequence.length : candidates.length === 1 && matched > 0 ? candidates[0].sequence.length : '?'}
          </span>
        }
      />
      <label className="block">
        <span className="sr-only">Target jutsu</span>
        <select
          value={target ?? ''}
          onChange={(event) => onTarget(event.target.value || null)}
          className="h-10 w-full rounded-lg border border-white/10 bg-ink-900 px-3 text-sm text-fg outline-none transition focus:border-accent/60"
        >
          <option value="">Free play — any jutsu</option>
          {jutsu.map((item) => (
            <option key={item.id} value={item.id}>
              Practice: {item.name}
              {item.unlocked ? '' : ' (signs not recognisable)'}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-4 h-1.5">
        {remaining !== null && sequence && (
          <Meter value={remaining} max={sequence.timeout_ms} tone={remaining < sequence.timeout_ms * 0.3 ? 'danger' : 'info'} label="Time left for the next sign" />
        )}
      </div>
      <div className="mt-1 h-4 text-right text-[11px] text-fg-faint">
        {remaining !== null && sequence && (
          <span>
            {sequence.paused ? 'Paused · ' : ''}
            {Math.ceil(remaining / 1000)}s for the next sign
          </span>
        )}
      </div>

      <ul className="mt-3 max-h-[300px] space-y-3 overflow-y-auto pr-1">
        {listed.map((item) => {
          const meta = elementMeta(item.element);
          return (
            <li key={item.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-display text-xs font-semibold uppercase tracking-[0.14em] text-fg">
                  <meta.icon className="h-3.5 w-3.5" style={{ color: meta.color }} aria-hidden />
                  {item.name}
                </span>
                <span className="text-[11px] text-fg-faint">{item.points} pts</span>
              </div>
              <SequenceTrack sequence={item.sequence} lookup={lookup} matched={targetJutsu || matched > 0 ? matched : undefined} missing={item.missing_signs} size="sm" />
            </li>
          );
        })}
        {listed.length === 0 && (
          <li className="rounded-xl border border-dashed border-white/10 p-4 text-center text-sm text-fg-muted">
            No jutsu is playable with the current recognition engine.
          </li>
        )}
      </ul>
      {targetJutsu && !targetJutsu.unlocked && (
        <p className="mt-3 text-xs leading-relaxed text-amber">
          Not recognisable with the current engine: {targetJutsu.missing_signs.map((sign) => lookup(sign).name).join(', ')}. Train them, or switch Settings → Recognition engine to Auto.
        </p>
      )}
    </section>
  );
});

interface HistoryEntry {
  id: number;
  sign: string;
}

const SignHistory = memo(function SignHistory({ entries, lookup, onClear }: { entries: HistoryEntry[]; lookup: SignLookup; onClear: () => void }) {
  return (
    <section className="panel p-5" aria-label="Recognized sign history">
      <PanelHeading
        icon={HistoryIcon}
        title="Recognized signs"
        aside={
          entries.length > 0 && (
            <button type="button" onClick={onClear} className="text-[11px] font-medium text-fg-faint transition hover:text-fg">
              Clear
            </button>
          )
        }
      />
      {entries.length === 0 ? (
        <p className="text-sm text-fg-muted">Signs appear here the moment they are accepted.</p>
      ) : (
        <ol className="flex flex-wrap gap-2">
          {entries.map((entry, index) => (
            <motion.li key={entry.id} initial={index === 0 ? { opacity: 0, scale: 0.8 } : false} animate={{ opacity: 1, scale: 1 }}>
              <SignChip label={lookup(entry.sign)} size="sm" state={index === 0 ? 'next' : 'plain'} />
            </motion.li>
          ))}
        </ol>
      )}
    </section>
  );
});

const MODES: Array<{ id: Settings['recognition_mode']; label: string }> = [
  { id: 'easy', label: 'Easy' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'strict', label: 'Strict' },
];

function ModePicker({ value, onChange }: { value: Settings['recognition_mode']; onChange: (mode: Settings['recognition_mode']) => void }) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-sm text-fg">
        <SlidersHorizontal className="h-3.5 w-3.5 text-fg-faint" aria-hidden /> Recognition mode
      </p>
      <div className="grid grid-cols-3 rounded-lg border border-white/10 p-0.5" role="radiogroup" aria-label="Recognition mode">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={value === mode.id}
            onClick={() => onChange(mode.id)}
            className={`h-8 rounded-md font-display text-xs font-semibold uppercase tracking-wider transition ${value === mode.id ? 'bg-accent/20 text-fg' : 'text-fg-muted hover:text-fg'}`}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-fg-faint">
        {value === 'easy' ? 'Forgiving: natural hand positions are accepted.' : value === 'balanced' ? 'A closer match is needed.' : 'Only clear, precise signs count.'}
      </p>
    </div>
  );
}

function ResultPanel({ activation, lookup, onReplay, onClose }: { activation: Activation; lookup: SignLookup; onReplay: () => void; onClose: () => void }) {
  const meta = elementMeta(activation.element);
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="panel overflow-hidden p-5"
      style={{ borderColor: `${meta.color}55` }}
      aria-label="Jutsu result"
    >
      <div className="pointer-events-none absolute inset-0 opacity-20" style={{ background: `radial-gradient(600px 200px at 0% 0%, ${meta.color}, transparent 70%)` }} aria-hidden />
      <div className="relative flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border" style={{ borderColor: `${meta.color}66`, background: `${meta.color}1f` }}>
            <meta.icon className="h-6 w-6" style={{ color: meta.color }} aria-hidden />
          </span>
          <div>
            <p className="eyebrow" style={{ color: meta.glow }}>
              Jutsu activated
            </p>
            <h2 className="mt-1 text-2xl font-bold uppercase text-fg">{activation.jutsu_name}</h2>
            <div className="mt-2">
              <SequenceTrack sequence={activation.sequence} lookup={lookup} matched={activation.sequence.length} size="sm" />
            </div>
          </div>
        </div>
        <dl className="flex items-center gap-6">
          <div className="text-center">
            <dt className="eyebrow">Points</dt>
            <dd className="hud-value mt-1 text-3xl text-fg">+{activation.points}</dd>
            <dd className="text-[11px] text-fg-faint">
              {activation.base_points} × {activation.multiplier.toFixed(2)}
            </dd>
          </div>
          <div className="text-center">
            <dt className="eyebrow">Combo</dt>
            <dd className="hud-value mt-1 text-3xl text-gradient">x{activation.combo}</dd>
          </div>
        </dl>
        <div className="flex items-center gap-2">
          <Button icon={Repeat} onClick={onReplay}>
            Replay
          </Button>
          <Button variant="ghost" icon={X} onClick={onClose} aria-label="Dismiss result" />
        </div>
      </div>
    </motion.section>
  );
}

// -- page ---------------------------------------------------------------------

export default function ArenaPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionId = useMemo(() => randomId('arena'), []);
  const [searchParams, setSearchParams] = useSearchParams();
  const target = searchParams.get('jutsu');

  const { settings, update } = useSettings();
  const { push } = useToast();
  const catalog = useCatalog();
  const camera = useCamera(videoRef, settings.camera_device_id);

  const [activation, setActivation] = useState<Activation | null>(null);
  const [playKey, setPlayKey] = useState(0);
  const [effectPlaying, setEffectPlaying] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [detected, setDetected] = useState<DetectedSign | null>(null);
  const [signHistory, setSignHistory] = useState<HistoryEntry[]>([]);
  const [showResults, setShowResults] = useState(false);
  const clock = useGameClock();
  const clockPhase = clock.state.phase;
  // Signs only count while the challenge clock is running and not paused.
  const scoring = clockPhase === 'running' && !clock.paused;
  const feedbackTimer = useRef(0);
  const detectedTimer = useRef(0);
  // Shadow Clone: the player captured from the camera at the moment of activation.
  // Kept in memory only (for Replay) until the next activation, the camera
  // stopping, a new game or leaving the page.
  const [capture, setCapture] = useState<ShadowCapture | null>(null);
  const [cloneStage, setCloneStage] = useState<CloneStage>('idle');
  const captureRef = useRef<ShadowCapture | null>(null);
  const cloneTimer = useRef(0);
  const effectSettings = useRef({ cloneSound: settings.clone_sound, mirrored: settings.mirror_camera });
  effectSettings.current = { cloneSound: settings.clone_sound, mirrored: settings.mirror_camera };
  const lookupRef = useRef(catalog.lookup);
  lookupRef.current = catalog.lookup;
  const jutsuRef = useRef(catalog.jutsu);
  jutsuRef.current = catalog.jutsu;
  const reloadJutsu = catalog.reloadJutsu;

  const showFeedback = useCallback((tone: Feedback['tone'], title: string, detail: string) => {
    window.clearTimeout(feedbackTimer.current);
    setFeedback({ id: Date.now(), tone, title, detail });
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), 2200);
  }, []);
  const replaceCapture = useCallback((next: ShadowCapture | null) => {
    if (captureRef.current && captureRef.current !== next) releaseShadow(captureRef.current.shadow);
    captureRef.current = next;
    setCapture(next);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(feedbackTimer.current);
      window.clearTimeout(detectedTimer.current);
      window.clearTimeout(cloneTimer.current);
      if (captureRef.current) releaseShadow(captureRef.current.shadow); // leaving the page frees the captured frame
    },
    [],
  );

  /**
   * Shadow Clone: grab the frame on screen right now, cut the player out of it
   * (locally), and play the clone effect built from that capture.
   */
  const startShadowClone = useCallback(async () => {
    window.clearTimeout(cloneTimer.current);
    setCloneStage('capturing');
    setEffectPlaying(true); // freezes the challenge clock immediately
    const video = videoRef.current;
    const result = await captureShadow(video, effectSettings.current.mirrored);
    if (result.kind !== 'captured') {
      setCloneStage('idle');
      setEffectPlaying(false);
      sound.incorrect();
      showFeedback('warning', 'Please stand in front of your camera.', result.kind === 'no_camera' ? 'The camera image is not available.' : 'No person was found in the camera image to clone.');
      return;
    }
    const { shadow } = result;
    const rect = video?.getBoundingClientRect();
    const stageAspect = rect && rect.height > 0 ? rect.width / rect.height : 16 / 9;
    replaceCapture({
      shadow,
      anchor: shadow.cutout ? frameBoxToStage(shadow.box, shadow.frameAspect, stageAspect) : null,
      cutOffBelow: shadow.box.y + shadow.box.height >= 0.97,
    });
    setCloneStage('creating');
    setPlayKey((key) => key + 1);
    if (effectSettings.current.cloneSound) sound.jutsu('clone');
    cloneTimer.current = window.setTimeout(() => setCloneStage('playing'), 1100);
  }, [replaceCapture, showFeedback]);

  const flashSign = useCallback((sign: string, response: PredictResponse) => {
    const matched = response.sequence.signs.length;
    const pick = response.sequence.target_jutsu_id ?? (response.sequence.candidates.length === 1 ? response.sequence.candidates[0].jutsu_id : null);
    const total = jutsuRef.current.find((item) => item.id === pick)?.sequence.length ?? null;
    window.clearTimeout(detectedTimer.current);
    setDetected({ id: Date.now(), label: lookupRef.current(sign), step: Math.max(matched, 1), total });
    detectedTimer.current = window.setTimeout(() => setDetected(null), 1100);
  }, []);

  const rememberSign = useCallback((sign: string) => {
    setSignHistory((current) => [{ id: Date.now() + Math.random(), sign }, ...current].slice(0, 12));
  }, []);

  const handleEvent = useCallback(
    (event: GameEvent, response: PredictResponse) => {
      if (event.sign && (event.type === 'sign_accepted' || event.type === 'jutsu_activated' || event.type === 'incorrect_sequence' || event.type === 'no_match')) {
        rememberSign(event.sign);
      }
      switch (event.type) {
        case 'sign_accepted':
          sound.signAccepted();
          if (event.sign) flashSign(event.sign, response);
          break;
        case 'jutsu_activated':
          if (!event.activation) break;
          setFeedback(null);
          window.clearTimeout(detectedTimer.current);
          setDetected(null);
          setActivation(event.activation);
          if (event.activation.effect === 'clone') {
            void startShadowClone();
          } else {
            setEffectPlaying(true);
            setPlayKey((key) => key + 1);
            sound.jutsu(event.activation.effect);
          }
          event.activation.new_achievements.forEach((achievement, index) => {
            window.setTimeout(() => {
              sound.achievement();
              push('achievement', achievement.name, achievement.description);
            }, 900 + index * 700);
          });
          void reloadJutsu();
          break;
        case 'incorrect_sequence':
          sound.incorrect();
          showFeedback('danger', 'Incorrect sequence', `${event.message.replace('Incorrect sequence: ', '')} — combo reset. Start again.`);
          break;
        case 'no_match':
          showFeedback('info', 'No match', event.message);
          break;
        case 'sequence_timeout':
          sound.timeout();
          showFeedback('warning', 'Sequence timed out', 'Form each sign before the timer runs out.');
          break;
        case 'person_required':
          sound.incorrect();
          showFeedback('warning', 'Please stand in front of your camera.', 'Shadow Clone copies you from the camera. Step into view, then form Ram again.');
          break;
      }
    },
    [push, reloadJutsu, showFeedback, flashSign, rememberSign, startShadowClone],
  );

  const live = camera.status === 'active';
  const presence = usePersonPresence(videoRef, live);
  // Unknown (still checking, or segmentation unavailable) is not sent, so it never blocks a jutsu.
  const personVisible = presence === 'present' ? true : presence === 'absent' ? false : null;
  const loop = usePredictionLoop({ sessionId, trackSequence: scoring, targetJutsuId: target, onEvent: handleEvent, debug: settings.debug_overlay, personVisible });
  const tracker = useHandTracker({
    videoRef,
    canvasRef,
    active: live,
    showLandmarks: settings.show_landmarks,
    mirrored: settings.mirror_camera,
    onFrame: loop.submit,
  });

  const { clear: clearLoop, setResponse } = loop;
  useEffect(() => {
    if (!live) {
      clearLoop();
      replaceCapture(null); // camera off: drop the captured frame
      setCloneStage('idle');
    }
  }, [live, clearLoop, replaceCapture]);

  const response = live ? loop.response : null;
  const phase = deriveArenaPhase({
    camera: camera.status,
    tracker: tracker.status,
    handCount: tracker.presence.count,
    offline: loop.offline,
    response,
    activationPlaying: effectPlaying,
  });
  const copy = PHASE_COPY[phase];
  const tone = TONE_STYLES[copy.tone];
  const game = response?.game ?? EMPTY_GAME;
  const prediction = response?.prediction ?? null;
  const signLabel = currentSignLabel(response, tracker.presence.count, (id) => catalog.lookup(id).name);
  const confident = prediction?.status === 'recognizing' || prediction?.status === 'recognized';
  const matched = response?.sequence.signs.length ?? 0;
  const sequenceTotal = useMemo(() => {
    if (!response) return null;
    const pick = target ?? (response.sequence.candidates.length === 1 && matched > 0 ? response.sequence.candidates[0].jutsu_id : null);
    return catalog.jutsu.find((item) => item.id === pick)?.sequence.length ?? null;
  }, [response, target, matched, catalog.jutsu]);

  const startCamera = useCallback(() => {
    sound.unlock();
    void camera.start();
  }, [camera]);

  const setTarget = useCallback(
    (jutsuId: string | null) => {
      setSearchParams(jutsuId ? { jutsu: jutsuId } : {}, { replace: true });
    },
    [setSearchParams],
  );

  const reset = useCallback(
    async (resetScore: boolean) => {
      try {
        const result = await api.resetSequence(sessionId, resetScore);
        setResponse((current) => (current ? { ...current, sequence: result.sequence, game: result.game, event: null } : current));
        if (resetScore) setActivation(null);
        setFeedback(null);
        push('info', resetScore ? 'Run reset' : 'Sequence reset', resetScore ? 'Score, combo and sequence cleared.' : 'Start the sequence again from the first sign.');
      } catch (error) {
        push('error', 'Could not reset', errorMessage(error));
      }
    },
    [sessionId, setResponse, push],
  );

  const replay = useCallback(() => {
    if (!activation) return;
    setEffectPlaying(true);
    setPlayKey((key) => key + 1); // Shadow Clone replays the same captured frame
    if (activation.effect !== 'clone' || settings.clone_sound) sound.jutsu(activation.effect);
  }, [activation, settings.clone_sound]);

  const onEffectDone = useCallback(() => {
    setEffectPlaying(false);
    setCloneStage((stage) => {
      if (stage === 'idle') return stage;
      window.clearTimeout(cloneTimer.current);
      cloneTimer.current = window.setTimeout(() => setCloneStage('idle'), 2200);
      return 'activated';
    });
  }, []);

  // -- challenge clock --------------------------------------------------------
  const { freeze: freezeClock, unfreeze: unfreezeClock, pause: pauseClock, resume: resumeClock } = clock;
  const gameMode = settings.game_mode;
  const tellServerPaused = useCallback(
    (paused: boolean) => {
      api.pauseSequence(sessionId, paused).catch(() => undefined); // offline: nothing is scored meanwhile anyway
    },
    [sessionId],
  );

  const startGame = useCallback(async () => {
    sound.unlock();
    try {
      const result = await api.resetSequence(sessionId, true);
      setResponse((current) => (current ? { ...current, sequence: result.sequence, game: result.game, event: null } : current));
    } catch (error) {
      push('error', 'Could not start the game', errorMessage(error));
      return;
    }
    tellServerPaused(false);
    setActivation(null);
    replaceCapture(null);
    setSignHistory([]);
    setFeedback(null);
    setShowResults(false);
    clock.start(gameMode);
  }, [clock, gameMode, sessionId, setResponse, push, tellServerPaused, replaceCapture]);

  const pauseGame = useCallback(() => {
    pauseClock();
    tellServerPaused(true);
  }, [pauseClock, tellServerPaused]);

  const resumeGame = useCallback(() => {
    resumeClock();
    tellServerPaused(false);
  }, [resumeClock, tellServerPaused]);

  const endGame = useCallback(() => clock.end(), [clock]);

  // The clock does not run while a jutsu animation plays.
  useEffect(() => {
    if (effectPlaying) freezeClock('effect');
    else unfreezeClock('effect');
  }, [effectPlaying, freezeClock, unfreezeClock]);

  // Losing the camera mid-game pauses instead of burning time.
  useEffect(() => {
    if (!live && (clockPhase === 'preparing' || clockPhase === 'running') && !clock.paused) pauseGame();
  }, [live, clockPhase, clock.paused, pauseGame]);

  // Time up: show the results and clear any half-finished sequence.
  const previousPhase = useRef(clockPhase);
  useEffect(() => {
    if (previousPhase.current !== 'ended' && clockPhase === 'ended') {
      setShowResults(true);
      sound.timeout();
      api.resetSequence(sessionId, false).catch(() => undefined);
      tellServerPaused(false);
    }
    previousPhase.current = clockPhase;
  }, [clockPhase, sessionId, tellServerPaused]);

  // Gentle reminders at 30 s and 10 s (no flashing).
  const previousWarning = useRef(clock.warning);
  useEffect(() => {
    if (clock.warning !== previousWarning.current) {
      if (clock.warning === 'warning') push('info', '30 seconds left', 'Finish the jutsu you are on.');
      if (clock.warning === 'critical') {
        push('info', '10 seconds left', 'Last chance for one more jutsu.');
        sound.incorrect();
      }
    }
    previousWarning.current = clock.warning;
  }, [clock.warning, push]);
  const activeMeta = activation ? elementMeta(activation.element) : null;
  // The personalised Shadow Clone effect shows its own titles.
  const personalClones = activation?.effect === 'clone' && capture !== null;
  const cloneStatus =
    CLONE_STAGE_COPY[cloneStage] ??
    (cloneStage === 'idle' && prediction?.sign === 'ram' && confident && tracker.presence.count === 2 ? 'Ram sign detected' : null);

  return (
    <Page>
      <PageHeader
        eyebrow="Game Arena"
        title="Perform the signs"
        description="Press Start game, then form each sign for a moment and flow straight into the next. Complete sequences to unleash jutsu before the clock runs out."
        actions={
          <>
            {live && (
              <Button icon={CameraOff} onClick={camera.stop}>
                Stop camera
              </Button>
            )}
            <Button icon={RotateCcw} onClick={() => void reset(false)} disabled={!live || loop.offline}>
              Reset sequence
            </Button>
            <Button variant="ghost" icon={RefreshCw} onClick={() => void reset(true)} disabled={!live || loop.offline}>
              New run
            </Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <CameraStage
            videoRef={videoRef}
            canvasRef={canvasRef}
            cameraStatus={camera.status}
            cameraError={camera.error}
            trackerStatus={tracker.status}
            trackerError={tracker.error}
            mirrored={settings.mirror_camera}
            onStart={startCamera}
            startLabel="Enter the arena"
          >
            <JutsuEffectPlayer effect={activation?.effect ?? null} playKey={playKey} capture={capture} quality={QUALITY_SCALE[settings.effects_quality]} onDone={onEffectDone} className="z-20" />

            {live && (
              <div className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-between p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-col gap-1.5">
                    <PersonPill status={presence} />
                    <HandPill side="Left" detected={tracker.presence.left} />
                    <HandPill side="Right" detected={tracker.presence.right} />
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <ChallengeTimer clock={clock} />
                    {cloneStatus && (
                      <span className="rounded-md border border-azure/40 bg-ink-950/80 px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-azure backdrop-blur" role="status" data-testid="clone-status">
                        {cloneStatus}
                      </span>
                    )}
                  </div>
                  <span
                    className={`flex items-center gap-2 rounded-md border border-white/10 bg-ink-950/70 px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.16em] backdrop-blur ${tone.text}`}
                    role="status"
                    aria-live="polite"
                  >
                    <span className="relative flex h-2 w-2">
                      <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${tone.dot}`} />
                      <span className={`relative inline-flex h-2 w-2 rounded-full ${tone.dot}`} />
                    </span>
                    {copy.label}
                  </span>
                </div>

                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-[220px] rounded-xl border border-white/10 bg-ink-950/75 p-3.5 backdrop-blur-md">
                    <p className="eyebrow">Current sign</p>
                    <p className={`hud-value mt-1 text-3xl ${confident ? 'text-fg' : 'text-fg-faint'} ${prediction?.status === 'recognized' ? '!text-jade' : ''}`}>{signLabel}</p>
                    <div className="mt-2.5 flex items-center gap-3">
                      <Meter
                        value={confident ? (prediction?.stability ?? 0) : 0}
                        tone={prediction?.status === 'recognized' ? 'success' : 'accent'}
                        label="Hold progress"
                      />
                      <span className="hud-value w-12 shrink-0 text-right text-xs text-fg-muted">{prediction && prediction.top.length > 0 ? percent(prediction.confidence) : '—'}</span>
                    </div>
                    <p className="mt-2 text-[11px] text-fg-faint">
                      {prediction?.status === 'unknown' && prediction.hint && tracker.presence.count === 2 ? prediction.hint : copy.hint}
                    </p>
                    {confident && prediction?.calibrated && <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-azure">Using your calibration</p>}
                  </div>
                  <div className="rounded-xl border border-white/10 bg-ink-950/75 px-4 py-3 text-right backdrop-blur-md">
                    <p className="eyebrow">Sequence</p>
                    <p className="hud-value mt-1 text-2xl text-fg">
                      {matched} / {sequenceTotal ?? '?'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {live && !effectPlaying && <SignDetectedCard detected={detected} />}
            {live && <PreparationOverlay clock={clock} />}
            {live && clockPhase === 'idle' && (
              <div className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex justify-center px-4">
                <p className="rounded-lg border border-white/10 bg-ink-950/75 px-4 py-2 text-center text-xs text-fg-muted backdrop-blur">
                  Warm up freely — signs are recognised but not scored. Press <span className="font-semibold text-fg">Start game</span> when you are ready.
                </p>
              </div>
            )}

            <AnimatePresence>
              {effectPlaying && activation && activeMeta && !personalClones && (
                <motion.div
                  key={`banner-${playKey}`}
                  className="pointer-events-none absolute inset-0 z-40 grid place-items-center"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.4 } }}
                >
                  <motion.div
                    initial={{ scale: 1.6, opacity: 0, letterSpacing: '0.6em' }}
                    animate={{ scale: 1, opacity: [0, 1, 1, 0], letterSpacing: '0.2em' }}
                    transition={{ duration: 2.2, times: [0, 0.15, 0.75, 1], ease: 'easeOut' }}
                    className="text-center"
                  >
                    <p className="font-display text-sm font-semibold uppercase text-white/90 drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)]">Jutsu activated!</p>
                    <p
                      className="mt-1 font-display text-4xl font-bold uppercase text-white md:text-6xl"
                      style={{ textShadow: `0 0 30px ${activeMeta.color}, 0 4px 24px rgba(0,0,0,0.9)` }}
                    >
                      {activation.jutsu_name}
                    </p>
                  </motion.div>
                </motion.div>
              )}
              {feedback && !effectPlaying && (
                <motion.div
                  key={feedback.id}
                  className="pointer-events-none absolute inset-x-0 top-1/3 z-40 flex justify-center px-4"
                  initial={{ opacity: 0, y: -12, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1, x: feedback.tone === 'danger' ? [0, -10, 10, -6, 6, 0] : 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.35 }}
                  role="alert"
                >
                  <div
                    className={`rounded-xl border px-6 py-4 text-center backdrop-blur-md ${
                      feedback.tone === 'danger' ? 'border-ember/60 bg-ember/20' : feedback.tone === 'warning' ? 'border-amber/50 bg-amber/15' : 'border-azure/40 bg-azure/10'
                    }`}
                  >
                    <p className="font-display text-xl font-bold uppercase tracking-[0.2em] text-white">{feedback.title}</p>
                    <p className="mt-1 text-sm text-white/80">{feedback.detail}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CameraStage>

          {live && loop.offline && (
            <Notice tone="danger" icon={TriangleAlert} title="Game server offline">
              Hand tracking is running, but signs cannot be recognised until the backend is back. Retrying automatically.
            </Notice>
          )}
          {live && !loop.offline && response && !response.model_ready && (
            <Notice tone="warning" icon={GraduationCap} title="No trained model to use">
              <p>{response.prediction.message}</p>
              <ButtonLink to="/training" size="sm" variant="secondary" className="mt-3" icon={GraduationCap}>
                Open Training Studio
              </ButtonLink>
            </Notice>
          )}
          {loop.error && (
            <Notice tone="danger" icon={TriangleAlert} title="Recognition error">
              {loop.error}
            </Notice>
          )}
          {catalog.error && !catalog.loading && (
            <Notice tone="danger" icon={TriangleAlert} title="Could not load the jutsu list">
              {catalog.error}
            </Notice>
          )}

          {live && settings.debug_overlay && <RecognitionDebug debug={response?.debug ?? null} prediction={prediction} lookup={catalog.lookup} />}

          <AnimatePresence>
            {showResults && clockPhase === 'ended' && !effectPlaying && (
              <GameOverPanel key="results" game={game} mode={clock.state.mode} onRestart={() => void startGame()} onClose={() => setShowResults(false)} />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {activation && !effectPlaying && (
              <ResultPanel key={activation.activation_id} activation={activation} lookup={catalog.lookup} onReplay={replay} onClose={() => setActivation(null)} />
            )}
          </AnimatePresence>
        </div>

        <aside className="space-y-5">
          <ChallengePanel
            clock={clock}
            mode={gameMode}
            onModeChange={(mode: GameMode) => void update({ game_mode: mode })}
            readiness={{ camera: live, tracker: tracker.status === 'ready', server: !loop.offline && loop.response !== null, person: presence === 'present' ? 'present' : presence === 'absent' ? 'absent' : presence === 'unavailable' ? 'unknown' : undefined }}
            onStart={() => void startGame()}
            onPause={pauseGame}
            onResume={resumeGame}
            onEnd={endGame}
          />
          <Scoreboard game={game} />
          <Objective jutsu={catalog.jutsu} lookup={catalog.lookup} sequence={response?.sequence ?? null} target={target} onTarget={setTarget} />
          <SignHistory entries={signHistory} lookup={catalog.lookup} onClear={() => setSignHistory([])} />

          <section className="panel space-y-4 p-5" aria-label="Camera controls">
            <PanelHeading icon={Activity} title="Controls" />
            <ModePicker value={settings.recognition_mode} onChange={(mode) => void update({ recognition_mode: mode })} />
            <Toggle label="Show hand landmarks" checked={settings.show_landmarks} onChange={(value) => void update({ show_landmarks: value })} />
            <Toggle label="Mirror camera" checked={settings.mirror_camera} onChange={(value) => void update({ mirror_camera: value })} />
            <Toggle label="Sound effects" checked={settings.sound_enabled} onChange={(value) => void update({ sound_enabled: value })} />
            <Toggle
              label="Debug overlay"
              description="Finger measurements, every sign's score and what is not matched."
              checked={settings.debug_overlay}
              onChange={(value) => void update({ debug_overlay: value })}
            />
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[11px] text-fg-faint">
              <span className="flex items-center gap-1.5">
                <Eye className="h-3 w-3" aria-hidden /> Blue = left hand, red = right hand
              </span>
              <span className="flex items-center gap-1.5">
                <FlipHorizontal2 className="h-3 w-3" aria-hidden /> Mirroring never changes which hand is which
              </span>
              <span className="flex items-center gap-1.5">
                <Volume2 className="h-3 w-3" aria-hidden /> All sounds are synthesised
              </span>
            </div>
          </section>

          <section className="panel p-5" aria-label="How to play">
            <PanelHeading icon={ListChecks} title="How to play" aside={<Badge icon={Hourglass}>{settings.sequence_timeout_seconds}s between signs</Badge>} />
            <ol className="space-y-2.5 text-sm leading-relaxed text-fg-muted">
              {[
                'Start the camera and keep both hands inside the frame, about an arm’s length away. Then press Start game — a 15-second warm-up comes first.',
                `Form a hand sign and hold it for about ${(settings.hold_ms / 1000).toFixed(1)} s, until the bar fills and the sign is detected.`,
                `Flow straight into the next sign — you have ${settings.sequence_timeout_seconds} s between signs. Holding a sign never counts it twice.`,
                'Finish the sequence to activate the jutsu. Consecutive successes raise your combo multiplier.',
              ].map((step, index) => (
                <li key={index} className="flex gap-3">
                  <span className="hud-value mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded bg-accent/15 text-[11px] text-accent-soft">{index + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
            <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-fg-faint">
              <Trophy className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Only confidently recognised signs count. Anything uncertain is shown as “Unknown sign” and scores nothing.
            </p>
            <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-fg-faint">
              <Bug className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                A sign not picked up the way you form it? Save one short burst of it in the{' '}
                <Link to="/training" className="text-fg-muted underline decoration-white/20 underline-offset-2 hover:text-fg">
                  Training Studio
                </Link>{' '}
                — it calibrates that sign instantly, no training run needed.
              </span>
            </p>
          </section>
        </aside>
      </div>
    </Page>
  );
}
