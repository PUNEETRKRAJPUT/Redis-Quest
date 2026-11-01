// quiz (multiple choice) and answer (typed value read back from Redis).
// Neither ever reveals the expected value on a miss: the learner can try again.

import type { AnswerVerifier, QuizVerifier } from '@quest/shared';
import { isRedisErrorReply } from '../redis.js';
import { refusal } from './redis-checks.js';
import { formatCommand, normalizeReply, numericValue, type Reply } from './reply.js';
import type { SendCommand } from './types.js';

export interface SimpleResult {
  ok: boolean;
  message: string;
  details: Record<string, unknown>;
}

export function gradeQuiz(q: QuizVerifier, submitted: string | string[] | undefined): SimpleResult {
  const picked = submitted === undefined ? [] : (Array.isArray(submitted) ? submitted : [submitted]).map((s) => s.trim()).filter(Boolean);
  if (picked.length === 0) {
    return { ok: false, message: 'No answer was submitted for this question.', details: { question: q.question, picked: [] } };
  }
  const labels = new Map(q.options.map((o) => [o.id, o.label]));
  const unknown = picked.filter((p) => !labels.has(p));
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `${unknown.join(', ')} is not one of the options for this question.`,
      details: { question: q.question, picked },
    };
  }
  const want = new Set(q.correct);
  const got = new Set(picked);
  const ok = want.size === got.size && [...want].every((c) => got.has(c));
  const pickedLabels = [...got].map((p) => `"${labels.get(p)}"`).join(', ');
  if (ok) {
    return { ok: true, message: `Correct. ${q.explanation}`, details: { question: q.question, picked, explanation: q.explanation } };
  }
  const message =
    want.size > 1
      ? `Not quite: you picked ${pickedLabels}. This question has ${want.size} correct options.`
      : `Not quite: you picked ${pickedLabels}.`;
  return { ok: false, message, details: { question: q.question, picked } };
}

/** Lenient parsing of what a learner copies from redis-cli: `(integer) 5`, `"Puneet"`. */
export function cleanTyped(text: string): string {
  let s = text.trim();
  const m = /^\(integer\)\s*(.*)$/i.exec(s);
  if (m) s = (m[1] ?? '').trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  return s;
}

function transformExpected(reply: Reply, transform: 'string' | 'number' | 'length'): string | number | null {
  if (transform === 'length') {
    if (reply === null) return 0;
    return Array.isArray(reply) ? reply.length : String(reply).length;
  }
  if (transform === 'number') return numericValue(reply);
  if (reply === null || Array.isArray(reply)) return null;
  return String(reply);
}

export async function gradeAnswer(a: AnswerVerifier, typed: string | string[] | undefined, send: SendCommand): Promise<SimpleResult> {
  const transform = a.expected.transform ?? 'string';
  const compare = a.compare ?? 'equals';
  const text = Array.isArray(typed) ? typed[0] : typed;
  const details: Record<string, unknown> = { prompt: a.prompt, typed: text ?? null, compare, transform };
  if (text === undefined || text.trim() === '') {
    return { ok: false, message: `${a.message} (nothing was typed)`, details };
  }
  const refused = refusal({ cmd: a.expected.cmd });
  if (refused) return { ok: false, message: `${a.message} (${refused})`, details };

  let reply: Reply;
  try {
    reply = normalizeReply(await send(a.expected.cmd));
  } catch (err) {
    const why = isRedisErrorReply(err) ? `Redis answered ${formatCommand(a.expected.cmd)} with an error` : 'Redis is not reachable right now';
    return { ok: false, message: `${a.message} (could not read the expected value: ${why})`, details };
  }
  const expected = transformExpected(reply, transform);
  const cleaned = cleanTyped(text);
  details.cleaned = cleaned;
  if (expected === null) {
    // Nothing to compare against (nil or a list for a string answer): no typed value can be right.
    return { ok: false, message: `${a.message} (you typed ${JSON.stringify(text.trim())}; Redis has no value to compare it with right now)`, details };
  }
  let ok: boolean;
  if (compare === 'numeric_within') {
    const n = numericValue(cleaned);
    ok = n !== null && typeof expected === 'number' && Math.abs(n - expected) <= (a.tolerance ?? 0);
  } else if (typeof expected === 'number') {
    const n = numericValue(cleaned);
    ok = n !== null && n === expected;
  } else {
    ok = cleaned === expected;
  }
  return ok
    ? { ok: true, message: 'Correct.', details }
    : { ok: false, message: `${a.message} (you typed ${JSON.stringify(text.trim())})`, details };
}
