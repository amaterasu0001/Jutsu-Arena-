// Pure derivation of what the arena should show. Kept free of React so the
// state transitions can be unit-tested.

import type { CameraStatus } from '@/hooks/useCamera';
import type { TrackerStatus } from '@/hooks/useHandTracker';
import type { PredictResponse } from '@/types/api';

export type ArenaPhase =
  | 'camera_off'
  | 'camera_starting'
  | 'permission_denied'
  | 'camera_error'
  | 'tracker_loading'
  | 'tracker_error'
  | 'backend_offline'
  | 'model_missing'
  | 'waiting_for_hands'
  | 'one_hand'
  | 'hands_detected'
  | 'recognizing'
  | 'sign_recognized'
  | 'sequence_in_progress'
  | 'jutsu_activated';

export interface ArenaInputs {
  camera: CameraStatus;
  tracker: TrackerStatus;
  handCount: number;
  offline: boolean;
  response: PredictResponse | null;
  /** True while an activation effect is on screen. */
  activationPlaying: boolean;
}

export function deriveArenaPhase(input: ArenaInputs): ArenaPhase {
  const { camera, tracker, handCount, offline, response, activationPlaying } = input;

  if (camera === 'denied') return 'permission_denied';
  if (camera === 'unavailable' || camera === 'in_use' || camera === 'unsupported' || camera === 'error') {
    return 'camera_error';
  }
  if (camera === 'idle') return 'camera_off';
  if (camera === 'starting') return 'camera_starting';

  if (tracker === 'error') return 'tracker_error';
  if (tracker !== 'ready') return 'tracker_loading';
  if (offline) return 'backend_offline';
  if (activationPlaying) return 'jutsu_activated';
  if (response && !response.model_ready) return 'model_missing';
  if (handCount === 0) return 'waiting_for_hands';
  if (handCount === 1) return 'one_hand';
  if (!response) return 'hands_detected';

  const status = response.prediction.status;
  if (status === 'recognized') return 'sign_recognized';
  if (status === 'recognizing') return 'recognizing';
  if (response.sequence.signs.length > 0) return 'sequence_in_progress';
  return 'hands_detected';
}

export type PhaseTone = 'idle' | 'info' | 'active' | 'success' | 'warning' | 'danger';

export const PHASE_COPY: Record<ArenaPhase, { label: string; hint: string; tone: PhaseTone }> = {
  camera_off: { label: 'Camera not started', hint: 'Start the camera to begin.', tone: 'idle' },
  camera_starting: { label: 'Starting camera', hint: 'Allow camera access if your browser asks.', tone: 'info' },
  permission_denied: { label: 'Camera permission denied', hint: 'Allow camera access for this site, then retry.', tone: 'danger' },
  camera_error: { label: 'Camera unavailable', hint: 'Check that a webcam is connected and not in use.', tone: 'danger' },
  tracker_loading: { label: 'Loading hand tracker', hint: 'Preparing the hand-landmark model.', tone: 'info' },
  tracker_error: { label: 'Hand tracker failed', hint: 'The hand-landmark model could not run.', tone: 'danger' },
  backend_offline: { label: 'Game server offline', hint: 'Start the backend to recognise signs.', tone: 'danger' },
  model_missing: { label: 'No trained model', hint: 'The recogniser is set to "trained model" — train one, or switch to Auto in Settings.', tone: 'warning' },
  waiting_for_hands: { label: 'No hands detected', hint: 'Raise both hands into the frame.', tone: 'info' },
  one_hand: { label: 'One hand detected', hint: 'Bring your other hand into view — every sign uses both.', tone: 'info' },
  hands_detected: { label: 'Both hands detected', hint: 'Form a hand sign and hold it for a moment.', tone: 'active' },
  recognizing: { label: 'Recognizing…', hint: 'Hold the sign steady.', tone: 'active' },
  sign_recognized: { label: 'Sign detected', hint: 'Relax your hands, then form the next sign.', tone: 'success' },
  sequence_in_progress: { label: 'Sequence in progress', hint: 'Form the next sign before the timer runs out.', tone: 'active' },
  jutsu_activated: { label: 'Jutsu activated', hint: 'Sequence complete.', tone: 'success' },
};

/** Text for the big "current sign" read-out. Never invents a sign. */
export function currentSignLabel(response: PredictResponse | null, handCount: number, signName: (id: string) => string): string {
  if (!response || handCount === 0) return '—';
  const { status, sign } = response.prediction;
  if ((status === 'recognizing' || status === 'recognized') && sign) return signName(sign).toUpperCase();
  if (status === 'unknown') return 'UNKNOWN SIGN';
  return '—';
}
