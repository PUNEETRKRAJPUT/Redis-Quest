// E-03: cluster routing of raw commands, the key table, and PUT/GET /api/target against a fake manager.
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErrorReply } from 'redis';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { parseTarget } from '@quest/shared';
import type { Config } from '../src/config.js';
import { EventBus, type EngineEvent } from '../src/events.js';
import { KeyTable } from '../src/keytable.js';
import { LevelService } from '../src/levels.js';
import { MetricsStore } from '../src/metrics.js';
import { newProgress, ProgressStore, reconcileLevels } from '../src/progress.js';
import { Link, whereIs } from '../src/redis.js';
import { buildServer } from '../src/server.js';
import { eventMatches } from '../src/verify/events.js';
import { runCli } from '../src/cli.js';
import type { RedisManager } from '../src/redis.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');

// The shape of a COMMAND reply: [name, arity, flags, first, last, step, acl, tips, keyspecs, subcommands]
const entry = (name: string, first: number, flags: string[] = [], subs: unknown[] = []) => [
  name,
  -1,
  flags,
  first,
  first,
  1,
  [],
  [],
  [],
  subs,
];
const COMMAND_REPLY = [
  entry('get', 1, ['readonly']),
  entry('set', 1, ['write']),
  entry('mset', 1, ['write']),
  entry('ping', 0, ['fast']),
  entry('eval', 0, ['write', 'movablekeys']),
  entry('object', 0, [], [entry('object|encoding', 2, ['readonly'])]),
  entry('cluster', 0, [], [entry('cluster|keyslot', 0), entry('cluster|info', 0)]),
];

describe('KeyTable', () => {
  const t = new KeyTable();
  t.load(COMMAND_REPLY);
  test('reads fixed key positions, subcommands included', () => {
    expect(t.size).toBe(10);
    expect(t.firstKey(['GET', 'a'])).toBe('a');
    expect(t.firstKey(['mset', '{u:1}:a', '1', '{u:1}:b', '2'])).toBe('{u:1}:a');
    expect(t.firstKey(['OBJECT', 'ENCODING', 'k'])).toBe('k');
  });
  test('keyless commands, movable keys and unknown commands', () => {
    expect(t.firstKey(['PING'])).toBeNull();
    expect(t.firstKey(['CLUSTER', 'KEYSLOT', 'x'])).toBeNull();
    expect(t.firstKey(['CLUSTER', 'INFO'])).toBeNull();
    expect(t.firstKey(['EVAL', 'return 1', '1', 'k'])).toBe('movable');
    expect(t.firstKey(['NOSUCH', 'a'])).toBeNull();
    expect(t.firstKey(['GET'])).toBeNull();
  });
  test('a bad reply leaves an empty table', () => {
    const e = new KeyTable();
    e.load('nope');
    expect(e.size).toBe(0);
  });
});

