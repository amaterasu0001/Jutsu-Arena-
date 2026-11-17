import { describe, expect, it, vi } from 'vitest';

import { ApiError, api, errorMessage, OFFLINE_MESSAGE } from '@/services/api';

function respond(status: number, body?: unknown, raw?: string): Response {
  const text = raw ?? (body === undefined ? '' : JSON.stringify(body));
  return new Response(status === 204 ? null : text, { status });
}

function stubFetch(implementation: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  const mock = vi.fn(implementation);
  vi.stubGlobal('fetch', mock);
  return mock;
}

async function failure(call: () => Promise<unknown>): Promise<ApiError> {
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('expected the request to fail');
}

describe('api client', () => {
  it('returns parsed JSON on success and calls the /api prefix', async () => {
    const fetchMock = stubFetch(async () => respond(200, { status: 'ok', model_ready: false }));
    await expect(api.health()).resolves.toMatchObject({ status: 'ok' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/health');
  });

  it('sends JSON bodies for writes', async () => {
    const fetchMock = stubFetch(async () => respond(200, { theme: 'azure' }));
    await api.updateSettings({ theme: 'azure' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/settings');
    expect(init).toMatchObject({ method: 'PUT', body: JSON.stringify({ theme: 'azure' }) });
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('encodes query parameters', async () => {
    const fetchMock = stubFetch(async () => respond(200, { label: 'tiger', total: 0, samples: [] }));
    await api.listSamples('tiger', 24);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/training/samples?label=tiger&limit=24');
  });

  it('handles 204 responses', async () => {
    stubFetch(async () => respond(204));
    await expect(api.clearHistory()).resolves.toBeUndefined();
  });

  it('turns a network failure into an offline error with guidance', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const error = await failure(() => api.signs());
    expect(error.kind).toBe('network');
    expect(error.offline).toBe(true);
    expect(error.message).toBe(OFFLINE_MESSAGE);
  });

  it('surfaces the server message for validation errors', async () => {
    stubFetch(async () => respond(422, { error: { code: 'validation_error', message: 'Invalid request data (hands.0.landmarks): too short' } }));
    const error = await failure(() => api.jutsu());
    expect(error.status).toBe(422);
    expect(error.code).toBe('validation_error');
    expect(error.offline).toBe(false);
    expect(errorMessage(error)).toContain('hands.0.landmarks');
  });

  it('surfaces domain errors such as insufficient training data', async () => {
    stubFetch(async () => respond(400, { error: { code: 'insufficient_data', message: 'The dataset is empty.' } }));
    const error = await failure(() => api.train());
    expect(error.code).toBe('insufficient_data');
    expect(error.message).toBe('The dataset is empty.');
  });

  it('treats a proxy error page (backend down) as offline', async () => {
    stubFetch(async () => respond(500, undefined, 'Internal Server Error'));
    const error = await failure(() => api.history());
    expect(error.offline).toBe(true);
    expect(error.message).toBe(OFFLINE_MESSAGE);
  });

  it('treats an HTML page returned in place of JSON as offline', async () => {
    stubFetch(async () => respond(200, undefined, '<!doctype html><html></html>'));
    const error = await failure(() => api.settings());
    expect(error.offline).toBe(true);
  });

  it('times out slow requests', async () => {
    vi.useFakeTimers();
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const pending = failure(() => api.health());
    await vi.advanceTimersByTimeAsync(5000);
    const error = await pending;
    vi.useRealTimers();
    expect(error.kind).toBe('timeout');
    expect(error.offline).toBe(true);
  });

  it('gives a readable message for unknown errors', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('nope')).toBe('Something went wrong.');
  });
});
