import { AnimatePresence, motion } from 'framer-motion';
import { CircleCheck, CircleDashed, Flag, Pause, Play, RotateCcw, Timer, Trophy } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { PanelHeading } from '@/components/ui/primitives';
import type { GameClock } from '@/hooks/useGameClock';
import { formatClock, GAME_MODES, PREPARATION_MS, type GameMode } from '@/lib/gameClock';
import type { GameState } from '@/types/api';

// -- big countdown on the camera stage ------------------------------------------

export function ChallengeTimer({ clock }: { clock: GameClock }) {
  const { phase } = clock.state;
  if (phase === 'idle' || phase === 'ended') return null;
  const preparing = phase === 'preparing';
  const tone =
    clock.warning === 'critical'
      ? 'border-ember/60 text-[#ff9aa6] shadow-[0_0_36px_-8px_rgba(255,70,90,0.7)]'
      : clock.warning === 'warning'
        ? 'border-amber/50 text-amber'
        : 'border-white/15 text-fg';
  return (
    <div className={`rounded-xl border bg-ink-950/80 px-5 py-2 text-center backdrop-blur-md transition-colors duration-500 ${tone}`} role="timer" aria-live="off">
      <p className="eyebrow !text-[10px]">{clock.paused ? 'Paused' : preparing ? 'Get ready' : 'Time left'}</p>
      <p className="hud-value text-4xl leading-tight tabular-nums md:text-5xl">{preparing ? clock.seconds : formatClock(clock.seconds)}</p>
    </div>
  );
}

/** Large "get ready" countdown in the middle of the stage during preparation. */
export function PreparationOverlay({ clock }: { clock: GameClock }) {
  const show = clock.state.phase === 'preparing' && !clock.paused;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="pointer-events-none absolute inset-x-0 top-[30%] z-30 flex flex-col items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
        >
          <p className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-white/80 drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">Challenge starts in</p>
          <motion.p
            key={clock.seconds}
            initial={{ scale: 1.25, opacity: 0.4 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.35 }}
            className="hud-value text-7xl text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)]"
          >
            {clock.seconds}
          </motion.p>
          <p className="mt-1 text-xs text-white/70 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">Warm up — signs are shown but not scored yet</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// -- controls panel ---------------------------------------------------------------

interface Readiness {
  camera: boolean;
  tracker: boolean;
  server: boolean;
  /** Person check (needed for Shadow Clone only, so it never blocks starting). */
  person?: 'present' | 'absent' | 'unknown';
}

function ReadyItem({ ok, label, pending }: { ok: boolean; label: string; pending: string }) {
  return (
    <li className={`flex items-center gap-2 text-xs ${ok ? 'text-jade' : 'text-fg-faint'}`}>
      {ok ? <CircleCheck className="h-3.5 w-3.5" aria-hidden /> : <CircleDashed className="h-3.5 w-3.5" aria-hidden />}
      {ok ? label : pending}
    </li>
  );
}

export function ChallengePanel({
  clock,
  mode,
  onModeChange,
  readiness,
  onStart,
  onPause,
  onResume,
  onEnd,
}: {
  clock: GameClock;
  mode: GameMode;
  onModeChange: (mode: GameMode) => void;
  readiness: Readiness;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
}) {
  const { phase } = clock.state;
  const active = phase === 'preparing' || phase === 'running';
  const ready = readiness.camera && readiness.tracker && readiness.server;
  return (
    <section className="panel space-y-4 p-5" aria-label="Challenge">
      <PanelHeading
        icon={Timer}
        title="Challenge"
        aside={active && <span className="hud-value text-sm text-fg-muted">{phase === 'preparing' ? `Starts in ${clock.seconds}s` : formatClock(clock.seconds)}</span>}
      />
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Game mode">
        {(Object.keys(GAME_MODES) as GameMode[]).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            disabled={active}
            onClick={() => onModeChange(id)}
            className={`rounded-lg border px-2 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
              mode === id ? 'border-accent/60 bg-accent/10' : 'border-white/10 hover:border-white/25'
            }`}
          >
            <span className="block font-display text-xs font-semibold uppercase tracking-wider text-fg">{GAME_MODES[id].label}</span>
            <span className="block text-[11px] text-fg-faint">{formatClock(GAME_MODES[id].seconds)}</span>
          </button>
        ))}
      </div>

      {!active && (
        <ul className="space-y-1">
          <ReadyItem ok={readiness.camera} label="Camera ready" pending="Start the camera" />
          <ReadyItem ok={readiness.tracker} label="Hand tracker ready" pending="Hand tracker loading…" />
          <ReadyItem ok={readiness.server} label="Game server connected" pending="Waiting for the game server" />
          {readiness.camera && readiness.person && (
            <ReadyItem
              ok={readiness.person === 'present'}
              label="Person detected"
              pending={readiness.person === 'absent' ? 'Please stand in front of your camera.' : 'Person check unavailable (Shadow Clone uses the whole frame)'}
            />
          )}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {!active ? (
          <Button variant="primary" icon={Play} onClick={onStart} disabled={!ready} className="flex-1">
            {phase === 'ended' ? 'Play again' : 'Start game'}
          </Button>
        ) : clock.paused ? (
          <Button variant="primary" icon={Play} onClick={onResume} className="flex-1">
            Resume
          </Button>
        ) : (
          <Button icon={Pause} onClick={onPause} className="flex-1">
            Pause
          </Button>
        )}
        {active && (
          <Button variant="ghost" icon={Flag} onClick={onEnd}>
            End
          </Button>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-fg-faint">
        {GAME_MODES[mode].note}. A {PREPARATION_MS / 1000}-second warm-up comes first. The clock stops while paused and while a jutsu animation plays.
      </p>
    </section>
  );
}

// -- results ------------------------------------------------------------------------

export function GameOverPanel({ game, onRestart, onClose, mode }: { game: GameState; onRestart: () => void; onClose: () => void; mode: GameMode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="panel p-5" aria-label="Challenge results">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-amber/40 bg-amber/10">
            <Trophy className="h-6 w-6 text-amber" aria-hidden />
          </span>
          <div>
            <p className="eyebrow !text-amber">Challenge over · {GAME_MODES[mode].label}</p>
            <h2 className="mt-1 text-2xl font-bold uppercase text-fg">Time!</h2>
          </div>
        </div>
        <dl className="flex items-center gap-6 text-center">
          {[
            { label: 'Score', value: String(game.score) },
            { label: 'Jutsu', value: String(game.activations) },
            { label: 'Signs', value: String(game.signs_accepted) },
            { label: 'Best combo', value: `x${game.best_combo}` },
          ].map((item) => (
            <div key={item.label}>
              <dt className="eyebrow">{item.label}</dt>
              <dd className="hud-value mt-1 text-2xl text-fg">{item.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex items-center gap-2">
          <Button variant="primary" icon={RotateCcw} onClick={onRestart}>
            Play again
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </motion.section>
  );
}
