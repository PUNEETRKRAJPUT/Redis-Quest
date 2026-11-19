'use client';

import { clsx } from 'clsx';
import { useEffect, useId, useMemo } from 'react';
import { FlipNumber } from '../design';
import { api } from '../api';
import { useQuest } from '../store';
import type { MetricsTick } from '../types';
import { cssHeight, type PanelHeight } from './height';

type Tone = 'flood' | 'turf' | 'wicket' | 'sky' | 'cap';
const TONE_VAR: Record<Tone, string> = {
  flood: 'var(--color-flood-500)',
  turf: 'var(--color-turf)',
  wicket: 'var(--color-wicket)',
  sky: 'var(--color-sky)',
  cap: 'var(--color-cap-purple)',
};
const TONE_TEXT: Record<Tone, string> = {
  flood: 'text-flood-400',
  turf: 'text-turf',
  wicket: 'text-wicket',
  sky: 'text-sky',
  cap: 'text-cap-purple',
};

/** The line and the area under it for a series, in a 0..100 by 0..100 box, plus where the last point sits. */
export function sparkPath(values: number[]): {
  line: string;
  area: string;
  last: [number, number] | null;
} {
  if (values.length === 0) return { line: '', area: '', last: null };
  const max = Math.max(1, ...values);
  const x = (i: number) => (values.length < 2 ? 100 : (i / (values.length - 1)) * 100);
  const y = (v: number) => 92 - (v / max) * 84;
  const pts = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`);
  const lastV = values[values.length - 1] as number;
  return {
    line: `M${pts.join(' L')}`,
    area: `M0,100 L${pts.join(' L')} L100,100 Z`,
    last: [x(values.length - 1), y(lastV)],
  };
}

/** A scoreboard tile: label, the latest number, a sparkline of the series, and what the window held. */
export function Sparkline({
  values,
  label,
  unit,
  fmt = (n: number) => n.toFixed(0),
  period = 'seconds',
  tone = 'sky',
  focal = false,
  flip = false,
  dense = false,
}: {
  values: number[];
  label: string;
  unit: string;
  fmt?: (n: number) => string;
  /** What one point is, for the screen-reader label. */
  period?: string;
  tone?: Tone;
  /** The tile the screen is about: an amber edge. One per screen. */
  focal?: boolean;
  /** Draw the latest number in flip digits (whole numbers only). */
  flip?: boolean;
  /** Smaller type and a shorter graph, for the level workbench. */
  dense?: boolean;
}) {
  const id = useId();
  const { line, area, last } = sparkPath(values);
  const latest = values.length ? (values[values.length - 1] as number) : null;
  const peak = values.length ? Math.max(...values) : null;
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return (
    <div
      data-ds=""
      data-testid={`metric-${label}`}
      className={clsx(
        'relative flex flex-col overflow-hidden rounded-lg border bg-night-900 shadow-raise',
        dense ? 'gap-1.5 p-3' : 'gap-3 p-4',
        focal
          ? 'border-flood-500/45 bg-[radial-gradient(120%_70%_at_50%_-10%,rgb(255_154_31/0.10),transparent_60%)]'
          : 'border-night-600/80',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-caps text-xs text-chalk-dim">{label}</span>
        <span className="tabular font-mono text-[11px] text-chalk-faint">
          {values.length ? `${values.length}s` : ''}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        {latest === null ? (
          <>
            <span className="font-display text-2xl font-bold leading-none text-chalk-faint">–</span>
            <strong className="text-sm font-medium text-chalk-dim">no data</strong>
          </>
        ) : (
          <>
            {flip && Number.isInteger(latest) ? (
              <FlipNumber
                value={latest}
                size={dense ? 'sm' : 'md'}
                sound={false}
                tone="chalk"
                label={label}
              />
            ) : (
              <strong
                className={clsx(
                  'tabular font-display font-bold leading-none text-chalk',
                  dense ? 'text-xl' : 'text-3xl',
                )}
              >
                {fmt(latest)}
              </strong>
            )}
            <span className={clsx('label-caps text-sm', TONE_TEXT[tone])}>{unit}</span>
          </>
        )}
      </div>
      <div className={clsx('relative', dense ? 'h-9' : 'h-14')}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${label} over the last ${values.length} ${period}`}
          className="absolute inset-0 size-full overflow-visible"
        >
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={TONE_VAR[tone]} stopOpacity="0.35" />
              <stop offset="1" stopColor={TONE_VAR[tone]} stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* a faint baseline so an empty or flat series still reads as a graph */}
          <line
            x1="0"
            x2="100"
            y1="92"
            y2="92"
            stroke="var(--color-night-600)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          {values.length > 1 ? (
            <>
              <path d={area} fill={`url(#${id}-fill)`} />
              <path
                d={line}
                fill="none"
                stroke={TONE_VAR[tone]}
                strokeWidth="1.8"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : null}
        </svg>
        {last && values.length > 1 ? (
          <span
            aria-hidden
            className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-night-900"
            style={{
              left: `${last[0]}%`,
              top: `${last[1]}%`,
              background: TONE_VAR[tone],
              boxShadow: `0 0 10px ${TONE_VAR[tone]}`,
            }}
          />
        ) : null}
      </div>
      {!dense && peak !== null && avg !== null ? (
        <div className="tabular flex gap-4 font-mono text-[11px] text-chalk-dim">
          <span>avg {fmt(avg)}</span>
          <span>peak {fmt(peak)}</span>
        </div>
      ) : null}
    </div>
  );
}

