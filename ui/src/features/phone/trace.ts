// The app's request trace, as the phone reads it. The format is written in app/src/trace.ts (`TraceEntry`,
// `RequestTrace.header`): response header `x-quest-trace`, JSON,
// `{"v":1,"total":12.3,"n":5,"e":[["r","GET k",0.1,0.4,"b",1],...]}`.
// Row = [kind r|d, label, startMs, ms, by l|b, ok 1|0]. `n` counts every call; `e` is what fit in the header.

export const TRACE_HEADER = 'x-quest-trace';

export interface TraceRow {
  kind: 'redis' | 'db';
  label: string;
  /** Milliseconds from the start of the request scope in the app (not from the click). */
  startMs: number;
  ms: number;
  by: 'learner' | 'builtin';
  ok: boolean;
}

export interface ParsedTrace {
  /** The app's own total for the request scope, in ms. */
  totalMs: number;
  /** Every Redis command and query the request made, including the ones that did not fit in the header. */
  calls: number;
  rows: TraceRow[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parseRow(raw: unknown): TraceRow | null {
  if (!Array.isArray(raw) || raw.length < 6) return null;
  const [k, label, start, ms, by, ok] = raw as unknown[];
  const startMs = num(start);
  const dur = num(ms);
  if ((k !== 'r' && k !== 'd') || typeof label !== 'string' || startMs === null || dur === null)
    return null;
  return {
    kind: k === 'r' ? 'redis' : 'db',
    label,
    startMs: Math.max(0, startMs),
    ms: Math.max(0, dur),
    by: by === 'l' ? 'learner' : 'builtin',
    ok: ok === 1,
  };
}

/** Parse the header value; anything unreadable is "no trace", never an exception. */
export function parseTraceHeader(value: string | null | undefined): ParsedTrace | null {
  if (!value) return null;
  let j: unknown;
  try {
    j = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof j !== 'object' || j === null) return null;
  const o = j as Record<string, unknown>;
  if (o.v !== 1 || !Array.isArray(o.e)) return null;
  const rows = o.e.map(parseRow).filter((r): r is TraceRow => r !== null);
  return {
    totalMs: Math.max(0, num(o.total) ?? 0),
    calls: Math.max(rows.length, num(o.n) ?? rows.length),
    rows,
  };
}
