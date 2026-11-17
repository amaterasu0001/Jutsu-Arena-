// Person detection and "shadow capture" from the live webcam - entirely in the
// browser. Frames are never uploaded: the only network request is for the
// segmentation model itself (local copy from the setup script, or Google's
// MediaPipe model bucket as a fallback).

import type { ImageSegmenter } from '@mediapipe/tasks-vision';

declare const __MEDIAPIPE_VERSION__: string;

/** Long side of the frame used for the capture (enough detail, cheap to process). */
export const CAPTURE_MAX_SIDE = 720;
/** Long side of the frame used for the periodic "is anyone there?" check. */
export const PRESENCE_MAX_SIDE = 256;
/** Share of the frame a person must cover to count as present. */
export const MIN_PERSON_COVERAGE = 0.04;

/** Normalised rectangle (0..1) in the coordinates of the displayed (possibly mirrored) frame. */
export interface FrameBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CapturedShadow {
  /** In-memory object URL of the captured person (or framed frame). Revoke with `releaseShadow`. */
  url: string;
  /** True when the background was removed (transparent PNG). */
  cutout: boolean;
  width: number;
  height: number;
  /** Where the person was in the frame (mirrored like the preview when `mirrored`). */
  box: FrameBox;
  /** Width / height of the captured video frame. */
  frameAspect: number;
}

export type CaptureResult = { kind: 'captured'; shadow: CapturedShadow } | { kind: 'no_person' } | { kind: 'no_camera' };

// -- pure helpers ---------------------------------------------------------------

/** Scale (w, h) to fit inside `max` on the long side, keeping the aspect ratio. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Bounding box of pixels with alpha above `threshold`, padded and clamped to the image. */
export function alphaBounds(alpha: ArrayLike<number>, width: number, height: number, threshold = 25, pad = 0.04) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const padX = Math.round((maxX - minX + 1) * pad);
  const padY = Math.round((maxY - minY + 1) * pad);
  const x = Math.max(0, minX - padX);
  const y = Math.max(0, minY - padY);
  return { x, y, width: Math.min(width, maxX + padX + 1) - x, height: Math.min(height, maxY + padY + 1) - y };
}

