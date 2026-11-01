import { describe, expect, test } from 'vitest';
import {
  clientIsReady,
  countRedis,
  createCachedRedis,
  createLearnerDeps,
  failFast,
  TargetError,
  type LearnerCounters,
} from '../../index.js';

// Stand-ins shaped like the three node-redis kinds, as measured on 5.12.1 (docs/handoffs/A-05.md):
// a single client has duplicate/watch/withAbortSignal; a Sentinel client has none of them (it has use());
// a cluster client has duplicate but no watch, no withAbortSignal and no isReady.
const counters = (): LearnerCounters => ({ redisCommands: 0, dbQueries: 0 });

describe('counting proxy on a client without duplicate() (Sentinel)', () => {
  test('fallbackDuplicate builds a counted clone and reports it to onDuplicate', async () => {
    const sentinelLike = {
      isOpen: true,
      isReady: true,
      get: async () => 'v',
      use: async (fn: (c: unknown) => unknown) => fn({ watch: async () => 'OK' }),
    };
    const made: object[] = [];
    const seen: object[] = [];
    const c = counters();
    const redis = countRedis(sentinelLike, c, {
      fallbackDuplicate: () => {
        const clone = {
          get: async () => 'clone',
          connect: async () => undefined,
          close: async () => undefined,
        };
        made.push(clone);
        return clone;
      },
      onDuplicate: (clone) => seen.push(clone),
    }) as unknown as {
      duplicate(): { get(): Promise<string>; connect(): Promise<unknown> };
      get(): Promise<string>;
      use(fn: (c: unknown) => unknown): Promise<unknown>;
    };
    await redis.get();
    const dup = redis.duplicate();
    expect(made).toHaveLength(1);
    expect(seen).toHaveLength(1);
    await dup.connect(); // a duplicate's own lifecycle: not swallowed, not counted
    await dup.get(); // counted like the original
    await redis.use(async () => undefined); // leasing a connection counts as one command
    expect(c.redisCommands).toBe(3);
  });

  test('without fallbackDuplicate the property stays undefined', () => {
    const redis = countRedis({ get: async () => 'v' }, counters()) as { duplicate?: unknown };
    expect(redis.duplicate).toBeUndefined();
  });
});

describe('failFast', () => {
  test('use(fn) is not timed out: the callback holds a leased connection on purpose', async () => {
    const client = {
      use: async (fn: () => Promise<string>) => fn(),
    };
    const wrapped = failFast(client, 50);
    const out = await wrapped.use(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return 'done';
    });
    expect(out).toBe('done');
  });

  test('a client without withAbortSignal (cluster, Sentinel) still gets the timeout', async () => {
    const client = { hGetAll: () => new Promise<never>(() => undefined) };
    await expect(failFast(client, 60).hGetAll()).rejects.toThrow(
      /hGetAll got no reply within 60 ms/,
    );
  });
});

describe('clientIsReady', () => {
  test('uses isReady when the client has one (single node, Sentinel)', () => {
    expect(clientIsReady({ isReady: true, isOpen: true })).toBe(true);
    expect(clientIsReady({ isReady: false, isOpen: true })).toBe(false);
  });
  test('a cluster client has no isReady: open and every node client created so far ready', () => {
    expect(clientIsReady({ isOpen: false, masters: [] })).toBe(false);
    expect(clientIsReady({ isOpen: true, masters: [] })).toBe(false);
    expect(
      clientIsReady({
        isOpen: true,
        masters: [{ client: undefined }, { client: { isReady: true } }],
      }),
    ).toBe(true);
    expect(clientIsReady({ isOpen: true, masters: [{ client: { isReady: false } }] })).toBe(false);
  });
});

describe('createLearnerDeps with a target string', () => {
  test('a bad scheme is rejected with the parser error before anything connects', async () => {
    await expect(createLearnerDeps({ redisUrl: 'http://nope:1' })).rejects.toBeInstanceOf(
      TargetError,
    );
    await expect(createLearnerDeps({ redisUrl: 'sentinel://nohost' })).rejects.toBeInstanceOf(
      TargetError,
    );
  });
});

describe('createCachedRedis', () => {
  test('is lazy: nothing is built until a property is read, and close() before use is harmless', async () => {
    const lines: string[] = [];
    const h = createCachedRedis({ redisUrl: 'redis://127.0.0.1:1', log: (l) => lines.push(l) });
    expect(lines).toEqual([]);
    expect(h.clientSideCache).toBe(false);
    await h.close();
    expect(() => h.client.get).toThrow(/closed/);
  });

  test('building it logs one line that names the kind and the cache settings', () => {
    const lines: string[] = [];
    const h = createCachedRedis({
      redisUrl: 'cluster://redis-c1:6379,redis-c2:6379',
      log: (l) => lines.push(l),
    });
    void h.client.isOpen; // first property read creates the (unconnected) client
    void h.client.isOpen;
    expect(h.clientSideCache).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/cluster, 2 root nodes; RESP 3, client-side cache on \(LRU, max 5000/);
    return h.close();
  });

  test('lifecycle calls from learner code are swallowed and duplicate() explains itself', async () => {
    const h = createCachedRedis({ redisUrl: 'redis://127.0.0.1:1', log: () => undefined });
    const c = h.client as unknown as {
      close(): Promise<void>;
      duplicate(): never;
      connect(): Promise<unknown>;
    };
    await c.close();
    await c.connect();
    expect(() => c.duplicate()).toThrow(/cannot be duplicated/);
    await h.close();
  });
});
