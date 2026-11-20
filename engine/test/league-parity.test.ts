// The league scorer judges a check with a copy of the engine's evaluation (packages/shared/src/league/evaluate.ts).
// This runs both over the same checks and replies; a change to one copy that is not made to the other fails here.
import { describe, expect, test } from 'vitest';
import { evaluateLeagueAssertion, normalizeLeagueReply, redisCheckSchema } from '@quest/shared';
import { evaluateAssertion } from '../src/verify/assert.js';
import { normalizeReply } from '../src/verify/reply.js';

const checks = (
  [
    { cmd: ['GET', 'k'], equals: 12 },
    { cmd: ['GET', 'k'], equals: 'live' },
    { cmd: ['GET', 'k'], equals: null },
    { cmd: ['LRANGE', 'k', '0', '-1'], equals: ['e8', 'e7'] },
    { cmd: ['GET', 'k'], notEquals: 'x' },
    { cmd: ['GET', 'k'], gte: 5 },
    { cmd: ['GET', 'k'], lte: 5 },
    { cmd: ['TTL', 'k'], between: [55, 60] },
    { cmd: ['EXISTS', 'k'], exists: true },
    { cmd: ['EXISTS', 'k'], exists: false },
    { cmd: ['GET', 'k'], matches: '^li' },
    { cmd: ['GET', 'k'], oneOf: ['a', 12, null] },
    { cmd: ['LRANGE', 'k', '0', '-1'], lengthGte: 2 },
    { cmd: ['SMEMBERS', 'k'], contains: 'p1' },
    { cmd: ['INFO'], notContains: 'cmdstat_eval' },
  ] as const
).map((c) => redisCheckSchema.parse(c));

const replies: unknown[] = [
  null,
  undefined,
  12,
  '12',
  ' 12 ',
  'live',
  'live\nlong',
  '',
  'inf',
  true,
  false,
  10n,
  Buffer.from('live'),
  [],
  ['e8', 'e7'],
  ['e8', 'e7', 'e6'],
  ['p1', 'p2'],
  new Set(['p1']),
  new Map([['a', 'b']]),
  { a: 1 },
  58,
  '58',
  'cmdstat_eval:calls=1\ncmdstat_get:calls=2',
];

describe('league evaluation matches the engine', () => {
  test('every check against every reply gives the same outcome', () => {
    let n = 0;
    for (const check of checks) {
      for (const raw of replies) {
        const mine = evaluateLeagueAssertion(check, normalizeLeagueReply(raw));
        const theirs = evaluateAssertion(check, normalizeReply(raw));
        expect(mine, `${JSON.stringify(check)} vs ${String(raw)}`).toEqual(theirs);
        n++;
      }
    }
    expect(n).toBe(checks.length * replies.length);
  });
});
