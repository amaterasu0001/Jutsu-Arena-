import { Camera, ShieldCheck } from 'lucide-react';

import { Toggle } from '@/components/ui/primitives';
import { useSettings } from '@/context/SettingsContext';
import { CLONE_COUNTS, CLONE_DURATIONS, FORMATIONS } from '@/lib/cloneFormation';
import type { Settings } from '@/types/api';

function Segmented<T extends string | number>({ label, options, value, onChange }: { label: string; options: Array<{ id: T; label: string }>; value: T; onChange: (value: T) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-fg">{label}</p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={String(option.id)}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            onClick={() => onChange(option.id)}
            className={`h-9 min-w-[3rem] rounded-lg border px-3 font-display text-xs font-semibold uppercase tracking-wider transition ${
              value === option.id ? 'border-accent/60 bg-accent/15 text-fg' : 'border-white/10 text-fg-muted hover:border-white/25 hover:text-fg'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Options for the live-camera Shadow Clone Jutsu (no photo is uploaded or stored). */
export function ShadowCloneSettings() {
  const { settings, update } = useSettings();
  return (
    <section id="shadow-clone" className="panel scroll-mt-24 grid gap-6 p-5 md:grid-cols-[240px_minmax(0,1fr)] md:p-6" aria-label="Shadow Clone Jutsu">
      <div>
        <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-accent/10">
          <Camera className="h-[18px] w-[18px] text-accent-soft" aria-hidden />
        </span>
        <h2 className="mt-3 text-base font-semibold uppercase text-fg">Shadow Clone Jutsu</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">
          Form <strong className="text-fg">Ram</strong> in the arena: the camera image at that moment is captured, you are cut out of it, and every clone is a copy of
          you exactly as you look right now.
        </p>
      </div>
      <div className="space-y-5">
        <Segmented
          label="Number of clones"
          options={CLONE_COUNTS.map((count) => ({ id: count, label: String(count) }))}
          value={settings.clone_count}
          onChange={(value) => void update({ clone_count: value as Settings['clone_count'] })}
        />
        <Segmented label="Formation" options={FORMATIONS.map((formation) => ({ id: formation.id, label: formation.label }))} value={settings.clone_formation} onChange={(value) => void update({ clone_formation: value })} />
        <Segmented
          label="Animation duration"
          options={(Object.keys(CLONE_DURATIONS) as Array<Settings['clone_duration']>).map((id) => ({ id, label: `${CLONE_DURATIONS[id].label} · ${CLONE_DURATIONS[id].ms / 1000}s` }))}
          value={settings.clone_duration}
          onChange={(value) => void update({ clone_duration: value })}
        />
        <Toggle label="Cinematic smoke" checked={settings.clone_smoke} onChange={(value) => void update({ clone_smoke: value })} />
        <Toggle label="Shadow Clone sound" description="Also requires sound effects to be on." checked={settings.clone_sound} onChange={(value) => void update({ clone_sound: value })} />
        <p className="flex items-start gap-2 text-xs leading-relaxed text-fg-faint">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-jade" aria-hidden />
          The capture is processed in this browser and kept only in memory, for Replay. It is never uploaded or saved, and it is discarded at the next activation,
          when the camera stops, when a new game starts, or when you leave the arena.
        </p>
      </div>
    </section>
  );
}
