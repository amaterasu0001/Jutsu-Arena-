import { JutsuEffect } from '@/animations/JutsuEffect';
import { ShadowCloneEffect } from '@/animations/ShadowCloneEffect';
import { useSettings } from '@/context/SettingsContext';
import { CLONE_DURATIONS, type StageAnchor } from '@/lib/cloneFormation';
import type { CapturedShadow } from '@/services/personSegmentation';

/** A Shadow Clone capture ready to play: the person cut out of the camera frame and where they stood. */
export interface ShadowCapture {
  shadow: CapturedShadow;
  /** Position on the stage, or null for the framed fallback (no cutout). */
  anchor: StageAnchor | null;
  cutOffBelow: boolean;
}

interface Props {
  effect: string | null;
  playKey: number;
  quality: number;
  /** The player captured from the camera at the moment Shadow Clone activated. */
  capture?: ShadowCapture | null;
  onDone?: () => void;
  className?: string;
}

/**
 * Plays a jutsu effect. Shadow Clone is built from the live camera capture of
 * the player; without a capture only its smoke plays - the clones are never
 * replaced by stand-in figures, avatars or other images.
 */
export function JutsuEffectPlayer({ effect, playKey, quality, capture = null, onDone, className = '' }: Props) {
  const { settings } = useSettings();
  if (effect === 'clone' && capture && playKey > 0) {
    return (
      <ShadowCloneEffect
        key={playKey}
        source={capture.shadow}
        anchor={capture.anchor}
        cutOffBelow={capture.cutOffBelow}
        count={settings.clone_count}
        formation={settings.clone_formation}
        durationMs={CLONE_DURATIONS[settings.clone_duration].ms}
        smoke={settings.clone_smoke}
        quality={quality}
        onDone={onDone}
        className={className}
      />
    );
  }
  return <JutsuEffect effect={effect === 'clone' ? 'smoke_burst' : effect} playKey={playKey} quality={quality} onDone={onDone} className={className} />;
}
