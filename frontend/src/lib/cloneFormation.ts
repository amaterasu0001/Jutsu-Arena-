// Where the original and each clone stand in the Shadow Clone effect.
// Pure data, so the layouts can be unit-tested.

import type { CloneFormation } from '@/types/api';

export interface CloneSlot {
  /** Horizontal offset from the centre, in % of the stage width. */
  x: number;
  /** Feet position above the bottom edge, in % of the stage height (further back = higher). */
  bottom: number;
  /** Size relative to the original (further back = smaller). */
  scale: number;
  /** 0 = the original at the front; larger = further back. */
  depth: number;
}

const ORIGINAL: CloneSlot = { x: 0, bottom: 3, scale: 1, depth: 0 };

// Clone slots in the order they are filled, so 2, 3, 5 or 7 clones all form a
// balanced picture: left and right first, then one behind, then the background.
const LAYOUTS: Record<CloneFormation, CloneSlot[]> = {
  surround: [
    { x: -25, bottom: 6, scale: 0.9, depth: 1 },
    { x: 25, bottom: 6, scale: 0.9, depth: 1 },
    { x: 0, bottom: 15, scale: 0.74, depth: 3 },
    { x: -37, bottom: 13, scale: 0.76, depth: 2 },
    { x: 37, bottom: 13, scale: 0.76, depth: 2 },
    { x: -16, bottom: 21, scale: 0.62, depth: 4 },
    { x: 16, bottom: 21, scale: 0.62, depth: 4 },
  ],
  line: [
    { x: -17, bottom: 4, scale: 0.95, depth: 1 },
    { x: 17, bottom: 4, scale: 0.95, depth: 1 },
    { x: 0, bottom: 14, scale: 0.78, depth: 3 },
    { x: -33, bottom: 5, scale: 0.9, depth: 2 },
    { x: 33, bottom: 5, scale: 0.9, depth: 2 },
    { x: -44, bottom: 6, scale: 0.82, depth: 3 },
    { x: 44, bottom: 6, scale: 0.82, depth: 3 },
  ],
  arrow: [
    { x: -19, bottom: 9, scale: 0.86, depth: 1 },
    { x: 19, bottom: 9, scale: 0.86, depth: 1 },
    { x: 0, bottom: 19, scale: 0.66, depth: 4 },
    { x: -36, bottom: 16, scale: 0.74, depth: 2 },
    { x: 36, bottom: 16, scale: 0.74, depth: 2 },
    { x: -45, bottom: 23, scale: 0.62, depth: 3 },
    { x: 45, bottom: 23, scale: 0.62, depth: 3 },
  ],
};

export const FORMATIONS: Array<{ id: CloneFormation; label: string; note: string }> = [
  { id: 'surround', label: 'Surround', note: 'Clones flank you and fill the background' },
  { id: 'line', label: 'Battle line', note: 'Shoulder to shoulder' },
  { id: 'arrow', label: 'Arrowhead', note: 'A V-shape with you at the point' },
];

export const CLONE_COUNTS = [2, 3, 5, 7] as const;

export const CLONE_DURATIONS: Record<'short' | 'normal' | 'long', { label: string; ms: number }> = {
  short: { label: 'Short', ms: 4000 },
  normal: { label: 'Normal', ms: 5500 },
  long: { label: 'Long', ms: 7500 },
};

/** The original first, then `count` clones. */
export function cloneFormation(count: number, formation: CloneFormation = 'surround'): CloneSlot[] {
  const slots = LAYOUTS[formation] ?? LAYOUTS.surround;
  return [ORIGINAL, ...slots.slice(0, Math.max(0, Math.min(count, slots.length)))];
}

/**
 * Front height of the figure as % of the stage: tall photos are shown
 * full-body, others as portraits. The top ~20% stays clear for the titles, so
 * the original's face is never covered.
 */
export function figureHeight(width: number, height: number): number {
  const aspect = height / Math.max(1, width);
  if (aspect >= 1.6) return 68; // full body
  if (aspect >= 1.1) return 58; // half body
  return 48; // head and shoulders / landscape
}

// -- live capture: clones around the player's real position ------------------------

/** Where the captured person appears on the stage, in % of the stage. */
export interface StageAnchor {
  /** Horizontal centre of the person. */
  x: number;
  /** Bottom edge of the person above the stage bottom (negative when cut off below). */
  bottom: number;
  width: number;
  height: number;
}

/**
 * Map a normalised box in the video frame to the stage, which shows the video
 * with `object-fit: cover` (the frame is scaled to fill the stage and the
 * overflow is cropped equally on both sides).
 */
export function frameBoxToStage(
  box: { x: number; y: number; width: number; height: number },
  frameAspect: number,
  stageAspect: number,
): StageAnchor {
  let scaleX = 1;
  let scaleY = 1;
  if (frameAspect > stageAspect) scaleX = frameAspect / stageAspect; // wider frame: sides cropped
  else scaleY = stageAspect / frameAspect; // taller frame: top and bottom cropped
  const offsetX = (1 - scaleX) / 2;
  const offsetY = (1 - scaleY) / 2;
  const left = offsetX + box.x * scaleX;
  const top = offsetY + box.y * scaleY;
  const width = box.width * scaleX;
  const height = box.height * scaleY;
  return { x: (left + width / 2) * 100, bottom: (1 - (top + height)) * 100, width: width * 100, height: height * 100 };
}

export interface LiveSlot extends CloneSlot {
  /** Figure height in % of the stage. */
  height: number;
}

/**
 * Clone positions around the player's real position on the stage. The usual
 * formation offsets are expressed relative to the person's on-screen size, so
 * a player close to the camera gets a wider, larger formation.
 */
export function liveFormation(anchor: StageAnchor, count: number, formation: CloneFormation = 'surround'): LiveSlot[] {
  const unitX = Math.max(anchor.width, 12) / 22; // formation x is designed for a ~22%-wide figure
  const unitY = Math.max(anchor.height, 20) / 68;
  return cloneFormation(count, formation).map((slot) => {
    const height = anchor.height * slot.scale;
    if (slot.depth === 0) return { ...slot, x: anchor.x - 50, bottom: anchor.bottom, height };
    // A clone straight behind the player rises until its head and shoulders show
    // above the player's head; otherwise the player would hide it completely.
    const behind = slot.x === 0;
    const bottom = behind ? anchor.bottom + anchor.height - height * 0.72 : anchor.bottom + (slot.bottom - 3) * unitY;
    return { ...slot, x: Math.min(44, Math.max(-44, anchor.x - 50 + slot.x * unitX)), bottom, height };
  });
}