function sumRoutes(t: MetricsTick, field: string): number | null {
  let found = false;
  let sum = 0;
  for (const r of Object.values(t.routes ?? {})) {
    const v = r[field];
    if (typeof v === 'number') {
      found = true;
      sum += v;
    }
  }
  return found ? sum : null;
}

/** rps, p50, p99, errors from the tick itself; db queries and redis commands only when the app reports those fields. */
export function tickSeries(ticks: MetricsTick[]) {
  return {
    rps: ticks.map((t) => t.count),
    p50: ticks.map((t) => t.p50Ms),
    p99: ticks.map((t) => t.p99Ms),
    errors: ticks.map((t) => t.errors),
    db: ticks.map((t) => sumRoutes(t, 'dbQueries')).filter((v): v is number => v !== null),
    redis: ticks.map((t) => sumRoutes(t, 'redisCommands')).filter((v): v is number => v !== null),
  };
}

export function MetricsPanel({
  compact = false,
  height,
}: {
  compact?: boolean;
  /** Pixels, or 'fill' to take the parent's height and scroll inside it. Default: natural height. */
  height?: PanelHeight;
}) {
  const ticks = useQuest((s) => s.ticks);
  const seed = useQuest((s) => s.seedTicks);
  useEffect(() => {
    api
      .metrics(60)
      .then((m) => seed(m.series.map((x) => ({ ...x }))))
      .catch(() => undefined);
  }, [seed]);
  const s = useMemo(() => tickSeries(ticks), [ticks]);
  const ms = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));
  return (
    <div
      data-ds=""
      data-testid="metrics"
      className={clsx(height !== undefined && 'overflow-y-auto')}
      style={height === undefined ? undefined : { height: cssHeight(height) }}
    >
      <div
        className={clsx(
          'grid gap-3',
          compact ? 'grid-cols-2 xl:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3',
        )}
      >
        <Sparkline label="requests/s" unit="rps" values={s.rps} tone="sky" flip dense={compact} />
        <Sparkline label="p50" unit="ms" values={s.p50} tone="turf" fmt={ms} dense={compact} />
        <Sparkline
          label="p99"
          unit="ms"
          values={s.p99}
          tone="flood"
          fmt={ms}
          focal
          dense={compact}
        />
        <Sparkline
          label="errors/s"
          unit="err"
          values={s.errors}
          tone="wicket"
          flip
          dense={compact}
        />
        <Sparkline label="db queries/s" unit="q" values={s.db} tone="cap" dense={compact} />
        <Sparkline
          label="redis commands/s"
          unit="cmd"
          values={s.redis}
          tone="sky"
          dense={compact}
        />
      </div>
      {ticks.length === 0 ? (
        <p className="mt-4 rounded-md border border-night-600/70 bg-night-900 px-4 py-3 text-md text-chalk-dim">
          No traffic yet. The engine only sends a tick in a second where the app served requests.
        </p>
      ) : null}
    </div>
  );
}

/** The "live pain" strip for beat 2: the three numbers the level is trying to move. */
export function PainPanel() {
  const ticks = useQuest((s) => s.ticks);
  const last = ticks[ticks.length - 1];
  const s = useMemo(() => tickSeries(ticks.slice(-10)), [ticks]);
  const errRate = last && last.count > 0 ? (last.errors / last.count) * 100 : 0;
  const db = s.db.length ? (s.db[s.db.length - 1] as number) : null;
  const cells: { label: string; value: string; tone?: string }[] = [
    {
      label: 'p99',
      value: last ? `${Math.round(last.p99Ms)} ms` : 'no traffic',
      tone: 'text-flood-400',
    },
    {
      label: 'error rate',
      value: last ? `${errRate.toFixed(1)}%` : 'no traffic',
      tone: errRate > 0 ? 'text-wicket' : undefined,
    },
    {
      label: 'db calls/s',
      value: db === null ? (last ? 'not reported' : 'no traffic') : String(db),
    },
    { label: 'requests/s', value: last ? String(last.count) : 'no traffic' },
  ];
  return (
    <div
      data-ds=""
      data-testid="pain"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-night-600 bg-night-600 sm:grid-cols-4"
    >
      {cells.map((c) => (
        <div key={c.label} className="flex flex-col gap-1 bg-night-900 px-4 py-3">
          <span className="label-caps text-[11px] text-chalk-dim">{c.label}</span>
          <strong
            className={clsx(
              'tabular font-display text-xl font-bold leading-none',
              c.tone ?? 'text-chalk',
            )}
          >
            {c.value}
          </strong>
        </div>
      ))}
    </div>
  );
}
