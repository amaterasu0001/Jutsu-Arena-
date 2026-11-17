import { motion } from 'framer-motion';
import {
  ArrowRight,
  BookOpen,
  Brain,
  Camera,
  ChevronRight,
  Cpu,
  Flame,
  GraduationCap,
  Hand,
  Layers,
  ListChecks,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  Trophy,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Fragment } from 'react';
import { Link } from 'react-router-dom';

import { Emblem } from '@/components/Logo';
import { ParticleField } from '@/components/ParticleField';
import { SequenceTrack } from '@/components/SequenceTrack';
import { ButtonLink } from '@/components/ui/Button';
import { Badge, Meter, SectionTitle } from '@/components/ui/primitives';
import { useBackend } from '@/context/BackendContext';
import { useApi } from '@/hooks/useApi';
import { useCatalog } from '@/hooks/useCatalog';
import { elementMeta } from '@/lib/elements';
import { formatNumber, percent } from '@/lib/format';
import { api } from '@/services/api';

const ZODIAC = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

const reveal = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-80px' },
  transition: { duration: 0.5 },
} as const;

/** Rotating ring of the twelve zodiac characters around the emblem. Pure SVG/CSS. */
function SealRing() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[460px]" aria-hidden>
      <div className="absolute inset-[12%] rounded-full bg-accent/20 blur-3xl" />
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full animate-spin-slow">
        <circle cx="200" cy="200" r="188" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        <circle cx="200" cy="200" r="150" fill="none" stroke="rgb(var(--accent) / 0.45)" strokeWidth="1" strokeDasharray="2 10" />
        {ZODIAC.map((glyph, index) => {
          const angle = (index / ZODIAC.length) * Math.PI * 2 - Math.PI / 2;
          const x = 200 + Math.cos(angle) * 169;
          const y = 200 + Math.sin(angle) * 169;
          return (
            <text
              key={glyph}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              transform={`rotate(${(index / ZODIAC.length) * 360} ${x} ${y})`}
              fill={index % 3 === 0 ? 'rgb(var(--accent-soft))' : 'rgba(236,236,244,0.55)'}
              style={{ fontSize: 22, fontWeight: 600 }}
            >
              {glyph}
            </text>
          );
        })}
      </svg>
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full animate-spin-slower">
        <circle cx="200" cy="200" r="118" fill="none" stroke="rgba(62,166,255,0.4)" strokeWidth="1.5" strokeDasharray="60 22 6 22" />
        <circle cx="200" cy="200" r="96" fill="none" stroke="rgba(139,92,246,0.45)" strokeWidth="1" strokeDasharray="4 8" />
        {[0, 60, 120, 180, 240, 300].map((degrees) => (
          <rect key={degrees} x="197" y="76" width="6" height="12" rx="2" fill="rgba(62,166,255,0.8)" transform={`rotate(${degrees} 200 200)`} />
        ))}
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="relative grid h-36 w-36 place-items-center rounded-full border border-white/10 bg-ink-900/80 shadow-glow backdrop-blur">
          <span className="absolute inset-0 animate-pulse-ring rounded-full border border-accent/60" />
          <Emblem className="h-20 w-20" />
        </span>
      </div>
    </div>
  );
}

const STEPS: Array<{ icon: LucideIcon; title: string; text: string }> = [
  { icon: Camera, title: 'Start your camera', text: 'Your webcam feed is analysed in the browser. Only hand-landmark coordinates are sent to the local game server.' },
  { icon: Hand, title: 'Form the hand signs', text: 'Both hands are tracked at once — 21 landmarks each — and classified into one of the twelve signs.' },
  { icon: ListChecks, title: 'Chain the sequence', text: 'Hold each sign until it locks in, then flow into the next before the timer runs out.' },
  { icon: Flame, title: 'Unleash the jutsu', text: 'Complete a sequence to trigger its effect, score points and grow your combo.' },
];

const PIPELINE: Array<{ icon: LucideIcon; title: string; where: string }> = [
  { icon: Camera, title: 'Webcam', where: 'Browser' },
  { icon: ScanLine, title: 'Hand landmarks', where: 'Browser · MediaPipe' },
  { icon: Layers, title: 'Pose geometry', where: 'Server · NumPy' },
  { icon: Brain, title: 'Sign templates', where: 'Server · Built-in + calibration' },
  { icon: Target, title: 'Stable sign', where: 'Server · Smoothing' },
  { icon: Zap, title: 'Jutsu', where: 'Server · Sequence engine' },
];

