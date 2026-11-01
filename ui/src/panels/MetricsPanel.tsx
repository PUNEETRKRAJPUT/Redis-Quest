import { useEffect, useMemo } from 'react';
import { api } from '../api';
import { useQuest } from '../store';
import type { MetricsTick } from '../types';

export function Sparkline({
  values,
  label,
  unit,
  fmt = (n: number) => n.toFixed(0),
}: {
  values: number[];
  label: string;
  unit: string;
  fmt?: (n: number) => string;
}) {
  const W = 220;
  const H = 44;
  const max = Math.max(1, ...values);
  const pts = values
    .map(
      (v, i) =>
        `${values.length < 2 ? W : (i / (values.length - 1)) * W},${H - 3 - (v / max) * (H - 8)}`,
    )
    .join(' ');
  const last = values.length ? (values[values.length - 1] as number) : null;
  return (
    <div className="metric" data-testid={`metric-${label}`}>
      <div className="metric-head">
        <span>{label}</span>
        <strong>{last === null ? 'no data' : `${fmt(last)} ${unit}`}</strong>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} over the last ${values.length} seconds`}
      >
        {values.length > 1 ? (
          <polyline
            points={pts}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
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

export function MetricsPanel({ compact = false }: { compact?: boolean }) {
  const ticks = useQuest((s) => s.ticks);
  const seed = useQuest((s) => s.seedTicks);
  useEffect(() => {
    api
      .metrics(60)
      .then((m) => seed(m.series.map((x) => ({ ...x }))))
      .catch(() => undefined);
  }, [seed]);
  const s = useMemo(() => tickSeries(ticks), [ticks]);
  return (
    <div className={compact ? 'metrics compact' : 'metrics'} data-testid="metrics">
      <Sparkline label="requests/s" unit="rps" values={s.rps} />
      <Sparkline label="p50" unit="ms" values={s.p50} />
      <Sparkline label="p99" unit="ms" values={s.p99} />
      <Sparkline label="errors/s" unit="err" values={s.errors} />
      <Sparkline label="db queries/s" unit="q" values={s.db} />
      <Sparkline label="redis commands/s" unit="cmd" values={s.redis} />
      {ticks.length === 0 ? (
        <p className="muted metrics-note">
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
  return (
    <div className="pain" data-testid="pain">
      <div>
        <span>p99</span>
        <strong>{last ? `${Math.round(last.p99Ms)} ms` : 'no traffic'}</strong>
      </div>
      <div>
        <span>error rate</span>
        <strong>{last ? `${errRate.toFixed(1)}%` : 'no traffic'}</strong>
      </div>
      <div>
        <span>db calls/s</span>
        <strong>{db === null ? (last ? 'not reported' : 'no traffic') : db}</strong>
      </div>
      <div>
        <span>requests/s</span>
        <strong>{last ? last.count : 'no traffic'}</strong>
      </div>
    </div>
  );
}
