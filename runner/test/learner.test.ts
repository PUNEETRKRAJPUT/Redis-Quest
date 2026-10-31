import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  aggregateMetrics,
  callLearner,
  createLearnerDeps,
  percentile,
  runLearnerCalls,
  type LearnerContext,
} from '@quest/shared';
import { databaseUrl, redisUrl } from './env.js';

let ctx: LearnerContext;
const lines: string[] = [];

beforeAll(async () => {
  ctx = await createLearnerDeps({ redisUrl, databaseUrl, log: (l) => lines.push(l) });
});
afterAll(async () => {
  await ctx.close();
});

const reset = (): void => {
  ctx.counters.redisCommands = 0;
  ctx.counters.dbQueries = 0;
};

describe('redis counting proxy', () => {
  test('one command call counts one, including a failing one', async () => {
    reset();
    await ctx.deps.redis.set('t8:a', '1');
    expect(await ctx.deps.redis.get('t8:a')).toBe('1');
    await expect(ctx.deps.redis.incr('t8:a-not-int-xx').then(() => ctx.deps.redis.hGet('t8:a', 'f'))).rejects.toThrow();
    expect(ctx.counters.redisCommands).toBe(4);
  });

  test('multi().exec() counts one however many commands are queued', async () => {
    reset();
    const out = await ctx.deps.redis.multi().set('t8:m', '1').incr('t8:m').get('t8:m').exec();
    expect(out).toEqual(['OK', 2, '2']);
    expect(ctx.counters.redisCommands).toBe(1);
    reset();
    await ctx.deps.redis.multi().set('t8:m', '1').incr('t8:m').execAsPipeline();
    expect(ctx.counters.redisCommands).toBe(1);
  });

  test('a multi that is never executed counts nothing', () => {
    reset();
    ctx.deps.redis.multi().set('t8:never', '1').incr('t8:never');
    expect(ctx.counters.redisCommands).toBe(0);
  });

  test('auto-pipelined commands in one tick still count one each', async () => {
    reset();
    await Promise.all([1, 2, 3, 4, 5].map(() => ctx.deps.redis.incr('t8:pipe')));
    expect(ctx.counters.redisCommands).toBe(5);
  });

  test('sendCommand and module namespaces count; listeners do not', async () => {
    reset();
    expect(await ctx.deps.redis.sendCommand(['PING'])).toBe('PONG');
    await ctx.deps.redis.json.set('t8:j', '$', { a: 1 });
    expect(await ctx.deps.redis.json.get('t8:j')).toEqual({ a: 1 });
    ctx.deps.redis.on('error', () => undefined);
    expect(ctx.counters.redisCommands).toBe(3);
  });

  test('lifecycle calls from learner code are swallowed', async () => {
    reset();
    await ctx.deps.redis.quit();
    await ctx.deps.redis.close();
    expect(await ctx.deps.redis.get('t8:a')).toBe('1');
    expect(ctx.counters.redisCommands).toBe(1);
  });

  test('duplicate() returns a counted clone that close() cleans up', async () => {
    reset();
    const dup = ctx.deps.redis.duplicate();
    await dup.connect();
    await dup.get('t8:a');
    expect(ctx.counters.redisCommands).toBe(1);
  });

  test('cleanup test keys', async () => {
    await ctx.deps.redis.del(['t8:a', 't8:m', 't8:pipe', 't8:j']);
  });
});

describe('db counter and log', () => {
  test('counts every query, even a failing one, and returns { rows }', async () => {
    reset();
    const res = await ctx.deps.db.query('SELECT $1::int AS n', [7]);
    expect(res).toEqual({ rows: [{ n: 7 }] });
    await expect(ctx.deps.db.query('SELECT * FROM table_that_does_not_exist')).rejects.toThrow();
    expect(ctx.counters.dbQueries).toBe(2);
  });

  test('log formats like console.log', () => {
    ctx.deps.log('a', 1, { b: 2 });
    expect(lines.at(-1)).toBe("a 1 { b: 2 }");
  });
});

describe('metrics', () => {
  test('nearest-rank percentiles', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 99)).toBe(99);
    expect(percentile([], 50)).toBe(0);
    expect(percentile([5], 99)).toBe(5);
  });

  test('aggregate', () => {
    const m = aggregateMetrics(
      [
        { ok: true, ms: 10 },
        { ok: false, ms: 30, error: { name: 'E', message: 'x' } },
        { ok: true, ms: 20 },
      ],
      { redisCommands: 4, dbQueries: 1 },
      60,
    );
    expect(m).toEqual({ calls: 3, errors: 1, p50Ms: 20, p99Ms: 30, dbQueries: 1, redisCommands: 4, totalMs: 60 });
  });
});

