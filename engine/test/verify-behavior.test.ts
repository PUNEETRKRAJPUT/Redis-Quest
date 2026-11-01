import { describe, expect, test } from 'vitest';
import type { BehaviorAssertion } from '@quest/shared';
import {
  deepEqual,
  judgeCalls,
  runAssertions,
  runFixtureSteps,
  type RunFn,
  type RunnerCallResult,
} from '../src/verify/behavior.js';

const ok = (value: unknown): RunnerCallResult => ({ ok: true, value, ms: 1 });
const err = (name: string, message: string): RunnerCallResult => ({
  ok: false,
  error: { name, message },
  ms: 1,
});
const a = (x: Partial<BehaviorAssertion>): BehaviorAssertion =>
  ({ call: { args: ['u-1'] }, ...x }) as BehaviorAssertion;

describe('deepEqual', () => {
  test('JSON semantics, key order free, types strict', () => {
    expect(deepEqual({ a: 1, b: [1, '2'] }, { b: [1, '2'], a: 1 })).toBe(true);
    expect(deepEqual('1', 1)).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual({ a: undefined }, {})).toBe(true);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
  });
});

describe('judgeCalls', () => {
  test('expect applies to every repeated call', () => {
    expect(judgeCalls(a({ expect: true }), [ok(true), ok(true)]).ok).toBe(true);
    expect(judgeCalls(a({ expect: true }), [ok(true), ok(false)]).detail).toBe(
      'expected true, got false on call 2 of 2',
    );
  });
  test('expectCount counts matching return values', () => {
    const r = judgeCalls(
      a({ repeat: 15, expectCount: { value: true, equals: 10 } }),
      [...Array(15)].map(() => ok(true)),
    );
    expect(r).toEqual({
      ok: false,
      matching: 15,
      detail: 'expected exactly 10 of 15 calls to return true, got 15',
    });
    const tenOf15 = [...Array(10)].map(() => ok(true)).concat([...Array(5)].map(() => ok(false)));
    expect(
      judgeCalls(a({ repeat: 15, expectCount: { value: true, equals: 10 } }), tenOf15).ok,
    ).toBe(true);
    expect(judgeCalls(a({ repeat: 15, expectCount: { value: true, lte: 10 } }), tenOf15).ok).toBe(
      true,
    );
    expect(
      judgeCalls(a({ repeat: 15, expectCount: { value: true, gte: 11 } }), tenOf15).detail,
    ).toBe('expected at least 11 of 15 calls to return true, got 10');
    expect(
      judgeCalls(a({ repeat: 15, expectCount: { value: true, between: [9, 11] } }), tenOf15).ok,
    ).toBe(true);
  });
  test('a thrown call fails the assertion, with the error', () => {
    expect(judgeCalls(a({ expect: 1 }), [err('TypeError', 'x is not a function')]).detail).toBe(
      'the call threw: TypeError: x is not a function',
    );
    expect(
      judgeCalls(a({ repeat: 2, expectCount: { value: true, lte: 10 } }), [
        ok(true),
        err('Error', 'boom'),
      ]).detail,
    ).toBe('1 of 2 calls threw; the first: Error: boom');
    expect(
      judgeCalls(a({ sideEffect: [{ cmd: ['TYPE', 'k'], equals: 'hash' }] }), [
        err('LearnerModuleError', 'no default export'),
      ]).detail,
    ).toBe('the call threw: your file could not be loaded: no default export');
  });
  test('expectError: every call must throw (and match)', () => {
    expect(judgeCalls(a({ expectError: true }), [err('Error', 'nope')]).ok).toBe(true);
    expect(judgeCalls(a({ expectError: 'not found' }), [err('Error', 'player not found')]).ok).toBe(
      true,
    );
    expect(judgeCalls(a({ expectError: 'not found' }), [err('Error', 'boom')]).detail).toBe(
      'expected an error matching /not found/, got Error: boom',
    );
    expect(judgeCalls(a({ expectError: true }), [ok(5)]).detail).toBe(
      'expected it to throw, but it returned 5',
    );
  });
});

describe('runAssertions', () => {
  test('sends repeat calls with concurrency (clamped to the runner max) and judges side effects', async () => {
    const seen: unknown[] = [];
    const run: RunFn = async (req) => {
      seen.push(req);
      return { results: req.calls.map(() => ok(true)) };
    };
    const send = async () => 'none';
    const r = await runAssertions(
      {
        slot: 'ratelimit.allow',
        module: 'ch3/ratelimit.js',
        concurrency: 500,
        assertions: [
          a({
            repeat: 3,
            expect: true,
            message: 'All three should pass.',
            sideEffect: [{ cmd: ['TYPE', 'ratelimit:u-1'], equals: 'hash' }],
          }),
          a({
            expect: true,
            sideEffect: [{ cmd: ['TYPE', 'k'], equals: 'hash', message: 'Own message.' }],
          }),
        ],
      },
      { run, send },
    );
    expect(r.concurrency).toBe(200);
    expect((seen[0] as { calls: unknown[]; concurrency: number }).calls).toHaveLength(3);
    expect(r.ok).toBe(false);
    expect(r.message).toBe(
      'All three should pass. (after the call, TYPE ratelimit:u-1: expected hash, got none)\nOwn message. (expected hash, got none)',
    );
  });
  test('unknown slot file and unreachable runner fail loudly', async () => {
    const r1 = await runAssertions(
      { slot: 'x.y', module: undefined, assertions: [a({ expect: 1 })] },
      { run: async () => ({ results: [] }), send: async () => null },
    );
    expect(r1.message).toBe('The engine does not know which workspace file implements slot x.y.');
    const r2 = await runAssertions(
      { slot: 'x.y', module: 'f.js', assertions: [a({ expect: 1 })] },
      {
        run: async () => {
          throw new Error('fetch failed');
        },
        send: async () => null,
      },
    );
    expect(r2.message).toBe(
      'x.y("u-1") (the runner that calls your function is not reachable: fetch failed)',
    );
  });
});

describe('fixtures', () => {
  test('cmd steps run; game:* and FLUSHALL refused; sql never skipped silently', async () => {
    const sent: string[][] = [];
    const send = async (argv: string[]) => {
      sent.push(argv);
      return 1;
    };
    expect(await runFixtureSteps([{ cmd: ['DEL', 'k'] }], send)).toBeNull();
    expect(sent).toEqual([['DEL', 'k']]);
    expect(await runFixtureSteps([{ cmd: ['DEL', 'game:progress'] }], send)).toMatch(/game:\*/);
    expect(await runFixtureSteps([{ cmd: ['FLUSHALL'] }], send)).toMatch(/FLUSHALL/);
    expect(await runFixtureSteps([{ sql: 'select 1' }], send)).toBe(
      'fixtures step 1 is a sql step, which the engine cannot run yet',
    );
  });
});
