// redis checks: used by `redis`, checks-shaped `antipattern`, and behavior `sideEffect`.

import { commandKey, isReadOnlyCommand, SETUP_FORBIDDEN_COMMANDS, type RedisCheck } from '@quest/shared';
import { isRedisErrorReply } from '../redis.js';
import { evaluateAssertion } from './assert.js';
import { formatCommand, normalizeReply } from './reply.js';
import type { CheckItem, SendCommand } from './types.js';

/**
 * Defence in depth: the schema already refuses non-allowlisted commands without `allowWrite`; the engine
 * refuses them again at run time, and never lets even an `allowWrite` check wipe the database or touch
 * the engine's own `game:*` keys with a write.
 */
export function refusal(check: Pick<RedisCheck, 'cmd' | 'allowWrite'>): string | null {
  const key = commandKey(check.cmd);
  if (isReadOnlyCommand(check.cmd)) return null;
  if (!check.allowWrite) {
    return `${key} is not on the read-only allowlist, so the engine refused to run it (a verifier must not change your data)`;
  }
  if (SETUP_FORBIDDEN_COMMANDS.has(key)) return `${key} is never run by a verifier`;
  if (check.cmd.slice(1).some((a) => a.startsWith('game:'))) return `${key} on a game:* key is never run by a verifier`;
  return null;
}

/** `<message> (expected X, got Y)`; without a message the command itself leads the line. */
export function checkFeedback(message: string | undefined, cmd: string, expected: string, observed: string): string {
  const tail = `expected ${expected}, got ${observed}`;
  return message ? `${message} (${tail})` : `${cmd}: ${tail}`;
}

export async function runCheck(send: SendCommand, check: RedisCheck): Promise<CheckItem> {
  const cmd = formatCommand(check.cmd);
  const refused = refusal(check);
  const expectedText = () => evaluateAssertion(check, null).expected;
  if (refused) {
    return { cmd, ok: false, expected: expectedText(), observed: 'refused', feedback: `${check.message ? `${check.message} ` : ''}(${refused})` };
  }
  let raw: unknown;
  try {
    raw = await send(check.cmd);
  } catch (err) {
    // An error reply (WRONGTYPE, unknown command) is Redis answering; anything else means no answer at all.
    const observed = isRedisErrorReply(err) ? `an error: ${err.message}` : 'no reply (Redis is not reachable right now)';
    return { cmd, ok: false, expected: expectedText(), observed, feedback: checkFeedback(check.message, cmd, expectedText(), observed) };
  }
  const outcome = evaluateAssertion(check, normalizeReply(raw));
  return {
    cmd,
    ok: outcome.ok,
    expected: outcome.expected,
    observed: outcome.observed,
    feedback: outcome.ok ? '' : checkFeedback(check.message, cmd, outcome.expected, outcome.observed),
  };
}

/** Runs every check (never stops at the first failure, so the learner sees all of them). */
export async function runChecks(send: SendCommand, checks: readonly RedisCheck[]): Promise<CheckItem[]> {
  const out: CheckItem[] = [];
  for (const c of checks) out.push(await runCheck(send, c));
  return out;
}

export function summarize(items: readonly CheckItem[], passedText: string): { ok: boolean; message: string } {
  const failed = items.filter((i) => !i.ok);
  if (failed.length === 0) return { ok: true, message: passedText };
  return { ok: false, message: failed.map((i) => i.feedback).join('\n') };
}

export function passedChecksText(n: number): string {
  return n === 1 ? 'The check passed.' : `All ${n} checks passed.`;
}