describe('callLearner and runLearnerCalls', () => {
  test('value, throw, timeout, bigint', async () => {
    expect(await callLearner(async () => 5, ctx.deps)).toMatchObject({ ok: true, value: 5 });
    expect(await callLearner(async () => 10n, ctx.deps)).toMatchObject({ ok: true, value: '10' });
    const threw = await callLearner(() => {
      throw new RangeError('boom');
    }, ctx.deps);
    expect(threw).toMatchObject({ ok: false, error: { name: 'RangeError', message: 'boom' } });
    const slow = await callLearner(() => new Promise(() => undefined), ctx.deps, [], { timeoutMs: 100 });
    expect(slow).toMatchObject({ ok: false, error: { name: 'TimeoutError' } });
    expect(slow.ms).toBeGreaterThanOrEqual(90);
  });

  test('args are passed after deps', async () => {
    const r = await callLearner(async (_d, a, b) => (a as number) + (b as number), ctx.deps, [2, 3]);
    expect(r.value).toBe(5);
  });

  test('concurrency bound and result order', async () => {
    let live = 0;
    let peak = 0;
    const fn = async (_d: unknown, i: unknown): Promise<unknown> => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 20));
      live--;
      return i;
    };
    const calls = Array.from({ length: 12 }, (_, i) => ({ args: [i] }));
    const results = await runLearnerCalls(fn as never, ctx.deps, calls, { concurrency: 4 });
    expect(peak).toBe(4);
    expect(results.map((r) => r.value)).toEqual(calls.map((c) => c.args[0]));
  });

  test('calls not started before the budget is spent fail with TimeoutError', async () => {
    const fn = (): Promise<void> => new Promise((r) => setTimeout(r, 80));
    const results = await runLearnerCalls(fn as never, ctx.deps, [{}, {}, {}], { concurrency: 1, timeoutMs: 100 });
    expect(results.map((r) => r.ok)).toEqual([true, false, false]);
  });
});

describe('loadLearnerModule (real Node child, because vitest rewrites import())', () => {
  const script = `
    import { mkdtemp, writeFile, utimes, rm } from 'node:fs/promises';
    import os from 'node:os';
    import path from 'node:path';
    import { loadLearnerModule } from '@quest/shared';
    const dir = await mkdtemp(path.join(os.tmpdir(), 'quest-loader-'));
    const out = {};
    const file = path.join(dir, 'm.js');
    await writeFile(file, 'export default async () => 1;\\n');
    const a = await loadLearnerModule(dir, 'm.js');
    const a2 = await loadLearnerModule(dir, 'm.js');
    out.reused = a.fn === a2.fn;
    await writeFile(file, 'export default async () => 2;\\n');
    const future = new Date(Date.now() + 5000);
    await utimes(file, future, future);
    const b = await loadLearnerModule(dir, 'm.js');
    out.afterEdit = await b.fn({});
    out.exports = Object.keys(b.exports);
    const err = async (rel, setup) => {
      if (setup) await writeFile(path.join(dir, rel), setup);
      try { await loadLearnerModule(dir, rel); return 'no error'; } catch (e) { return e.name + ': ' + e.message; }
    };
    out.traversal = await err('../etc/passwd');
    out.missing = await err('nope.js');
    out.noDefault = await err('nd.js', 'export const x = 1;\\n');
    out.syntax = await err('bad.js', 'export default async function ( {\\n');
    out.named = (await loadLearnerModule(dir, 'nd.js', 'x').catch((e) => e.message));
    await rm(dir, { recursive: true, force: true });
    console.log(JSON.stringify(out));
  `;

  test('cache-busting, errors and path checks', () => {
    const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: path.resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
    });
    const out = JSON.parse(stdout.trim().split('\n').at(-1) as string);
    expect(out.reused).toBe(true);
    expect(out.afterEdit).toBe(2);
    expect(out.exports).toEqual(['default']);
    expect(out.traversal).toMatch(/LearnerModuleError: module path escapes the workspace/);
    expect(out.missing).toMatch(/LearnerModuleError: module not found/);
    expect(out.noDefault).toMatch(/LearnerModuleError: .*no default export/);
    expect(out.syntax).toMatch(/^SyntaxError/);
    expect(out.named).toMatch(/no exported function named "x"/);
  });
});
