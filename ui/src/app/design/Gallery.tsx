'use client';
// The living gallery at /design: every token and every primitive in its states. It doubles as the visual check
// for F-16, so it shows real states side by side rather than one example of each.
import { clsx } from 'clsx';
import {
  Bell,
  Check,
  CircleSlash,
  CloudRain,
  Command,
  Copy,
  Database,
  Disc3,
  Flashlight,
  Gavel,
  Inbox,
  ListChecks,
  MessageCircle,
  PartyPopper,
  Play,
  Plus,
  RotateCcw,
  Shuffle,
  Siren,
  SquareTerminal,
  Undo2,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Button,
  CUES,
  CUE_NAMES,
  Card,
  DURATION_MS,
  Dialog,
  EmptyState,
  FlipNumber,
  IconButton,
  Kbd,
  Meter,
  Panel,
  Pill,
  ProgressBar,
  Scoreline,
  Segmented,
  Skeleton,
  Switch,
  Tabs,
  Tooltip,
  celebrate,
  confetti,
  contrastRatio,
  floodlights,
  listItem,
  play,
  toast,
  useReducedMotion,
  useSettings,
  variantsFor,
  type Cue,
  type ReducedMotionSetting,
} from '@/design';

const SURFACE_BG = '#0B1020';

type Swatch = { token: string; hex: string; use: string; text?: boolean };
const SURFACES: Swatch[] = [
  { token: 'night-950', hex: '#070A12', use: 'Page' },
  { token: 'night-900', hex: '#0B1020', use: 'Base surface' },
  { token: 'night-800', hex: '#111833', use: 'Raised, cards' },
  { token: 'night-700', hex: '#1A2344', use: 'Hover, strong edge' },
  { token: 'night-600', hex: '#27325C', use: 'Hairlines' },
];
const INKS: Swatch[] = [
  { token: 'chalk', hex: '#EEF2FA', use: 'Primary text', text: true },
  { token: 'chalk-dim', hex: '#A9B4CC', use: 'Secondary text', text: true },
  { token: 'chalk-faint', hex: '#6F7B97', use: 'Tertiary, disabled', text: true },
];
const SIGNALS: Swatch[] = [
  { token: 'flood-400', hex: '#FFB347', use: 'Accent, hover', text: true },
  { token: 'flood-500', hex: '#FF9A1F', use: 'Accent: actions, focus, XP', text: true },
  { token: 'flood-600', hex: '#E67E00', use: 'Accent, pressed', text: true },
  { token: 'turf', hex: '#2EE281', use: 'Passed, live', text: true },
  { token: 'wicket', hex: '#FF5468', use: 'Failed, danger', text: true },
  { token: 'sky', hex: '#5CC8FF', use: 'Info, links, focus ring', text: true },
  { token: 'cap-purple', hex: '#B58CFF', use: 'Rare: caps, streaks', text: true },
];

const CUE_ICON: Record<Cue, ReactNode> = {
  tick: <Disc3 size={16} aria-hidden />,
  msg: <MessageCircle size={16} aria-hidden />,
  tock: <Gavel size={16} aria-hidden />,
  out: <CircleSlash size={16} aria-hidden />,
  flip: <ListChecks size={16} aria-hidden />,
  roar: <PartyPopper size={16} aria-hidden />,
  pager: <Siren size={16} aria-hidden />,
};

function Section({
  n,
  title,
  lede,
  children,
}: {
  n: string;
  title: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`s-${n}`} className="scroll-mt-24 py-14">
      <div className="mb-8 grid grid-cols-[56px_1fr] items-baseline gap-x-2">
        <span
          aria-hidden
          className="tabular font-display text-2xl font-bold leading-none text-flood-500"
        >
          {n}
        </span>
        <h2
          id={`s-${n}`}
          className="font-display text-2xl font-semibold uppercase leading-none tracking-[0.04em] text-chalk"
        >
          {title}
        </h2>
        <p className="col-start-2 mt-2.5 max-w-2xl text-md text-chalk-dim">{lede}</p>
      </div>
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="label-caps mb-3 text-[11px] text-chalk-dim">{children}</div>;
}

