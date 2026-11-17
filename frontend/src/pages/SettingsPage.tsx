import { Camera, Check, Gauge, Palette, RefreshCw, RotateCcw, Sparkles, Volume2, WifiOff, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { ShadowCloneSettings } from '@/components/ShadowCloneSettings';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PageHeader, Toggle } from '@/components/ui/primitives';
import { Notice } from '@/components/ui/States';
import { useBackend } from '@/context/BackendContext';
import { useSettings } from '@/context/SettingsContext';
import { useToast } from '@/context/ToastContext';
import { classifyCameraError, listCameras, type CameraDevice } from '@/hooks/useCamera';
import { Page } from '@/layouts/AppLayout';
import { sound } from '@/services/sound';
import type { EffectsQuality, Settings, ThemeName } from '@/types/api';

const THEMES: Array<{ id: ThemeName; name: string; swatch: string; note: string }> = [
  { id: 'crimson', name: 'Shadow Crimson', swatch: 'linear-gradient(135deg, #e23b4e, #7a1220)', note: 'Dark red accents' },
  { id: 'azure', name: 'Storm Azure', swatch: 'linear-gradient(135deg, #3ea6ff, #0c3e7a)', note: 'Electric blue accents' },
  { id: 'violet', name: 'Void Violet', swatch: 'linear-gradient(135deg, #8b5cf6, #381c82)', note: 'Deep purple accents' },
];

const QUALITIES: Array<{ id: EffectsQuality; name: string; note: string }> = [
  { id: 'low', name: 'Low', note: 'Fewest particles' },
  { id: 'medium', name: 'Medium', note: 'Balanced' },
  { id: 'high', name: 'High', note: 'Full effects' },
];

const MODES: Array<{ id: Settings['recognition_mode']; name: string; note: string }> = [
  { id: 'easy', name: 'Easy', note: 'Natural hand positions are accepted' },
  { id: 'balanced', name: 'Balanced', note: 'Needs a closer match' },
  { id: 'strict', name: 'Strict', note: 'Only precise signs count' },
];

const GAME_MODE_CHOICES: Array<{ id: Settings['game_mode']; name: string; note: string }> = [
  { id: 'easy', name: 'Easy', note: '180 s per challenge' },
  { id: 'normal', name: 'Normal', note: '120 s per challenge' },
  { id: 'challenge', name: 'Challenge', note: '90 s per challenge' },
];

const ENGINES: Array<{ id: Settings['recognition_engine']; name: string; note: string }> = [
  { id: 'auto', name: 'Auto', note: 'Built-in, or your trained model once it covers all 12 signs' },
  { id: 'builtin', name: 'Built-in', note: 'Pose templates + your calibration samples' },
  { id: 'trained', name: 'Trained model', note: 'Only the model from the Training Studio' },
];

