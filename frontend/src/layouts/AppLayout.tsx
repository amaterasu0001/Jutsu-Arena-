import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, GraduationCap, Hand, History, Home, Menu, Settings, Swords, WifiOff, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { Logo } from '@/components/Logo';
import { useBackend } from '@/context/BackendContext';

export const NAV_ITEMS: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/play', label: 'Play', icon: Swords },
  { to: '/jutsu', label: 'Jutsu Library', icon: BookOpen },
  { to: '/signs', label: 'Hand Signs', icon: Hand },
  { to: '/training', label: 'Training', icon: GraduationCap },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function ServerStatus() {
  const { online, health } = useBackend();
  const state =
    online === null
      ? { dot: 'bg-fg-faint', text: 'Connecting' }
      : !online
        ? { dot: 'bg-ember', text: 'Server offline' }
        : health?.recognition_engine === 'builtin'
          ? { dot: 'bg-jade', text: `Built-in recogniser · ${health.recognizable_signs.length}/${health.signs_total} signs` }
          : health?.recognition_engine === 'trained'
            ? { dot: 'bg-jade', text: `Trained model · ${health.recognizable_signs.length}/${health.signs_total} signs` }
            : { dot: 'bg-amber', text: 'No trained model' };
  return (
    <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-fg-muted xl:flex" role="status">
      <span className="relative flex h-2 w-2">
        {online && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${state.dot}`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${state.dot}`} />
      </span>
      {state.text}
    </span>
  );
}

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { online, refresh } = useBackend();
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[90] focus:rounded-lg focus:bg-ink-700 focus:px-4 focus:py-2 focus:text-sm">
        Skip to content
      </a>

      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-ink-950/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" aria-label="Naruto Jutsu Arena home" className="shrink-0">
            <Logo />
          </Link>

          <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Main">
            {NAV_ITEMS.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `relative rounded-lg px-3 py-2 font-display text-xs font-semibold uppercase tracking-[0.14em] transition ${
                    isActive ? 'text-fg' : 'text-fg-muted hover:bg-white/[0.04] hover:text-fg'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {label}
                    {isActive && (
                      <motion.span
                        layoutId="nav-underline"
                        className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-accent shadow-[0_0_12px_rgb(var(--accent))]"
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <ServerStatus />
            <button
              type="button"
              className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 text-fg-muted transition hover:text-fg lg:hidden"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {menuOpen && (
            <motion.nav
              id="mobile-nav"
              aria-label="Mobile"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="overflow-hidden border-t border-white/[0.06] bg-ink-950/95 lg:hidden"
            >
              <div className="mx-auto grid max-w-[1400px] gap-1 p-3 sm:grid-cols-2">
                {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-4 py-3 font-display text-sm font-semibold uppercase tracking-[0.14em] ${
                        isActive ? 'bg-accent/15 text-fg' : 'text-fg-muted hover:bg-white/[0.04]'
                      }`
                    }
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {label}
                  </NavLink>
                ))}
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      {online === false && (
        <div className="border-b border-ember/30 bg-ember/10" role="alert">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-6">
            <span className="flex items-center gap-2 text-[#ffb3bc]">
              <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
              The game server is not reachable. Start the backend (run <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">start.bat</code>) — recognition, training and saving are paused.
            </span>
            <button type="button" onClick={() => void refresh()} className="font-display text-xs font-semibold uppercase tracking-[0.14em] text-fg underline-offset-4 hover:underline">
              Retry now
            </button>
          </div>
        </div>
      )}

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-white/[0.06] bg-ink-950/60">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-md">
            <Logo />
            <p className="mt-3 text-xs leading-relaxed text-fg-faint">
              A fan-made, non-commercial project. Not affiliated with or endorsed by the owners of Naruto. All visuals and sounds are original; sign sequences are
              game-defined.
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Footer">
            {NAV_ITEMS.map(({ to, label }) => (
              <Link key={to} to={to} className="font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-faint transition hover:text-fg">
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** Standard page container. */
export function Page({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 md:py-10 ${className}`}>{children}</div>;
}
