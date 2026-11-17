// Types mirroring the FastAPI schemas (backend/app/schemas).

export type Handedness = 'Left' | 'Right';
export type Point3 = [number, number, number];

export interface HandPayload {
  handedness: Handedness;
  score: number;
  landmarks: Point3[];
}

export interface FramePayload {
  hands: HandPayload[];
  image_width: number;
  image_height: number;
}

// -- prediction / gameplay ----------------------------------------------------

export type PredictionStatus = 'no_hands' | 'model_missing' | 'unknown' | 'recognizing' | 'recognized';
export type GameEventType =
  | 'sign_accepted'
  | 'jutsu_activated'
  | 'incorrect_sequence'
  | 'no_match'
  | 'sequence_timeout'
  | 'person_required';

export interface PredictRequest extends FramePayload {
  session_id: string;
  track_sequence: boolean;
  target_jutsu_id: string | null;
  /** Ask for per-finger measurements and every sign's score. */
  debug?: boolean;
  /** Whether a person is visible to the camera (local check). Shadow Clone needs one. */
  person_visible?: boolean;
}

export interface TopPrediction {
  sign: string;
  confidence: number;
}

export type RecognitionEngine = 'builtin' | 'trained' | 'none';

export interface Prediction {
  status: PredictionStatus;
  sign: string | null;
  confidence: number;
  threshold: number;
  stability: number;
  message: string | null;
  top: TopPrediction[];
  engine: RecognitionEngine;
  /** The player's own calibration samples contributed to this sign. */
  calibrated: boolean;
  /** For a near miss: the closest sign and what is off. Never a recognised sign. */
  closest: string | null;
  hint: string | null;
}

export interface HandDebug {
  slot: 'left' | 'right';
  extension: number[];
  fingers: Array<'extended' | 'half' | 'curled'>;
  axis_deg: number;
}

export interface SignScore {
  sign: string;
  score: number;
  template: number | null;
  calibration: number | null;
}

export interface RecognitionDebug {
  engine: RecognitionEngine;
  hands: HandDebug[];
  pair: Record<string, number>;
  scores: SignScore[];
  unmet: string[];
  margin: number;
  margin_required: number;
  idle_similarity: number | null;
  calibrated_signs: string[];
  hold_ms: number;
}

export interface SequenceCandidate {
  jutsu_id: string;
  matched: number;
  total: number;
}

export interface SequenceState {
  signs: string[];
  candidates: SequenceCandidate[];
  target_jutsu_id: string | null;
  timeout_ms: number;
  time_remaining_ms: number | null;
  locked: boolean;
  /** The game is paused: the countdown is frozen and signs are ignored. */
  paused: boolean;
}

export interface GameState {
  score: number;
  combo: number;
  best_combo: number;
  activations: number;
  incorrect: number;
  signs_accepted: number;
  accuracy: number | null;
  next_multiplier: number;
}

