import { useCallback, useEffect, useRef, useState } from 'react';

import { toFramePayload, type TrackedFrame } from '@/lib/hands';
import { ApiError, api, errorMessage } from '@/services/api';
import type { GameEvent, PredictResponse } from '@/types/api';

interface Options {
  sessionId: string;
  /** false = classify only (Training Studio live test). */
  trackSequence: boolean;
  targetJutsuId?: string | null;
  onEvent?: (event: GameEvent, response: PredictResponse) => void;
  /** Minimum time between requests. One request is in flight at most. */
  intervalMs?: number;
  /** Ask the backend for per-finger measurements and all sign scores. */
  debug?: boolean;
  /** Tell the backend whether a person is visible (null = unknown, not sent). */
  personVisible?: boolean | null;
}

const OFFLINE_RETRY_MS = 1500;
const IDLE_INTERVAL_MS = 300;

/**
 * Streams landmark frames to the backend and exposes its authoritative answer.
 * Only landmarks are sent - never video. Requests are throttled and never overlap.
 */
export function usePredictionLoop({ sessionId, trackSequence, targetJutsuId = null, onEvent, intervalMs = 70, debug = false, personVisible = null }: Options) {
  const [response, setResponse] = useState<PredictResponse | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = useRef({ trackSequence, targetJutsuId, onEvent, intervalMs, debug, personVisible });
  live.current = { trackSequence, targetJutsuId, onEvent, intervalMs, debug, personVisible };

  const state = useRef({ inFlight: false, lastSent: 0, offline: false, lastEventId: 0, generation: 0, mounted: true });

  useEffect(() => {
    const current = state.current;
    current.mounted = true;
    return () => {
      current.mounted = false;
    };
  }, []);

  const submit = useCallback(
    (frame: TrackedFrame) => {
      const current = state.current;
      const now = performance.now();
      // Without hands there is nothing to recognise; a slow heartbeat still lets
      // the server time out an unfinished sequence.
      const wait = current.offline ? OFFLINE_RETRY_MS : frame.hands.length === 0 ? Math.max(live.current.intervalMs, IDLE_INTERVAL_MS) : live.current.intervalMs;
      if (current.inFlight || now - current.lastSent < wait) return;
      current.inFlight = true;
      current.lastSent = now;
      const generation = current.generation;

      api
        .predict({
          session_id: sessionId,
          track_sequence: live.current.trackSequence,
          target_jutsu_id: live.current.targetJutsuId,
          ...(live.current.debug ? { debug: true } : {}),
          ...(live.current.personVisible === null ? {} : { person_visible: live.current.personVisible }),
          ...toFramePayload(frame),
        })
        .then((result) => {
          if (!current.mounted || generation !== current.generation) return;
          if (current.offline) {
            current.offline = false;
            setOffline(false);
          }
          setError(null);
          setResponse(result);
          if (result.event && result.event.id !== current.lastEventId) {
            current.lastEventId = result.event.id;
            live.current.onEvent?.(result.event, result);
          }
        })
        .catch((failure: unknown) => {
          if (!current.mounted || generation !== current.generation) return;
          if (failure instanceof ApiError && failure.offline) {
            if (!current.offline) {
              current.offline = true;
              setOffline(true);
            }
          } else {
            setError(errorMessage(failure));
          }
        })
        .finally(() => {
          current.inFlight = false;
        });
    },
    [sessionId],
  );

  /** Forget the last answer (e.g. when the camera stops) and ignore late responses. */
  const clear = useCallback(() => {
    state.current.generation += 1;
    setResponse(null);
    setError(null);
  }, []);

  return { response, offline, error, submit, clear, setResponse };
}
