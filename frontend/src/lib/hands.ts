import type { FramePayload, HandPayload } from '@/types/api';

export type TrackedHand = HandPayload;

/** Everything detected in one camera frame, in raw (un-mirrored) image coordinates. */
export interface TrackedFrame extends FramePayload {
  timestamp: number;
}

export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export const FINGERTIPS = [4, 8, 12, 16, 20];

export const HAND_COLORS: Record<TrackedHand['handedness'], { line: string; joint: string }> = {
  Left: { line: '#3ea6ff', joint: '#cfe9ff' },
  Right: { line: '#ff5a6e', joint: '#ffd6db' },
};

/** Draw landmark skeletons onto an overlay canvas sized to the video frame. */
export function drawHands(
  ctx: CanvasRenderingContext2D,
  hands: TrackedHand[],
  width: number,
  height: number,
  mirrored: boolean,
): void {
  ctx.clearRect(0, 0, width, height);
  const unit = Math.max(width, height) / 640;

  for (const hand of hands) {
    const colors = HAND_COLORS[hand.handedness];
    const points = hand.landmarks.map(([x, y]) => [x * width, y * height] as const);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = colors.line;
    ctx.shadowColor = colors.line;
    ctx.shadowBlur = 10 * unit;
    ctx.lineWidth = 2.6 * unit;
    ctx.beginPath();
    for (const [from, to] of HAND_CONNECTIONS) {
      ctx.moveTo(points[from][0], points[from][1]);
      ctx.lineTo(points[to][0], points[to][1]);
    }
    ctx.stroke();

    ctx.shadowBlur = 0;
    points.forEach(([x, y], index) => {
      const tip = FINGERTIPS.includes(index);
      ctx.beginPath();
      ctx.fillStyle = tip ? '#ffffff' : colors.joint;
      ctx.arc(x, y, (tip ? 4.2 : 3) * unit, 0, Math.PI * 2);
      ctx.fill();
    });

    // Label at the wrist. The canvas is flipped by CSS when mirrored, so the
    // text is flipped back to stay readable.
    const [wx, wy] = points[0];
    const label = hand.handedness === 'Left' ? 'L' : 'R';
    ctx.save();
    ctx.translate(wx, wy + 22 * unit);
    if (mirrored) ctx.scale(-1, 1);
    ctx.font = `600 ${13 * unit}px "Chakra Petch", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(6, 6, 10, 0.75)';
    ctx.beginPath();
    ctx.arc(0, 0, 11 * unit, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colors.line;
    ctx.fillText(label, 0, 1 * unit);
    ctx.restore();
  }
}

/** Strip a tracked frame down to what the API expects (rounded to keep payloads small). */
export function toFramePayload(frame: TrackedFrame): FramePayload {
  return {
    image_width: frame.image_width,
    image_height: frame.image_height,
    hands: frame.hands.map((hand) => ({
      handedness: hand.handedness,
      score: Math.round(hand.score * 1000) / 1000,
      landmarks: hand.landmarks.map(
        ([x, y, z]) => [round5(x), round5(y), round5(z)] as [number, number, number],
      ),
    })),
  };
}

function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}