function SwatchTile({ s, big }: { s: Swatch; big?: boolean }) {
  const ratio = contrastRatio(s.hex, SURFACE_BG);
  const grade = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'Large' : '';
  return (
    <div className="overflow-hidden rounded-md border border-night-600/80 bg-night-900 shadow-raise">
      <div
        className={clsx('relative flex items-end p-3', big ? 'h-24' : 'h-20')}
        style={{ background: s.hex, boxShadow: 'inset 0 -1px 0 rgb(255 255 255 / 0.06)' }}
      >
        {s.text && (
          <span className="font-display text-xl font-bold" style={{ color: SURFACE_BG }}>
            Aa
          </span>
        )}
      </div>
      <div className="space-y-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <code className="font-mono text-xs font-medium text-chalk">{s.token}</code>
          <span className="font-mono text-[11px] uppercase text-chalk-dim">{s.hex}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-chalk-dim">{s.use}</span>
          {s.text && (
            <span className="tabular shrink-0 font-mono text-[11px] text-chalk-dim">
              {ratio.toFixed(2)}
              {grade && (
                <span className={clsx('ml-1', grade === 'Large' ? 'text-flood-400' : 'text-turf')}>
                  {grade}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the HUD (signature moment: scoreboard) */

function Hud({ xp }: { xp: number }) {
  const sound = useSettings((s) => s.sound);
  const toggleSound = useSettings((s) => s.toggleSound);
  return (
    <header className="sticky top-0 z-40 border-b border-night-600/70 bg-night-950/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-6 px-8">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="relative grid size-7 place-items-center rounded-sm bg-flood-500 text-on-flood shadow-glow"
          >
            <Zap size={15} strokeWidth={2.5} />
          </span>
          <span className="font-display text-xl font-bold uppercase leading-none tracking-[0.06em] text-chalk">
            Redis Quest
          </span>
        </div>
        <span aria-hidden className="h-6 w-px bg-night-600" />
        <nav aria-label="Gallery sections" className="hidden items-center gap-1 lg:flex">
          {[
            ['01', 'Palette'],
            ['02', 'Type'],
            ['03', 'Controls'],
            ['04', 'Surfaces'],
            ['05', 'Data'],
            ['06', 'Motion & sound'],
          ].map(([n, t]) => (
            <a
              key={n}
              href={`#s-${n}`}
              className="rounded-sm px-2.5 py-1.5 text-sm font-medium text-chalk-dim no-underline transition-colors duration-fast hover:bg-night-800 hover:text-chalk"
            >
              {t}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-5">
          <Pill variant="status" tone="turf" live>
            Stack live
          </Pill>
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-sm font-semibold text-chalk">Asha</div>
              <div className="label-caps text-[10.5px] text-chalk-dim">Rank 14 · Opener</div>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-night-600 bg-night-900 py-1 pl-2.5 pr-1.5 shadow-hairline">
              <span className="label-caps text-[11px] text-flood-400">XP</span>
              <FlipNumber value={xp} minDigits={4} size="sm" label="XP" />
            </div>
          </div>
          <IconButton
            label={sound ? 'Sound on' : 'Sound off'}
            icon={sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
            variant={sound ? 'ghost' : 'quiet'}
            aria-pressed={sound}
            onClick={() => {
              toggleSound();
              if (!sound) setTimeout(() => play('tick'), 30);
            }}
            tooltip
          />
        </div>
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------- the hero: a third-umpire review */

type Verdict = 'idle' | 'pending' | 'passed';
const CHECKS = [
  'The leaderboard key exists',
  'Reads come from Redis, not Postgres',
  'Entries expire after 60 seconds',
  'p95 read under 5 ms',
];

function Review({ onPass, onReset }: { onPass: () => void; onReset: () => void }) {
  const [verdict, setVerdict] = useState<Verdict>('idle');
  const reduced = useReducedMotion();
  const item = variantsFor(listItem, reduced);
  const run = () => {
    setVerdict('pending');
    play('tick');
    setTimeout(() => {
      setVerdict('passed');
      onPass();
      celebrate();
    }, 1500);
  };
  return (
    <Card focal padding="none" className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-night-600/70 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="label-caps text-xs text-chalk-dim">Over 3 · Ball 4</span>
          <Pill tone="cap" size="sm">
            Caching
          </Pill>
        </div>
        <Pill
          variant="status"
          tone={verdict === 'passed' ? 'turf' : verdict === 'pending' ? 'flood' : 'neutral'}
          live={verdict === 'pending'}
        >
          {verdict === 'passed'
            ? 'Passed'
            : verdict === 'pending'
              ? 'Decision pending'
              : 'Not checked'}
        </Pill>
      </div>
      <div className="px-5 pb-5 pt-4">
        <h3 className="font-display text-[26px] font-semibold uppercase leading-tight tracking-[0.02em] text-chalk">
          Cache the leaderboard
        </h3>
        <p className="mt-1 text-md text-chalk-dim">
          The scoreboard query hits Postgres on every refresh. Put the top 10 in Redis with a 60
          second expiry.
        </p>
        <motion.ol initial="hidden" animate="show" className="mt-4 space-y-1.5" aria-label="Checks">
          {CHECKS.map((c, i) => {
            const state = verdict === 'passed' ? 'pass' : verdict === 'pending' ? 'wait' : 'idle';
            return (
              <motion.li
                key={c + verdict}
                custom={i}
                variants={item}
                className="flex items-center gap-3 rounded-sm border border-night-600/60 bg-night-950/50 px-3 py-2 text-md"
              >
                <span
                  className={clsx(
                    'grid size-5 shrink-0 place-items-center rounded-full border',
                    state === 'pass' && 'border-turf/50 bg-turf/15 text-turf',
                    state === 'wait' && 'border-flood-500/50 text-flood-400',
                    state === 'idle' && 'border-night-600 text-chalk-faint',
                  )}
                >
                  {state === 'pass' ? (
                    <Check size={12} strokeWidth={3} aria-hidden />
                  ) : state === 'wait' ? (
                    <span className="ds-still size-1.5 animate-live rounded-full bg-flood-500" />
                  ) : (
                    <span className="size-1.5 rounded-full bg-night-600" />
                  )}
                </span>
                <span className={clsx(state === 'pass' ? 'text-chalk' : 'text-chalk-dim')}>
                  {c}
                </span>
                {state === 'pass' && (
                  <span className="tabular ml-auto font-mono text-xs text-turf">ok</span>
                )}
              </motion.li>
            );
          })}
        </motion.ol>
        <div className="mt-5 flex items-center gap-3">
          <Button
            size="lg"
            loading={verdict === 'pending'}
            loadingText="Decision pending"
            shortcut="⌘↵"
            onClick={run}
            disabled={verdict === 'passed'}
            leading={<Play size={16} aria-hidden />}
          >
            Check my work
          </Button>
          {verdict === 'passed' && (
            <Button
              variant="quiet"
              size="lg"
              leading={<RotateCcw size={16} aria-hidden />}
              onClick={() => {
                setVerdict('idle');
                onReset();
              }}
            >
              Reset
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- motion demos */

function DurationTrack({ name, ms }: { name: string; ms: number }) {
  const [on, setOn] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        setOn((v) => !v);
        play('tick');
      }}
      className="group grid w-full cursor-pointer grid-cols-[88px_1fr_56px] items-center gap-4 rounded-sm px-2 py-2 text-left transition-colors duration-fast hover:bg-night-800/70"
    >
      <code className="font-mono text-xs text-chalk">{name}</code>
      <span className="relative h-6 rounded-full bg-night-800 shadow-[inset_0_1px_2px_rgb(0_0_0/0.5)]">
        <span
          className="absolute left-1 top-1 size-4 rounded-full bg-flood-500 shadow-[0_0_10px_rgb(255_154_31/0.8)] transition-[left] ease-out-expo"
          style={{ transitionDuration: `${ms}ms`, left: on ? 'calc(100% - 1.25rem)' : '0.25rem' }}
        />
      </span>
      <span className="tabular text-right font-mono text-xs text-chalk-dim">{ms}ms</span>
    </button>
  );
}

/* ---------------------------------------------------------------- the page */

export function Gallery() {
  const [xp, setXp] = useState(1240);
  const [score, setScore] = useState(182);
  const [dialog, setDialog] = useState<null | 'info' | 'danger'>(null);
  const [tab, setTab] = useState('brief');
  const [busy, setBusy] = useState(false);
  const sound = useSettings((s) => s.sound);
  const setSound = useSettings((s) => s.setSound);
  const volume = useSettings((s) => s.volume);
  const setVolume = useSettings((s) => s.setVolume);
  const motionSetting = useSettings((s) => s.reducedMotion);
  const setMotion = useSettings((s) => s.setReducedMotion);
  const reduced = useReducedMotion();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toast({
          title: 'Command palette',
          description: 'Arrives with the screens (cmdk is installed).',
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div data-ds="" className="min-h-dvh text-chalk">
        <Hud xp={xp} />

        <main className="mx-auto max-w-[1240px] px-8">
          {/* hero */}
          <div className="grid items-center gap-12 pb-10 pt-16 lg:grid-cols-[1.05fr_1fr]">
            <div>
              <div className="flex items-center gap-3">
                <span aria-hidden className="h-px w-8 bg-flood-500" />
                <span className="label-caps text-xs text-flood-400">Design system · F-16</span>
              </div>
              <h1 className="mt-5 font-display text-[88px] font-bold uppercase leading-[0.86] tracking-[0.01em] text-chalk">
                Night
                <br />
                <span className="text-flood-500 [text-shadow:0_0_42px_rgb(255_154_31/0.35)]">
                  match
                </span>
              </h1>
              <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-chalk-dim">
                A dark stadium under floodlights, read through a developer&apos;s tools. Every state
                change is shown, heard and animated the moment it happens. One loud thing per
                screen; everything else is quiet.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button
                  size="lg"
                  leading={<Flashlight size={18} aria-hidden />}
                  onClick={() => celebrate()}
                >
                  Sweep the lights
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  leading={
                    sound ? <Volume2 size={18} aria-hidden /> : <VolumeX size={18} aria-hidden />
                  }
                  onClick={() => {
                    setSound(!sound);
                    if (!sound) setTimeout(() => play('msg'), 30);
                  }}
                >
                  {sound ? 'Sound on' : 'Turn sound on'}
                </Button>
              </div>
              <div className="mt-10 grid max-w-[34rem] grid-cols-3 gap-6 border-t border-night-600/70 pt-6">
                <Scoreline label="Primitives" value={21} />
                <Scoreline label="Sound cues" value={CUE_NAMES.length} />
                <Scoreline label="Colours" value={16} unit="tokens" />
              </div>
            </div>
            <Review onPass={() => setXp((v) => v + 40)} onReset={() => setXp(1240)} />
          </div>

          <div className="rule-fade" />

          {/* 01 palette */}
          <Section
            n="01"
            title="Palette"
            lede="Deep night surfaces, chalk text, one accent: floodlight amber. Signals are kept for meaning. Contrast is measured against night-900."
          >
            <Label>Surfaces</Label>
            <div className="grid grid-cols-5 gap-3">
              {SURFACES.map((s) => (
                <SwatchTile key={s.token} s={s} big />
              ))}
            </div>
            <div className="mt-8 grid grid-cols-[3fr_7fr] gap-8">
              <div>
                <Label>Text</Label>
                <div className="grid gap-3">
                  {INKS.map((s) => (
                    <SwatchTile key={s.token} s={s} />
                  ))}
                </div>
              </div>
              <div>
                <Label>Accent and signals</Label>
                <div className="grid grid-cols-3 gap-3">
                  {SIGNALS.map((s) => (
                    <SwatchTile key={s.token} s={s} />
                  ))}
                  <div className="flex flex-col justify-between rounded-md border border-dashed border-night-600 p-4 text-sm text-chalk-dim">
                    <span className="label-caps text-[11px] text-chalk-dim">Rule</span>
                    <span>
                      <span className="text-chalk">chalk-faint</span> is for disabled and decorative
                      text only: it misses 4.5:1 on raised surfaces.
                    </span>
                  </div>
                  <div className="flex flex-col justify-between rounded-md border border-flood-500/40 bg-flood-500 p-4 text-on-flood shadow-glow">
                    <span className="label-caps text-[11px] text-on-flood/85">
                      on-flood · #1A1206
                    </span>
                    <span className="font-display text-2xl font-bold uppercase leading-none">
                      Text on accent 8.7:1
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-8 grid grid-cols-3 gap-3">
              <Card padding="md">
                <Label>Radii</Label>
                <div className="flex items-end gap-3">
                  {[
                    ['xs', 'rounded-xs'],
                    ['sm', 'rounded-sm'],
                    ['md', 'rounded-md'],
                    ['lg', 'rounded-lg'],
                    ['xl', 'rounded-xl'],
                  ].map(([n, c]) => (
                    <div key={n} className="flex flex-col items-center gap-2">
                      <span className={clsx('size-10 border border-night-600 bg-night-800', c)} />
                      <code className="font-mono text-[11px] text-chalk-dim">{n}</code>
                    </div>
                  ))}
                </div>
              </Card>
              <Card padding="md">
                <Label>Elevation</Label>
                <div className="flex items-end gap-4">
                  {[
                    ['hairline', 'shadow-hairline'],
                    ['raise', 'shadow-raise'],
                    ['pop', 'shadow-pop'],
                    ['glow', 'shadow-glow'],
                  ].map(([n, c]) => (
                    <div key={n} className="flex flex-col items-center gap-2">
                      <span
                        className={clsx(
                          'size-10 rounded-md border border-night-600 bg-night-800',
                          c,
                        )}
                      />
                      <code className="font-mono text-[11px] text-chalk-dim">{n}</code>
                    </div>
                  ))}
                </div>
              </Card>
              <Card padding="md">
                <Label>Hairlines</Label>
                <div className="space-y-3 pt-1">
                  <div className="h-px bg-night-600" />
                  <div className="h-px bg-night-600/60" />
                  <div className="rule-fade" />
                  <p className="text-xs text-chalk-dim">
                    1px <code className="font-mono text-chalk">night-600</code>, at 60% inside
                    cards, <code className="font-mono text-chalk">rule-fade</code> between sections.
                  </p>
                </div>
              </Card>
            </div>
          </Section>

          <div className="rule-fade" />

          {/* 02 type */}
          <Section
            n="02"
            title="Type"
            lede="Barlow Condensed for the scoreboard, Inter for reading, JetBrains Mono for the terminal. Numbers are always tabular."
          >
            <div className="grid grid-cols-[1.2fr_1fr] gap-6">
              <Card padding="lg" className="flex flex-col justify-between">
                <div className="label-caps text-xs text-chalk-dim">
                  Display · Barlow Condensed 700
                </div>
                <div className="mt-4 flex items-end gap-6">
                  <span className="tabular font-display text-[120px] font-bold leading-[0.8] text-chalk">
                    182<span className="text-chalk-faint">/</span>4
                  </span>
                  <span className="pb-1 font-display text-3xl font-semibold uppercase leading-none tracking-[0.04em] text-chalk-dim">
                    Over 14.3
                  </span>
                </div>
                <div className="mt-6 grid grid-cols-3 gap-4 border-t border-night-600/70 pt-4">
                  <div>
                    <div className="label-caps text-xs text-chalk-dim">Label caps</div>
                    <div className="label-caps mt-1 text-md text-chalk">Checks passed</div>
                  </div>
                  <div>
                    <div className="label-caps text-xs text-chalk-dim">Tabular</div>
                    <div className="tabular mt-1 font-display text-xl font-bold text-chalk">
                      1,111 / 8,808
                    </div>
                  </div>
                  <div>
                    <div className="label-caps text-xs text-chalk-dim">Mono</div>
                    <div className="mt-1 font-mono text-md text-chalk">ZADD lb 182 asha</div>
                  </div>
                </div>
              </Card>
              <Card padding="lg">
                <div className="label-caps text-xs text-chalk-dim">Scale</div>
                <ul className="mt-3 space-y-1.5">
                  {[
                    ['4xl', 64, 'text-4xl'],
                    ['3xl', 40, 'text-3xl'],
                    ['2xl', 28, 'text-2xl'],
                    ['xl', 22, 'text-xl'],
                    ['lg', 18, 'text-lg'],
                    ['base', 16, 'text-base'],
                    ['md', 14, 'text-md'],
                    ['sm', 13, 'text-sm'],
                    ['xs', 12, 'text-xs'],
                  ].map(([n, px, c]) => (
                    <li key={n} className="flex items-baseline gap-4 overflow-hidden">
                      <code className="w-20 shrink-0 font-mono text-[11px] text-chalk-dim">
                        {n} · {px}
                      </code>
                      <span
                        className={clsx(
                          'truncate font-display font-semibold uppercase leading-none text-chalk',
                          c as string,
                        )}
                      >
                        Rain delay
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-6">
              <Card padding="lg">
                <div className="label-caps text-xs text-chalk-dim">
                  Lesson text · Inter 16 / 1.6
                </div>
                <p className="mt-3 max-w-[60ch] text-base text-chalk">
                  The scoreboard asks Postgres for the top ten players every two seconds. Store the
                  answer in Redis with{' '}
                  <button
                    type="button"
                    onClick={() => toast.success('Copied to the terminal', 'SET lb:top10 … EX 60')}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-xs border border-sky/30 bg-sky/10 px-1.5 py-px align-baseline font-mono text-[0.85em] text-sky transition-colors duration-fast hover:border-sky/60 hover:bg-sky/15"
                  >
                    SET … EX 60
                  </button>{' '}
                  and read it from there first.
                </p>
                <p className="mt-3 text-md text-chalk-dim">
                  Secondary text is chalk-dim at 14px. Flavour lives here: the groundsman says the
                  covers come off at nine.
                </p>
              </Card>
              <Card
                tone="inset"
                padding="none"
                className="overflow-hidden font-mono text-[13px] leading-6"
              >
                <div className="flex items-center gap-2 border-b border-night-600/60 px-4 py-2">
                  <SquareTerminal size={14} className="text-chalk-dim" aria-hidden />
                  <span className="label-caps text-[11px] text-chalk-dim">
                    Terminal · JetBrains Mono
                  </span>
                </div>
                <div className="px-4 py-3">
                  <div>
                    <span className="text-flood-400">127.0.0.1:6379&gt;</span>{' '}
                    <span className="text-chalk">ZREVRANGE lb 0 2 WITHSCORES</span>
                  </div>
                  <div className="text-chalk-dim">1) &quot;asha&quot; 2) &quot;182&quot;</div>
                  <div className="text-chalk-dim">3) &quot;ravi&quot; 4) &quot;177&quot;</div>
                  <div>
                    <span className="text-flood-400">127.0.0.1:6379&gt;</span>{' '}
                    <span className="text-chalk">TTL lb:top10</span>
                  </div>
                  <div className="text-turf">(integer) 58</div>
                  <div>
                    <span className="text-flood-400">127.0.0.1:6379&gt;</span>{' '}
                    <span className="ds-still inline-block h-4 w-2 translate-y-0.5 animate-live bg-chalk/80" />
                  </div>
                </div>
              </Card>
            </div>
          </Section>

          <div className="rule-fade" />

          {/* 03 controls */}
          <Section
            n="03"
            title="Controls"
            lede="Tactile: a lit top edge, a press that sinks a pixel, a 2px sky focus ring. Plain words on every button."
          >
            <Card padding="lg">
              <div className="grid grid-cols-[96px_repeat(5,auto)] items-center gap-x-6 gap-y-5">
                <span />
                {['Small', 'Medium', 'Large', 'Disabled', 'Loading'].map((h) => (
                  <span key={h} className="label-caps text-[11px] text-chalk-dim">
                    {h}
                  </span>
                ))}
                {(['primary', 'ghost', 'quiet', 'danger'] as const).map((v) => (
                  <Row key={v} variant={v} />
                ))}
              </div>
            </Card>
            <div className="mt-6 grid grid-cols-3 gap-6">
              <Card padding="lg">
                <Label>Icon buttons and tooltips</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <IconButton label="Copy command" icon={<Copy size={16} />} />
                  <IconButton label="Run again" icon={<RotateCcw size={16} />} variant="quiet" />
                  <IconButton label="Add key" icon={<Plus size={18} />} variant="primary" />
                  <IconButton label="Delete key" icon={<X size={16} />} variant="danger" />
                  <IconButton label="Notifications" icon={<Bell size={14} />} size="sm" />
                  <Tooltip content="Open the command palette" shortcut="⌘K">
                    <Button variant="ghost" size="md" leading={<Command size={15} aria-hidden />}>
                      Palette
                    </Button>
                  </Tooltip>
                </div>
                <Label>
                  <span className="mt-6 block">Keys</span>
                </Label>
                <div className="flex flex-wrap items-center gap-4 text-sm text-chalk-dim">
                  <span className="flex items-center gap-1">
                    <Kbd>⌘</Kbd>
                    <Kbd>K</Kbd>
                    <span className="ml-1.5">palette</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Kbd>⌘</Kbd>
                    <Kbd>↵</Kbd>
                    <span className="ml-1.5">check</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Kbd>Esc</Kbd>
                    <span className="ml-1.5">close</span>
                  </span>
                </div>
              </Card>
              <Card padding="lg">
                <Label>Switch and segmented</Label>
                <div className="space-y-5">
                  <Switch checked={sound} onCheckedChange={setSound} label="Sound effects" />
                  <div>
                    <div id="motion-label" className="mb-2 text-sm text-chalk-dim">
                      Reduce motion
                    </div>
                    <Segmented<ReducedMotionSetting>
                      label="Reduce motion"
                      value={motionSetting}
                      onValueChange={setMotion}
                      options={[
                        { value: 'system', label: 'System' },
                        { value: 'on', label: 'Reduce' },
                        { value: 'off', label: 'Full' },
                      ]}
                    />
                    <p className="mt-2 text-xs text-chalk-dim">
                      Resolved:{' '}
                      <span className="text-chalk">
                        {reduced ? 'reduced (fades only)' : 'full motion'}
                      </span>
                    </p>
                  </div>
                </div>
              </Card>
              <Card padding="lg">
                <Label>Tabs</Label>
                <Tabs
                  label="Level"
                  value={tab}
                  onValueChange={setTab}
                  items={[
                    {
                      id: 'brief',
                      label: 'Brief',
                      content: (
                        <p className="text-md text-chalk-dim">
                          Arrow keys move between tabs, Home and End jump.
                        </p>
                      ),
                    },
                    {
                      id: 'hints',
                      label: 'Hints',
                      badge: (
                        <Pill size="sm" tone="flood">
                          2
                        </Pill>
                      ),
                      content: (
                        <p className="text-md text-chalk-dim">
                          Hints cost nothing; they just take a ball.
                        </p>
                      ),
                    },
                    {
                      id: 'keys',
                      label: 'Keys',
                      content: <Skeleton lines={3} />,
                    },
                  ]}
                />
              </Card>
            </div>
          </Section>

          <div className="rule-fade" />

          {/* 04 surfaces */}
          <Section
            n="04"
            title="Surfaces"
            lede="Solid night panels with a lit top edge and 1px hairlines. No glass. The focal card is the screen's one loud thing."
          >
            <div className="grid grid-cols-4 gap-4">
              <Card>
                <Label>Card · base</Label>
                <p className="text-md text-chalk-dim">night-900 on the page.</p>
              </Card>
              <Card tone="raised">
                <Label>Card · raised</Label>
                <p className="text-md text-chalk-dim">night-800, one step up.</p>
              </Card>
              <Card tone="inset">
                <Label>Card · inset</Label>
                <p className="text-md text-chalk-dim">A well for code and lists.</p>
              </Card>
              <Card interactive tabIndex={0} role="button" onClick={() => toast('Fixture opened')}>
                <Label>Card · interactive</Label>
                <p className="text-md text-chalk-dim">Lifts and brightens on hover.</p>
              </Card>
            </div>
            <div className="mt-6 grid grid-cols-[1.3fr_1fr] gap-6">
              <Panel
                eyebrow="Match view"
                title="Scoreboard of checks"
                icon={<ListChecks size={15} aria-hidden />}
                actions={
                  <>
                    <Pill variant="status" tone="flood" live>
                      Running
                    </Pill>
                    <IconButton
                      label="Run checks again"
                      icon={<RotateCcw size={14} />}
                      size="sm"
                      variant="quiet"
                    />
                  </>
                }
                footer={
                  <div className="flex items-center justify-between text-sm text-chalk-dim">
                    <span>3 of 5 checks passed</span>
                    <span className="flex gap-2">
                      <Button size="sm" variant="danger" onClick={() => setDialog('danger')}>
                        Flush all
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDialog('info')}>
                        Open dialog
                      </Button>
                    </span>
                  </div>
                }
              >
                <ul className="divide-y divide-night-600/50">
                  {[
                    ['Key lb:top10 exists', 'turf', 'Passed'],
                    ['TTL is between 1 and 60', 'turf', 'Passed'],
                    ['Hit rate over 90%', 'turf', 'Passed'],
                    ['App reads from Redis first', 'flood', 'Checking'],
                    ['No KEYS in the hot path', 'wicket', 'Failed'],
                  ].map(([t, tone, s]) => (
                    <li key={t} className="flex items-center justify-between py-2.5 text-md">
                      <span className="text-chalk">{t}</span>
                      <Pill
                        variant="status"
                        tone={tone as 'turf'}
                        size="sm"
                        live={s === 'Checking'}
                      >
                        {s}
                      </Pill>
                    </li>
                  ))}
                </ul>
              </Panel>
              <div className="flex flex-col gap-4">
                <Card padding="none" className="flex-1">
                  <EmptyState
                    icon={<Inbox size={22} aria-hidden />}
                    title="No caps yet"
                    action={
                      <Button size="sm" variant="ghost">
                        See the season
                      </Button>
                    }
                  >
                    Pass your first level and your first cap lands on this shelf.
                  </EmptyState>
                </Card>
                <Card tone="raised" className="flex items-center gap-4 border-sky/25">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sky/10 text-sky">
                    <CloudRain size={18} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-lg font-semibold uppercase tracking-[0.03em] text-chalk">
                      Rain delay
                    </div>
                    <div className="text-sm text-chalk-dim">
                      The stack is down. Bring it back with{' '}
                      <code className="font-mono text-chalk">scripts/start</code>
                    </div>
                  </div>
                  <IconButton
                    label="Copy command"
                    icon={<Copy size={15} />}
                    onClick={() => toast.success('Copied', 'scripts/start')}
                  />
                </Card>
              </div>
            </div>
          </Section>

          <div className="rule-fade" />

          {/* 05 data */}
          <Section
            n="05"
            title="Data"
            lede="Status in plain words with a light, progress and gauges that glow by threshold, and the scoreboard digits that flip."
          >
            <div className="grid grid-cols-[1.25fr_1fr] gap-6">
              <Card padding="lg">
                <Label>Scoreboard</Label>
                <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
                  <div>
                    <div className="label-caps mb-2 text-xs text-chalk-dim">Runs</div>
                    <FlipNumber value={score} minDigits={3} size="xl" label="Runs" />
                  </div>
                  <Scoreline label="XP" value={xp} flip minDigits={4} tone="flood" delta={40} />
                  <Scoreline label="Streak" value={6} unit="nights" />
                  <Scoreline label="Rank" value="#14" tone="turf" />
                </div>
                <div className="mt-6 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    leading={<Plus size={14} aria-hidden />}
                    onClick={() => setScore((s) => s + 1)}
                  >
                    Single
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    leading={<Plus size={14} aria-hidden />}
                    onClick={() => setScore((s) => s + 6)}
                  >
                    Six
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    leading={<Shuffle size={14} aria-hidden />}
                    onClick={() => setScore(Math.floor(Math.random() * 999))}
                  >
                    Random
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    leading={<Undo2 size={14} aria-hidden />}
                    onClick={() => setScore(182)}
                  >
                    Reset
                  </Button>
                </div>
              </Card>
              <Card padding="lg" className="col-start-2 row-span-2 row-start-1 space-y-5">
                <Label>Progress and meters</Label>
                <ProgressBar
                  label="Chapter 2 · The leaderboard"
                  value={7}
                  max={12}
                  valueText="7 / 12"
                />
                <ProgressBar label="Checks" value={100} tone="turf" size="sm" valueText="5 / 5" />
                <ProgressBar label="Waiting for the stack" />
                <Meter label="used_memory" value={38} valueText="38 MB" />
                <Meter label="Connections" value={78} valueText="78 / 100" />
                <Meter label="Eviction pressure" value={95} valueText="95%" />
                <div className="border-t border-night-600/70 pt-5">
                  <Label>Loading</Label>
                  <div className="flex items-center gap-4">
                    <Skeleton className="size-10 shrink-0 rounded-full" />
                    <div className="flex-1">
                      <Skeleton className="mb-3 h-3.5 w-1/3" />
                      <Skeleton lines={2} />
                    </div>
                  </div>
                </div>
              </Card>
              <Card padding="lg">
                <Label>Pills</Label>
                <div className="flex flex-wrap gap-2">
                  <Pill variant="status" tone="turf" live>
                    Live
                  </Pill>
                  <Pill variant="status" tone="turf">
                    Passed
                  </Pill>
                  <Pill variant="status" tone="wicket">
                    Failed
                  </Pill>
                  <Pill variant="status" tone="flood" live>
                    Decision pending
                  </Pill>
                  <Pill variant="status" tone="sky">
                    Info
                  </Pill>
                  <Pill variant="status" tone="cap">
                    Rare
                  </Pill>
                  <Pill variant="status">Locked</Pill>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Pill>strings</Pill>
                  <Pill tone="sky">sorted sets</Pill>
                  <Pill tone="flood">+40 XP</Pill>
                  <Pill tone="cap">Streak 6</Pill>
                  <Pill tone="turf" icon={<Database size={12} aria-hidden />}>
                    replica
                  </Pill>
                  <Pill tone="wicket" size="sm">
                    dangerous
                  </Pill>
                </div>
              </Card>
            </div>
          </Section>

          <div className="rule-fade" />

          {/* 06 motion and sound */}
          <Section
            n="06"
            title="Motion & sound"
            lede="Quick and physical. Transform and opacity only; reduced motion keeps fades of 150ms and drops every move, flip and burst. Sound is off until the player turns it on."
          >
            <div className="grid grid-cols-[1fr_1.2fr] gap-6">
              <Card padding="lg">
                <Label>Durations · ease-out-expo · click a track</Label>
                <div className="-mx-2">
                  {Object.entries(DURATION_MS).map(([n, ms]) => (
                    <DurationTrack key={n} name={n} ms={ms} />
                  ))}
                </div>
                <div className="mt-6 border-t border-night-600/70 pt-5">
                  <Label>Celebration</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      leading={<Flashlight size={15} aria-hidden />}
                      onClick={() => floodlights()}
                    >
                      Floodlights
                    </Button>
                    <Button
                      variant="ghost"
                      leading={<PartyPopper size={15} aria-hidden />}
                      onClick={() => confetti()}
                    >
                      Confetti
                    </Button>
                    <Button
                      leading={<Zap size={15} aria-hidden />}
                      onClick={() => {
                        celebrate({ cue: 'roar' });
                        setXp((v) => v + 120);
                      }}
                    >
                      Chapter complete
                    </Button>
                  </div>
                </div>
              </Card>
              <Card padding="lg">
                <div className="mb-3 flex items-center justify-between">
                  <span className="label-caps text-[11px] text-chalk-dim">
                    Sound cues · WebAudio, no files
                  </span>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-xs text-chalk-dim">
                      Volume
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={volume}
                        onChange={(e) => setVolume(Number(e.target.value))}
                        className="w-24 cursor-pointer accent-flood-500"
                      />
                    </label>
                    <Switch checked={sound} onCheckedChange={setSound} label="Sound" />
                  </div>
                </div>
                {!sound && (
                  <p className="mb-3 rounded-sm border border-night-600/70 bg-night-950/50 px-3 py-2 text-sm text-chalk-dim">
                    Sound is off, so <code className="font-mono text-chalk">play()</code> is silent.
                    Turn it on to hear each cue.
                  </p>
                )}
                <ul className="grid grid-cols-2 gap-2">
                  {CUE_NAMES.map((c) => (
                    <li key={c}>
                      <button
                        type="button"
                        onClick={() => play(c)}
                        className="group flex w-full cursor-pointer items-center gap-3 rounded-md border border-night-600/80 bg-night-900 px-3 py-2.5 text-left shadow-hairline transition-[border-color,background-color,transform] duration-fast ease-out-expo hover:border-flood-500/50 hover:bg-night-800 motion-ok:active:scale-[0.98]"
                      >
                        <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-night-800 text-chalk-dim transition-colors duration-fast group-hover:text-flood-400">
                          {CUE_ICON[c]}
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-baseline gap-2">
                            <code className="font-mono text-md font-medium text-chalk">{c}</code>
                            <span className="tabular font-mono text-[11px] text-chalk-dim">
                              {Math.round(CUES[c].duration * 1000)}ms
                            </span>
                          </span>
                          <span className="block truncate text-xs text-chalk-dim">
                            {CUES[c].when}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
            <Card padding="lg" className="mt-6">
              <Label>Toasts · toast() from anywhere</Label>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['Info', 'info', 'Stack is reachable again. Play resumes.'],
                    ['Passed', 'success', '+40 XP. Next ball is unlocked.'],
                    ['Careful', 'warn', 'FLUSHALL would clear every key.'],
                    ['Check failed', 'error', 'The app still reads from Postgres.'],
                  ] as const
                ).map(([t, tone, d]) => (
                  <Button
                    key={tone}
                    variant="ghost"
                    onClick={() =>
                      toast({
                        title: t,
                        description: d,
                        tone,
                        cue: tone === 'error' ? 'out' : tone === 'success' ? 'tock' : 'msg',
                        action:
                          tone === 'warn'
                            ? { label: 'Undo', onClick: () => toast('Undone') }
                            : undefined,
                      })
                    }
                  >
                    {t}
                  </Button>
                ))}
              </div>
            </Card>
          </Section>

          <footer className="flex items-center justify-between border-t border-night-600/70 py-8 text-sm text-chalk-dim">
            <span>Redis Quest · Night match design system</span>
            <span className="flex items-center gap-2">
              Busy state:
              <Button
                size="sm"
                variant="ghost"
                loading={busy}
                onClick={() => setBusy(true)}
                onBlur={() => setBusy(false)}
              >
                Save
              </Button>
            </span>
          </footer>
        </main>

        <Dialog
          open={dialog === 'info'}
          onClose={() => setDialog(null)}
          title="Third umpire"
          description="Checks run against your live Redis. Nothing leaves this machine."
          footer={
            <>
              <Button variant="quiet" onClick={() => setDialog(null)}>
                Not now
              </Button>
              <Button onClick={() => setDialog(null)} shortcut="↵">
                Check my work
              </Button>
            </>
          }
        >
          Focus is trapped inside, Escape closes, and focus returns to the button that opened it.
          The page behind is inert.
        </Dialog>
        <Dialog
          open={dialog === 'danger'}
          tone="danger"
          size="sm"
          onClose={() => setDialog(null)}
          title="Flush every key?"
          description="FLUSHALL clears the whole database, including your leaderboard."
          footer={
            <>
              <Button variant="quiet" onClick={() => setDialog(null)}>
                Keep my keys
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setDialog(null);
                  play('pager');
                  toast({ title: 'Flushed', description: 'All keys are gone.', tone: 'error' });
                }}
              >
                Flush all keys
              </Button>
            </>
          }
        />
      </div>
    </>
  );
}

function Row({ variant }: { variant: 'primary' | 'ghost' | 'quiet' | 'danger' }) {
  const label = {
    primary: 'Check my work',
    ghost: 'Show hint',
    quiet: 'Skip',
    danger: 'Flush all',
  }[variant];
  return (
    <>
      <code className="font-mono text-xs text-chalk-dim">{variant}</code>
      <div>
        <Button variant={variant} size="sm">
          {label}
        </Button>
      </div>
      <div>
        <Button variant={variant} size="md">
          {label}
        </Button>
      </div>
      <div>
        <Button variant={variant} size="lg">
          {label}
        </Button>
      </div>
      <div>
        <Button variant={variant} disabled>
          {label}
        </Button>
      </div>
      <div>
        <Button variant={variant} loading>
          {label}
        </Button>
      </div>
    </>
  );
}
