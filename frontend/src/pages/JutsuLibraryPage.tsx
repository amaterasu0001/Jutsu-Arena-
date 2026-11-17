import { motion } from 'framer-motion';
import { GraduationCap, Info, Lock, LockOpen, Pencil, Play, Plus, Repeat, Save, Swords, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { JutsuEffectPlayer } from '@/animations/JutsuEffectPlayer';
import { SequenceTrack, SignChip, type SignLookup } from '@/components/SequenceTrack';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Badge, PageHeader, type Tone } from '@/components/ui/primitives';
import { ErrorState, LoadingGrid, Notice } from '@/components/ui/States';
import { QUALITY_SCALE, useSettings } from '@/context/SettingsContext';
import { useToast } from '@/context/ToastContext';
import { useCatalog } from '@/hooks/useCatalog';
import { Page } from '@/layouts/AppLayout';
import { elementMeta } from '@/lib/elements';
import { plural } from '@/lib/format';
import { api, errorMessage } from '@/services/api';
import { sound } from '@/services/sound';
import type { Difficulty, Jutsu, Sign } from '@/types/api';

const DIFFICULTY_TONE: Record<Difficulty, Tone> = { Beginner: 'success', Intermediate: 'warning', Advanced: 'danger' };
const MIN_SIGNS = 1;
const MAX_SIGNS = 6;

// -- card ---------------------------------------------------------------------

function JutsuCard({ jutsu, lookup, onPreview, onEdit, index }: { jutsu: Jutsu; lookup: SignLookup; onPreview: () => void; onEdit: () => void; index: number }) {
  const meta = elementMeta(jutsu.element);
  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.4), duration: 0.4 }}
      className="panel panel-hover group flex flex-col overflow-hidden"
    >
      <div className="relative h-28 overflow-hidden border-b border-white/[0.06]">
        <div className="absolute inset-0" style={{ background: `radial-gradient(420px 160px at 20% 0%, ${meta.color}55, transparent 70%), linear-gradient(135deg, ${meta.color}22, transparent 60%)` }} aria-hidden />
        <meta.icon className="absolute -right-3 -top-3 h-32 w-32 opacity-[0.13] transition duration-500 group-hover:scale-110 group-hover:opacity-25" style={{ color: meta.glow }} aria-hidden />
        <div className="relative flex h-full items-end justify-between p-4">
          <span className="grid h-11 w-11 place-items-center rounded-xl border bg-ink-950/60 backdrop-blur" style={{ borderColor: `${meta.color}77` }}>
            <meta.icon className="h-5 w-5" style={{ color: meta.color }} aria-hidden />
          </span>
          <Badge tone={jutsu.unlocked ? 'success' : 'neutral'} icon={jutsu.unlocked ? LockOpen : Lock}>
            {jutsu.unlocked ? 'Unlocked' : 'Locked'}
          </Badge>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <p className="eyebrow" style={{ color: meta.glow }}>
          {jutsu.subtitle}
        </p>
        <h2 className="mt-1 text-xl font-bold uppercase text-fg">{jutsu.name}</h2>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge>{meta.label}</Badge>
          <Badge tone={DIFFICULTY_TONE[jutsu.difficulty]}>{jutsu.difficulty}</Badge>
          <Badge tone="accent">{jutsu.points} pts</Badge>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-fg-muted">{jutsu.description}</p>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">Sign sequence</p>
            <button type="button" onClick={onEdit} className="flex items-center gap-1 rounded text-[11px] font-medium text-fg-faint transition hover:text-accent-soft" aria-label={`Edit sequence for ${jutsu.name}`}>
              <Pencil className="h-3 w-3" aria-hidden /> Edit
            </button>
          </div>
          <SequenceTrack sequence={jutsu.sequence} lookup={lookup} missing={jutsu.missing_signs} size="sm" />
        </div>

        <p className="mt-3 min-h-[2.5rem] text-xs leading-relaxed text-fg-faint">
          {jutsu.unlocked
            ? jutsu.times_activated > 0
              ? `Activated ${plural(jutsu.times_activated, 'time')}.`
              : 'All signs are recognisable. Not activated yet.'
            : `Train ${jutsu.missing_signs.map((sign) => lookup(sign).name).join(', ')} to unlock.`}
        </p>

        {jutsu.effect === 'clone' && <ShadowCloneHint />}

        <div className="mt-auto flex gap-2 pt-4">
          <Button className="flex-1" icon={Play} onClick={onPreview}>
            Test effect
          </Button>
          {jutsu.unlocked ? (
            <ButtonLink className="flex-1" variant="primary" icon={Swords} to={`/play?jutsu=${jutsu.id}`}>
              Practice
            </ButtonLink>
          ) : (
            <ButtonLink className="flex-1" icon={GraduationCap} to={`/training?sign=${jutsu.missing_signs[0]}`}>
              Train signs
            </ButtonLink>
          )}
        </div>
      </div>
    </motion.article>
  );
}

