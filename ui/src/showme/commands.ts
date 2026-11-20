// Pure command building for the hands-on panels. Every gesture becomes one argv, formatted into the one string
// that is both sent through POST /api/cli and shown under the panel, so what the player reads is what ran.
//
// The quoting matches the engine's parser exactly: engine/src/cli.ts `splitArgs` is redis-cli's sdssplitargs
// (bare tokens split on ASCII whitespace; inside double quotes `\\`, `\"`, `\n`, `\r`, `\t`, `\xHH` are escapes).
// A token that survives bare is left bare so the lesson reads like a command a person would type.
import type { CliReply } from '../types';

/** `game:*` belongs to the engine. The panels read it freely and never write it. */
export const ENGINE_PREFIX = 'game:';
/** The practice gallery plays only under this prefix (no level file uses it). */
export const PRACTICE_PREFIX = 'practice:';

export const ENGINE_REFUSAL =
  'This key belongs to the game engine (game:), so this panel only reads it. Practice on your own keys in The nets.';

export function isEngineKey(key: string): boolean {
  return key.startsWith(ENGINE_PREFIX);
}

export function isPracticeKey(key: string): boolean {
  return key.startsWith(PRACTICE_PREFIX);
}

// ---- formatting ----------------------------------------------------------------------------------------------
// eslint-disable-next-line no-control-regex
const BARE = /^[^\s"'\\\u0000-\u001f\u007f]+$/;

/** One argument as the parser will read it back: bare when safe, otherwise double-quoted with escapes. */
export function formatArg(a: string): string {
  if (BARE.test(a)) return a;
  let out = '"';
  for (const ch of a) {
    const code = ch.codePointAt(0) as number;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

export function formatCommand(argv: string[]): string {
  return argv.map(formatArg).join(' ');
}

// ---- the commands the gestures send ---------------------------------------------------------------------------
export const cmd = {
  set: (key: string, value: string): string[] => ['SET', key, value],
  hset: (key: string, field: string, value: string): string[] => ['HSET', key, field, value],
  lpush: (key: string, value: string): string[] => ['LPUSH', key, value],
  rpush: (key: string, value: string): string[] => ['RPUSH', key, value],
  lpop: (key: string): string[] => ['LPOP', key],
  rpop: (key: string): string[] => ['RPOP', key],
  sadd: (key: string, member: string): string[] => ['SADD', key, member],
  srem: (key: string, member: string): string[] => ['SREM', key, member],
  zincrby: (key: string, by: number, member: string): string[] => [
    'ZINCRBY',
    key,
    String(by),
    member,
  ],
  /** Brings an expired key back with a countdown (SET ... EX). */
  setEx: (key: string, seconds: number): string[] => [
    'SET',
    key,
    'a key with a countdown',
    'EX',
    String(seconds),
  ],
  expire: (key: string, seconds: number): string[] => ['EXPIRE', key, String(seconds)],
  persist: (key: string): string[] => ['PERSIST', key],
  /** XADD key * field value [field value]: the server picks the entry id. */
  xadd: (key: string, fields: [string, string][]): string[] => [
    'XADD',
    key,
    '*',
    ...fields.flatMap(([f, v]) => [f, v]),
  ],
  /** JSON.SET key path value: `json` is the JSON text itself (a number, "a string", an object ...). */
  jsonSet: (key: string, path: string, json: string): string[] => ['JSON.SET', key, path, json],
  jsonNumIncrBy: (key: string, path: string, by: number): string[] => [
    'JSON.NUMINCRBY',
    key,
    path,
    String(by),
  ],
  /** SETBIT key offset value. */
  setbit: (key: string, offset: number, value: 0 | 1): string[] => [
    'SETBIT',
    key,
    String(offset),
    String(value),
  ],
  pfadd: (key: string, element: string): string[] => ['PFADD', key, element],
  /** GEOADD key longitude latitude member (longitude first). */
  geoadd: (key: string, lon: number, lat: number, member: string): string[] => [
    'GEOADD',
    key,
    String(lon),
    String(lat),
    member,
  ],
  bfAdd: (key: string, item: string): string[] => ['BF.ADD', key, item],
  bfExists: (key: string, item: string): string[] => ['BF.EXISTS', key, item],
  /** TS.ADD key * value: `*` is the server's own clock, so "now". */
  tsAdd: (key: string, value: number): string[] => ['TS.ADD', key, '*', String(value)],
};

/** The key a command acts on (every command the panels send has it as the first argument). */
export function targetKey(argv: string[]): string {
  return argv[1] ?? '';
}

/** A refusal in plain words, or null when the command may run. */
export function refusal(argv: string[]): string | null {
  return isEngineKey(targetKey(argv)) ? ENGINE_REFUSAL : null;
}

// ---- input helpers --------------------------------------------------------------------------------------------
export const TTL_MAX_SECONDS = 86400 * 7;

/** Whole seconds from a text box or slider; null when it is not a positive whole number. */
export function parseSeconds(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= TTL_MAX_SECONDS ? n : null;
}

/** A finite number from a text box (`-3`, `1.5`, `2e3`); null for anything else, including empty text. */
export function parseNumber(text: string): number | null {
  const t = text.trim();
  if (t === '' || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** True when the text is one complete JSON value (`600`, `"Asha"`, `{"a":1}`); a bare word like Asha is not. */
export function isJsonText(text: string): boolean {
  if (text.trim() === '') return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** A whole day offset from a text box, 0..max-1; blank text means `fallback`; null when it is not valid. */
export function parseDayOffset(text: string, max: number, fallback: number): number | null {
  const t = text.trim();
  if (t === '') return fallback >= 0 && fallback < max ? fallback : null;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n < max ? n : null;
}

/** GEOADD's accepted ranges (longitude -180..180, latitude about -85.05..85.05); not in the docs digest. */
export const GEO_LAT_LIMIT = 85.05112878;

/** Rounds to 5 decimals (about a metre) and keeps the point inside what GEOADD accepts. */
export function clampLonLat(lon: number, lat: number): { lon: number; lat: number } {
  const r = (n: number) => Math.round(n * 1e5) / 1e5;
  return {
    lon: r(Math.max(-180, Math.min(180, lon))),
    lat: r(Math.max(-GEO_LAT_LIMIT, Math.min(GEO_LAT_LIMIT, lat))),
  };
}

export interface GeoBounds {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

/**
 * The inverse of the map's drawing: a click at (x, y) in the 360x220 viewBox becomes a longitude and latitude.
 * With one point (or points on one line) there is no scale; a click is placed about a hundred metres per unit away.
 */
export function mapToLonLat(
  x: number,
  y: number,
  b: GeoBounds,
  size = { w: 360, h: 220, pad: 30 },
): { lon: number; lat: number } {
  const { w, h, pad } = size;
  const lon =
    b.maxLon === b.minLon
      ? b.minLon + (x - w / 2) * 0.001
      : b.minLon + ((x - pad) / (w - 2 * pad)) * (b.maxLon - b.minLon);
  const lat =
    b.maxLat === b.minLat
      ? b.minLat - (y - h / 2) * 0.001
      : b.minLat + ((h - pad - y) / (h - 2 * pad)) * (b.maxLat - b.minLat);
  return clampLonLat(lon, lat);
}

export function fmtSeconds(s: number): string {
  if (s >= 86400 && s % 86400 === 0) return `${s / 86400} d`;
  if (s >= 3600 && s % 3600 === 0) return `${s / 3600} h`;
  if (s >= 60 && s % 60 === 0) return `${s / 60} min`;
  return `${s} s`;
}

/** Next ring scale for the TTL timer: keep it until the key was given a longer life than the clock explains. */
export function nextTtlTotal(
  total: number | null,
  prev: { ttl: number; at: number } | null,
  now: { ttl: number; at: number },
): number {
  if (now.ttl < 0) return total ?? 0;
  if (total === null || prev === null || prev.ttl < 0) return now.ttl;
  const expected = prev.ttl - Math.floor((now.at - prev.at) / 1000);
  // Within a few seconds of the countdown: same life. Off it either way: the TTL was reset (EXPIRE, SET ... EX), a new life.
  return Math.abs(now.ttl - expected) > 3 ? now.ttl : Math.max(total, now.ttl);
}

// ---- running a command ----------------------------------------------------------------------------------------
export interface Ran {
  /** The exact string that was sent (or would have been sent, for a refusal). */
  command: string;
  ok: boolean;
  /** Raw reply text from the engine, first line only. */
  reply: string;
  /** What the reply means, in plain words. */
  note: string | null;
  /** The problem, in plain words (set when ok is false). */
  error: string | null;
  ms: number | null;
  at: number;
}

const firstLine = (s: string) => (s.split('\n')[0] ?? '').slice(0, 160);

/** Plain words for the errors a gesture can hit; anything else is passed through as Redis said it. */
export function plainError(raw: string): string {
  const text = raw.replace(/^\(error\)\s*/, '');
  if (/^WRONGTYPE/i.test(text))
    return 'That key holds a different kind of value, so this command does not fit it.';
  if (/not a valid float|not an integer|out of range/i.test(text))
    return 'Redis could not read that as a number.';
  if (/no such key/i.test(text)) return 'That key does not exist.';
  return `Redis said: ${text}`;
}

function intReply(reply: string): number | null {
  const m = /^\(integer\) (-?\d+)/.exec(reply.trim());
  return m ? Number(m[1]) : null;
}

/** What a successful reply means for the gesture that caused it. Only facts Redis documents for each command. */
export function describeReply(argv: string[], reply: string, type: string): string | null {
  const name = (argv[0] ?? '').toUpperCase();
  const n = intReply(reply);
  switch (name) {
    case 'SET':
      return 'Saved.';
    case 'HSET':
      return n === 1 ? 'A new field was added.' : n === 0 ? 'The field was updated.' : null;
    case 'LPUSH':
    case 'RPUSH':
      return n === null ? null : `The list now holds ${n} item${n === 1 ? '' : 's'}.`;
    case 'LPOP':
    case 'RPOP':
      return type === 'nil' ? 'The list is empty, so nothing was removed.' : 'Removed one item.';
    case 'SADD':
      return n === 1 ? 'Added.' : n === 0 ? 'Already a member, nothing changed.' : null;
    case 'SREM':
      return n === 1 ? 'Removed.' : n === 0 ? 'Not a member, nothing changed.' : null;
    case 'ZINCRBY':
      return `The score is now ${reply.replace(/^"|"$/g, '').trim()}.`;
    case 'EXPIRE':
      return n === 1 ? 'The countdown started.' : n === 0 ? 'The key does not exist.' : null;
    case 'PERSIST':
      return n === 1
        ? 'The expiry was removed.'
        : n === 0
          ? 'Nothing changed: the key has no expiry or does not exist.'
          : null;
    case 'XADD': {
      const id = unquote(reply);
      return id ? `Added the entry ${id}; the server chose that id.` : null;
    }
    case 'JSON.SET':
      return 'Saved at that path.';
    case 'JSON.NUMINCRBY':
      // With a `$` path the reply is a JSON array of the new value(s), with a legacy path a bare number.
      return `The number at that path is now ${unquote(reply)}.`;
    case 'SETBIT':
      return n === 1 || n === 0 ? `That bit was ${n} before this command.` : null;
    case 'PFADD':
      return n === 1
        ? 'The estimate may have changed: the sketch was updated.'
        : n === 0
          ? 'The sketch did not change: that visitor looks already counted.'
          : null;
    case 'GEOADD':
      return n === 1 ? 'A new place was added.' : n === 0 ? 'The place already existed.' : null;
    case 'BF.ADD':
      return n === 1
        ? 'Added: it was not in the filter before.'
        : n === 0
          ? 'It may already have been in the filter.'
          : null;
    case 'BF.EXISTS':
      return n === 1
        ? 'It may exist: a Bloom filter can be wrong this way.'
        : n === 0
          ? 'Definitely not in the filter.'
          : null;
    case 'TS.ADD':
      return n === null ? null : `Stored one sample at timestamp ${n} (server time, in ms).`;
    default:
      return null;
  }
}

function unquote(reply: string): string {
  return reply.replace(/^"|"$/g, '').trim();
}

/** Sends one command through `cli`. Refuses engine keys before any request; never throws. */
export async function runCommand(
  argv: string[],
  cli: (command: string) => Promise<CliReply>,
  now: () => number = Date.now,
): Promise<Ran> {
  const command = formatCommand(argv);
  const blocked = refusal(argv);
  if (blocked)
    return { command, ok: false, reply: '', note: null, error: blocked, ms: null, at: now() };
  try {
    const r = await cli(command);
    const reply = firstLine(r.reply);
    if (r.type === 'error')
      return {
        command,
        ok: false,
        reply,
        note: null,
        error: plainError(reply),
        ms: r.ms,
        at: now(),
      };
    return {
      command,
      ok: true,
      reply,
      note: describeReply(argv, reply, r.type),
      error: null,
      ms: r.ms,
      at: now(),
    };
  } catch {
    return {
      command,
      ok: false,
      reply: '',
      note: null,
      error:
        'Could not reach the game engine, so nothing was sent. Check that the stack is running.',
      ms: null,
      at: now(),
    };
  }
}
