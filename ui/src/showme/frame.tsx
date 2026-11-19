'use client';
// The shared frame of every show-me panel: card, icon, title, key in mono, type pill, live light, and (in hands-on
// mode) the command line under the panel. Plus the small live-data helpers: change flashes and ticking numbers.
import { clsx } from 'clsx';
import { Check, Copy, Lock, Terminal } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Pill, play, toast, useReducedMotion } from '@/design';
import { api } from '../api';
import { runCommand, type Ran } from './commands';
import { refreshRedisNow } from './useRedis';
import styles from './showme.module.css';

// ---- hands-on context ------------------------------------------------------------------------------------------
export interface HandsOn {
  /** Sends one command; resolves true when Redis accepted it. */
  run: (argv: string[]) => Promise<boolean>;
  last: Ran | null;
  busy: boolean;
}

export interface FrameState {
  /** The panel was asked to be hands-on (a passed level, or the practice gallery). */
  interactive: boolean;
  /** Hands-on is on and the key may be changed; null when it may not or is not offered. */
  hands: HandsOn | null;
  /** The key is under the engine's prefix: the panel reads it and says why it will not change it. */
  locked: boolean;
  /** Data is the gallery's fixed sample, not a live read. */
  sample: boolean;
}

export const FrameContext = createContext<FrameState>({
  interactive: false,
  hands: null,
  locked: false,
  sample: false,
});

export function useFrame(): FrameState {
  return useContext(FrameContext);
}

/** Owns the "ran:" line for one panel and sends gestures through api.cli. */
export function useRunner(): HandsOn {
  const [last, setLast] = useState<Ran | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(async (argv: string[]) => {
    setBusy(true);
    const ran = await runCommand(argv, api.cli);
    if (!alive.current) return ran.ok;
    setLast(ran);
    setBusy(false);
    play(ran.ok ? 'tick' : 'out');
    if (ran.ok) refreshRedisNow();
    return ran.ok;
  }, []);
  return useMemo(() => ({ run, last, busy }), [run, last, busy]);
}

// ---- live helpers -----------------------------------------------------------------------------------------------
/** Ids that are new since the previous render (never on the first one); each stays marked for `ms`. */
export function useFresh(ids: string[], ms = 1500): Set<string> {
  const prev = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const joined = ids.join('\u0001');
  useEffect(() => {
    const list = joined === '' ? [] : joined.split('\u0001');
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (prev.current) {
      const before = prev.current;
      const added = list.filter((i) => !before.has(i));
      if (added.length > 0) {
        setFresh(new Set(added));
        timer = setTimeout(() => setFresh(new Set()), ms);
      }
    }
    prev.current = new Set(list);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [joined, ms]);
  return fresh;
}

/** Class for a row or cell that just changed. */
export const freshClass = (on: boolean): string | undefined => (on ? styles.fresh : undefined);

/** A number that counts from its old value to the new one (instantly under reduced motion). */
export function useTween(value: number, ms = 600): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced || from.current === value || Math.abs(value - from.current) > 1e7) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      from.current = a + (value - a) * eased;
      setShown(Math.round(from.current));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, reduced]);
  return shown;
}

/** A number that ticks to its new value and glows when it changes. Plain text, so screen readers and tests read it. */
export function Num({
  value,
  format = (n) => String(n),
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const shown = useTween(value);
  const fresh = useFresh([String(value)]);
  return (
    <span className={clsx('tabular', className, fresh.size > 0 && styles.freshText)}>
      {format(shown)}
    </span>
  );
}

// ---- small building blocks ---------------------------------------------------------------------------------------
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="showme-empty rounded-md border border-dashed border-night-600 bg-night-950/40 px-4 py-5 text-center text-md text-chalk-dim">
      {children}
    </p>
  );
}

