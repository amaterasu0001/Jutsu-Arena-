import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

// -- Badge --------------------------------------------------------------------

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const BADGE_TONES: Record<Tone, string> = {
  neutral: 'border-white/10 bg-white/[0.05] text-fg-muted',
  accent: 'border-accent/40 bg-accent/10 text-accent-soft',
  success: 'border-jade/35 bg-jade/10 text-jade',
  warning: 'border-amber/35 bg-amber/10 text-amber',
  danger: 'border-ember/40 bg-ember/10 text-[#ff9aa6]',
  info: 'border-azure/35 bg-azure/10 text-azure',
};

export function Badge({ tone = 'neutral', icon: Icon, children, className = '' }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-display text-[10.5px] font-semibold uppercase tracking-[0.14em] ${BADGE_TONES[tone]} ${className}`}
    >
      {Icon && <Icon className="h-3 w-3" aria-hidden />}
      {children}
    </span>
  );
}

// -- Meter --------------------------------------------------------------------

const METER_TONES: Record<Tone, string> = {
  neutral: 'bg-fg-faint',
  accent: 'bg-gradient-to-r from-accent to-accent-soft',
  success: 'bg-gradient-to-r from-emerald-500 to-jade',
  warning: 'bg-gradient-to-r from-amber-600 to-amber',
  danger: 'bg-ember',
  info: 'bg-gradient-to-r from-sky-600 to-azure',
};

export function Meter({ value, max = 1, tone = 'accent', label, className = '' }: { value: number; max?: number; tone?: Tone; label?: string; className?: string }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07] ${className}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
    >
      <div className={`h-full rounded-full transition-[width] duration-300 ${METER_TONES[tone]}`} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

// -- Toggle -------------------------------------------------------------------

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-center justify-between gap-4 ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{label}</span>
        {description && <span className="mt-0.5 block text-[13px] leading-snug text-fg-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition ${checked ? 'border-accent/60 bg-accent/70' : 'border-white/15 bg-white/[0.06]'}`}
      >
        <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

// -- Page header --------------------------------------------------------------

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        <p className="eyebrow !text-accent-soft">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-bold uppercase text-fg md:text-4xl">{title}</h1>
        {description && <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

// -- Section title ------------------------------------------------------------

export function SectionTitle({ eyebrow, title, description, align = 'left' }: { eyebrow?: string; title: string; description?: string; align?: 'left' | 'center' }) {
  return (
    <div className={`mb-8 ${align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}`}>
      {eyebrow && <p className="eyebrow !text-accent-soft">{eyebrow}</p>}
      <h2 className="mt-2 text-2xl font-bold uppercase text-fg md:text-3xl">{title}</h2>
      {description && <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">{description}</p>}
    </div>
  );
}

// -- Stat tile ----------------------------------------------------------------

export function StatTile({ label, value, hint, icon: Icon, color }: { label: string; value: ReactNode; hint?: string; icon?: LucideIcon; color?: string }) {
  return (
    <div className="panel overflow-hidden p-4">
      <div className="flex items-center justify-between">
        <p className="eyebrow">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-fg-faint" style={color ? { color } : undefined} aria-hidden />}
      </div>
      <p className="hud-value mt-2 text-3xl text-fg">{value}</p>
      {hint && <p className="mt-1 text-xs text-fg-faint">{hint}</p>}
    </div>
  );
}

// -- Panel heading ------------------------------------------------------------

export function PanelHeading({ icon: Icon, title, aside }: { icon?: LucideIcon; title: string; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.18em] text-fg">
        {Icon && <Icon className="h-4 w-4 text-accent-soft" aria-hidden />}
        {title}
      </h3>
      {aside}
    </div>
  );
}