export interface AchievementUnlock {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export interface Activation {
  activation_id: number;
  jutsu_id: string;
  jutsu_name: string;
  element: string;
  effect: string;
  base_points: number;
  multiplier: number;
  points: number;
  combo: number;
  sequence: string[];
  new_achievements: AchievementUnlock[];
}

export interface GameEvent {
  id: number;
  type: GameEventType;
  sign: string | null;
  signs: string[];
  jutsu_id: string | null;
  message: string;
  activation: Activation | null;
}

export interface PredictResponse {
  session_id: string;
  model_ready: boolean;
  hands: { count: number; left: boolean; right: boolean };
  prediction: Prediction;
  sequence: SequenceState;
  game: GameState;
  event: GameEvent | null;
  debug: RecognitionDebug | null;
}

export interface SequenceResetResponse {
  session_id: string;
  sequence: SequenceState;
  game: GameState;
}

// -- catalogue ----------------------------------------------------------------

export type FingerState = 'up' | 'fold' | 'lock';
export type RecognitionStatus = 'untrained' | 'collecting' | 'ready_to_train' | 'trained';

export interface ClassMetrics {
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface SignDiagramData {
  left: FingerState[];
  right: FingerState[];
  layout: string;
  caption: string;
}

export interface Sign {
  id: string;
  name: string;
  kanji: string;
  order: number;
  description: string;
  how_to: string[];
  hands_required: number;
  diagram: SignDiagramData;
  recognition_status: RecognitionStatus;
  recognition_source: 'builtin' | 'calibrated' | 'trained' | 'unavailable';
  calibration_samples: number;
  calibration_min_samples: number;
  sample_count: number;
  min_samples: number;
  recommended_samples: number;
  metrics: ClassMetrics | null;
  used_in: string[];
  reference_hands: HandPayload[] | null;
  reference_aspect: number | null;
}

export interface SignsResponse {
  signs: Sign[];
  model_ready: boolean;
  recognition_engine: RecognitionEngine;
  trained_at: string | null;
  evaluation_note: string | null;
}

export type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced';

export interface Jutsu {
  /** Built from the live camera image of the player, so they must be in frame. */
  requires_person?: boolean;
  id: string;
  name: string;
  subtitle: string;
  element: string;
  difficulty: Difficulty;
  points: number;
  effect: string;
  description: string;
  sequence: string[];
  unlocked: boolean;
  missing_signs: string[];
  times_activated: number;
}

export interface JutsuResponse {
  jutsu: Jutsu[];
  note: string;
}

// -- training -----------------------------------------------------------------

export interface StoredSample extends FramePayload {
  id: string;
  label: string;
  created_at: string;
  capture_group: string;
}

export interface SampleList {
  label: string;
  total: number;
  samples: StoredSample[];
}

export interface SampleBatchResult {
  label: string;
  saved: number;
  rejected: number;
  total_for_label: number;
  message: string;
}

export interface Evaluation {
  method: string;
  folds: number;
  group_aware: boolean;
  accuracy: number;
  macro_f1: number;
  per_class: Record<string, ClassMetrics>;
  confusion_matrix: { labels: string[]; matrix: number[][] };
  note: string;
}

export interface ModelInfo {
  ready: boolean;
  message: string;
  trained_at: string | null;
  classes: string[];
  trained_signs: string[];
  samples_per_class: Record<string, number>;
  skipped_classes: Record<string, number>;
  total_samples: number;
  feature_count: number;
  evaluation: Evaluation | null;
  evaluation_note: string | null;
}

export interface LabelStatus {
  label: string;
  name: string;
  is_idle: boolean;
  sample_count: number;
  capture_groups: number;
  eligible: boolean;
  in_model: boolean;
}

export interface TrainingJob {
  state: 'idle' | 'running' | 'completed' | 'failed';
  started_at: string | null;
  finished_at: string | null;
  message: string | null;
}

export interface TrainingStatus {
  min_samples_per_class: number;
  recommended_samples_per_class: number;
  min_classes: number;
  total_samples: number;
  labels: LabelStatus[];
  eligible_classes: number;
  can_train: boolean;
  blocking_reason: string | null;
  dataset_changed_since_training: boolean;
  job: TrainingJob;
  model: ModelInfo;
}

// -- history / settings / health ----------------------------------------------

export interface ActivationRecord {
  id: number;
  jutsu_id: string;
  jutsu_name: string;
  element: string;
  points: number;
  combo: number;
  sequence: string[];
  created_at: string;
}

export interface PlayerStats {
  total_activations: number;
  total_score: number;
  best_combo: number;
  incorrect_sequences: number;
  accuracy: number | null;
  distinct_jutsu: number;
  jutsu_total: number;
  per_jutsu: Record<string, number>;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  metric: string;
  threshold: number;
  progress: number;
  unlocked: boolean;
  unlocked_at: string | null;
}

export interface TrainingProgress {
  signs_total: number;
  signs_with_samples: number;
  signs_trained: number;
  total_samples: number;
  model_ready: boolean;
}

export interface HistoryResponse {
  activations: ActivationRecord[];
  stats: PlayerStats;
  achievements: Achievement[];
  training: TrainingProgress;
}

export type EffectsQuality = 'low' | 'medium' | 'high';
export type ThemeName = 'crimson' | 'azure' | 'violet';

export interface Settings {
  camera_device_id: string | null;
  mirror_camera: boolean;
  show_landmarks: boolean;
  sound_enabled: boolean;
  effects_quality: EffectsQuality;
  recognition_sensitivity: number;
  recognition_mode: 'easy' | 'balanced' | 'strict';
  hold_ms: number;
  recognition_engine: 'auto' | 'builtin' | 'trained';
  debug_overlay: boolean;
  game_mode: 'easy' | 'normal' | 'challenge';
  clone_count: 2 | 3 | 5 | 7;
  clone_duration: 'short' | 'normal' | 'long';
  clone_smoke: boolean;
  clone_sound: boolean;
  clone_formation: CloneFormation;
  sequence_timeout_seconds: number;
  theme: ThemeName;
}

export type CloneFormation = 'surround' | 'line' | 'arrow';

export interface Health {
  status: 'ok';
  version: string;
  model_ready: boolean;
  model_message: string;
  trained_signs: string[];
  recognition_engine: RecognitionEngine;
  recognizable_signs: string[];
  calibrated_signs: string[];
  signs_total: number;
  jutsu_total: number;
  total_samples: number;
  training_state: string;
}
