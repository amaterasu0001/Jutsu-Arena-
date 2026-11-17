import type { FingerState, SignDiagramData } from '@/types/api';

// Schematic of both hands, seen from the performer's point of view (backs of the
// hands toward you). It shows the state of each finger, not an anatomical drawing.

const FINGER_X = [14, 30, 46, 62]; // four fingers across the palm
const FINGER_FULL = [44, 54, 58, 50]; // pinky, ring, middle, index lengths (left hand order)

const STATE_STYLE: Record<FingerState, { length: number; fill: string; stroke: string }> = {
  up: { length: 1, fill: 'rgb(var(--accent) / 0.85)', stroke: 'rgb(var(--accent-soft))' },
  lock: { length: 0.55, fill: 'rgba(139, 92, 246, 0.55)', stroke: '#b9a0ff' },
  fold: { length: 0.24, fill: 'rgba(255, 255, 255, 0.10)', stroke: 'rgba(255, 255, 255, 0.28)' },
};

function Hand({ states, side }: { states: FingerState[]; side: 'left' | 'right' }) {
  // states arrive as [thumb, index, middle, ring, pinky]
  const [thumb, index, middle, ring, pinky] = states;
  // Left hand (back toward you): pinky on the outside (left), thumb on the inside (right).
  const fingers = side === 'left' ? [pinky, ring, middle, index] : [index, middle, ring, pinky];
  const lengths = side === 'left' ? FINGER_FULL : [...FINGER_FULL].reverse();
  const thumbStyle = STATE_STYLE[thumb];
  const thumbLength = 14 + 22 * thumbStyle.length;
  const palmTop = 70;

  return (
    <g>
      {fingers.map((state, i) => {
        const style = STATE_STYLE[state];
        const length = lengths[i] * style.length;
        return (
          <rect
            key={i}
            x={FINGER_X[i] - 6}
            y={palmTop - length}
            width={12}
            height={length + 8}
            rx={6}
            fill={style.fill}
            stroke={style.stroke}
            strokeWidth={1.2}
          />
        );
      })}
      {/* thumb, angled away from the palm on the inner side */}
      <rect
        x={-6}
        y={-thumbLength}
        width={12}
        height={thumbLength + 6}
        rx={6}
        fill={thumbStyle.fill}
        stroke={thumbStyle.stroke}
        strokeWidth={1.2}
        transform={side === 'left' ? `translate(76 92) rotate(48)` : `translate(0 92) rotate(-48)`}
      />
      <rect x={4} y={palmTop} width={68} height={52} rx={14} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.22)" strokeWidth={1.2} />
    </g>
  );
}

export function SignDiagram({ diagram, className = '' }: { diagram: SignDiagramData; className?: string }) {
  return (
    <figure className={className}>
      <svg viewBox="0 0 260 150" className="w-full" role="img" aria-label={diagram.caption}>
        <g transform="translate(22 14)">
          <Hand states={diagram.left} side="left" />
        </g>
        <g transform="translate(162 14)">
          <Hand states={diagram.right} side="right" />
        </g>
        {/* how the hands meet */}
        <g stroke="rgba(255,255,255,0.28)" strokeWidth={1.2} strokeDasharray="3 4" fill="none">
          <path d="M116 96 H146" />
        </g>
        <text x="60" y="146" textAnchor="middle" className="fill-fg-faint" style={{ font: '600 9px "Chakra Petch", sans-serif', letterSpacing: '0.18em' }}>
          LEFT
        </text>
        <text x="200" y="146" textAnchor="middle" className="fill-fg-faint" style={{ font: '600 9px "Chakra Petch", sans-serif', letterSpacing: '0.18em' }}>
          RIGHT
        </text>
      </svg>
      <figcaption className="mt-1 text-center text-xs leading-snug text-fg-muted">{diagram.caption}</figcaption>
    </figure>
  );
}

export function DiagramLegend() {
  const items: Array<{ state: FingerState; label: string }> = [
    { state: 'up', label: 'Extended' },
    { state: 'lock', label: 'Interlocked' },
    { state: 'fold', label: 'Folded' },
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-fg-muted">
      {items.map(({ state, label }) => (
        <li key={state} className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-5 rounded-full border"
            style={{ background: STATE_STYLE[state].fill, borderColor: STATE_STYLE[state].stroke }}
            aria-hidden
          />
          {label}
        </li>
      ))}
    </ul>
  );
}
