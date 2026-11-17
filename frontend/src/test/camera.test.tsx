import { act, renderHook, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { classifyCameraError, useCamera } from '@/hooks/useCamera';

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

function fakeStream() {
  const track = { stop: vi.fn(), addEventListener: vi.fn() };
  return { track, stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream };
}

function stubMediaDevices(getUserMedia: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) } });
}

function renderCamera(deviceId: string | null = null) {
  return renderHook(({ id }) => useCamera(useRef<HTMLVideoElement>(null), id), { initialProps: { id: deviceId } });
}

describe('classifyCameraError', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'unavailable'],
    ['OverconstrainedError', 'unavailable'],
    ['NotReadableError', 'in_use'],
    ['SomethingElse', 'error'],
  ])('maps %s to "%s"', (name, status) => {
    const failure = classifyCameraError(domError(name));
    expect(failure.status).toBe(status);
    expect(failure.message.length).toBeGreaterThan(20);
  });
});

describe('useCamera', () => {
  it('starts idle', () => {
    stubMediaDevices(vi.fn());
    const { result } = renderCamera();
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('becomes active when permission is granted', async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    stubMediaDevices(getUserMedia);
    const { result } = renderCamera();

    act(() => void result.current.start());
    expect(result.current.status).toBe('starting');
    await waitFor(() => expect(result.current.status).toBe('active'));
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
  });

  it('reports a denied permission with guidance', async () => {
    stubMediaDevices(vi.fn().mockRejectedValue(domError('NotAllowedError')));
    const { result } = renderCamera();
    await act(() => result.current.start());
    expect(result.current.status).toBe('denied');
    expect(result.current.error).toMatch(/permission was denied/i);
  });

  it('reports a missing camera', async () => {
    stubMediaDevices(vi.fn().mockRejectedValue(domError('NotFoundError')));
    const { result } = renderCamera();
    await act(() => result.current.start());
    expect(result.current.status).toBe('unavailable');
  });

  it('falls back to any camera when the saved one is gone', async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn().mockRejectedValueOnce(domError('OverconstrainedError')).mockResolvedValueOnce(stream);
    stubMediaDevices(getUserMedia);
    const { result } = renderCamera('unplugged-camera');
    await act(() => result.current.start());
    expect(result.current.status).toBe('active');
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[0][0].video.deviceId).toEqual({ exact: 'unplugged-camera' });
    expect(getUserMedia.mock.calls[1][0].video.deviceId).toBeUndefined();
  });

  it('reports an unsupported browser instead of throwing', async () => {
    vi.stubGlobal('navigator', {});
    const { result } = renderCamera();
    await act(() => result.current.start());
    expect(result.current.status).toBe('unsupported');
  });

  it('releases the webcam on stop', async () => {
    const { stream, track } = fakeStream();
    stubMediaDevices(vi.fn().mockResolvedValue(stream));
    const { result } = renderCamera();
    await act(() => result.current.start());
    act(() => result.current.stop());
    expect(track.stop).toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('releases the webcam when the page unmounts', async () => {
    const { stream, track } = fakeStream();
    stubMediaDevices(vi.fn().mockResolvedValue(stream));
    const { result, unmount } = renderCamera();
    await act(() => result.current.start());
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  it('discards a stream that arrives after stop was pressed', async () => {
    const { stream, track } = fakeStream();
    let grant: (value: MediaStream) => void = () => undefined;
    stubMediaDevices(vi.fn().mockReturnValue(new Promise<MediaStream>((resolve) => (grant = resolve))));
    const { result } = renderCamera();

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.start();
    });
    act(() => result.current.stop());
    await act(async () => {
      grant(stream);
      await pending;
    });
    expect(track.stop).toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });
});
