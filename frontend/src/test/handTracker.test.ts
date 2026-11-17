import { describe, expect, it } from 'vitest';

import { describeLoadFailure } from '@/hooks/useHandTracker';

describe('describeLoadFailure', () => {
  it('identifies a library that the dev server failed to deliver', () => {
    const failure = new TypeError(
      'Failed to fetch dynamically imported module: http://localhost:5173/node_modules/.vite/deps/@mediapipe_tasks-vision.js?v=fbc73274',
    );
    const message = describeLoadFailure(failure);
    expect(message).toMatch(/library could not be loaded from the dev server/i);
    expect(message).not.toMatch(/setup script/i);
  });

  it('keeps the underlying reason for model or runtime failures', () => {
    const message = describeLoadFailure(new Error('Failed to fetch model: /models/hand_landmarker.task'));
    expect(message).toContain('Failed to fetch model: /models/hand_landmarker.task');
    expect(message).toMatch(/setup script/i);
  });

  it('handles non-Error values', () => {
    expect(describeLoadFailure(undefined)).toContain('unknown error');
    expect(describeLoadFailure('wasm aborted')).toContain('wasm aborted');
  });
});