describe('cluster routing in Link.sendRaw', () => {
  const noHooks = { onError: () => undefined, onUp: () => undefined, onDown: () => undefined };
  function clusterLink() {
    const calls: Array<{ via: string; key?: string | undefined; argv: string[] }> = [];
    const node = {
      sendCommand: async (argv: string[]) => {
        calls.push({ via: 'anchor', argv });
        if (argv[0] === 'COMMAND' && argv[1] === 'GETKEYS') return ['{t}:k'];
        return 'anchor-reply';
      },
    };
    const fake = {
      isOpen: true,
      slots: [{ master: 'm0' }],
      nodeClient: async () => node,
      sendCommand: async (key: string | undefined, _ro: boolean, argv: string[]) => {
        calls.push({ via: 'cluster', key, argv });
        if (argv[0] === 'MSET' && argv[1] === 'a') {
          throw new ErrorReply("CROSSSLOT Keys in request don't hash to the same slot");
        }
        return 'routed-reply';
      },
    };
    const link = new Link(parseTarget('cluster://a:1,b:1,c:1'), noHooks, false);
    link.client = fake as never;
    link.keys.load(COMMAND_REPLY);
    return { link, calls };
  }
  test('a command with a key goes through the client with that key (its slot)', async () => {
    const { link, calls } = clusterLink();
    expect(await link.sendRaw(['GET', '{u:1}:a'])).toBe('routed-reply');
    expect(calls).toEqual([{ via: 'cluster', key: '{u:1}:a', argv: ['GET', '{u:1}:a'] }]);
  });
  test('a command without a key goes to the node that owns slot 0', async () => {
    const { link, calls } = clusterLink();
    expect(await link.sendRaw(['CLUSTER', 'INFO'])).toBe('anchor-reply');
    expect(await link.sendRaw(['PING'])).toBe('anchor-reply');
    expect(calls.map((c) => c.via)).toEqual(['anchor', 'anchor']);
  });
  test('movable keys ask COMMAND GETKEYS first, then route on the first key', async () => {
    const { link, calls } = clusterLink();
    await link.sendRaw(['EVAL', 'return 1', '1', '{t}:k']);
    expect(calls[0]?.argv.slice(0, 2)).toEqual(['COMMAND', 'GETKEYS']);
    expect(calls[1]).toMatchObject({ via: 'cluster', key: '{t}:k' });
  });
  test('CROSSSLOT surfaces as an error reply and the CLI prints it as the error line', async () => {
    const { link } = clusterLink();
    await expect(link.sendRaw(['MSET', 'a', '1', 'b', '2'])).rejects.toBeInstanceOf(ErrorReply);
    const redis = {
      url: 'cluster://a:1',
      cliSend: (argv: string[]) => link.sendRaw(argv),
      resetCli: () => undefined,
    } as unknown as RedisManager;
    const r = await runCli(redis, 'MSET a 1 b 2');
    expect(r.type).toBe('error');
    expect(r.reply).toBe("(error) CROSSSLOT Keys in request don't hash to the same slot");
  });
  test('a cluster with no slots says so instead of guessing a node', async () => {
    const { link } = clusterLink();
    (link.client as unknown as { slots: unknown[] }).slots = [];
    await expect(link.sendRaw(['PING'])).rejects.toThrow(/no slots/);
  });
});

describe('eventMatches on a payload field named kind', () => {
  const ev = {
    kind: 'custom' as const,
    name: 'redis_target_changed',
    data: { from: 'redis://redis:6379', to: 'cluster://a:1', kind: 'cluster' },
  };
  test('match.kind reads the payload, match.name the event', () => {
    expect(
      eventMatches(
        { kind: 'custom', match: { name: 'redis_target_changed', kind: 'cluster' } },
        ev,
      ),
    ).toBe(true);
    expect(
      eventMatches(
        { kind: 'custom', match: { name: 'redis_target_changed', kind: 'sentinel' } },
        ev,
      ),
    ).toBe(false);
    expect(eventMatches({ kind: 'custom', match: { name: 'redis_target_changed' } }, ev)).toBe(
      true,
    );
  });
});

describe('whereIs', () => {
  test('host:port for one node, the description for the rest', () => {
    expect(whereIs('redis://redis:6379')).toBe('redis:6379');
    expect(whereIs('sentinel://mymaster@a:26379,b:26379')).toBe(
      'sentinel mymaster via 2 sentinels',
    );
    expect(whereIs('cluster://a:6379')).toBe('cluster, 1 root node');
    expect(whereIs('garbage')).toBe('garbage');
  });
});