function ShadowCloneHint() {
  return (
    <p className="mt-1 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-fg-muted">
      The clones are copied live from your camera the moment you form Ram.
      <Link to="/settings#shadow-clone" className="ml-auto shrink-0 text-accent-soft hover:underline">
        Options
      </Link>
    </p>
  );
}

// -- effect preview -----------------------------------------------------------

function PreviewModal({ jutsu, onClose }: { jutsu: Jutsu | null; onClose: () => void }) {
  const { settings } = useSettings();
  const [playKey, setPlayKey] = useState(0);
  const [playing, setPlaying] = useState(false);

  const play = useCallback(() => {
    if (!jutsu) return;
    setPlaying(true);
    setPlayKey((key) => key + 1);
    sound.unlock();
    if (jutsu.effect !== 'clone' || settings.clone_sound) sound.jutsu(jutsu.effect);
  }, [jutsu, settings.clone_sound]);

  useEffect(() => {
    if (!jutsu) return;
    // let the dialog finish opening so the effect is sized to the final stage
    const timer = window.setTimeout(play, 280);
    return () => window.clearTimeout(timer);
  }, [jutsu, play]);

  const meta = jutsu ? elementMeta(jutsu.element) : null;
  return (
    <Modal
      open={jutsu !== null}
      onClose={onClose}
      size="xl"
      title={jutsu ? `${jutsu.name} — effect test` : ''}
      description="A preview of the activation effect. Previews never award points or count as activations."
      footer={
        <>
          <Button icon={Repeat} onClick={play} disabled={playing}>
            Replay
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-ink-950">
        <div className="grid-backdrop absolute inset-0" aria-hidden />
        {meta && !playing && (
          <div className="absolute inset-0 grid place-items-center">
            <meta.icon className="h-16 w-16 opacity-30" style={{ color: meta.color }} aria-hidden />
          </div>
        )}
        <JutsuEffectPlayer effect={jutsu?.effect ?? null} playKey={playKey} quality={QUALITY_SCALE[settings.effects_quality]} onDone={() => setPlaying(false)} />
      </div>
      {jutsu?.effect === 'clone' && (
        <p className="mt-3 text-sm text-fg-muted">
          This preview shows only the smoke. In the arena, Shadow Clone captures you from your camera the moment you form Ram and every clone is a copy of
          you - so it needs you in the picture.
        </p>
      )}
    </Modal>
  );
}

// -- sequence editor ----------------------------------------------------------

function SequenceEditor({ jutsu, signs, lookup, onClose, onSaved }: { jutsu: Jutsu | null; signs: Sign[]; lookup: SignLookup; onClose: () => void; onSaved: (updated: Jutsu) => void }) {
  const [sequence, setSequence] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (jutsu) {
      setSequence(jutsu.sequence);
      setError(null);
    }
  }, [jutsu]);

  const last = sequence[sequence.length - 1];
  const full = sequence.length >= MAX_SIGNS;
  const unchanged = jutsu ? jutsu.sequence.join() === sequence.join() : true;

  const save = async () => {
    if (!jutsu) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.updateJutsuSequence(jutsu.id, sequence));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={jutsu !== null}
      onClose={onClose}
      size="lg"
      title={jutsu ? `Edit sequence — ${jutsu.name}` : ''}
      description={`Sequences are game-defined. Use ${MIN_SIGNS}–${MAX_SIGNS} signs; the same sign cannot appear twice in a row, and one sequence cannot be the start of another.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={Save} loading={saving} disabled={unchanged || sequence.length < MIN_SIGNS} onClick={() => void save()}>
            Save sequence
          </Button>
        </>
      }
    >
      <p className="eyebrow mb-2">Sequence ({sequence.length})</p>
      <div className="flex min-h-[3.5rem] flex-wrap items-center gap-2 rounded-xl border border-white/[0.07] bg-ink-900 p-3">
        {sequence.length === 0 && <span className="text-sm text-fg-faint">Add signs below to build the sequence.</span>}
        {sequence.map((signId, index) => (
          <button
            key={`${signId}-${index}`}
            type="button"
            onClick={() => setSequence((current) => current.filter((_, position) => position !== index))}
            className="group relative rounded-lg"
            aria-label={`Remove ${lookup(signId).name} (position ${index + 1})`}
          >
            <SignChip label={lookup(signId)} />
            <span className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-ink-600 text-fg-muted transition group-hover:bg-ember group-hover:text-white">
              <X className="h-2.5 w-2.5" aria-hidden />
            </span>
          </button>
        ))}
      </div>

      <p className="eyebrow mb-2 mt-5">Add a sign</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {signs.map((sign) => {
          const disabled = full || sign.id === last;
          return (
            <button
              key={sign.id}
              type="button"
              disabled={disabled}
              onClick={() => setSequence((current) => [...current, sign.id])}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition hover:border-accent/50 hover:bg-accent/10 disabled:pointer-events-none disabled:opacity-35"
            >
              <span className="text-lg leading-none text-fg-muted" aria-hidden>
                {sign.kanji}
              </span>
              <span className="min-w-0 flex-1 truncate font-display text-xs font-semibold uppercase tracking-[0.12em] text-fg">{sign.name}</span>
              <Plus className="h-3.5 w-3.5 text-fg-faint" aria-hidden />
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mt-4" role="alert">
          <Notice tone="danger" title="This sequence cannot be used">
            {error}
          </Notice>
        </div>
      )}
    </Modal>
  );
}

// -- page ---------------------------------------------------------------------

export default function JutsuLibraryPage() {
  const catalog = useCatalog();
  const { push } = useToast();
  const [filter, setFilter] = useState('all');
  const [preview, setPreview] = useState<Jutsu | null>(null);
  const [editing, setEditing] = useState<Jutsu | null>(null);

  const elements = useMemo(() => Array.from(new Set(catalog.jutsu.map((item) => item.element))), [catalog.jutsu]);
  const visible = filter === 'all' ? catalog.jutsu : filter === 'unlocked' ? catalog.jutsu.filter((item) => item.unlocked) : catalog.jutsu.filter((item) => item.element === filter);
  const unlocked = catalog.jutsu.filter((item) => item.unlocked).length;

  const chip = (value: string, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setFilter(value)}
      aria-pressed={filter === value}
      className={`rounded-lg border px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.14em] transition ${
        filter === value ? 'border-accent/60 bg-accent/15 text-fg' : 'border-white/10 text-fg-muted hover:border-white/25 hover:text-fg'
      }`}
    >
      {label}
    </button>
  );

  return (
    <Page>
      <PageHeader
        eyebrow="Jutsu Library"
        title="Know your arsenal"
        description="Every jutsu, its element, and the hand-sign sequence that triggers it. With the built-in recogniser every jutsu is playable right away; if you switch to a trained model, a jutsu needs all of its signs in that model."
        actions={!catalog.loading && !catalog.error ? <Badge tone="accent">{unlocked} / {catalog.jutsu.length} unlocked</Badge> : undefined}
      />

      {catalog.loading ? (
        <LoadingGrid count={6} className="h-[420px]" />
      ) : catalog.error ? (
        <ErrorState message={catalog.error} offline={catalog.offline} onRetry={() => void catalog.reload()} />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter jutsu">
            {chip('all', 'All')}
            {chip('unlocked', 'Unlocked')}
            {elements.map((element) => chip(element, elementMeta(element).label))}
          </div>

          {visible.length ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {visible.map((item, index) => (
                <JutsuCard key={item.id} jutsu={item} lookup={catalog.lookup} index={index} onPreview={() => setPreview(item)} onEdit={() => setEditing(item)} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-fg-muted">
              No jutsu match this filter.
            </div>
          )}

          {catalog.jutsuNote && (
            <div className="mt-8">
              <Notice icon={Info}>{catalog.jutsuNote} Edit any sequence here, or change them all in <code className="rounded bg-black/30 px-1 py-0.5 text-xs">backend/config/jutsu.json</code>.</Notice>
            </div>
          )}
        </>
      )}

      <PreviewModal jutsu={preview} onClose={() => setPreview(null)} />
      <SequenceEditor
        jutsu={editing}
        signs={catalog.signs}
        lookup={catalog.lookup}
        onClose={() => setEditing(null)}
        onSaved={(updated) => {
          setEditing(null);
          push('success', 'Sequence updated', `${updated.name}: ${updated.sequence.map((sign) => catalog.lookup(sign).name).join(' → ')}`);
          void catalog.reloadJutsu();
        }}
      />
    </Page>
  );
}