const FEATURES: Array<{ icon: LucideIcon; title: string; text: string }> = [
  { icon: Hand, title: 'True two-hand tracking', text: 'Left and right hands are identified separately and their relative geometry is part of every prediction.' },
  { icon: GraduationCap, title: 'Works out of the box', text: 'All twelve signs are recognised from built-in pose templates. A short recording personalises any sign; a fully trained model is optional.' },
  { icon: ShieldCheck, title: 'No fake recognitions', text: 'Low-confidence frames are shown as “Unknown sign”. Nothing is accepted unless the model is confident and the pose is held.' },
  { icon: Sparkles, title: 'Original cinematic effects', text: 'Eight hand-built particle and 3D effects with synthesised sound — no borrowed footage, art or music.' },
  { icon: Trophy, title: 'Score, combos, achievements', text: 'Chain jutsu without a mistake to raise your multiplier, and unlock milestones as you improve.' },
  { icon: Cpu, title: 'Runs entirely on your machine', text: 'Video never leaves the browser. Training data, the model and your history stay in local files.' },
];

export default function HomePage() {
  const { online, health } = useBackend();
  const catalog = useCatalog();
  const history = useApi(api.history);
  const featured = catalog.jutsu.slice(0, 4);
  const stats = history.data?.stats;
  const achievements = history.data?.achievements ?? [];
  const nextAchievement = achievements.find((achievement) => !achievement.unlocked);
  const recognisable = health?.recognizable_signs.length ?? 0;
  const calibrated = health?.calibrated_signs.length ?? 0;
  const total = health?.signs_total ?? 12;

  return (
    <>
      {/* ---------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden border-b border-white/[0.06]">
        <div className="grid-backdrop absolute inset-0" aria-hidden />
        <ParticleField />
        <div className="relative mx-auto grid max-w-[1400px] items-center gap-12 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <motion.div initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <Badge tone="accent" icon={Sparkles}>
              AI hand-sign recognition
            </Badge>
            <h1 className="mt-5 text-4xl font-bold uppercase leading-[1.05] text-fg sm:text-5xl lg:text-6xl">
              Master the <span className="text-gradient">art of jutsu</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-fg-muted">Your hands are your weapon. Perform the signs. Unleash your power.</p>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-fg-faint">
              Naruto Jutsu Arena watches your hands through your webcam, recognises the signs you form in real time, and fires the matching jutsu when you complete a
              sequence.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink to="/play" variant="primary" size="lg" icon={Swords} iconRight={ArrowRight}>
                Enter the arena
              </ButtonLink>
              <ButtonLink to="/jutsu" size="lg" icon={BookOpen}>
                Explore jutsu
              </ButtonLink>
            </div>

            <dl className="mt-10 grid max-w-xl grid-cols-3 gap-4 border-t border-white/[0.07] pt-6">
              {[
                { label: 'Hand signs', value: '12' },
                { label: 'Jutsu', value: String(health?.jutsu_total ?? 8) },
                { label: 'Landmarks tracked', value: '42' },
              ].map((item) => (
                <div key={item.label}>
                  <dd className="hud-value text-3xl text-fg">{item.value}</dd>
                  <dt className="eyebrow mt-1">{item.label}</dt>
                </div>
              ))}
            </dl>
          </motion.div>

          <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.1 }}>
            <SealRing />
          </motion.div>
        </div>
      </section>

      <div className="mx-auto max-w-[1400px] space-y-24 px-4 py-20 sm:px-6">
        {/* ------------------------------------------------------ setup status */}
        {online && health && health.recognition_engine === 'none' && (
          <motion.section {...reveal} className="panel flex flex-col gap-5 border-amber/25 p-6 md:flex-row md:items-center md:justify-between" aria-label="Setup status">
            <div className="flex items-start gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-amber/30 bg-amber/10">
                <GraduationCap className="h-5 w-5 text-amber" aria-hidden />
              </span>
              <div>
                <h2 className="text-lg font-semibold uppercase text-fg">One step before you play</h2>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-muted">
                  The recogniser is set to use a trained model, but none has been trained yet. Train one in the Training Studio, or set Settings → Recognition engine back
                  to Auto to use the built-in recogniser.
                </p>
              </div>
            </div>
            <ButtonLink to="/training" variant="primary" icon={GraduationCap} iconRight={ArrowRight} className="shrink-0">
              Start training
            </ButtonLink>
          </motion.section>
        )}

        {/* ------------------------------------------------------ how it works */}
        <section aria-labelledby="how-it-works">
          <motion.div {...reveal}>
            <SectionTitle eyebrow="How it works" title="From hand sign to jutsu in four moves" description="No controller, no keyboard — the camera reads your hands and the game does the rest." />
          </motion.div>
          <h2 id="how-it-works" className="sr-only">
            How it works
          </h2>
          <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {STEPS.map((step, index) => (
              <motion.li key={step.title} {...reveal} transition={{ duration: 0.5, delay: index * 0.08 }} className="panel panel-hover relative overflow-hidden p-6">
                <span className="hud-value pointer-events-none absolute -right-2 -top-5 text-[88px] leading-none text-white/[0.035]">{index + 1}</span>
                <span className="grid h-11 w-11 place-items-center rounded-xl border border-accent/30 bg-accent/10">
                  <step.icon className="h-5 w-5 text-accent-soft" aria-hidden />
                </span>
                <h3 className="mt-4 text-base font-semibold uppercase text-fg">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{step.text}</p>
              </motion.li>
            ))}
          </ol>
        </section>

        {/* ---------------------------------------------------- featured jutsu */}
        <section aria-label="Featured jutsu">
          <motion.div {...reveal} className="flex flex-wrap items-end justify-between gap-4">
            <SectionTitle eyebrow="Featured jutsu" title="Sequences worth mastering" description="Each jutsu is triggered by its own chain of signs. Sequences are game-defined and fully editable." />
            <Link to="/jutsu" className="mb-8 flex items-center gap-1 font-display text-xs font-semibold uppercase tracking-[0.16em] text-accent-soft transition hover:text-fg">
              View all jutsu <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </motion.div>
          {catalog.loading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="skeleton h-56" />
              ))}
            </div>
          ) : catalog.error ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-fg-muted">
              The jutsu list is unavailable while the game server is offline. Start the backend to see it here.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {featured.map((jutsu, index) => {
                const meta = elementMeta(jutsu.element);
                return (
                  <motion.div key={jutsu.id} {...reveal} transition={{ duration: 0.5, delay: index * 0.08 }}>
                    <Link to="/jutsu" className="panel panel-hover group relative flex h-full flex-col overflow-hidden p-5">
                      <div className="pointer-events-none absolute inset-0 opacity-25 transition group-hover:opacity-45" style={{ background: `radial-gradient(360px 180px at 100% 0%, ${meta.color}, transparent 70%)` }} aria-hidden />
                      <div className="relative flex items-center justify-between">
                        <span className="grid h-11 w-11 place-items-center rounded-xl border bg-ink-950/50" style={{ borderColor: `${meta.color}77` }}>
                          <meta.icon className="h-5 w-5" style={{ color: meta.color }} aria-hidden />
                        </span>
                        <Badge>{jutsu.difficulty}</Badge>
                      </div>
                      <p className="eyebrow relative mt-4" style={{ color: meta.glow }}>
                        {meta.label}
                      </p>
                      <h3 className="relative mt-1 text-lg font-bold uppercase text-fg">{jutsu.name}</h3>
                      <p className="relative mt-2 line-clamp-2 text-sm leading-relaxed text-fg-muted">{jutsu.description}</p>
                      <div className="relative mt-auto pt-4">
                        <SequenceTrack sequence={jutsu.sequence} lookup={catalog.lookup} size="sm" />
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          )}
        </section>

        {/* ------------------------------------------------- recognition intro */}
        <section className="grid items-center gap-10 lg:grid-cols-2 [&>*]:min-w-0" aria-label="Hand-sign recognition">
          <motion.div {...reveal}>
            <SectionTitle
              eyebrow="Hand-sign recognition"
              title="A real computer-vision pipeline"
              description="Nothing here is scripted. Each frame travels through landmark detection, scale-free pose measurements, sign matching and temporal smoothing before a sign is accepted."
            />
            <ul className="space-y-3 text-sm leading-relaxed text-fg-muted">
              {[
                'Landmarks are normalised to the wrist and hand size, so position and distance from the camera do not matter.',
                'A sign must stay confident across several consecutive frames — flickering predictions are ignored.',
                'The same sign is never counted twice in one hold; release it before it can register again.',
                'Sequence matching is a separate engine with timeouts, error recovery and duplicate-activation protection.',
              ].map((point) => (
                <li key={point} className="flex gap-3">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                  {point}
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink to="/signs" icon={Hand}>
                See the twelve signs
              </ButtonLink>
              <ButtonLink to="/training" variant="ghost" icon={GraduationCap}>
                Training Studio
              </ButtonLink>
            </div>
          </motion.div>

          <motion.div {...reveal} className="panel p-6">
            <p className="eyebrow mb-5">Per-frame pipeline</p>
            <ol className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-y-4">
              {PIPELINE.map((stage, index) => (
                <Fragment key={stage.title}>
                  <li className="rounded-xl border border-white/[0.07] bg-ink-900/70 p-2.5 text-center [overflow-wrap:anywhere] sm:p-3">
                    <stage.icon className="mx-auto h-5 w-5 text-accent-soft" aria-hidden />
                    <p className="mt-2 font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-fg">{stage.title}</p>
                    <p className="mt-1 text-[10.5px] leading-tight text-fg-faint">{stage.where}</p>
                  </li>
                  {index % 3 !== 2 && (
                    <li className="grid place-items-center px-1.5" aria-hidden>
                      <ChevronRight className="h-4 w-4 text-fg-faint" />
                    </li>
                  )}
                </Fragment>
              ))}
            </ol>
            <div className="hairline my-5" />
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-sm text-fg-muted">Signs the recogniser can detect</p>
                <p className="hud-value text-sm text-fg">{online ? `${recognisable} / ${total}` : '—'}</p>
              </div>
              <Meter value={online ? recognisable : 0} max={total} tone="success" label="Signs the active recogniser can detect" />
              <p className="mt-2 text-xs text-fg-faint">
                {online === false
                  ? 'Game server offline.'
                  : health?.recognition_engine === 'builtin'
                    ? `Built-in recogniser · ${calibrated} calibrated to your hands.`
                    : health?.recognition_engine === 'trained'
                      ? 'Using the model trained on your samples.'
                      : 'No recogniser available — see Settings → Recognition engine.'}
              </p>
            </div>
          </motion.div>
        </section>

        {/* ---------------------------------------------------------- features */}
        <section aria-label="Features">
          <motion.div {...reveal}>
            <SectionTitle eyebrow="Features" title="Built like a game, engineered like a tool" align="center" />
          </motion.div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {FEATURES.map((feature, index) => (
              <motion.article key={feature.title} {...reveal} transition={{ duration: 0.5, delay: (index % 3) * 0.08 }} className="panel panel-hover p-6">
                <feature.icon className="h-6 w-6 text-accent-soft" aria-hidden />
                <h3 className="mt-4 text-base font-semibold uppercase text-fg">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{feature.text}</p>
              </motion.article>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------ your progress */}
        <motion.section {...reveal} className="panel relative overflow-hidden p-6 md:p-10" aria-label="Your progress">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/15 blur-3xl" aria-hidden />
          <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
            <div>
              <p className="eyebrow !text-accent-soft">Your progress</p>
              <h2 className="mt-2 text-2xl font-bold uppercase text-fg md:text-3xl">Every cast is recorded</h2>
              <p className="mt-3 max-w-md text-[15px] leading-relaxed text-fg-muted">Scores, combos and achievements are saved locally and waiting for you in the history view.</p>
              {nextAchievement && (
                <div className="mt-6 max-w-md rounded-xl border border-white/[0.07] bg-ink-900/60 p-4">
                  <p className="eyebrow">Next achievement</p>
                  <p className="mt-1 font-display text-sm font-semibold uppercase tracking-[0.12em] text-fg">{nextAchievement.name}</p>
                  <p className="mt-0.5 text-[13px] text-fg-muted">{nextAchievement.description}</p>
                  <Meter className="mt-3" value={nextAchievement.progress} max={nextAchievement.threshold} tone="warning" label="Next achievement progress" />
                </div>
              )}
              <div className="mt-6 flex flex-wrap gap-3">
                <ButtonLink to="/play" variant="primary" icon={Swords}>
                  Start playing
                </ButtonLink>
                <ButtonLink to="/history" icon={Trophy}>
                  View history
                </ButtonLink>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-4">
              {[
                { label: 'Jutsu activated', value: stats ? formatNumber(stats.total_activations) : '—' },
                { label: 'Total score', value: stats ? formatNumber(stats.total_score) : '—' },
                { label: 'Best combo', value: stats ? `x${stats.best_combo}` : '—' },
                { label: 'Accuracy', value: stats ? percent(stats.accuracy) : '—' },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/[0.07] bg-ink-900/60 p-5">
                  <dt className="eyebrow">{item.label}</dt>
                  <dd className="hud-value mt-2 text-3xl text-fg">{item.value}</dd>
                </div>
              ))}
              <p className="col-span-2 text-xs text-fg-faint">
                {history.error ? 'Stats are unavailable while the game server is offline.' : `${achievements.filter((a) => a.unlocked).length} of ${achievements.length} achievements unlocked.`}
              </p>
            </dl>
          </div>
        </motion.section>
      </div>
    </>
  );
}