describe('routes: GET and PUT /api/target', () => {
  let root: string;
  let app: Awaited<ReturnType<typeof buildServer>>;
  const bus = new EventBus();
  const events: EngineEvent[] = [];
  const fake = {
    url: 'redis://redis:6379',
    isUp: true,
    reachable: true,
    connects: [] as string[],
    send: async () => 'OK',
    onUp: () => undefined,
    cliSend: async () => 'OK',
    resetCli: () => undefined,
    targetInfo() {
      const t = parseTarget(this.url);
      return {
        kind: t.kind,
        description: t.kind === 'single' ? `single node ${t.nodes[0]?.host}:6379` : t.kind,
        state: 'up',
        ...(t.kind === 'sentinel' ? { master: 'redis:6379', nodes: t.nodes.length } : {}),
      };
    },
    async connect(url: string) {
      this.connects.push(url);
      this.url = url;
    },
    async switchTo(url: string) {
      if (!this.reachable) return { ok: false, message: `Could not connect to ${url}: refused` };
      await this.connect(url);
      return { ok: true };
    },
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'quest-e03-'));
    await cp(join(REPO, 'levels/_examples/example-code'), join(root, 'levels', 'example-code'), {
      recursive: true,
    });
    const cfg: Config = {
      port: 0,
      redisUrl: 'redis://redis:6379',
      databaseUrl: 'postgres://nobody@127.0.0.1:1/x',
      logDir: join(root, 'logs'),
      progressDir: join(root, 'progress'),
      workspaceDir: join(root, 'workspace'),
      levelsDir: join(root, 'levels'),
      uiDistDir: join(root, 'ui'),
      dev: true,
      templateEnv: {},
    };
    const levels = new LevelService(cfg.levelsDir);
    await levels.load();
    const store = new ProgressStore(cfg.progressDir);
    const p = newProgress({
      id: 'p-1',
      name: 'Asha',
      redisUrl: 'redis://redis:6379',
      activeSlots: [],
      now: new Date(),
    });
    reconcileLevels(p, levels.orderedIds);
    await store.create(p);
    bus.subscribe((e) => events.push(e));
    app = await buildServer({
      cfg,
      log: pino({ level: 'silent' }),
      bus,
      store,
      redis: fake as never,
      mirror: { write: async () => undefined, setGift: async () => undefined } as never,
      levels,
      logtail: { attach: () => undefined, tail: async () => [] } as never,
      metrics: new MetricsStore(),
      runtime: { redisUrl: 'redis://redis:6379', activeSlots: [], dbExtraLatencyMs: 0, boots: 1 },
    });
  });
  afterAll(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const put = (payload: unknown) =>
    app.inject({ method: 'PUT', url: '/api/target', payload: payload as object });
  const targetEvents = () =>
    events
      .filter((e) => e.type === 'level.event')
      .map((e) => e.data as { kind: string; name?: string; data?: Record<string, unknown> })
      .filter((d) => d.name === 'redis_target_changed');

  test('GET answers url, kind, description, state', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/target' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      redisUrl: 'redis://redis:6379',
      kind: 'single',
      description: 'single node redis:6379',
      state: 'up',
    });
  });

  test('PUT accepts the three schemes and emits redis_target_changed { from, to, kind }', async () => {
    const sentinel = 'sentinel://mymaster@s1:26379,s2:26379,s3:26379';
    const r = await put({ redisUrl: sentinel });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      redisUrl: sentinel,
      kind: 'sentinel',
      master: 'redis:6379',
      nodes: 3,
    });
    expect((await put({ redisUrl: 'cluster://a:6379,b:6379,c:6379' })).statusCode).toBe(200);
    expect((await put({ redisUrl: 'redis://redis:6379' })).statusCode).toBe(200);
    expect(targetEvents().map((d) => d.data)).toEqual([
      { from: 'redis://redis:6379', to: sentinel, kind: 'sentinel' },
      { from: sentinel, to: 'cluster://a:6379,b:6379,c:6379', kind: 'cluster' },
      { from: 'cluster://a:6379,b:6379,c:6379', to: 'redis://redis:6379', kind: 'single' },
    ]);
    // The new target is persisted into progress.json.
    const prog = await app.inject({ method: 'GET', url: '/api/progress' });
    expect(prog.json().target.redisUrl).toBe('redis://redis:6379');
  });

  test('a bad string is 400 invalid_url and nothing is connected or emitted', async () => {
    const before = fake.connects.length;
    const n = targetEvents().length;
    for (const bad of ['http://x', 'sentinel://nohost', 'cluster://', 5, undefined]) {
      const r = await put({ redisUrl: bad });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe('invalid_url');
    }
    expect(fake.connects.length).toBe(before);
    expect(targetEvents().length).toBe(n);
  });

  test('strict: an unreachable target is 502 target_unreachable with the engine message and no event', async () => {
    const n = targetEvents().length;
    fake.reachable = false;
    const r = await put({ redisUrl: 'cluster://nowhere:6379', strict: true });
    fake.reachable = true;
    expect(r.statusCode).toBe(502);
    expect(r.json()).toMatchObject({ error: 'target_unreachable' });
    expect(r.json().message).toContain('Could not connect to');
    expect(targetEvents().length).toBe(n);
    expect(fake.url).toBe('redis://redis:6379');
  });
});
