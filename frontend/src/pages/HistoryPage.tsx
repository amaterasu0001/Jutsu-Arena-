import {
  Award,
  Crown,
  Flame,
  GraduationCap,
  Hand,
  History,
  Link as LinkIcon,
  Lock,
  ScrollText,
  Shapes,
  Sparkles,
  Swords,
  Target,
  Trash2,
  TrendingUp,
  Trophy,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Button, ButtonLink } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Badge, Meter, PageHeader, PanelHeading, StatTile } from '@/components/ui/primitives';
import { EmptyState, ErrorState, LoadingGrid } from '@/components/ui/States';
import { useToast } from '@/context/ToastContext';
import { useApi } from '@/hooks/useApi';
import { Page } from '@/layouts/AppLayout';
import { elementMeta } from '@/lib/elements';
import { formatDateTime, formatNumber, percent, titleCase } from '@/lib/format';
import { api, errorMessage } from '@/services/api';
import type { Achievement, ActivationRecord, TrainingProgress } from '@/types/api';

const ACHIEVEMENT_ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  flame: Flame,
  swords: Swords,
  link: LinkIcon,
  waves: Waves,
  target: Target,
  shapes: Shapes,
  crown: Crown,
  hand: Hand,
  scroll: ScrollText,
  'trending-up': TrendingUp,
};

