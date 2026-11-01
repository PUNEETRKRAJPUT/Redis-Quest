import { ErrorReply } from 'redis';
import { describe, expect, test } from 'vitest';
import type { RedisCheck } from '@quest/shared';
import { evaluateAssertion } from '../src/verify/assert.js';
import { checkFeedback, refusal, runCheck } from '../src/verify/redis-checks.js';
import { formatCommand, formatReply, normalizeReply, numericValue, replyEquals } from '../src/verify/reply.js';

const check = (c: Partial<RedisCheck>): RedisCheck => ({ cmd: ['GET', 'k'], ...c }) as RedisCheck;

describe('normalizeReply', () => {
  test('RESP2 shapes pass through', () => {
    expect(normalizeReply(5)).toBe(5);
    expect(normalizeReply('x')).toBe('x');
    expect(normalizeReply(null)).toBeNull();
    expect(normalizeReply(undefined)).toBeNull();
    expect(normalizeReply(['a', 1, null, ['b']])).toEqual(['a', 1, null, ['b']]);
  });
  test('Buffers become strings, RESP3 maps and sets become flat lists, booleans 1/0', () => {
    expect(normalizeReply(Buffer.from('OK'))).toBe('OK');
    expect(normalizeReply(new Map([['f', 'v']]))).toEqual(['f', 'v']);
    expect(normalizeReply({ a: '1', b: 2 })).toEqual(['a', '1', 'b', 2]);
    expect(normalizeReply(new Set(['x']))).toEqual(['x']);
    expect(normalizeReply(true)).toBe(1);
    expect(normalizeReply(10n)).toBe(10);
  });
});

describe('comparison contract (P0-05 decision 15)', () => {
  test('numeric expected values compare numerically against numeric strings', () => {
    expect(replyEquals('150', 150)).toBe(true);
    expect(replyEquals('150.0', 150)).toBe(true);
    expect(replyEquals('150', 151)).toBe(false);
    expect(replyEquals('abc', 0)).toBe(false);
    expect(replyEquals(null, 0)).toBe(false);
  });
  test('string expected values: exact string, or an integer by its decimal form', () => {
    expect(replyEquals('zset', 'zset')).toBe(true);
    expect(replyEquals('ZSET', 'zset')).toBe(false);
    expect(replyEquals(0, '0')).toBe(true);
  });
  test('null is nil only', () => {
    expect(replyEquals(null, null)).toBe(true);
    expect(replyEquals('', null)).toBe(false);
    expect(replyEquals([], null)).toBe(false);
  });
  test('lists element-wise, with the same rules inside', () => {
    expect(replyEquals(['a', '1'], ['a', 1])).toBe(true);
    expect(replyEquals(['a'], ['a', 1])).toBe(false);
    expect(replyEquals('a', ['a'])).toBe(false);
  });
  test('numericValue reads inf', () => {
    expect(numericValue('inf')).toBe(Infinity);
    expect(numericValue('-inf')).toBe(-Infinity);
    expect(numericValue(' 12 ')).toBe(12);
    expect(numericValue('12abc')).toBeNull();
  });
});

describe('evaluateAssertion: every assertion kind', () => {
  test('equals / notEquals', () => {
    expect(evaluateAssertion(check({ equals: 'zset' }), 'list')).toEqual({ ok: false, expected: 'zset', observed: 'list' });
    expect(evaluateAssertion(check({ equals: 150 }), '150').ok).toBe(true);
    expect(evaluateAssertion(check({ notEquals: -1 }), -1)).toEqual({ ok: false, expected: 'anything but -1', observed: '-1' });
    expect(evaluateAssertion(check({ notEquals: -1 }), 30).ok).toBe(true);
  });
  test('gte / lte / between read the reply as a number', () => {
    expect(evaluateAssertion(check({ gte: 5 }), 4)).toEqual({ ok: false, expected: 'at least 5', observed: '4' });
    expect(evaluateAssertion(check({ gte: 1 }), '2').ok).toBe(true);
    expect(evaluateAssertion(check({ lte: 10 }), 11).expected).toBe('at most 10');
    expect(evaluateAssertion(check({ between: [1, 30] }), -1)).toEqual({ ok: false, expected: 'between 1 and 30', observed: '-1' });
    expect(evaluateAssertion(check({ between: [1, 30] }), 30).ok).toBe(true);
    expect(evaluateAssertion(check({ gte: 1 }), null)).toEqual({ ok: false, expected: 'at least 1', observed: 'nil' });
    expect(evaluateAssertion(check({ gte: 1 }), 'abc').observed).toBe('abc (not a number)');
  });
  test('exists: not nil and not an empty list', () => {
    expect(evaluateAssertion(check({ exists: true }), 'x').ok).toBe(true);
    expect(evaluateAssertion(check({ exists: true }), []).ok).toBe(false);
    expect(evaluateAssertion(check({ exists: true }), null).ok).toBe(false);
    expect(evaluateAssertion(check({ exists: false }), null).ok).toBe(true);
    expect(evaluateAssertion(check({ exists: true }), 0).ok).toBe(true);
  });
  test('matches is a JavaScript regex on the string form', () => {
    expect(evaluateAssertion(check({ matches: '^redis_version:8' }), 'redis_version:8.2.1').ok).toBe(true);
    expect(evaluateAssertion(check({ matches: '^\\d+$' }), 42).ok).toBe(true);
    expect(evaluateAssertion(check({ matches: 'x' }), null).ok).toBe(false);
  });
  test('oneOf, lengthGte, contains', () => {
    expect(evaluateAssertion(check({ oneOf: ['hash', 'zset'] }), 'zset').ok).toBe(true);
    expect(evaluateAssertion(check({ oneOf: ['hash', 'zset'] }), 'list').expected).toBe('one of hash, zset');
    expect(evaluateAssertion(check({ lengthGte: 3 }), ['a', 'b'])).toEqual({ ok: false, expected: 'length at least 3', observed: 'length 2' });
    expect(evaluateAssertion(check({ lengthGte: 3 }), 'abcd').ok).toBe(true);
    expect(evaluateAssertion(check({ lengthGte: 0 }), null).ok).toBe(true);
    expect(evaluateAssertion(check({ contains: 'user:p-1' }), ['user:a', 'user:p-1']).ok).toBe(true);
    expect(evaluateAssertion(check({ contains: 150 }), ['150']).ok).toBe(true);
    expect(evaluateAssertion(check({ contains: 'ver' }), 'redis_version').ok).toBe(true);
    expect(evaluateAssertion(check({ contains: 'x' }), null).ok).toBe(false);
  });
});

