import { Droplets, Flame, Ghost, Mountain, Orbit, Sparkles, Wind, Zap, type LucideIcon } from 'lucide-react';

export interface ElementMeta {
  label: string;
  icon: LucideIcon;
  /** Primary colour (hex) used for glows, chips and effect tinting. */
  color: string;
  /** Secondary colour for gradients. */
  glow: string;
}

const ELEMENTS: Record<string, ElementMeta> = {
  fire: { label: 'Fire', icon: Flame, color: '#ff6a3d', glow: '#ffb347' },
  water: { label: 'Water', icon: Droplets, color: '#3ea6ff', glow: '#7fe0ff' },
  shadow: { label: 'Shadow', icon: Ghost, color: '#a8a8c8', glow: '#e4e4f4' },
  illusion: { label: 'Illusion', icon: Sparkles, color: '#c084fc', glow: '#f0abfc' },
  lightning: { label: 'Lightning', icon: Zap, color: '#7dd3fc', glow: '#e0f2fe' },
  wind: { label: 'Wind', icon: Wind, color: '#5eead4', glow: '#ccfbf1' },
  earth: { label: 'Earth', icon: Mountain, color: '#d6a45c', glow: '#f1d9a8' },
  energy: { label: 'Energy', icon: Orbit, color: '#60a5fa', glow: '#c7d2fe' },
};

const FALLBACK: ElementMeta = { label: 'Jutsu', icon: Sparkles, color: '#a3a3ba', glow: '#ececf4' };

export function elementMeta(element: string): ElementMeta {
  return ELEMENTS[element] ?? { ...FALLBACK, label: element.charAt(0).toUpperCase() + element.slice(1) };
}
