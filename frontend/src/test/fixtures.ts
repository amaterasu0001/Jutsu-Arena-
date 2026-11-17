import { vi } from 'vitest';

import type {
  GameState,
  Health,
  HistoryResponse,
  JutsuResponse,
  PredictResponse,
  Settings,
  SignsResponse,
  TrainingStatus,
} from '@/types/api';

export const health: Health = {
  status: 'ok',
  version: '1.0.0',
  model_ready: false,
  model_message: 'No trained model yet.',
  trained_signs: [],
  recognition_engine: 'builtin',
  recognizable_signs: ['tiger', 'snake', 'ram'],
  calibrated_signs: [],
  signs_total: 12,
  jutsu_total: 8,
  total_samples: 0,
  training_state: 'idle',
};

export const settings: Settings = {
  camera_device_id: null,
  mirror_camera: true,
  show_landmarks: true,
  sound_enabled: false,
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

const sign = (id: string, name: string, kanji: string, order: number) => ({
  id,
  name,
  kanji,
  order,
  description: `${name} description`,
  how_to: ['Step one', 'Step two'],
  hands_required: 2,
  diagram: { left: ['up', 'up', 'lock', 'lock', 'lock'], right: ['up', 'up', 'lock', 'lock', 'lock'], layout: 'clasped', caption: `${name} caption` },
  recognition_status: 'untrained',
  recognition_source: 'builtin',
  calibration_samples: 0,
  calibration_min_samples: 8,
  sample_count: 0,
  min_samples: 20,
  recommended_samples: 80,
  metrics: null,
  used_in: ['Fireball Jutsu'],
  reference_hands: null,
  reference_aspect: null,
});

export const signs = {
  signs: [sign('tiger', 'Tiger', '寅', 3), sign('snake', 'Snake', '巳', 6), sign('ram', 'Ram', '未', 8)],
  model_ready: false,
  recognition_engine: 'builtin',
  trained_at: null,
  evaluation_note: null,
} as SignsResponse;

export const jutsu: JutsuResponse = {
  note: 'Sequences are game-defined and configurable.',
  jutsu: [
    {
      id: 'fireball',
      name: 'Fireball Jutsu',
      subtitle: 'Fire Style',
      element: 'fire',
      difficulty: 'Beginner',
      points: 100,
      effect: 'fireball',
      description: 'A roaring sphere of flame.',
      sequence: ['tiger', 'snake', 'ram'],
      unlocked: true,
      missing_signs: [],
      times_activated: 0,
    },
  ],
};

export const history: HistoryResponse = {
  activations: [],
  stats: {
    total_activations: 0,
    total_score: 0,
    best_combo: 0,
    incorrect_sequences: 0,
    accuracy: null,
    distinct_jutsu: 0,
    jutsu_total: 8,
    per_jutsu: {},
  },
  achievements: [
    { id: 'first_spark', name: 'First Spark', description: 'Activate your first jutsu.', icon: 'sparkles', metric: 'total_activations', threshold: 1, progress: 0, unlocked: false, unlocked_at: null },
  ],
  training: { signs_total: 12, signs_with_samples: 0, signs_trained: 0, total_samples: 0, model_ready: false },
};

export const trainingStatus: TrainingStatus = {
  min_samples_per_class: 20,
  recommended_samples_per_class: 80,
  min_classes: 2,
  total_samples: 0,
  labels: [
    { label: 'tiger', name: 'Tiger', is_idle: false, sample_count: 0, capture_groups: 0, eligible: false, in_model: false },
    { label: 'none', name: 'Idle (no sign)', is_idle: true, sample_count: 0, capture_groups: 0, eligible: false, in_model: false },
  ],
  eligible_classes: 0,
  can_train: false,
  blocking_reason: 'The dataset is empty. Capture samples for at least two hand signs first.',
  dataset_changed_since_training: false,
  job: { state: 'idle', started_at: null, finished_at: null, message: null },
  model: {
    ready: false,
    message: 'No trained model yet.',
    trained_at: null,
    classes: [],
    trained_signs: [],
    samples_per_class: {},
    skipped_classes: {},
    total_samples: 0,
    feature_count: 0,
    evaluation: null,
    evaluation_note: null,
  },
};

export const game: GameState = { score: 0, combo: 0, best_combo: 0, activations: 0, incorrect: 0, signs_accepted: 0, accuracy: null, next_multiplier: 1 };

export function predictResponse(overrides: Partial<PredictResponse> = {}): PredictResponse {
  return {
    session_id: 'test-session',
    model_ready: true,
    hands: { count: 2, left: true, right: true },
    prediction: {
      status: 'unknown',
      sign: null,
      confidence: 0.3,
      threshold: 0.56,
      stability: 0,
      message: null,
      top: [],
      engine: 'builtin',
      calibrated: false,
      closest: null,
      hint: null,
    },
    sequence: { signs: [], candidates: [], target_jutsu_id: null, timeout_ms: 20000, time_remaining_ms: null, locked: false, paused: false },
    game,
    event: null,
    debug: null,
    ...overrides,
  };
}

/** A stand-in for the `api` object where every call resolves with fixture data. */
export function mockApi() {
  return {
    health: vi.fn().mockResolvedValue(health),
    signs: vi.fn().mockResolvedValue(signs),
    jutsu: vi.fn().mockResolvedValue(jutsu),
    updateJutsuSequence: vi.fn(),
    predict: vi.fn().mockResolvedValue(predictResponse()),
    resetSequence: vi.fn(),
    pauseSequence: vi.fn(),
    trainingStatus: vi.fn().mockResolvedValue(trainingStatus),
    saveSamples: vi.fn(),
    listSamples: vi.fn().mockResolvedValue({ label: 'tiger', total: 0, samples: [] }),
    deleteSample: vi.fn(),
    clearSamples: vi.fn(),
    train: vi.fn(),
    history: vi.fn().mockResolvedValue(history),
    clearHistory: vi.fn(),
    settings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockImplementation(async (changes: Partial<Settings>) => ({ ...settings, ...changes })),
    resetSettings: vi.fn().mockResolvedValue(settings),
  };
}