/** Share of mask values above 0.5. */
export function maskCoverage(mask: ArrayLike<number>): number {
  if (!mask.length) return 0;
  let covered = 0;
  for (let i = 0; i < mask.length; i += 1) if (mask[i] > 0.5) covered += 1;
  return covered / mask.length;
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

// -- segmenter -------------------------------------------------------------------

const env = import.meta.env;
const LOCAL_WASM = (env.VITE_MEDIAPIPE_WASM_URL as string | undefined) || '/mediapipe/wasm';
const LOCAL_SEGMENTER = (env.VITE_SEGMENTER_MODEL_URL as string | undefined) || '/models/selfie_segmenter.tflite';
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${__MEDIAPIPE_VERSION__}/wasm`;
const CDN_SEGMENTER = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

async function assetExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    const type = response.headers.get('content-type') ?? '';
    return response.ok && !type.includes('text/html');
  } catch {
    return false;
  }
}

let shared: Promise<ImageSegmenter> | null = null;
let failedAt = -Infinity;
/** After a failed load (offline, model missing), wait this long before trying again. */
const RETRY_AFTER_MS = 30_000;

export function loadSegmenter(): Promise<ImageSegmenter> {
  if (!shared && performance.now() - failedAt < RETRY_AFTER_MS) {
    return Promise.reject(new Error('Person segmentation is unavailable right now.'));
  }
  if (!shared) {
    shared = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
      const [hasWasm, hasModel] = await Promise.all([assetExists(`${LOCAL_WASM}/vision_wasm_internal.wasm`), assetExists(LOCAL_SEGMENTER)]);
      const fileset = await FilesetResolver.forVisionTasks(hasWasm ? LOCAL_WASM : CDN_WASM);
      return ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: hasModel ? LOCAL_SEGMENTER : CDN_SEGMENTER, delegate: 'CPU' },
        runningMode: 'IMAGE',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    })().catch((error) => {
      shared = null;
      failedAt = performance.now();
      throw error;
    });
  }
  return shared;
}

interface Mask {
  data: Float32Array;
  width: number;
  height: number;
}

function segment(segmenter: ImageSegmenter, source: HTMLCanvasElement): Mask | null {
  const result = segmenter.segment(source);
  try {
    const masks = result.confidenceMasks ?? [];
    // The selfie segmenter returns one "person" mask; multi-class models put background first.
    const mask = masks.length >= 2 ? masks[1] : masks[0];
    if (!mask) return null;
    return { data: new Float32Array(mask.getAsFloat32Array()), width: mask.width, height: mask.height };
  } finally {
    result.close();
  }
}

function videoReady(video: HTMLVideoElement | null): video is HTMLVideoElement {
  return Boolean(video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0);
}

/** Draw the current video frame (optionally mirrored like the preview) into a new canvas. */
function grabFrame(video: HTMLVideoElement, maxSide: number, mirrored: boolean): HTMLCanvasElement | null {
  const size = fitWithin(video.videoWidth, video.videoHeight, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (mirrored) {
    ctx.translate(size.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, size.width, size.height);
  return canvas;
}

// -- presence ----------------------------------------------------------------------

export type PresenceCheck = { status: 'present' | 'absent'; coverage: number } | { status: 'unavailable' };

/** Is a person in front of the camera right now? Runs on a small frame; nothing leaves the browser. */
export async function detectPerson(video: HTMLVideoElement | null): Promise<PresenceCheck> {
  if (!videoReady(video)) return { status: 'absent', coverage: 0 };
  let segmenter: ImageSegmenter;
  try {
    segmenter = await loadSegmenter();
  } catch {
    return { status: 'unavailable' };
  }
  const frame = grabFrame(video, PRESENCE_MAX_SIDE, false);
  if (!frame) return { status: 'unavailable' };
  const mask = segment(segmenter, frame);
  if (!mask) return { status: 'unavailable' };
  const coverage = maskCoverage(mask.data);
  return { status: coverage >= MIN_PERSON_COVERAGE ? 'present' : 'absent', coverage };
}

// -- capture -------------------------------------------------------------------------

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The frame could not be encoded.'))), type, quality));
}

/**
 * Capture the current camera frame and cut out the person in it.
 *
 * The frame is grabbed synchronously, so it is exactly the frame on screen when
 * this is called (the moment of activation); segmentation then runs on that
 * copy. Without a segmenter, the whole frame is used as a framed image (when
 * `allowFramedFallback`). With a segmenter but no person found, nothing is
 * produced - the caller shows a message instead of fake clones.
 */
export async function captureShadow(video: HTMLVideoElement | null, mirrored: boolean, allowFramedFallback = true): Promise<CaptureResult> {
  if (!videoReady(video)) return { kind: 'no_camera' };
  const frame = grabFrame(video, CAPTURE_MAX_SIDE, mirrored);
  if (!frame) return { kind: 'no_camera' };
  const frameAspect = frame.width / frame.height;

  let segmenter: ImageSegmenter | null = null;
  try {
    segmenter = await loadSegmenter();
  } catch {
    segmenter = null;
  }

  if (!segmenter) {
    if (!allowFramedFallback) return { kind: 'no_person' };
    const blob = await toBlob(frame, 'image/jpeg', 0.9);
    return {
      kind: 'captured',
      shadow: { url: URL.createObjectURL(blob), cutout: false, width: frame.width, height: frame.height, box: { x: 0, y: 0, width: 1, height: 1 }, frameAspect },
    };
  }

  const mask = segment(segmenter, frame);
  if (!mask || maskCoverage(mask.data) < MIN_PERSON_COVERAGE) return { kind: 'no_person' };

  // Soft alpha matte from the person probability, scaled to the frame.
  const matte = document.createElement('canvas');
  matte.width = mask.width;
  matte.height = mask.height;
  const matteCtx = matte.getContext('2d');
  const cut = document.createElement('canvas');
  cut.width = frame.width;
  cut.height = frame.height;
  const cutCtx = cut.getContext('2d');
  if (!matteCtx || !cutCtx) return { kind: 'no_person' };
  const pixels = matteCtx.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i += 1) pixels.data[i * 4 + 3] = Math.round(smoothstep(0.35, 0.75, mask.data[i]) * 255);
  matteCtx.putImageData(pixels, 0, 0);

  cutCtx.drawImage(frame, 0, 0);
  cutCtx.globalCompositeOperation = 'destination-in';
  cutCtx.imageSmoothingQuality = 'high';
  cutCtx.filter = 'blur(1px)';
  cutCtx.drawImage(matte, 0, 0, frame.width, frame.height);
  cutCtx.filter = 'none';
  cutCtx.globalCompositeOperation = 'source-over';

  const alpha = cutCtx.getImageData(0, 0, frame.width, frame.height).data;
  const channel = new Uint8ClampedArray(frame.width * frame.height);
  for (let i = 0; i < channel.length; i += 1) channel[i] = alpha[i * 4 + 3];
  const box = alphaBounds(channel, frame.width, frame.height, 25, 0.02);
  if (!box) return { kind: 'no_person' };

  const output = document.createElement('canvas');
  output.width = box.width;
  output.height = box.height;
  output.getContext('2d')?.drawImage(cut, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  const where: FrameBox = { x: box.x / frame.width, y: box.y / frame.height, width: box.width / frame.width, height: box.height / frame.height };
  const blob = await toBlob(output, 'image/png');
  // Free the large intermediate canvases right away.
  for (const canvas of [frame, matte, cut, output]) canvas.width = canvas.height = 0;

  return {
    kind: 'captured',
    shadow: { url: URL.createObjectURL(blob), cutout: true, width: box.width, height: box.height, box: where, frameAspect },
  };
}

/** Free the in-memory image of a capture. */
export function releaseShadow(shadow: CapturedShadow | null | undefined): void {
  if (shadow) URL.revokeObjectURL(shadow.url);
}
