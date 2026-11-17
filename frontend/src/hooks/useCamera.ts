import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export type CameraStatus =
  | 'idle'
  | 'starting'
  | 'active'
  | 'denied'
  | 'unavailable'
  | 'in_use'
  | 'unsupported'
  | 'error';

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface CameraFailure {
  status: Exclude<CameraStatus, 'idle' | 'starting' | 'active'>;
  message: string;
}

/** Translate a getUserMedia failure into a state and a message the player can act on. */
export function classifyCameraError(error: unknown): CameraFailure {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        status: 'denied',
        message:
          'Camera permission was denied. Allow camera access for this site in your browser (the camera icon in the address bar), then try again.',
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DevicesNotFoundError':
      return {
        status: 'unavailable',
        message: 'No camera was found. Connect a webcam and try again.',
      };
    case 'NotReadableError':
    case 'AbortError':
    case 'TrackStartError':
      return {
        status: 'in_use',
        message: 'The camera is busy. Close other apps or tabs that are using it, then try again.',
      };
    default:
      return {
        status: 'error',
        message: 'The camera could not be started. Check that it is connected and try again.',
      };
  }
}

export async function listCameras(): Promise<CameraDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'videoinput')
    .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Camera ${index + 1}` }));
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function useCamera(videoRef: RefObject<HTMLVideoElement>, deviceId: string | null) {
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef(0);
  const deviceRef = useRef(deviceId);
  deviceRef.current = deviceId;

  const stop = useCallback(() => {
    requestRef.current += 1; // cancels any start still in flight
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('idle');
    setError(null);
  }, [videoRef]);

  const start = useCallback(async () => {
    const request = (requestRef.current += 1);
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      setError('This browser cannot access a camera here. Open the app on http://localhost in a current browser.');
      return;
    }
    setStatus('starting');
    setError(null);
    stopStream(streamRef.current);
    streamRef.current = null;

    const base: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    const preferred = deviceRef.current;
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: preferred ? { ...base, deviceId: { exact: preferred } } : { ...base, facingMode: 'user' },
        });
      } catch (firstError) {
        // The saved camera may have been unplugged: fall back to any camera.
        const name = firstError instanceof Error ? firstError.name : '';
        if (!preferred || (name !== 'OverconstrainedError' && name !== 'NotFoundError')) throw firstError;
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: base });
      }

      if (request !== requestRef.current) {
        stopStream(stream); // stopped or restarted while the prompt was open
        return;
      }
      streamRef.current = stream;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (streamRef.current !== stream) return;
        streamRef.current = null;
        setStatus('unavailable');
        setError('The camera was disconnected.');
      });

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      if (request !== requestRef.current) return;
      setStatus('active');
      void listCameras().then(setDevices).catch(() => undefined);
    } catch (startError) {
      if (request !== requestRef.current) return;
      const failure = classifyCameraError(startError);
      setStatus(failure.status);
      setError(failure.message);
    }
  }, [videoRef]);

  // Switch cameras when the selected device changes while running.
  const activeRef = useRef(false);
  activeRef.current = status === 'active';
  useEffect(() => {
    if (activeRef.current) void start();
  }, [deviceId, start]);

  // Always release the webcam when the page using it goes away.
  useEffect(
    () => () => {
      requestRef.current += 1;
      stopStream(streamRef.current);
      streamRef.current = null;
    },
    [],
  );

  return { status, error, devices, start, stop };
}