function Choice<T extends string>({ legend, description, options, value, onChange }: { legend: string; description: string; options: Array<{ id: T; name: string; note: string }>; value: T; onChange: (value: T) => void }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-fg">{legend}</legend>
      <p className="mt-0.5 text-[13px] leading-snug text-fg-muted">{description}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {options.map((option) => {
          const active = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.id)}
              className={`rounded-xl border p-3 text-left transition ${active ? 'border-accent/60 bg-accent/10 shadow-glow' : 'border-white/10 hover:border-white/25'}`}
            >
              <span className="font-display text-sm font-semibold uppercase tracking-[0.12em] text-fg">{option.name}</span>
              <span className="mt-0.5 block text-xs text-fg-faint">{option.note}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Section({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description: string; children: ReactNode }) {
  return (
    <section className="panel grid gap-6 p-5 md:grid-cols-[240px_minmax(0,1fr)] md:p-6" aria-label={title}>
      <div>
        <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-accent/10">
          <Icon className="h-[18px] w-[18px] text-accent-soft" aria-hidden />
        </span>
        <h2 className="mt-3 text-base font-semibold uppercase text-fg">{title}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{description}</p>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Slider({ label, value, min, max, step = 1, onCommit, format, lowLabel, highLabel, description }: { label: string; value: number; min: number; max: number; step?: number; onCommit: (value: number) => void; format: (value: number) => string; lowLabel: string; highLabel: string; description: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={`slider-${label}`} className="text-sm font-medium text-fg">
          {label}
        </label>
        <span className="hud-value text-sm text-accent-soft">{format(draft)}</span>
      </div>
      <p className="mt-0.5 text-[13px] leading-snug text-fg-muted">{description}</p>
      <input
        id={`slider-${label}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-[rgb(var(--accent))]"
      />
      <div className="mt-1.5 flex justify-between text-[11px] text-fg-faint">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { settings, loaded, update, reset } = useSettings();
  const { online } = useBackend();
  const { push } = useToast();
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [cameraNote, setCameraNote] = useState<string | null>(null);
  const location = useLocation();

  // Links to "#clone-identity" (from the Jutsu Library) jump straight to the photo section.
  useEffect(() => {
    if (!location.hash) return;
    const timer = window.setTimeout(() => document.querySelector(location.hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    return () => window.clearTimeout(timer);
  }, [location.hash]);
  const [confirmReset, setConfirmReset] = useState(false);

  // Camera names are only available after permission; show what the browser already allows.
  useEffect(() => {
    void listCameras()
      .then((devices) => setCameras(devices.filter((device) => device.deviceId)))
      .catch(() => undefined);
  }, []);

  const detectCameras = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraNote('This browser cannot access a camera here. Open the app on http://localhost in a current browser.');
      return;
    }
    setDetecting(true);
    setCameraNote(null);
    try {
      // A short-lived stream is the only way to get permission (and device names).
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach((track) => track.stop());
      const devices = (await listCameras()).filter((device) => device.deviceId);
      setCameras(devices);
      setCameraNote(devices.length ? null : 'No camera was found.');
      if (devices.length) push('success', `Found ${devices.length} camera${devices.length === 1 ? '' : 's'}`);
    } catch (error) {
      setCameraNote(classifyCameraError(error).message);
    } finally {
      setDetecting(false);
    }
  }, [push]);

  const selectedMissing = settings.camera_device_id !== null && !cameras.some((camera) => camera.deviceId === settings.camera_device_id);

  return (
    <Page className="max-w-[1000px]">
      <PageHeader
        eyebrow="Settings"
        title="Tune your setup"
        description="Preferences are saved on the game server and restored every time you open the arena."
        actions={
          <Button variant="danger" icon={RotateCcw} onClick={() => setConfirmReset(true)} disabled={!online}>
            Reset settings
          </Button>
        }
      />

      {online === false && (
        <div className="mb-6">
          <Notice tone="danger" icon={WifiOff} title="Game server offline">
            Settings cannot be saved right now. Changes will be reverted until the backend is running again.
          </Notice>
        </div>
      )}
      {online && !loaded && (
        <div className="mb-6">
          <Notice icon={RefreshCw}>Loading your saved settings…</Notice>
        </div>
      )}

      <div className="space-y-5">
        <Section icon={Camera} title="Camera" description="Choose which webcam to use and how its preview is shown.">
          <div>
            <label htmlFor="camera-select" className="text-sm font-medium text-fg">
              Camera
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <select
                id="camera-select"
                value={settings.camera_device_id ?? ''}
                onChange={(event) => void update({ camera_device_id: event.target.value || null })}
                className="h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-ink-900 px-3 text-sm text-fg outline-none transition focus:border-accent/60"
              >
                <option value="">System default camera</option>
                {cameras.map((camera) => (
                  <option key={camera.deviceId} value={camera.deviceId}>
                    {camera.label}
                  </option>
                ))}
                {selectedMissing && <option value={settings.camera_device_id ?? ''}>Saved camera (not connected)</option>}
              </select>
              <Button icon={RefreshCw} loading={detecting} onClick={() => void detectCameras()}>
                Detect cameras
              </Button>
            </div>
            <p className="mt-2 text-[13px] leading-snug text-fg-muted">
              {cameraNote ?? 'Detecting asks for camera permission once so the browser can list your devices by name. No video is recorded or uploaded.'}
            </p>
          </div>
          <div className="hairline" />
          <Toggle
            label="Mirror camera"
            description="Show the preview like a mirror. This only flips the picture — left and right hands are still identified correctly."
            checked={settings.mirror_camera}
            onChange={(value) => void update({ mirror_camera: value })}
          />
          <Toggle
            label="Show hand landmarks"
            description="Draw the detected joints and bones of each hand over the arena preview."
            checked={settings.show_landmarks}
            onChange={(value) => void update({ show_landmarks: value })}
          />
        </Section>

        <Section icon={Gauge} title="Recognition" description="Control how strict the game is when accepting a hand sign. All twelve signs work without training.">
          <Choice
            legend="Recognition mode"
            description="How closely a pose must match a sign. Easy suits first-time players; switch to Strict if wrong signs get accepted."
            options={MODES}
            value={settings.recognition_mode}
            onChange={(value) => void update({ recognition_mode: value })}
          />
          <div className="hairline" />
          <Slider
            label="Hold time"
            value={settings.hold_ms}
            min={150}
            max={1500}
            step={50}
            format={(value) => `${(value / 1000).toFixed(2)} s`}
            lowLabel="Snappy"
            highLabel="Deliberate"
            description="How long a sign must stay steady before it counts. Holding a sign longer never counts it twice."
            onCommit={(value) => void update({ hold_ms: value })}
          />
          <div className="hairline" />
          <Slider
            label="Fine-tune sensitivity"
            value={settings.recognition_sensitivity}
            min={0}
            max={100}
            step={5}
            format={(value) => `${value}`}
            lowLabel="Strict — fewer false positives"
            highLabel="Lenient — faster acceptance"
            description="Nudges the confidence needed on top of the mode. Higher accepts signs at lower confidence; lower it if wrong signs get accepted."
            onCommit={(value) => void update({ recognition_sensitivity: value })}
          />
          <div className="hairline" />
          <Slider
            label="Time allowed between signs"
            value={settings.sequence_timeout_seconds}
            min={10}
            max={60}
            format={(value) => `${value}s`}
            lowLabel="Fast — more challenging"
            highLabel="Relaxed"
            description="How long you have to form the next sign before the sequence resets. Frozen while the game is paused."
            onCommit={(value) => void update({ sequence_timeout_seconds: value })}
          />
          <div className="hairline" />
          <Choice
            legend="Game mode"
            description="Length of a timed challenge in the arena (after a 15-second warm-up). The clock stops while paused and during jutsu animations."
            options={GAME_MODE_CHOICES}
            value={settings.game_mode}
            onChange={(value) => void update({ game_mode: value })}
          />
          <div className="hairline" />
          <Choice
            legend="Recognition engine"
            description="Where predictions come from. The trained model is only used when you have trained one in the Training Studio."
            options={ENGINES}
            value={settings.recognition_engine}
            onChange={(value) => void update({ recognition_engine: value })}
          />
          <Toggle
            label="Debug overlay in the arena"
            description="Show measured finger positions, every sign's score and which conditions are not met."
            checked={settings.debug_overlay}
            onChange={(value) => void update({ debug_overlay: value })}
          />
        </Section>

        <ShadowCloneSettings />

        <Section icon={Sparkles} title="Sound & effects" description="Adjust audio feedback and the intensity of jutsu animations.">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <Toggle
                label="Sound effects"
                description="Synthesised cues for accepted signs, mistakes and jutsu activations."
                checked={settings.sound_enabled}
                onChange={(value) => void update({ sound_enabled: value })}
              />
            </div>
            <Button
              size="sm"
              icon={Volume2}
              disabled={!settings.sound_enabled}
              onClick={() => {
                sound.unlock();
                sound.achievement();
              }}
            >
              Test
            </Button>
          </div>
          <div className="hairline" />
          <fieldset>
            <legend className="text-sm font-medium text-fg">Visual effects quality</legend>
            <p className="mt-0.5 text-[13px] leading-snug text-fg-muted">Lower this if animations stutter while the camera is running.</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {QUALITIES.map((quality) => {
                const active = settings.effects_quality === quality.id;
                return (
                  <button
                    key={quality.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => void update({ effects_quality: quality.id })}
                    className={`rounded-xl border p-3 text-left transition ${active ? 'border-accent/60 bg-accent/10 shadow-glow' : 'border-white/10 hover:border-white/25'}`}
                  >
                    <span className="font-display text-sm font-semibold uppercase tracking-[0.12em] text-fg">{quality.name}</span>
                    <span className="mt-0.5 block text-xs text-fg-faint">{quality.note}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        </Section>

        <Section icon={Palette} title="Theme" description="Pick the accent colour used across the interface.">
          <fieldset>
            <legend className="sr-only">Theme preference</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {THEMES.map((theme) => {
                const active = settings.theme === theme.id;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => void update({ theme: theme.id })}
                    className={`relative rounded-xl border p-3 text-left transition ${active ? 'border-white/40 bg-white/[0.05]' : 'border-white/10 hover:border-white/25'}`}
                  >
                    <span className="block h-14 rounded-lg" style={{ background: theme.swatch }} aria-hidden />
                    <span className="mt-3 block font-display text-sm font-semibold uppercase tracking-[0.12em] text-fg">{theme.name}</span>
                    <span className="block text-xs text-fg-faint">{theme.note}</span>
                    {active && (
                      <span className="absolute right-5 top-5 grid h-6 w-6 place-items-center rounded-full bg-white text-ink-950">
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </Section>
      </div>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset all settings?"
        description="Camera, recognition, sound, effects and theme preferences return to their defaults."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={RotateCcw}
              onClick={() => {
                setConfirmReset(false);
                void reset();
              }}
            >
              Reset settings
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">Your history, achievements, training samples and trained model are not affected.</p>
      </Modal>
    </Page>
  );
}
