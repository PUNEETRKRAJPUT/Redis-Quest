// D-07: GET /api/league and POST /api/league/score against a fake scratch connection (no Redis needed).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createLeague, type LeagueRedis } from '../src/features/league.js';
import type { FeatureContext } from '../src/features/index.js';

const HOLE = `title: Stock the shelves
task: Put apples in stock:a and pears in stock:b.
par: 2
checks:
  - cmd: [GET, stock:a]
    equals: apples
  - cmd: [GET, stock:b]
    equals: pears
`;

/** The few commands the scorer sends, answered from a map. `db` is what CLIENT INFO reports. */
function fakeScratch(db = 7) {
  const kv = new Map<string, string>();
  const log: string[] = [];
  return {
    log,
    run: async (argv: string[]): Promise<unknown> => {
      log.push(argv.join(' '));
      switch (argv[0]) {
        case 'CLIENT':
          return `id=1 db=${db}`;
        case 'FLUSHDB':
          kv.clear();
          return 'OK';
        case 'SET':
          kv.set(argv[1] as string, argv[2] as string);
          return 'OK';
        case 'MSET':
          for (let i = 1; i + 1 < argv.length; i += 2)
            kv.set(argv[i] as string, argv[i + 1] as string);
          return 'OK';
        case 'GET':
          return kv.get(argv[1] as string) ?? null;
        case 'MEMORY':
          return kv.has(argv[2] as string) ? 60 : null;
        default:
          throw new Error(`ERR unknown command '${argv[0]}'`);
      }
    },
    close: async () => undefined,
  };
}

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'quest-league-'));
  await mkdir(join(dir, 'holes/01-stock/entries'), { recursive: true });
  await writeFile(join(dir, 'holes/01-stock/hole.yaml'), HOLE);
  await writeFile(
    join(dir, 'holes/01-stock/entries/par-house.redis'),
    'SET stock:a apples\nSET stock:b pears\n',
  );
  await writeFile(
    join(dir, 'holes/01-stock/entries/octocat.redis'),
    'MSET stock:a apples stock:b pears\n',
  );
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function app(
  redis: LeagueRedis,
  opened: { url: string; db: number }[] = [],
): Promise<FastifyInstance> {
  const a = Fastify();
  const feature = createLeague({
    golfDir: () => dir,
    redis: () => redis,
    open: (async (url: string, db: number) => {
      opened.push({ url, db });
      return fakeScratch();
    }) as never,
  });
  await feature.register({ api: a, deps: {} } as unknown as FeatureContext);
  return a;
}

const single: LeagueRedis = {
  kind: 'single',
  isUp: true,
  singleUrl: 'redis://127.0.0.1:6379',
  master: undefined,
};

describe('GET /league', () => {
  test('holes with the committed entries ranked, best first', async () => {
    const opened: { url: string; db: number }[] = [];
    const a = await app(single, opened);
    const res = await a.inject({ method: 'GET', url: '/league' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ available: true, scored: true, db: 7, problems: [] });
    const hole = body.holes[0];
    expect(hole).toMatchObject({ id: '01-stock', par: 2, setup: [] });
    expect(hole.checks[0]).toEqual({ cmd: 'GET stock:a', expected: 'apples' });
    expect(
      hole.entries.map((e: { handle: string; rank: number; underPar: number }) => [
        e.handle,
        e.rank,
        e.underPar,
      ]),
    ).toEqual([
      ['octocat', 1, 1],
      ['par-house', 2, 0],
    ]);
    // scoring used a connection of its own on database 7, never the engine's
    expect(opened).toEqual([{ url: 'redis://127.0.0.1:6379', db: 7 }]);
  });

  test('on a cluster the holes still list, unscored, with the reason', async () => {
    const a = await app({ kind: 'cluster', isUp: true, singleUrl: undefined, master: undefined });
    const body = (await a.inject({ method: 'GET', url: '/league' })).json();
    expect(body.scored).toBe(false);
    expect(body.unscored).toMatch(/cluster has only one database/);
    expect(body.holes[0].entries).toEqual([
      { handle: 'octocat', commands: 1 },
      { handle: 'par-house', commands: 2 },
    ]);
  });
});

describe('POST /league/score', () => {
  const post = (a: FastifyInstance, payload: unknown) =>
    a.inject({ method: 'POST', url: '/league/score', payload: payload as object });

  test('an attempt that passes: score, par and where it would rank', async () => {
    const a = await app(single);
    const res = await post(a, { hole: '01-stock', entry: 'MSET stock:a apples stock:b pears' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result).toMatchObject({
      ok: true,
      commands: 1,
      par: 2,
      underPar: 1,
      handle: 'you',
    });
    expect(body.rank).toMatchObject({ position: 1, of: 3, tiedWith: [] });
  });

  test('a worse attempt ranks below the committed entries', async () => {
    const a = await app(single);
    const res = await post(a, {
      hole: '01-stock',
      entry: 'SET stock:a apples\nSET stock:b pears\nSET junk 1',
    });
    expect(res.json().rank).toMatchObject({ position: 3, of: 3 });
  });

  test('an attempt that fails a check has no rank and says why', async () => {
    const a = await app(single);
    const body = (await post(a, { hole: '01-stock', entry: 'SET stock:a apples' })).json();
    expect(body.result).toMatchObject({ ok: false, reason: 'checks_failed' });
    expect(body.rank).toBeNull();
  });

  test('a refused command is a 400 with its line', async () => {
    const a = await app(single);
    const res = await post(a, { hole: '01-stock', entry: 'SET a 1\nEVAL "return 1" 0' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_entry', problems: [{ line: 2, col: 1 }] });
  });

  test('an unknown hole, a bad body, a cluster and a down Redis', async () => {
    const a = await app(single);
    expect((await post(a, { hole: 'nope', entry: 'SET a 1' })).statusCode).toBe(404);
    expect((await post(a, { hole: 1 })).statusCode).toBe(400);
    const c = await app({ kind: 'cluster', isUp: true, singleUrl: undefined, master: undefined });
    const cluster = await post(c, { hole: '01-stock', entry: 'SET a 1' });
    expect(cluster.statusCode).toBe(409);
    expect(cluster.json().error).toBe('cluster');
    const d = await app({ ...single, isUp: false });
    expect((await post(d, { hole: '01-stock', entry: 'SET a 1' })).statusCode).toBe(503);
  });

  test('Sentinel scores on the master it names', async () => {
    const opened: { url: string; db: number }[] = [];
    const a = await app(
      { kind: 'sentinel', isUp: true, singleUrl: undefined, master: 'redis:6379' },
      opened,
    );
    await post(a, { hole: '01-stock', entry: 'SET stock:a apples' });
    expect(opened[0]).toEqual({ url: 'redis://redis:6379', db: 7 });
  });
});
