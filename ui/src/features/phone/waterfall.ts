import type { TraceRow } from './trace';

export interface Bar {
  row: TraceRow;
  /** Percent of the strip's width. */
  leftPct: number;
  widthPct: number;
}

export interface WaterfallLayout {
  /** The time the strip stands for, in ms: the longer of the app's total and the end of the last call. */
  spanMs: number;
  /** One bar per Redis command or query, in call order, each on its own line. */
  bars: Bar[];
  /** Axis marks: where (percent) and what to print. */
  ticks: { pct: number; label: string }[];
}

/** A bar never gets thinner than this, or a 0.1 ms command would be invisible. */
export const MIN_BAR_PCT = 0.8;

export function formatMs(ms: number): string {
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function layoutWaterfall(rows: readonly TraceRow[], totalMs: number): WaterfallLayout {
  const end = rows.reduce((m, r) => Math.max(m, r.startMs + r.ms), 0);
  const spanMs = Math.max(totalMs, end, 1);
  const bars = rows.map((row) => {
    const widthPct = Math.min(100, Math.max(MIN_BAR_PCT, (row.ms / spanMs) * 100));
    const leftPct = Math.min(100 - widthPct, Math.max(0, (row.startMs / spanMs) * 100));
    return { row, leftPct, widthPct };
  });
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ pct: f * 100, label: formatMs(spanMs * f) }));
  return { spanMs, bars, ticks };
}

export interface TraceSummary {
  redis: number;
  db: number;
  /** Time during which at least one call was in flight (overlapping calls are counted once). */
  busyMs: number;
  /** True when no two calls overlap: each one waited for the one before it. */
  sequential: boolean;
}

export function summarizeTrace(rows: readonly TraceRow[]): TraceSummary {
  const sorted = [...rows].sort((a, b) => a.startMs - b.startMs);
  let busyMs = 0;
  let curEnd = -1;
  let curStart = 0;
  let sequential = true;
  for (const r of sorted) {
    const s = r.startMs;
    const e = r.startMs + r.ms;
    if (curEnd < 0) {
      curStart = s;
      curEnd = e;
    } else if (s < curEnd) {
      sequential = false;
      curEnd = Math.max(curEnd, e);
    } else {
      busyMs += curEnd - curStart;
      curStart = s;
      curEnd = e;
    }
  }
  if (curEnd >= 0) busyMs += curEnd - curStart;
  return {
    redis: rows.filter((r) => r.kind === 'redis').length,
    db: rows.filter((r) => r.kind === 'db').length,
    busyMs,
    sequential,
  };
}
