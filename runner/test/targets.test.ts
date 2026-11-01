import pino from 'pino';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createLearnerDeps, type LearnerContext } from '@quest/shared';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { databaseUrl, redisUrl, workspaceDir } from './env.js';

// A-05: the runner takes any target string in `redisUrl`, and learner deps carry `redisCached`.

let app: FastifyInstance;
beforeAll(async () => {
  app = buildServer({ port: 0, workspaceDir, redisUrl, databaseUrl }, pino({ level: 'silent' }));
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

async function run(payload: object): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.inject({ method: 'POST', url: '/run', payload });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

describe('POST /run redisUrl accepts every target scheme', () => {
  test.each([
    'http://redis:6379',
    'sentinel://nohost',
    'cluster://',
    'sentinel://@h:1',
    'redis://:abc',
  ])('a bad target %j is a 400 that says why', async (bad) => {
    const { status, body } = await run({ module: '_examples/ok.js', redisUrl: bad });
    expect(status).toBe(400);
    expect((body.error as { message: string }).message).toMatch(
      /^"redisUrl" is not a valid Redis target: /,
    );
  });

  test('a well-formed cluster and sentinel target pass validation and fail at connect, per call', async () => {
    for (const redisUrl of [
      'cluster://127.0.0.1:1,127.0.0.1:2',
      'sentinel://mymaster@127.0.0.1:1',
    ]) {
      const { status, body } = await run({
        module: '_examples/ok.js',
        redisUrl,
        calls: [{ args: [] }],
        timeoutMs: 8000,
      });
      expect(status).toBe(200);
      const results = body.results as Array<{ ok: boolean; error?: { message: string } }>;
      expect(results[0]!.ok).toBe(false);
      expect(results[0]!.error?.message).toBeTruthy();
    }
  }, 40_000);

  test('a single-node redis:// override still works', async () => {
    const { body } = await run({ module: '_examples/ok.js', redisUrl });
    expect((body.results as Array<{ ok: boolean }>)[0]!.ok).toBe(true);
  });
});

describe('deps.redisCached', () => {
  const key = `test:a05:cached:${Date.now()}`;
  let observerCtx: LearnerContext;
  const observer = () => observerCtx.deps.redis;
  const hgetallCalls = async (): Promise<number> => {
    const info = await observer().info('commandstats');
    return Number(/cmdstat_hgetall:calls=(\d+)/.exec(info)?.[1] ?? 0);
  };
  beforeAll(async () => {
    // A second connection of its own, standing in for "another process": it writes and reads server stats.
    observerCtx = await createLearnerDeps({ redisUrl, databaseUrl });
    await observer().del(key);
  });
  afterAll(async () => {
    await observer().del(key);
    await observerCtx.close();
  });

  test('a second read never reaches the server, a write from another connection invalidates, and none of it is counted', async () => {
    const logs: string[] = [];
    const ctx = await createLearnerDeps({ redisUrl, databaseUrl, log: (l) => logs.push(l) });
    try {
      await ctx.deps.redis.hSet(key, { runs: '10' });
      expect(ctx.counters.redisCommands).toBe(1);
      const base = await hgetallCalls();
      expect(await ctx.deps.redisCached.hGetAll(key)).toEqual({ runs: '10' });
      expect(await hgetallCalls()).toBe(base + 1); // first read: the server answers
      expect(await ctx.deps.redisCached.hGetAll(key)).toEqual({ runs: '10' });
      expect(await hgetallCalls()).toBe(base + 1); // second read: served from the client's memory
      await observer().hSet(key, { runs: '11' }); // another connection writes: the server invalidates the entry
      await new Promise((r) => setTimeout(r, 150));
      expect(await ctx.deps.redisCached.hGetAll(key)).toEqual({ runs: '11' });
      expect(await hgetallCalls()).toBe(base + 2); // third read: back to the server, fresh value
      // redisCached is not in redisCommands (a hit never reaches the server): only the one HSET above counted.
      expect(ctx.counters.redisCommands).toBe(1);
      expect(logs.filter((l) => l.startsWith('redisCached:'))).toHaveLength(1);
      expect(logs.find((l) => l.startsWith('redisCached:'))).toMatch(
        /single node .*RESP 3, client-side cache on \(LRU, max 5000/,
      );
    } finally {
      await ctx.close();
    }
  });

  test('it is lazy (no connection until used), supports multi, and the learner cannot close it', async () => {
    // Only this test's own connections are judged, by the ids they report themselves. The server is shared with
    // the other suites and, under `pnpm -r test`, with the other packages' suites, whose clients come and go on
    // their own clock: a diff of CLIENT LIST between two reads is not stable (seen on CI).
    const isOpen = async (id: number): Promise<boolean> => {
      const list = (await observer().sendCommand(['CLIENT', 'LIST', 'ID', String(id)])) as string;
      return list.includes(`id=${id} `);
    };
    const created = () => logs.filter((l) => l.startsWith('redisCached:'));
    const logs: string[] = [];
    const ctx = await createLearnerDeps({ redisUrl, databaseUrl, log: (l) => logs.push(l) });
    let mainId = 0;
    let cachedId = 0;
    try {
      mainId = await ctx.deps.redis.clientId();
      expect(await isOpen(mainId)).toBe(true);
      expect(created()).toEqual([]); // the cached client does not exist yet, so nothing of it is connected
      await ctx.deps.redisCached.close(); // swallowed
      const out = await ctx.deps.redisCached.multi().set(key, 'x').get(key).exec();
      expect(out).toEqual(['OK', 'x']);
      expect(created()).toHaveLength(1); // created on first use
      cachedId = await ctx.deps.redisCached.clientId();
      expect(cachedId).not.toBe(mainId); // a connection of its own, next to deps.redis
      expect(await isOpen(cachedId)).toBe(true);
    } finally {
      await ctx.close();
    }
    await new Promise((r) => setTimeout(r, 100));
    expect(await isOpen(mainId)).toBe(false); // both of this test's connections are gone
    expect(await isOpen(cachedId)).toBe(false);
  });
});
