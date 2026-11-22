// A copy of the engine's check evaluation (engine/src/verify/reply.ts and assert.ts), so the league scorer judges a
// check exactly as a level's `redis` verifier does. The shared package cannot import the engine; the scorer, the
// contributor script and the engine route all need one evaluation. engine/test/league-parity.test.ts runs both
// copies over the same table of replies and checks, so a change to one that is not made to the other fails CI.
// Differences from the originals: the imports, and `formatCommand` is called `formatArgv`.

import type { RedisCheck } from '../levels/schema.js';

// Reply normalisation. Levels compare against RESP2-shaped values (levels/README.md, "Comparison rules"): integers,
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
  if (v instanceof Map)
    return [...v.entries()].flatMap(([k, val]) => [normalizeReply(k), normalizeReply(val)]);
  if (typeof v === 'object')
    return Object.entries(v as Record<string, unknown>).flatMap(([k, val]) => [
      k,
      normalizeReply(val),
    ]);
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
export function formatArgv(argv: readonly string[]): string {
  return argv.map((a) => (a === '' || /[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

export interface AssertionOutcome {
  ok: boolean;
  /** What the check wanted, e.g. `zset`, `at least 5`, `between 1 and 30`. */
  expected: string;
  /** What Redis gave, rendered for the learner, e.g. `list`, `nil`, `length 3`. */
  observed: string;
}

const list = (vs: readonly Reply[]) => vs.map(formatReply).join(', ');

function asNumberOutcome(
  reply: Reply,
  expected: string,
  test: (n: number) => boolean,
): AssertionOutcome {
  const n = numericValue(reply);
  if (n === null) return { ok: false, expected, observed: describeNonNumber(reply) };
  return { ok: test(n), expected, observed: formatReply(reply) };
}

function describeNonNumber(reply: Reply): string {
  if (reply === null) return 'nil';
  if (Array.isArray(reply)) return `a list ${formatReply(reply)}`;
  return `${formatReply(reply)} (not a number)`;
}

export function evaluateAssertion(check: RedisCheck, reply: Reply): AssertionOutcome {
  if (check.equals !== undefined) {
    return {
      ok: replyEquals(reply, check.equals),
      expected: formatReply(check.equals),
      observed: formatReply(reply),
    };
  }
  if (check.notEquals !== undefined) {
    return {
      ok: !replyEquals(reply, check.notEquals),
      expected: `anything but ${formatReply(check.notEquals)}`,
      observed: formatReply(reply),
    };
  }
  if (check.gte !== undefined) {
    const min = check.gte;
    return asNumberOutcome(reply, `at least ${min}`, (n) => n >= min);
  }
  if (check.lte !== undefined) {
    const max = check.lte;
    return asNumberOutcome(reply, `at most ${max}`, (n) => n <= max);
  }
  if (check.between !== undefined) {
    const [lo, hi] = check.between;
    return asNumberOutcome(reply, `between ${lo} and ${hi}`, (n) => n >= lo && n <= hi);
  }
  if (check.exists !== undefined) {
    // "not nil and not an empty list"
    const present = reply !== null && !(Array.isArray(reply) && reply.length === 0);
    return {
      ok: present === check.exists,
      expected: check.exists ? 'a value (not nil, not an empty list)' : 'nil or an empty list',
      observed: formatReply(reply),
    };
  }
  if (check.matches !== undefined) {
    const expected = `something matching /${check.matches}/`;
    if (reply === null || Array.isArray(reply))
      return { ok: false, expected, observed: formatReply(reply) };
    return {
      ok: new RegExp(check.matches).test(String(reply)),
      expected,
      observed: formatReply(reply),
    };
  }
  if (check.oneOf !== undefined) {
    return {
      ok: check.oneOf.some((v) => replyEquals(reply, v)),
      expected: `one of ${list(check.oneOf)}`,
      observed: formatReply(reply),
    };
  }
  if (check.lengthGte !== undefined) {
    // List length, or string length; nil counts as length 0 (a missing key holds nothing).
    const len = reply === null ? 0 : Array.isArray(reply) ? reply.length : String(reply).length;
    return {
      ok: len >= check.lengthGte,
      expected: `length at least ${check.lengthGte}`,
      observed: `length ${len}`,
    };
  }
  if (check.contains !== undefined) {
    const want = check.contains;
    const expected = `something containing ${formatReply(want)}`;
    if (reply === null) return { ok: false, expected, observed: 'nil' };
    if (Array.isArray(reply))
      return {
        ok: reply.some((e) => replyEquals(e, want)),
        expected,
        observed: formatReply(reply),
      };
    return { ok: String(reply).includes(String(want)), expected, observed: formatReply(reply) };
  }
  if (check.notContains !== undefined) {
    // E-02: the negation of `contains`. A string (INFO commandstats, CLIENT LIST) must not hold the text; a list must
    // have no element equal to it; nil holds nothing, so it passes.
    const text = check.notContains;
    const expected = `no ${JSON.stringify(text)}`;
    if (reply === null) return { ok: true, expected, observed: 'nil' };
    if (Array.isArray(reply)) {
      const hit = reply.find((e) => replyEquals(e, text));
      return {
        ok: hit === undefined,
        expected,
        observed: formatReply(reply),
      };
    }
    const whole = String(reply);
    if (!whole.includes(text)) return { ok: true, expected, observed: formatReply(reply) };
    // A long INFO reply is cut when shown, so show the line that holds the text instead of its first 120 characters.
    const line = whole.split(/\r?\n/).find((l) => l.includes(text)) ?? whole;
    return {
      ok: false,
      expected,
      observed: whole.includes('\n')
        ? `a line reading ${formatReply(line.trim())}`
        : formatReply(reply),
    };
  }
  // The schema guarantees exactly one assertion; a check without one must never pass.
  return {
    ok: false,
    expected: 'an assertion (this check has none)',
    observed: formatReply(reply),
  };
}
