import { useEffect, useRef, useState, type RefObject } from 'react';

import { drawHands, type TrackedFrame, type TrackedHand } from '@/lib/hands';
import { loadHandLandmarker } from '@/services/handLandmarker';
import type { Handedness, Point3 } from '@/types/api';

export type TrackerStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface HandPresence {
  count: number;
  left: boolean;
  right: boolean;
}

interface Options {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  /** Run detection only while the camera is delivering frames. */
  active: boolean;
  showLandmarks: boolean;
  mirrored: boolean;
  /** Called for every processed frame (also when no hands are visible). */
  onFrame?: (frame: TrackedFrame) => void;
  maxFps?: number;
}

const NO_HANDS: HandPresence = { count: 0, left: false, right: false };
// MediaPipe reports handedness for the subject's own hands when given the raw
// (un-mirrored) camera frame, which is what we pass. The mirror setting only
// flips the preview with CSS, so it never changes these labels.
const SWAP = import.meta.env.VITE_SWAP_HANDEDNESS === 'true';

function physicalHand(label: string): Handedness {
  const left = label === 'Left';
  return left !== SWAP ? 'Left' : 'Right';
}

/** Explain why the hand tracker could not start, keeping the underlying reason. */
export function describeLoadFailure(failure: unknown): string {
  const reason = failure instanceof Error ? failure.message : String(failure ?? '');
  if (/dynamically imported module|importing a module script failed|error loading dynamically imported/i.test(reason)) {
    return 'The hand-tracking library could not be loaded from the dev server. Restart the frontend (close its window and run start.bat again), then reload this page.';
  }
  return `The hand-tracking model could not be loaded (${reason || 'unknown error'}). Run the setup script to download it, or check your internet connection.`;
}

/** Real-time two-hand landmark detection on a playing <video>. */
export function useHandTracker({
  videoRef,
  canvasRef,
  active,
  showLandmarks,
  mirrored,
  onFrame,
  maxFps = 30,
}: Options) {
  const [status, setStatus] = useState<TrackerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [presence, setPresence] = useState<HandPresence>(NO_HANDS);

  // Latest values read inside the frame loop without restarting it.
  const live = useRef({ showLandmarks, mirrored, onFrame });
  live.current = { showLandmarks, mirrored, onFrame };

  useEffect(() => {
    if (!active) {
      setPresence(NO_HANDS);
      const canvas = canvasRef.current;
      canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    let cancelled = false;
    let raf = 0;
    let lastVideoTime = -1;
    let lastRun = 0;
    let failures = 0;
    let lastPresence = NO_HANDS;
    const minInterval = 1000 / maxFps;

    setStatus((current) => (current === 'ready' ? current : 'loading'));
    setError(null);

    loadHandLandmarker()
      .then((landmarker) => {
        if (cancelled) return;
        setStatus('ready');

        const loop = () => {
          if (cancelled) return;
          raf = requestAnimationFrame(loop);

          const video = videoRef.current;
          const now = performance.now();
          if (!video || video.readyState < 2 || !video.videoWidth) return;
          if (video.currentTime === lastVideoTime || now - lastRun < minInterval) return;
          lastVideoTime = video.currentTime;
          lastRun = now;

          let hands: TrackedHand[];
          try {
            const result = landmarker.detectForVideo(video, now);
            hands = result.landmarks.map((landmarks, index) => ({
              handedness: physicalHand(result.handedness[index]?.[0]?.categoryName ?? 'Right'),
              score: result.handedness[index]?.[0]?.score ?? 0,
              landmarks: landmarks.map(({ x, y, z }) => [x, y, z] as Point3),
            }));
            failures = 0;
          } catch {
            failures += 1;
            if (failures >= 10) {
              cancelled = true;
              cancelAnimationFrame(raf);
              setStatus('error');
              setError('Hand tracking stopped unexpectedly. Restart the camera to try again.');
            }
            return;
          }

          const width = video.videoWidth;
          const height = video.videoHeight;
          const canvas = canvasRef.current;
          if (canvas) {
            if (canvas.width !== width || canvas.height !== height) {
              canvas.width = width;
              canvas.height = height;
            }
            const ctx = canvas.getContext('2d');
            if (ctx) {
              if (live.current.showLandmarks) drawHands(ctx, hands, width, height, live.current.mirrored);
              else ctx.clearRect(0, 0, width, height);
            }
          }

          const next: HandPresence = {
            count: hands.length,
            left: hands.some((hand) => hand.handedness === 'Left'),
            right: hands.some((hand) => hand.handedness === 'Right'),
          };
          if (next.count !== lastPresence.count || next.left !== lastPresence.left || next.right !== lastPresence.right) {
            lastPresence = next;
            setPresence(next);
          }

          live.current.onFrame?.({ hands, image_width: width, image_height: height, timestamp: now });
        };
        raf = requestAnimationFrame(loop);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        console.error('[hand-tracker] failed to start', failure);
        setStatus('error');
        setError(describeLoadFailure(failure));
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [active, videoRef, canvasRef, maxFps]);

  return { status, error, presence };
}
