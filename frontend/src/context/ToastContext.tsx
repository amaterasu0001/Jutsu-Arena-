import { AnimatePresence, motion } from 'framer-motion';
import { CircleAlert, CircleCheck, Info, Trophy, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastKind = 'success' | 'error' | 'info' | 'achievement';

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastApi {
  push: (kind: ToastKind, title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi>({ push: () => undefined });

const STYLES: Record<ToastKind, { icon: typeof Info; ring: string; tint: string }> = {
  success: { icon: CircleCheck, ring: 'border-jade/40', tint: 'text-jade' },
  error: { icon: CircleAlert, ring: 'border-ember/50', tint: 'text-ember' },
  info: { icon: Info, ring: 'border-azure/40', tint: 'text-azure' },
  achievement: { icon: Trophy, ring: 'border-amber/50', tint: 'text-amber' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, title: string, description?: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-3), { id, kind, title, description }]);
      window.setTimeout(() => dismiss(id), kind === 'achievement' ? 6500 : 4500);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-5 right-5 z-[80] flex w-[min(92vw,360px)] flex-col gap-2"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const style = STYLES[toast.kind];
            const Icon = style.icon;
            return (
              <motion.div
                key={toast.id}
                layout
                initial={{ opacity: 0, x: 40, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className={`pointer-events-auto flex items-start gap-3 rounded-xl border bg-ink-800/95 p-3.5 shadow-panel backdrop-blur ${style.ring}`}
              >
                <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${style.tint}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  {toast.kind === 'achievement' && <p className="eyebrow mb-0.5 !text-amber">Achievement unlocked</p>}
                  <p className="font-display text-sm font-semibold text-fg">{toast.title}</p>
                  {toast.description && <p className="mt-0.5 text-[13px] leading-snug text-fg-muted">{toast.description}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  className="rounded p-1 text-fg-faint transition hover:text-fg"
                  aria-label="Dismiss notification"
                >
                  <X className="h-4 w-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
