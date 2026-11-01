// One assertion of a redis check, evaluated against a normalised reply.
// The README table "Exactly one assertion per check" is the contract; each branch cites its row.

import type { RedisCheck } from '@quest/shared';
import { formatReply, numericValue, replyEquals, type Reply } from './reply.js';

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
