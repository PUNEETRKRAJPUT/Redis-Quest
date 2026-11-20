import { describe, expect, test } from 'vitest';
import type { LearnerCounters, LearnerDb } from '@quest/shared';
import {
  MAX_TRACE_ENTRIES,
  MAX_TRACE_HEADER_CHARS,
  RequestTrace,
  cleanLabel,
  commandLabel,
  traceDb,
  traceRedis,
} from '../src/trace.js';

/** A clock the test moves by hand, so offsets and durations are exact. */
function clock(): { now: () => number; tick: (ms: number) => void } {
  let t = 1000;
  return { now: () => t, tick: (ms) => void (t += ms) };
}

/** A stand-in for the counted client: it moves the counters the way the counting proxy does. */
function fakeRedis(counters: LearnerCounters, clk: ReturnType<typeof clock>) {
  // The clock moves when the reply arrives, not while the command is being sent.
  const slow = (ms: number, value: unknown) =>
    Promise.resolve().then(() => {
      clk.tick(ms);
      return value;
    });
  const client = {
    isOpen: true,
    get(key: string) {
      counters.redisCommands += 1;
      return slow(2, `v:${key}`);
    },
    hGetAll() {
      counters.redisCommands += 1;
      return slow(3, {});
    },
    fail() {
      counters.redisCommands += 1;
      return Promise.reject(new Error('boom'));
    },
    on() {
      return client;
    },
    json: {
      get() {
        counters.redisCommands += 1;
        return slow(1, 1);
      },
    },
    multi() {
      let queued = 0;
      const m = {
        set() {
          queued += 1;
          return m;
        },
        exec() {
          if (queued > 0) counters.redisCommands += 1;
          queued = 0;
          return slow(4, []);
        },
      };
      return m;
    },
  };
  return client;
}

