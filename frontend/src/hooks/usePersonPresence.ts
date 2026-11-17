import { useEffect, useState, type RefObject } from 'react';

import { detectPerson } from '@/services/personSegmentation';

export type PresenceStatus = 'off' | 'checking' | 'present' | 'absent' | 'unavailable';

const CHECK_EVERY_MS = 600;

/**
 * Is a person standing in front of the camera? Checks a small (256 px) copy of
 * the current frame with local person segmentation about every 0.6 s - frames
 * never leave the browser. ``unavailable`` means the segmentation model could
 * not be loaded (callers can fall back to hand detection).
 */
export function usePersonPresence(videoRef: RefObject<HTMLVideoElement>, active: boolean): PresenceStatus {
  const [status, setStatus] = useState<PresenceStatus>('off');

  useEffect(() => {
    if (!active) {
      setStatus('off');
      return;
    }
    let cancelled = false;
    let timer = 0;
    setStatus((current) => (current === 'off' ? 'checking' : current));

    const check = async () => {
      const result = await detectPerson(videoRef.current).catch(() => ({ status: 'unavailable' as const }));
      if (cancelled) return;
      setStatus(result.status);
      // One check at a time; the next starts only after this one finished.
      timer = window.setTimeout(() => void check(), CHECK_EVERY_MS);
    };
    void check();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, videoRef]);

  return status;
}
