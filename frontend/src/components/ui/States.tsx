import { CircleAlert, RefreshCw, WifiOff, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/Button';

/** Shimmering placeholders shown while a page's data loads. */
export function LoadingGrid({ count = 6, className = 'h-48' }: { count?: number; className?: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={`skeleton ${className}`} />
      ))}
    </div>
  );
}

export function ErrorState({ message, offline, onRetry }: { message: string; offline?: boolean; onRetry?: () => void }) {
  const Icon = offline ? WifiOff : CircleAlert;
  return (
    <div className="panel mx-auto flex max-w-xl flex-col items-center gap-4 border-ember/25 p-8 text-center" role="alert">
      <span className="grid h-12 w-12 place-items-center rounded-full border border-ember/30 bg-ember/10">
        <Icon className="h-5 w-5 text-[#ff9aa6]" aria-hidden />
      </span>
      <div>
        <h2 className="text-lg font-semibold uppercase text-fg">{offline ? 'Game server offline' : 'Something went wrong'}</h2>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">{message}</p>
      </div>
      {onRetry && (
        <Button icon={RefreshCw} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.05]">
        <Icon className="h-5 w-5 text-fg-faint" aria-hidden />
      </span>
      <div>
        <p className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-fg">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-fg-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

/** Inline notice for warnings and hints inside panels. */
export function Notice({ tone = 'info', icon: Icon, title, children }: { tone?: 'info' | 'warning' | 'danger' | 'success'; icon?: LucideIcon; title?: string; children: ReactNode }) {
  const tones = {
    info: 'border-azure/25 bg-azure/[0.06] text-azure',
    warning: 'border-amber/30 bg-amber/[0.06] text-amber',
    danger: 'border-ember/35 bg-ember/[0.08] text-[#ff9aa6]',
    success: 'border-jade/30 bg-jade/[0.06] text-jade',
  } as const;
  return (
    <div className={`flex gap-3 rounded-xl border p-3.5 ${tones[tone]}`}>
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
      <div className="min-w-0 text-[13px] leading-relaxed text-fg-muted">
        {title && <p className="mb-0.5 font-display text-xs font-semibold uppercase tracking-[0.14em] text-fg">{title}</p>}
        {children}
      </div>
    </div>
  );
}
