import { Camera, CameraOff, LoaderCircle, ShieldAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

import { Button } from '@/components/ui/Button';
import type { CameraStatus } from '@/hooks/useCamera';
import type { TrackerStatus } from '@/hooks/useHandTracker';

interface Props {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  cameraStatus: CameraStatus;
  cameraError: string | null;
  trackerStatus: TrackerStatus;
  trackerError: string | null;
  mirrored: boolean;
  onStart: () => void;
  /** HUD and effects rendered above the video (not mirrored). */
  children?: ReactNode;
  startLabel?: string;
}

function Message({ icon: Icon, title, text, action, spin }: { icon: LucideIcon; title: string; text: string; action?: ReactNode; spin?: boolean }) {
  return (
    <div className="absolute inset-0 z-10 grid place-items-center p-6 text-center">
      <div className="flex max-w-md flex-col items-center gap-4">
        <span className="relative grid h-16 w-16 place-items-center rounded-full border border-white/10 bg-white/[0.04]">
          <Icon className={`h-6 w-6 text-accent-soft ${spin ? 'animate-spin' : ''}`} aria-hidden />
        </span>
        <div>
          <p className="font-display text-lg font-semibold uppercase tracking-[0.16em] text-fg">{title}</p>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">{text}</p>
        </div>
        {action}
      </div>
    </div>
  );
}

/** The webcam preview with its landmark overlay and every camera state. */
export function CameraStage({
  videoRef,
  canvasRef,
  cameraStatus,
  cameraError,
  trackerStatus,
  trackerError,
  mirrored,
  onStart,
  children,
  startLabel = 'Start camera',
}: Props) {
  const live = cameraStatus === 'active';
  const flip = mirrored ? '-scale-x-100' : '';
  const startButton = (label: string) => (
    <Button variant="primary" size="lg" icon={Camera} onClick={onStart}>
      {label}
    </Button>
  );

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-ink-900 shadow-panel">
      <div className="grid-backdrop absolute inset-0" aria-hidden />
      <video
        ref={videoRef}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${flip} ${live ? 'opacity-100' : 'opacity-0'}`}
        playsInline
        muted
        aria-label="Webcam preview"
      />
      <canvas ref={canvasRef} className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${flip} ${live ? '' : 'hidden'}`} aria-hidden />

      {/* corner brackets */}
      <div className="pointer-events-none absolute inset-3 z-[5]" aria-hidden>
        {['left-0 top-0 border-l-2 border-t-2', 'right-0 top-0 border-r-2 border-t-2', 'bottom-0 left-0 border-b-2 border-l-2', 'bottom-0 right-0 border-b-2 border-r-2'].map(
          (position) => (
            <span key={position} className={`absolute h-5 w-5 border-accent/60 ${position}`} />
          ),
        )}
      </div>

      {cameraStatus === 'idle' && (
        <Message
          icon={Camera}
          title="Camera not started"
          text="Your video never leaves this device - only hand-landmark coordinates are sent to the local game server."
          action={startButton(startLabel)}
        />
      )}
      {cameraStatus === 'starting' && (
        <Message icon={LoaderCircle} spin title="Starting camera" text="Allow camera access if your browser asks." />
      )}
      {cameraStatus === 'denied' && (
        <Message icon={ShieldAlert} title="Camera permission denied" text={cameraError ?? ''} action={startButton('Try again')} />
      )}
      {(cameraStatus === 'unavailable' || cameraStatus === 'in_use' || cameraStatus === 'error' || cameraStatus === 'unsupported') && (
        <Message
          icon={CameraOff}
          title={cameraStatus === 'in_use' ? 'Camera is busy' : 'Camera unavailable'}
          text={cameraError ?? ''}
          action={cameraStatus === 'unsupported' ? undefined : startButton('Try again')}
        />
      )}
      {live && trackerStatus === 'loading' && (
        <div className="absolute inset-x-0 top-0 z-10 flex justify-center p-4">
          <span className="flex items-center gap-2 rounded-full border border-white/10 bg-ink-900/85 px-4 py-2 text-xs text-fg-muted backdrop-blur">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent-soft" aria-hidden />
            Loading hand-tracking model…
          </span>
        </div>
      )}
      {live && trackerStatus === 'error' && (
        <div className="absolute inset-0 z-10 bg-ink-950/80 backdrop-blur-sm">
          <Message icon={ShieldAlert} title="Hand tracking unavailable" text={trackerError ?? ''} action={startButton('Restart camera')} />
        </div>
      )}

      {children}
    </div>
  );
}
