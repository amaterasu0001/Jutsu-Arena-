import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { api } from '@/services/api';
import type { Health } from '@/types/api';

interface BackendState {
  /** null until the first health check finishes. */
  online: boolean | null;
  health: Health | null;
  refresh: () => Promise<void>;
}

const BackendContext = createContext<BackendState>({ online: null, health: null, refresh: async () => undefined });

const ONLINE_POLL_MS = 8000;
const OFFLINE_POLL_MS = 2500;

/** Polls /api/health so every page can react when the server goes away or comes back. */
export function BackendProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState<boolean | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const onlineRef = useRef<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await api.health();
      onlineRef.current = true;
      setOnline(true);
      setHealth(result);
    } catch {
      onlineRef.current = false;
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    let timer = 0;
    let stopped = false;
    const tick = async () => {
      if (!document.hidden) await refresh();
      if (stopped) return;
      timer = window.setTimeout(tick, onlineRef.current ? ONLINE_POLL_MS : OFFLINE_POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [refresh]);

  const value = useMemo(() => ({ online, health, refresh }), [online, health, refresh]);
  return <BackendContext.Provider value={value}>{children}</BackendContext.Provider>;
}

export function useBackend(): BackendState {
  return useContext(BackendContext);
}
