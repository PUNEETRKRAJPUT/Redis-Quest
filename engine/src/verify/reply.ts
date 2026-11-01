// Reply normalisation and formatting for verifier checks.
//
// Levels compare against RESP2-shaped values (levels/README.md, "Comparison rules"): integers,
// strings, nil and lists. node-redis already returns RESP2 replies in that shape; this module also
// folds the RESP3 shapes (maps, sets, booleans, doubles) and Buffers into it, so a future protocol
// switch cannot silently change a verdict.

export type Reply = string | number | null | Reply[];

export function normalizeReply(v: unknown): Reply {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v;
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.from(v).toString('utf8');
  if (v instanceof Error) return `(error) ${v.message}`;
  if (Array.isArray(v)) return v.map(normalizeReply);
  if (v instanceof Set) return [...v].map(normalizeReply);
  if (v instanceof Map) return [...v.entries()].flatMap(([k, val]) => [normalizeReply(k), normalizeReply(val)]);
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).flatMap(([k, val]) => [k, normalizeReply(val)]);
  return String(v);
}

const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Reads a reply as a number: integers as is, numeric strings (`ZSCORE` gives "150") parsed, `inf` as Infinity. */
export function numericValue(r: Reply): number | null {
  if (typeof r === 'number') return Number.isNaN(r) ? null : r;
  if (typeof r !== 'string') return null;
  const s = r.trim();
  if (NUMERIC.test(s)) return Number(s);
  const lower = s.toLowerCase();
  if (lower === 'inf' || lower === '+inf') return Infinity;
  if (lower === '-inf') return -Infinity;
  return null;
}

/**
 * The comparison contract (P0-05 decision 15): `null` is nil; a numeric expected value compares
 * numerically against a numeric string reply; a string expected value matches a string reply exactly
 * or an integer reply by its decimal form; lists compare element by element.
 */
export function replyEquals(reply: Reply, expected: Reply): boolean {
  if (expected === null) return reply === null;
  if (typeof expected === 'number') {
    const n = numericValue(reply);
    return n !== null && n === expected;
  }
  if (typeof expected === 'string') {
    if (typeof reply === 'string') return reply === expected;
    if (typeof reply === 'number') return String(reply) === expected;
    return false;
  }
  if (!Array.isArray(reply) || reply.length !== expected.length) return false;
  return expected.every((e, i) => replyEquals(reply[i] as Reply, e));
}

const MAX_STRING = 120;
const MAX_LIST = 10;

/** Short, learner-readable rendering of a reply or expected value: `zset`, `150`, `nil`, `[a, b]`. */
export function formatReply(r: Reply): string {
  if (r === null) return 'nil';
  if (typeof r === 'number') {
    if (r === Infinity) return 'inf';
    if (r === -Infinity) return '-inf';
    return String(r);
  }
  if (typeof r === 'string') {
    if (r === '') return '""';
    const needsQuotes = /^\s|\s$|[\r\n]/.test(r);
    const cut = r.length > MAX_STRING ? `${r.slice(0, MAX_STRING)}…` : r;
    return needsQuotes ? JSON.stringify(cut) : cut;
  }
  if (r.length === 0) return '(empty list)';
  const shown = r.slice(0, MAX_LIST).map(formatReply);
  const more = r.length > MAX_LIST ? `, … (+${r.length - MAX_LIST} more)` : '';
  return `[${shown.join(', ')}${more}]`;
}

/** A command as the learner would type it: `ZSCORE lb:hostel user:p-1`. */
export function formatCommand(argv: readonly string[]): string {
  return argv.map((a) => (a === '' || /[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

/** JSON rendering for learner function values (behavior verifiers), truncated. */
export function formatJson(v: unknown, max = 200): string {
  let s: string;
  try {
    s = v === undefined ? 'undefined' : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