describe('RequestTrace', () => {
  test('records start offset and duration in call order', async () => {
    const clk = clock();
    const trace = new RequestTrace(clk.now);
    const counters = { redisCommands: 0, dbQueries: 0 };
    const redis = traceRedis(fakeRedis(counters, clk), counters, trace);
    clk.tick(5);
    await redis.get('a');
    await redis.hGetAll('b');
    const [a, b] = trace.snapshot();
    expect(a).toMatchObject({ kind: 'redis', label: 'GET a', startMs: 5, by: 'builtin', ok: true });
    expect(a?.ms).toBe(2);
    expect(b).toMatchObject({ label: 'HGETALL b', startMs: 7 });
    expect(counters.redisCommands).toBe(2);
  });

  test('marks a failed command not ok and keeps the rejection', async () => {
    const clk = clock();
    const trace = new RequestTrace(clk.now);
    const counters = { redisCommands: 0, dbQueries: 0 };
    const redis = traceRedis(fakeRedis(counters, clk), counters, trace);
    await expect(redis.fail()).rejects.toThrow('boom');
    expect(trace.snapshot()[0]).toMatchObject({ label: 'FAIL', ok: false });
  });

  test('does not record listeners or other calls that are not commands', () => {
    const clk = clock();
    const trace = new RequestTrace(clk.now);
    const counters = { redisCommands: 0, dbQueries: 0 };
    const redis = traceRedis(fakeRedis(counters, clk), counters, trace);
    expect(redis.on()).toBe(redis);
    expect(redis.isOpen).toBe(true);
    expect(trace.snapshot()).toEqual([]);
  });

  test('a module namespace command carries its namespace', async () => {
    const clk = clock();
    const trace = new RequestTrace(clk.now);
    const counters = { redisCommands: 0, dbQueries: 0 };
    const redis = traceRedis(fakeRedis(counters, clk), counters, trace);
    await redis.json.get('doc');
    expect(trace.snapshot()[0]?.label).toBe('JSON.GET doc');
  });

  test('a multi is one bar, labelled with how many commands it carried', async () => {
    const clk = clock();
    const trace = new RequestTrace(clk.now);
    const counters = { redisCommands: 0, dbQueries: 0 };
    const redis = traceRedis(fakeRedis(counters, clk), counters, trace);
    await redis.multi().set().set().set().exec();
    const rows = trace.snapshot();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'MULTI/EXEC x3', ms: 4, ok: true });
  });

  test('an empty multi sends nothing and leaves no bar', async () => {
    const clk = clock();
    const trace = new RequestTrace(clk.now);
    const counters = { redisCommands: 0, dbQueries: 0 };
    const redis = traceRedis(fakeRedis(counters, clk), counters, trace);
    await redis.multi().exec();
    expect(trace.snapshot()).toEqual([]);
  });

  test('the "by" flag at call time says who ran', async () => {
    const clk = clock();
    const trace = new RequestTrace(clk.now);
    const counters = { redisCommands: 0, dbQueries: 0 };
    const redis = traceRedis(fakeRedis(counters, clk), counters, trace);
    await redis.get('x');
    trace.by = 'learner';
    await redis.get('y');
    expect(trace.snapshot().map((e) => e.by)).toEqual(['builtin', 'learner']);
  });

  test('db queries are recorded, failures too', async () => {
    const clk = clock();
    const trace = new RequestTrace(clk.now);
    const inner: LearnerDb = {
      async query(text) {
        clk.tick(7);
        if (text.includes('bad')) throw new Error('syntax');
        return { rows: [] };
      },
    };
    const db = traceDb(inner, trace);
    await db.query('SELECT *\n  FROM players WHERE id = $1', ['p-1']);
    await expect(db.query('SELECT bad')).rejects.toThrow('syntax');
    const rows = trace.snapshot();
    expect(rows[0]).toMatchObject({
      kind: 'db',
      label: 'SELECT * FROM players WHERE id = $1',
      ms: 7,
      ok: true,
    });
    expect(rows[1]).toMatchObject({ kind: 'db', ok: false });
  });

  test('a call that never finishes is closed at the time of the snapshot and marked not ok', () => {
    const clk = clock();
    const trace = new RequestTrace(clk.now);
    trace.begin('redis', 'BLPOP q');
    clk.tick(30);
    expect(trace.snapshot()[0]).toMatchObject({ ms: 30, ok: false });
  });

  test('the header is compact JSON the UI can parse, with rows in call order', () => {
    const clk = clock();
    const trace = new RequestTrace(clk.now);
    const end = trace.begin('redis', 'GET k');
    clk.tick(2.26);
    end(true);
    const parsed = JSON.parse(trace.header()) as {
      v: number;
      total: number;
      n: number;
      e: unknown[];
    };
    expect(parsed).toEqual({ v: 1, total: 2.3, n: 1, e: [['r', 'GET k', 0, 2.3, 'b', 1]] });
  });

  test('the header stays under the cap and still says how many calls there were', () => {
    const clk = clock();
    const trace = new RequestTrace(clk.now);
    for (let i = 0; i < 300; i += 1) trace.begin('redis', `GET player:stats:p-${i}`)(true);
    const h = trace.header();
    expect(h.length).toBeLessThanOrEqual(MAX_TRACE_HEADER_CHARS);
    const parsed = JSON.parse(h) as { n: number; e: unknown[] };
    expect(parsed.n).toBe(300);
    expect(parsed.e.length).toBeGreaterThan(0);
    expect(parsed.e.length).toBeLessThan(300);
  });

  test('memory is bounded: past the limit calls are counted, not stored', () => {
    const trace = new RequestTrace(clock().now);
    for (let i = 0; i < MAX_TRACE_ENTRIES + 25; i += 1) trace.begin('db', 'SELECT 1')(true);
    expect(trace.snapshot()).toHaveLength(MAX_TRACE_ENTRIES);
    expect((JSON.parse(trace.header()) as { n: number }).n).toBe(MAX_TRACE_ENTRIES + 25);
  });

  test('header output is printable ASCII even when a key is not', () => {
    const trace = new RequestTrace(clock().now);
    trace.begin('redis', 'GET café:☃\n')(true);
    expect(/^[\x20-\x7e]*$/.test(trace.header())).toBe(true);
  });
});

describe('labels', () => {
  test('cleanLabel collapses whitespace and truncates', () => {
    expect(cleanLabel('a  \n b')).toBe('a b');
    expect(cleanLabel('x'.repeat(100))).toHaveLength(48);
  });

  test('commandLabel upper-cases the method and shows the first key', () => {
    expect(commandLabel('', 'hGetAll', ['cache:player:p-028'])).toBe('HGETALL cache:player:p-028');
    expect(commandLabel('', 'ping', [])).toBe('PING');
    expect(commandLabel('', 'sendCommand', [['GET', 'k']])).toBe('GET k');
    expect(commandLabel('JSON', 'get', ['doc'])).toBe('JSON.GET doc');
  });
});
