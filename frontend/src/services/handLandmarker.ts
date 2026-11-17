// Loads the MediaPipe Hand Landmarker once and shares it across pages.
// Local assets (copied by the setup script) are preferred; the public CDN is a fallback.

import type { HandLandmarker } from '@mediapipe/tasks-vision';

declare const __MEDIAPIPE_VERSION__: string;

const env = import.meta.env;
const LOCAL_WASM = (env.VITE_MEDIAPIPE_WASM_URL as string | undefined) || '/mediapipe/wasm';
const LOCAL_MODEL = (env.VITE_HAND_MODEL_URL as string | undefined) || '/models/hand_landmarker.task';
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${__MEDIAPIPE_VERSION__}/wasm`;
const CDN_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/** True when `url` serves a real asset (the dev server answers unknown paths with index.html). */
async function assetExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    const type = response.headers.get('content-type') ?? '';
    return response.ok && !type.includes('text/html');
  } catch {
    return false;
  }
}

async function create(): Promise<HandLandmarker> {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');

  const [hasLocalWasm, hasLocalModel] = await Promise.all([
    assetExists(`${LOCAL_WASM}/vision_wasm_internal.wasm`),
    assetExists(LOCAL_MODEL),
  ]);
  const fileset = await FilesetResolver.forVisionTasks(hasLocalWasm ? LOCAL_WASM : CDN_WASM);
  const modelAssetPath = hasLocalModel ? LOCAL_MODEL : CDN_MODEL;

  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath, delegate },
    runningMode: 'VIDEO' as const,
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  try {
    return await HandLandmarker.createFromOptions(fileset, options('GPU'));
  } catch {
    return HandLandmarker.createFromOptions(fileset, options('CPU'));
  }
}

let shared: Promise<HandLandmarker> | null = null;

export function loadHandLandmarker(): Promise<HandLandmarker> {
  if (!shared) {
    shared = create().catch((error) => {
      shared = null; // allow a retry after a failed load
      throw error;
    });
  }
  return shared;
}