describe('formatting', () => {
  test('replies render short and readable', () => {
    expect(formatReply(null)).toBe('nil');
    expect(formatReply('')).toBe('""');
    expect(formatReply(' padded')).toBe('" padded"');
    expect(formatReply(['a', 1])).toBe('[a, 1]');
    expect(formatReply([])).toBe('(empty list)');
    expect(formatReply(Array.from({ length: 12 }, (_, i) => i))).toBe('[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, … (+2 more)]');
    expect(formatReply('x'.repeat(130)).endsWith('…')).toBe(true);
  });
  test('commands render like typed', () => expect(formatCommand(['SET', 'a b', ''])).toBe('SET "a b" ""'));
  test('feedback line: message plus expected and observed', () => {
    expect(checkFeedback('Not a sorted set.', 'TYPE k', 'zset', 'list')).toBe('Not a sorted set. (expected zset, got list)');
    expect(checkFeedback(undefined, 'TYPE k', 'zset', 'list')).toBe('TYPE k: expected zset, got list');
  });
});

describe('runCheck', () => {
  test('passes and fails with the observed value appended', async () => {
    const send = async () => 'list';
    const r = await runCheck(send, check({ cmd: ['TYPE', 'lb'], equals: 'zset', message: 'lb is not a sorted set any more.' }));
    expect(r).toMatchObject({ ok: false, feedback: 'lb is not a sorted set any more. (expected zset, got list)' });
  });
  test('an error reply is an observed value', async () => {
    const send = async () => {
      throw new ErrorReply('WRONGTYPE Operation against a key holding the wrong kind of value');
    };
    const r = await runCheck(send, check({ cmd: ['GET', 'h'], exists: true }));
    expect(r.ok).toBe(false);
    expect(r.observed).toBe('an error: WRONGTYPE Operation against a key holding the wrong kind of value');
  });
  test('Redis down is reported as no reply', async () => {
    const send = async () => {
      throw new Error('redis is down');
    };
    const r = await runCheck(send, check({ cmd: ['GET', 'h'], exists: true, message: 'm' }));
    expect(r.feedback).toBe('m (expected a value (not nil, not an empty list), got no reply (Redis is not reachable right now))');
  });
  test('write commands are refused at run time unless allowWrite, and never on game:* or FLUSHALL', async () => {
    let sent = 0;
    const send = async () => {
      sent += 1;
      return 'OK';
    };
    const r = await runCheck(send, check({ cmd: ['SET', 'k', 'v'], equals: 'OK' }));
    expect(r.ok).toBe(false);
    expect(r.observed).toBe('refused');
    expect(sent).toBe(0);
    expect(refusal({ cmd: ['SET', 'k', 'v'], allowWrite: true })).toBeNull();
    expect(refusal({ cmd: ['FLUSHALL'], allowWrite: true })).toMatch(/never run/);
    expect(refusal({ cmd: ['DEL', 'game:progress'], allowWrite: true })).toMatch(/game:\*/);
    expect(refusal({ cmd: ['CONFIG', 'SET', 'x', 'y'] })).toMatch(/CONFIG SET is not on the read-only allowlist/);
    expect(refusal({ cmd: ['config', 'get', 'maxmemory'] })).toBeNull();
  });
});
