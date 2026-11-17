// Centralised API client. Every backend call in the app goes through here.

import type {
  FramePayload,
  Health,
  HistoryResponse,
  Jutsu,
  JutsuResponse,
  PredictRequest,
  PredictResponse,
  SampleBatchResult,
  SampleList,
  SequenceResetResponse,
  Settings,
  SignsResponse,
  TrainingJob,
  TrainingStatus,
} from '@/types/api';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '/api';

export type ApiErrorKind = 'network' | 'timeout' | 'http';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code: string;

  constructor(kind: ApiErrorKind, message: string, status = 0, code: string = kind) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }

  /** True when the backend could not be reached at all. */
  get offline(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.status === 502 || this.status === 504;
  }
}

export const OFFLINE_MESSAGE =
  'Cannot reach the game server. Start the backend (start.bat, or uvicorn on port 8000) and try again.';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Send this binary body as-is (with its own content type) instead of JSON. */
  raw?: Blob;
  /** Return the response body as a Blob instead of parsed JSON. */
  expectBlob?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, timeoutMs = 10_000, signal, raw, expectBlob = false } = options;
  const search = query
    ? `?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`
    : '';

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}${search}`, {
      method,
      headers: raw ? { 'Content-Type': raw.type || 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
      cache: expectBlob ? 'no-store' : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error; // caller cancelled: let them handle it
    if (timedOut) throw new ApiError('timeout', 'The game server took too long to respond.');
    throw new ApiError('network', OFFLINE_MESSAGE);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  if (response.status === 204) return undefined as T;
  if (expectBlob && response.ok) return (await response.blob()) as T;

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    // The Vite proxy answers 500/502 with a non-JSON body when FastAPI is down.
    if (!error && response.status >= 500) throw new ApiError('http', OFFLINE_MESSAGE, 502, 'backend_unreachable');
    throw new ApiError(
      'http',
      error?.message ?? `Request failed (${response.status}).`,
      response.status,
      error?.code ?? 'http_error',
    );
  }
  if (payload === null) throw new ApiError('http', OFFLINE_MESSAGE, 502, 'backend_unreachable');
  return payload as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

export const api = {
  health: (signal?: AbortSignal) => request<Health>('/health', { timeoutMs: 4000, signal }),

  signs: () => request<SignsResponse>('/signs'),
  jutsu: () => request<JutsuResponse>('/jutsu'),
  updateJutsuSequence: (jutsuId: string, sequence: string[]) =>
    request<Jutsu>(`/jutsu/${encodeURIComponent(jutsuId)}`, { method: 'PUT', body: { sequence } }),

  predict: (body: PredictRequest, signal?: AbortSignal) =>
    request<PredictResponse>('/predict', { method: 'POST', body, timeoutMs: 4000, signal }),
  /** Pause or resume a session: the time between signs freezes and signs are ignored while paused. */
  pauseSequence: (sessionId: string, paused: boolean) =>
    request<SequenceResetResponse>('/sequence/pause', {
      method: 'POST',
      body: { session_id: sessionId, paused },
    }),
  resetSequence: (sessionId: string, resetScore: boolean) =>
    request<SequenceResetResponse>('/sequence/reset', {
      method: 'POST',
      body: { session_id: sessionId, reset_score: resetScore },
    }),

  trainingStatus: () => request<TrainingStatus>('/training/status'),
  saveSamples: (label: string, captureGroup: string, samples: FramePayload[]) =>
    request<SampleBatchResult>('/training/samples', {
      method: 'POST',
      body: { label, capture_group: captureGroup, samples },
      timeoutMs: 20_000,
    }),
  listSamples: (label: string, limit = 48) =>
    request<SampleList>('/training/samples', { query: { label, limit } }),
  deleteSample: (label: string, sampleId: string) =>
    request<{ deleted: number; total_for_label: number }>(
      `/training/samples/${encodeURIComponent(label)}/${encodeURIComponent(sampleId)}`,
      { method: 'DELETE' },
    ),
  clearSamples: (label: string) =>
    request<{ deleted: number; total_for_label: number }>(`/training/samples/${encodeURIComponent(label)}`, {
      method: 'DELETE',
    }),
  train: () => request<{ started: boolean; message: string; job: TrainingJob }>('/training/train', { method: 'POST' }),

  history: () => request<HistoryResponse>('/history'),
  clearHistory: () => request<void>('/history', { method: 'DELETE' }),

  settings: () => request<Settings>('/settings'),
  updateSettings: (changes: Partial<Settings>) => request<Settings>('/settings', { method: 'PUT', body: changes }),
  resetSettings: () => request<Settings>('/settings/reset', { method: 'POST' }),
};