export function Facts({
  items,
  testId,
  cols = 2,
}: {
  items: { label: string; value: ReactNode; fresh?: boolean }[];
  testId?: string;
  cols?: 2 | 3;
}) {
  return (
    <dl
      data-testid={testId}
      className={clsx(
        'grid gap-px overflow-hidden rounded-md border border-night-600/70 bg-night-600/50',
        cols === 3 ? 'grid-cols-3' : 'grid-cols-2',
      )}
    >
      {items.map((it) => (
        <div key={it.label} className={clsx('bg-night-900 px-3 py-2', it.fresh && styles.fresh)}>
          <dt className="label-caps text-xs text-chalk-dim">{it.label}</dt>
          <dd className="tabular mt-0.5 break-words text-md text-chalk">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** p99-style sparkline; the last value is printed. */
export function Spark({
  values,
  label,
  unit,
  fmt = (n) => n.toFixed(0),
  period = 'seconds',
}: {
  values: number[];
  label: string;
  unit: string;
  fmt?: (n: number) => string;
  period?: string;
}) {
  const W = 240;
  const H = 56;
  const max = Math.max(1, ...values);
  const xy = values.map(
    (v, i) =>
      [
        values.length < 2 ? W : (i / (values.length - 1)) * W,
        H - 4 - (v / max) * (H - 12),
      ] as const,
  );
  const pts = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = values.length ? (values[values.length - 1] as number) : null;
  const tip = xy[xy.length - 1];
  return (
    <div
      data-testid={`metric-${label}`}
      className="rounded-md border border-night-600/70 bg-night-950/50 p-3"
    >
      <div className="flex items-baseline justify-between">
        <span className="label-caps text-xs text-chalk-dim">{label}</span>
        <strong className="tabular font-mono text-md font-medium text-chalk">
          {last === null ? 'no data' : `${fmt(last)} ${unit}`.trim()}
        </strong>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 h-14 w-full"
        role="img"
        aria-label={`${label} over the last ${values.length} ${period}`}
        preserveAspectRatio="none"
      >
        {values.length > 1 && (
          <polygon points={`0,${H} ${pts} ${W},${H}`} className="fill-flood-500/10" />
        )}
        <polyline
          points={pts}
          fill="none"
          className="stroke-flood-500"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {tip && <circle cx={tip[0]} cy={tip[1]} r="3" className="fill-flood-400" />}
      </svg>
    </div>
  );
}

// ---- the command line --------------------------------------------------------------------------------------------
function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          toast({ title: 'Copied', description: text, duration: 2000 });
        } catch {
          toast.warn('Could not copy', 'Select the command and copy it by hand.');
        }
      }}
      className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-sm text-chalk-dim transition-colors duration-fast hover:bg-night-700 hover:text-chalk active:bg-night-600"
    >
      {done ? <Check size={16} className="text-turf" /> : <Copy size={16} />}
    </button>
  );
}

/** "ran: <command>" under a hands-on panel: the lesson. `preview` shows what the next gesture would send. */
export function RanBar({
  last,
  preview,
  idle = false,
}: {
  last: Ran | null;
  preview?: string | null;
  /** The panel cannot act yet (sample data): say what unlocks it. */
  idle?: boolean;
}) {
  const showPreview = preview && (!last || preview !== last.command);
  const command = showPreview ? preview : last?.command;
  return (
    <div
      data-testid="ran-bar"
      className="rounded-md border border-night-600 bg-night-950 px-3 py-2.5 shadow-[inset_0_1px_3px_rgb(0_0_0/0.5)]"
    >
      <div className="flex items-start gap-2">
        <span
          className={clsx(
            'label-caps mt-0.5 shrink-0 text-md',
            showPreview ? 'text-sky' : 'text-flood-500',
          )}
        >
          {showPreview ? 'will run:' : 'ran:'}
        </span>
        {command ? (
          <code
            key={showPreview ? 'p' : last?.at}
            data-testid="ran-command"
            className={clsx(
              '-mx-1 min-w-0 flex-1 select-all break-all rounded-xs px-1 font-mono text-md leading-6 text-chalk',
              !showPreview && styles.ranIn,
            )}
          >
            {command}
          </code>
        ) : (
          <span className="min-w-0 flex-1 text-md leading-6 text-chalk-dim">
            {idle
              ? 'Set up the nets, then touch the panel. The exact Redis command it sends appears here.'
              : 'Touch the panel. The exact Redis command it sends appears here.'}
          </span>
        )}
        {command && <CopyButton text={command} label="Copy the command" />}
      </div>
      {last && (!showPreview || !last.ok) && (
        <p
          role={last.ok ? 'status' : 'alert'}
          data-testid={last.ok ? 'ran-note' : 'ran-error'}
          className={clsx(
            'mt-1.5 flex flex-wrap items-baseline gap-x-2 border-t border-night-600/60 pt-1.5 text-sm leading-5',
            last.ok ? 'text-chalk-dim' : 'text-wicket',
          )}
        >
          {last.ok ? (
            <>
              <span className="font-mono text-turf">{last.reply || 'OK'}</span>
              {last.note && <span>{last.note}</span>}
              {last.ms !== null && (
                <span className="text-chalk-faint">{last.ms.toFixed(1)} ms</span>
              )}
            </>
          ) : (
            <span>{last.error}</span>
          )}
        </p>
      )}
    </div>
  );
}

