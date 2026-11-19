// The log feed's model: raw log lines in, one small record per line out. Services write three dialects (pino JSON
// for the app and the runner, Caddy's JSON access log for the proxy, plain text for Postgres), and the feed shows
// them as one broadcast-style ticker. Pure, so it is unit-tested without a DOM. The raw line is always kept: the
// inspector shows exactly what the service wrote.
import type { LogService } from '../../types';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  raw: string;
  /** HH:MM:SS.mmm in the browser's time zone, or null when the line carries no timestamp. */
  time: string | null;
  level: LogLevel;
  /** The sentence: pino's msg, "GET /app/fixtures" for the proxy, the Postgres message. */
  text: string;
  /** Right-aligned detail: "200 · 0.3 ms" for the proxy. Empty when there is none. */
  meta: string;
  /** Up to four more scalar fields of a JSON line, as key and value. */
  extras: [string, string][];
}

export const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** `all` shows everything, `warn` hides debug and info, `error` shows errors only. */
export type LevelFilter = 'all' | 'warn' | 'error';
export const FILTER_MIN: Record<LevelFilter, number> = { all: 0, warn: 2, error: 3 };

const SKIP_KEYS = new Set([
  'level',
  'time',
  'ts',
  'msg',
  'message',
  'name',
  'pid',
  'hostname',
  'v',
  'logger',
  'instance',
]);

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** HH:MM:SS.mmm for an epoch in milliseconds. */
export function clockOf(epochMs: number): string | null {
  if (!Number.isFinite(epochMs)) return null;
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return null;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function levelOf(v: unknown): LogLevel | null {
  if (typeof v === 'number')
    return v >= 50 ? 'error' : v >= 40 ? 'warn' : v >= 30 ? 'info' : 'debug';
  if (typeof v !== 'string') return null;
  const s = v.toLowerCase();
  if (s === 'error' || s === 'fatal' || s === 'panic' || s === 'critical') return 'error';
  if (s === 'warn' || s === 'warning') return 'warn';
  if (s === 'info' || s === 'notice') return 'info';
  if (s === 'debug' || s === 'trace') return 'debug';
  return null;
}

function scalar(v: unknown): string | null {
  if (typeof v === 'string') return v.length > 28 ? `${v.slice(0, 27)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function durationText(seconds: number): string {
  const ms = seconds * 1000;
  return `${ms >= 100 ? Math.round(ms) : ms >= 1 ? Math.round(ms * 10) / 10 : Number(ms.toPrecision(2))} ms`;
}

const PG_LINE =
  /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)(?:\.(\d+))? \S+ \[\d+\] (LOG|ERROR|WARNING|FATAL|PANIC|NOTICE|INFO|DEBUG\d?|STATEMENT|DETAIL|HINT|CONTEXT):\s*(.*)$/s;

function fromJson(o: Record<string, unknown>, raw: string): LogEntry {
  const request =
    o.request && typeof o.request === 'object' ? (o.request as Record<string, unknown>) : null;
  const status = typeof o.status === 'number' ? o.status : null;
  let level = levelOf(o.level) ?? 'info';
  let text = typeof o.msg === 'string' ? o.msg : typeof o.message === 'string' ? o.message : '';
  let meta = '';
  const extras: [string, string][] = [];
  if (request && status !== null) {
    // Caddy access log.
    text = `${String(request.method ?? '')} ${String(request.uri ?? '')}`.trim();
    meta = `${status}${typeof o.duration === 'number' ? ` · ${durationText(o.duration)}` : ''}`;
    if (status >= 500) level = 'error';
    else if (status >= 400 && LEVEL_RANK[level] < LEVEL_RANK.warn) level = 'warn';
  } else {
    for (const [k, v] of Object.entries(o)) {
      if (SKIP_KEYS.has(k) || extras.length >= 4) continue;
      const s = scalar(v);
      if (s !== null) extras.push([k, s]);
    }
    if (!text) text = raw;
  }
  const t =
    typeof o.time === 'number'
      ? o.time
      : typeof o.ts === 'number'
        ? o.ts * 1000
        : typeof o.time === 'string'
          ? Date.parse(o.time)
          : NaN;
  return { raw, time: clockOf(t), level, text, meta, extras };
}

function parse(raw: string): LogEntry {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      const o: unknown = JSON.parse(trimmed);
      if (o && typeof o === 'object' && !Array.isArray(o))
        return fromJson(o as Record<string, unknown>, raw);
    } catch {
      /* not JSON after all: fall through to plain text */
    }
  }
  const pg = PG_LINE.exec(raw);
  if (pg) {
    const [, , clock, frac, tag, message] = pg;
    const lvl =
      tag === 'ERROR' || tag === 'FATAL' || tag === 'PANIC'
        ? 'error'
        : tag === 'WARNING'
          ? 'warn'
          : 'info';
    return {
      raw,
      time: `${clock}.${(frac ?? '000').padEnd(3, '0').slice(0, 3)}`,
      level: lvl,
      text: tag === 'LOG' || tag === 'INFO' ? (message ?? '') : `${tag}: ${message ?? ''}`,
      meta: '',
      extras: [],
    };
  }
  const level: LogLevel = /\b(ERROR|FATAL|PANIC|Uncaught|Exception|Traceback)\b/.test(raw)
    ? 'error'
    : /\bWARN(ING)?\b/.test(raw)
      ? 'warn'
      : 'info';
  return { raw, time: null, level, text: raw, meta: '', extras: [] };
}

const CACHE_LIMIT = 6000;
const cache = new Map<string, LogEntry>();

/** Parse once per distinct line: the feed re-reads up to a thousand lines per service on every tick. */
export function parseLogLine(raw: string): LogEntry {
  const hit = cache.get(raw);
  if (hit) return hit;
  const entry = parse(raw);
  if (cache.size >= CACHE_LIMIT) {
    // Maps iterate in insertion order: drop the oldest quarter.
    let n = CACHE_LIMIT / 4;
    for (const k of cache.keys()) {
      cache.delete(k);
      if (--n <= 0) break;
    }
  }
  cache.set(raw, entry);
  return entry;
}

/** Parsed lines that pass the level filter and the (case-insensitive) text filter. Order is kept. */
export function filterEntries(
  lines: readonly string[],
  level: LevelFilter,
  text: string,
): LogEntry[] {
  const min = FILTER_MIN[level];
  const needle = text.trim().toLowerCase();
  const out: LogEntry[] = [];
  for (const raw of lines) {
    const e = parseLogLine(raw);
    if (LEVEL_RANK[e.level] < min) continue;
    if (needle && !raw.toLowerCase().includes(needle)) continue;
    out.push(e);
  }
  return out;
}

export function countErrors(lines: readonly string[]): number {
  let n = 0;
  for (const raw of lines) if (parseLogLine(raw).level === 'error') n++;
  return n;
}

/** How many lines arrived after `snapshot` was taken. The store keeps a sliding window, so find the old tail. */
export function linesSince(snapshot: readonly string[], live: readonly string[]): number {
  if (snapshot === live) return 0;
  const last = snapshot[snapshot.length - 1];
  if (last === undefined) return live.length;
  for (let i = live.length - 1; i >= 0; i--) if (live[i] === last) return live.length - 1 - i;
  return live.length;
}

/** The text the inspector shows: pretty JSON when the line is JSON, else the line itself. */
export function prettyRaw(raw: string): string {
  const t = raw.trimStart();
  if (t.startsWith('{')) {
    try {
      return JSON.stringify(JSON.parse(t), null, 2);
    } catch {
      /* plain text */
    }
  }
  return raw;
}

export const SERVICE_BLURB: Record<LogService, string> = {
  app: 'The cricket app your code runs inside',
  runner: 'Runs your workspace files and checks',
  proxy: 'Caddy: every request that reaches the app',
  postgres: 'The database behind the app',
};
