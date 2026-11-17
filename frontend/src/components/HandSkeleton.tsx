import { memo } from 'react';

import { HAND_COLORS, HAND_CONNECTIONS } from '@/lib/hands';
import type { HandPayload } from '@/types/api';

interface Props {
  hands: HandPayload[];
  /** Image width / height of the frame the landmarks came from. */
  aspect: number;
  /** Flip horizontally so the pose reads like a mirror, matching the camera preview. */
  mirrored?: boolean;
  className?: string;
  label?: string;
}

/** Static drawing of captured landmarks, cropped to the hands. */
export const HandSkeleton = memo(function HandSkeleton({ hands, aspect, mirrored = true, className = '', label }: Props) {
  if (!hands.length) return null;

  const projected = hands.map((hand) => ({
    handedness: hand.handedness,
    points: hand.landmarks.map(([x, y]) => [(mirrored ? 1 - x : x) * aspect, y] as const),
  }));
  const all = projected.flatMap((hand) => hand.points);
  const minX = Math.min(...all.map((p) => p[0]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const pad = span * 0.12;
  const size = span + pad * 2;
  const offsetX = minX - pad - (span - (maxX - minX)) / 2;
  const offsetY = minY - pad - (span - (maxY - minY)) / 2;
  const sx = (value: number) => ((value - offsetX) / size) * 100;
  const sy = (value: number) => ((value - offsetY) / size) * 100;

  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label={label ?? 'Captured hand pose'}>
      {projected.map((hand, handIndex) => {
        const colors = HAND_COLORS[hand.handedness];
        return (
          <g key={handIndex}>
            {HAND_CONNECTIONS.map(([from, to]) => (
              <line
                key={`${from}-${to}`}
                x1={sx(hand.points[from][0])}
                y1={sy(hand.points[from][1])}
                x2={sx(hand.points[to][0])}
                y2={sy(hand.points[to][1])}
                stroke={colors.line}
                strokeWidth={1.6}
                strokeLinecap="round"
                opacity={0.9}
              />
            ))}
            {hand.points.map(([x, y], index) => (
              <circle key={index} cx={sx(x)} cy={sy(y)} r={1.5} fill={colors.joint} />
            ))}
          </g>
        );
      })}
    </svg>
  );
});