// ---- the frame ----------------------------------------------------------------------------------------------------
export function PanelFrame({
  kind,
  title,
  name,
  icon,
  typeLabel,
  handsOn = false,
  preview,
  children,
  className,
}: {
  /** The component id: `data-showme`. */
  kind: string;
  title: string;
  /** The key (or command) the panel reads, in mono. */
  name: string;
  icon: ReactNode;
  /** Redis type shown as a pill. */
  typeLabel?: string;
  /** This panel has direct manipulation in hands-on mode. */
  handsOn?: boolean;
  preview?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const f = useFrame();
  return (
    <section
      data-ds=""
      data-showme={kind}
      data-feed={f.sample ? 'sample' : 'live'}
      className={clsx(
        'relative overflow-hidden rounded-lg border border-night-600 bg-night-800 shadow-raise',
        'before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-24 before:bg-[radial-gradient(120%_100%_at_50%_-30%,rgb(255_154_31/0.08),transparent_70%)]',
        className,
      )}
    >
      <header className="relative flex items-center gap-3 px-4 pt-3.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-night-900 text-flood-400 shadow-hairline ring-1 ring-night-600">
          {icon}
        </span>
        <h4 className="showme-title label-caps min-w-0 flex-1 truncate text-md leading-5 text-chalk">
          {title}
        </h4>
        {typeLabel && (
          <Pill tone="sky" size="sm">
            {typeLabel}
          </Pill>
        )}
        {f.sample ? (
          <Pill tone="neutral" size="sm">
            sample
          </Pill>
        ) : (
          <Pill tone="turf" variant="status" live size="sm">
            live
          </Pill>
        )}
      </header>
      <div className="relative px-4 pt-2">
        <code
          className="showme-key inline-block max-w-full break-all rounded-xs bg-night-950/70 px-2 py-0.5 font-mono text-xs text-chalk-dim ring-1 ring-night-600/70"
          data-testid="showme-key"
        >
          {name}
        </code>
      </div>
      <div className="relative space-y-3 px-4 pt-3 pb-4">
        {children}
        {f.interactive && f.locked && (
          <p
            data-testid="showme-locked"
            className="flex items-start gap-2 rounded-md border border-night-600 bg-night-900 px-3 py-2 text-sm leading-5 text-chalk-dim"
          >
            <Lock size={15} className="mt-0.5 shrink-0 text-flood-400" aria-hidden />
            <span>
              This key belongs to the game engine (<code className="font-mono">game:</code>), so the
              panel only reads it. Practice on your own keys in The nets.
            </span>
          </p>
        )}
        {f.interactive && !f.locked && handsOn && (
          <RanBar last={f.hands?.last ?? null} preview={preview} idle={!f.hands} />
        )}
        {f.interactive && !f.locked && !handsOn && (
          <p
            data-testid="showme-readonly"
            className="flex items-start gap-2 text-sm leading-5 text-chalk-dim"
          >
            <Terminal size={15} className="mt-0.5 shrink-0 text-chalk-faint" aria-hidden />
            <span>
              This panel only reads. Change the key from the terminal and watch it move here.
            </span>
          </p>
        )}
      </div>
    </section>
  );
}
