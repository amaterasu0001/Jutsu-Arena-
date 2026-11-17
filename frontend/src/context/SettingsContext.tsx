import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useBackend } from '@/context/BackendContext';
import { useToast } from '@/context/ToastContext';
import { api, errorMessage } from '@/services/api';
import { sound } from '@/services/sound';
import type { Settings } from '@/types/api';

export const DEFAULT_SETTINGS: Settings = {
  camera_device_id: null,
  mirror_camera: true,
  show_landmarks: true,
  sound_enabled: true,
  effects_quality: 'high',
  recognition_sensitivity: 50,
  recognition_mode: 'easy',
  hold_ms: 300,
  recognition_engine: 'auto',
  debug_overlay: false,
  game_mode: 'normal',
  clone_count: 5,
  clone_duration: 'normal',
  clone_smoke: true,
  clone_sound: true,
  clone_formation: 'surround',
  sequence_timeout_seconds: 20,
  theme: 'crimson',
};

interface SettingsState {
  settings: Settings;
  /** True once the saved settings have been loaded from the server. */
  loaded: boolean;
  update: (changes: Partial<Settings>) => Promise<void>;
  reset: () => Promise<void>;
}

const SettingsContext = createContext<SettingsState>({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  update: async () => undefined,
  reset: async () => undefined,
});

/** Numeric quality multiplier used by particle effects. */
export const QUALITY_SCALE: Record<Settings['effects_quality'], number> = { low: 0.4, medium: 0.7, high: 1 };

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { online } = useBackend();
  const { push } = useToast();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Load saved settings when the server is (or becomes) reachable.
  useEffect(() => {
    if (!online || loaded) return;
    let cancelled = false;
    api
      .settings()
      .then((saved) => {
        if (cancelled) return;
        setSettings(saved);
        setLoaded(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [online, loaded]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    sound.setEnabled(settings.sound_enabled);
  }, [settings.sound_enabled]);

  const update = useCallback(
    async (changes: Partial<Settings>) => {
      const previous = settingsRef.current;
      setSettings({ ...previous, ...changes }); // apply immediately, then persist
      try {
        const saved = await api.updateSettings(changes);
        setSettings(saved);
      } catch (error) {
        setSettings(previous);
        push('error', 'Settings were not saved', errorMessage(error));
      }
    },
    [push],
  );

  const reset = useCallback(async () => {
    try {
      setSettings(await api.resetSettings());
      push('success', 'Settings reset', 'All preferences are back to their defaults.');
    } catch (error) {
      push('error', 'Could not reset settings', errorMessage(error));
    }
  }, [push]);

  const value = useMemo(() => ({ settings, loaded, update, reset }), [settings, loaded, update, reset]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsState {
  return useContext(SettingsContext);
}