function AchievementCard({ achievement }: { achievement: Achievement }) {
  const Icon = ACHIEVEMENT_ICONS[achievement.icon] ?? Award;
  return (
    <li className={`panel flex gap-4 p-4 ${achievement.unlocked ? 'border-amber/30' : ''}`}>
      <span
        className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl border ${
          achievement.unlocked ? 'border-amber/40 bg-amber/10 text-amber shadow-[0_0_24px_-8px_#f5b041]' : 'border-white/10 bg-white/[0.03] text-fg-faint'
        }`}
      >
        {achievement.unlocked ? <Icon className="h-5 w-5" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`font-display text-sm font-semibold uppercase tracking-[0.12em] ${achievement.unlocked ? 'text-fg' : 'text-fg-muted'}`}>{achievement.name}</p>
          <span className="hud-value shrink-0 text-xs text-fg-faint">
            {formatNumber(achievement.progress)} / {formatNumber(achievement.threshold)}
          </span>
        </div>
        <p className="mt-0.5 text-[13px] leading-snug text-fg-muted">{achievement.description}</p>
        <Meter className="mt-2.5" value={achievement.progress} max={achievement.threshold} tone={achievement.unlocked ? 'warning' : 'neutral'} label={`${achievement.name} progress`} />
        {achievement.unlocked && <p className="mt-1.5 text-[11px] text-fg-faint">Unlocked {formatDateTime(achievement.unlocked_at)}</p>}
      </div>
    </li>
  );
}

function TrainingPanel({ training }: { training: TrainingProgress }) {
  return (
    <section className="panel p-5" aria-label="Training progress">
      <PanelHeading icon={GraduationCap} title="Training progress" aside={<Badge tone={training.model_ready ? 'success' : 'warning'}>{training.model_ready ? 'Model ready' : 'No model'}</Badge>} />
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 flex justify-between text-sm">
            <span className="text-fg-muted">Signs the model recognises</span>
            <span className="hud-value text-fg">
              {training.signs_trained} / {training.signs_total}
            </span>
          </div>
          <Meter value={training.signs_trained} max={training.signs_total} tone="success" label="Signs trained" />
        </div>
        <div>
          <div className="mb-1.5 flex justify-between text-sm">
            <span className="text-fg-muted">Signs with recorded samples</span>
            <span className="hud-value text-fg">
              {training.signs_with_samples} / {training.signs_total}
            </span>
          </div>
          <Meter value={training.signs_with_samples} max={training.signs_total} tone="info" label="Signs with samples" />
        </div>
        <p className="text-xs text-fg-faint">{formatNumber(training.total_samples)} samples recorded in total.</p>
      </div>
      <ButtonLink to="/training" className="mt-5 w-full" icon={GraduationCap}>
        Open Training Studio
      </ButtonLink>
    </section>
  );
}

function ActivationTable({ activations }: { activations: ActivationRecord[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-sm">
        <caption className="sr-only">Previously activated jutsu, newest first</caption>
        <thead>
          <tr className="border-b border-white/[0.07] text-left">
            {['When', 'Jutsu', 'Sequence', 'Combo', 'Points'].map((heading, index) => (
              <th key={heading} scope="col" className={`eyebrow pb-3 font-semibold ${index >= 3 ? 'text-right' : ''}`}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {activations.map((activation) => {
            const meta = elementMeta(activation.element);
            return (
              <tr key={activation.id} className="border-b border-white/[0.04] transition hover:bg-white/[0.02]">
                <td className="whitespace-nowrap py-3 pr-4 text-fg-muted">{formatDateTime(activation.created_at)}</td>
                <td className="py-3 pr-4">
                  <span className="flex items-center gap-2 font-display font-semibold uppercase tracking-[0.1em] text-fg">
                    <meta.icon className="h-4 w-4 shrink-0" style={{ color: meta.color }} aria-hidden />
                    {activation.jutsu_name}
                  </span>
                </td>
                <td className="py-3 pr-4 text-fg-muted">{activation.sequence.map(titleCase).join(' → ')}</td>
                <td className="hud-value py-3 text-right text-fg">x{activation.combo}</td>
                <td className="hud-value py-3 text-right text-accent-soft">+{activation.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function HistoryPage() {
  const { data, loading, error, offline, reload } = useApi(api.history);
  const { push } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  const clear = async () => {
    setClearing(true);
    try {
      await api.clearHistory();
      push('info', 'History cleared', 'Activations, stats and achievements were reset. Training data was kept.');
      await reload();
    } catch (failure) {
      push('error', 'Could not clear history', errorMessage(failure));
    } finally {
      setClearing(false);
      setConfirm(false);
    }
  };

  const unlocked = data?.achievements.filter((achievement) => achievement.unlocked).length ?? 0;

  return (
    <Page>
      <PageHeader
        eyebrow="History & Achievements"
        title="Your record"
        description="Every jutsu you have activated, your best runs, and the milestones you have reached."
        actions={
          data && data.stats.total_activations + data.stats.incorrect_sequences > 0 ? (
            <Button variant="danger" icon={Trash2} onClick={() => setConfirm(true)}>
              Clear history
            </Button>
          ) : undefined
        }
      />

      {loading ? (
        <LoadingGrid count={4} className="h-28" />
      ) : error || !data ? (
        <ErrorState message={error ?? 'Your history could not be loaded.'} offline={offline} onRetry={() => void reload()} />
      ) : (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Jutsu activated" value={formatNumber(data.stats.total_activations)} hint={`${data.stats.distinct_jutsu} of ${data.stats.jutsu_total} different jutsu`} icon={Zap} />
            <StatTile label="Total score" value={formatNumber(data.stats.total_score)} hint="Points from all activations" icon={Trophy} />
            <StatTile label="Best combo" value={`x${data.stats.best_combo}`} hint="Consecutive jutsu without a mistake" icon={Flame} />
            <StatTile
              label="Accuracy"
              value={percent(data.stats.accuracy)}
              hint={`${data.stats.incorrect_sequences} incorrect ${data.stats.incorrect_sequences === 1 ? 'sequence' : 'sequences'}`}
              icon={Target}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="panel p-5" aria-label="Activation history">
              <PanelHeading icon={History} title="Activated jutsu" aside={<span className="text-xs text-fg-faint">Latest {data.activations.length}</span>} />
              {data.activations.length ? (
                <ActivationTable activations={data.activations} />
              ) : (
                <EmptyState
                  icon={Swords}
                  title="No jutsu activated yet"
                  description="Complete a hand-sign sequence in the arena and it will be recorded here."
                  action={
                    <ButtonLink to="/play" variant="primary" icon={Swords}>
                      Enter the arena
                    </ButtonLink>
                  }
                />
              )}
            </section>
            <TrainingPanel training={data.training} />
          </div>

          <section aria-label="Achievements">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold uppercase text-fg">
                <Award className="h-5 w-5 text-amber" aria-hidden /> Achievements
              </h2>
              <Badge tone="warning">
                {unlocked} / {data.achievements.length} unlocked
              </Badge>
            </div>
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.achievements.map((achievement) => (
                <AchievementCard key={achievement.id} achievement={achievement} />
              ))}
            </ul>
          </section>
        </div>
      )}

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Clear all history?"
        description="This permanently deletes every recorded activation, your stats and your unlocked achievements."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="danger" icon={Trash2} loading={clearing} onClick={() => void clear()}>
              Clear history
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">Your training samples, trained model and settings are not affected.</p>
      </Modal>
    </Page>
  );
}
