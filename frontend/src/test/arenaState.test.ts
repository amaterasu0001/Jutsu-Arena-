import { describe, expect, it } from 'vitest';

import { currentSignLabel, deriveArenaPhase, PHASE_COPY, type ArenaInputs } from '@/lib/arenaState';
import type { PredictionStatus } from '@/types/api';

import { predictResponse } from './fixtures';

const basePrediction = predictResponse().prediction;

const base: ArenaInputs = { camera: 'active', tracker: 'ready', handCount: 2, offline: false, response: null, activationPlaying: false };

const withPrediction = (status: PredictionStatus, sign: string | null = null, signs: string[] = []) =>
  predictResponse({
    prediction: { ...basePrediction, status, sign, confidence: 0.9, stability: 0.5 },
    sequence: { signs, candidates: [], target_jutsu_id: null, timeout_ms: 20000, time_remaining_ms: 4000, locked: false, paused: false },
  });

const name = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

describe('deriveArenaPhase', () => {
  it('covers the camera lifecycle', () => {
    expect(deriveArenaPhase({ ...base, camera: 'idle' })).toBe('camera_off');
    expect(deriveArenaPhase({ ...base, camera: 'starting' })).toBe('camera_starting');
    expect(deriveArenaPhase({ ...base, camera: 'denied' })).toBe('permission_denied');
    for (const camera of ['unavailable', 'in_use', 'unsupported', 'error'] as const) {
      expect(deriveArenaPhase({ ...base, camera })).toBe('camera_error');
    }
  });

  it('waits for the hand tracker before anything else', () => {
    expect(deriveArenaPhase({ ...base, tracker: 'loading' })).toBe('tracker_loading');
    expect(deriveArenaPhase({ ...base, tracker: 'idle' })).toBe('tracker_loading');
    expect(deriveArenaPhase({ ...base, tracker: 'error' })).toBe('tracker_error');
  });

  it('reports a missing backend or model before gameplay states', () => {
    expect(deriveArenaPhase({ ...base, offline: true, response: withPrediction('recognized', 'tiger') })).toBe('backend_offline');
    expect(deriveArenaPhase({ ...base, response: predictResponse({ model_ready: false }) })).toBe('model_missing');
  });

  it('walks through a full recognition: waiting -> detected -> recognizing -> recognized', () => {
    expect(deriveArenaPhase({ ...base, handCount: 0, response: withPrediction('no_hands') })).toBe('waiting_for_hands');
    expect(deriveArenaPhase({ ...base, response: null })).toBe('hands_detected');
    expect(deriveArenaPhase({ ...base, response: withPrediction('unknown') })).toBe('hands_detected');
    expect(deriveArenaPhase({ ...base, response: withPrediction('recognizing', 'tiger') })).toBe('recognizing');
    expect(deriveArenaPhase({ ...base, response: withPrediction('recognized', 'tiger') })).toBe('sign_recognized');
  });

  it('asks for the second hand when only one is visible', () => {
    expect(deriveArenaPhase({ ...base, handCount: 1, response: withPrediction('unknown') })).toBe('one_hand');
    expect(PHASE_COPY.one_hand.label).toBe('One hand detected');
    expect(PHASE_COPY.hands_detected.label).toBe('Both hands detected');
  });

  it('shows the sequence as in progress between signs', () => {
    expect(deriveArenaPhase({ ...base, response: withPrediction('unknown', null, ['tiger']) })).toBe('sequence_in_progress');
  });

  it('shows the activation while its effect plays, then returns to play', () => {
    const response = withPrediction('recognized', 'ram');
    expect(deriveArenaPhase({ ...base, response, activationPlaying: true })).toBe('jutsu_activated');
    expect(deriveArenaPhase({ ...base, response, activationPlaying: false })).toBe('sign_recognized');
  });

  it('never shows an activation while the camera is off', () => {
    expect(deriveArenaPhase({ ...base, camera: 'idle', activationPlaying: true })).toBe('camera_off');
  });

  it('has copy for every phase', () => {
    for (const copy of Object.values(PHASE_COPY)) {
      expect(copy.label).toBeTruthy();
      expect(copy.hint).toBeTruthy();
    }
  });
});

describe('currentSignLabel', () => {
  it('shows the sign only when the backend is confident', () => {
    expect(currentSignLabel(withPrediction('recognizing', 'tiger'), 2, name)).toBe('TIGER');
    expect(currentSignLabel(withPrediction('recognized', 'snake'), 2, name)).toBe('SNAKE');
  });

  it('shows UNKNOWN SIGN for low-confidence frames', () => {
    expect(currentSignLabel(withPrediction('unknown'), 2, name)).toBe('UNKNOWN SIGN');
  });

  it('shows nothing without hands, a response, or a model', () => {
    expect(currentSignLabel(null, 2, name)).toBe('—');
    expect(currentSignLabel(withPrediction('recognized', 'tiger'), 0, name)).toBe('—');
    expect(currentSignLabel(withPrediction('model_missing'), 2, name)).toBe('—');
    expect(currentSignLabel(withPrediction('no_hands'), 2, name)).toBe('—');
  });
});
