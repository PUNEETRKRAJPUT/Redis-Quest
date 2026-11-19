// E-06: the command-docs snapshot (unit) and its two routes (against a fake manager that counts every command).
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  buildSnapshot,
  CommandDocs,
  CommandDocsInputError,
  parseNames,
  pickDocs,
} from '../src/command-docs.js';
import type { Config } from '../src/config.js';
import { EventBus } from '../src/events.js';
import { LevelService } from '../src/levels.js';
import { MetricsStore } from '../src/metrics.js';
import { newProgress, ProgressStore, reconcileLevels } from '../src/progress.js';
import { buildServer } from '../src/server.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const silent = pino({ level: 'silent' });

// The shape COMMAND LIST and COMMAND DOCS (no arguments) return: names, and a flat [name, doc, ...] map.
const LIST = ['get', 'zadd', 'client', 'client|list'];
const GET_DOC = [
  'summary',
  'Returns the string value of a key.',
  'since',
  '1.0.0',
  'group',
  'string',
];
const ZADD_DOC = [
  'summary',
  'Adds one or more members to a sorted set.',
  'complexity',
  'O(log(N))',
];
const CLIENT_DOC = [
  'summary',
  'A container for client connection commands.',
  'subcommands',
  ['client|list', ['summary', 'Lists open connections.']],
];
const DOCS = ['get', GET_DOC, 'zadd', ZADD_DOC, 'client', CLIENT_DOC];

function fakeRedis(url = 'redis://a:6379') {
  const f = {
    url,
    isUp: true,
    sent: [] as string[][],
    fail: false,
    onUp: () => undefined,
    send: async (argv: string[]) => {
      f.sent.push(argv);
      if (f.fail) throw new Error('BUSY Redis is busy running a script');
      return argv[1] === 'LIST' ? LIST : DOCS;
    },
  };
  return f;
}

describe('buildSnapshot, parseNames, pickDocs', () => {
  const snap = buildSnapshot(LIST, DOCS);

  test('names are verbatim; docs are keyed by lowercase name', () => {
    expect(snap.names).toEqual(LIST);
    expect([...snap.docs.keys()]).toEqual(['get', 'zadd', 'client']);
  });
  test('Buffers and RESP3 maps are folded the way the verifier folds them', () => {
    const s = buildSnapshot(
      [Buffer.from('get')],
      new Map([[Buffer.from('get'), new Map([['summary', Buffer.from('x')]])]]),
    );
    expect(pickDocs(s, ['get'])).toEqual(['get', ['summary', 'x']]);
  });
  test('a reply that is not a list or not a map is refused', () => {
    expect(() => buildSnapshot('nope', DOCS)).toThrow(/COMMAND LIST/);
    expect(() => buildSnapshot(LIST, ['get'])).toThrow(/COMMAND DOCS/);
    expect(() => buildSnapshot(LIST, 'ERR')).toThrow(/COMMAND DOCS/);
  });
  test('pickDocs: asked order, case-insensitive, unknown and subcommand names absent, no repeats', () => {
    expect(pickDocs(snap, ['zadd', 'nosuchcommand', 'GET', 'get', 'client|list'])).toEqual([
      'zadd',
      ZADD_DOC,
      'get',
      GET_DOC,
    ]);
    expect(pickDocs(snap, ['nosuchcommand'])).toEqual([]);
  });
  test('parseNames accepts plain names and refuses everything else', () => {
    expect(parseNames('get,client|list,ts.info,x-y_z')).toEqual([
      'get',
      'client|list',
      'ts.info',
      'x-y_z',
    ]);
    const twenty = Array.from({ length: 20 }, (_, i) => `c${i}`).join(',');
    expect(parseNames(twenty)).toHaveLength(20);
    for (const bad of [
      undefined,
      '',
      'a,,b',
      `${twenty},c20`,
      'a b',
      'get;x',
      'a\nb',
      ['a', 'b'],
      'x'.repeat(65),
    ])
      expect(() => parseNames(bad)).toThrow(CommandDocsInputError);
  });
});

describe('CommandDocs lifecycle', () => {
  test('takes exactly one COMMAND LIST and one COMMAND DOCS, then serves from memory', async () => {
    const r = fakeRedis();
    const cd = new CommandDocs(r as never, silent);
    expect(cd.snapshot()).toBeNull();
    await cd.ensure();
    expect(r.sent).toEqual([
      ['COMMAND', 'LIST'],
      ['COMMAND', 'DOCS'],
    ]);
    for (let i = 0; i < 50; i++) pickDocs(cd.snapshot()!, ['get', 'zadd']);
    await cd.ensure(); // a reconnect to the same server keeps the snapshot
    expect(r.sent).toHaveLength(2);
  });
  test('a failed attempt leaves it unavailable and the next "up" retries; ensure never throws', async () => {
    const r = fakeRedis();
    r.fail = true;
    const cd = new CommandDocs(r as never, silent);
    await cd.ensure();
    expect(cd.snapshot()).toBeNull();
    r.fail = false;
    await cd.ensure();
    expect(cd.snapshot()?.names).toEqual(LIST);
  });
  test('nothing is sent while Redis is down', async () => {
    const r = fakeRedis();
    r.isUp = false;
    const cd = new CommandDocs(r as never, silent);
    await cd.ensure();
    expect(r.sent).toEqual([]);
  });
  test('a different target hides the old snapshot and takes its own; switching back keeps the first', async () => {
    const r = fakeRedis('redis://a:6379');
    const cd = new CommandDocs(r as never, silent);
    await cd.ensure();
    r.url = 'redis://b:6379';
    expect(cd.snapshot()).toBeNull();
    await cd.ensure();
    expect(cd.snapshot()).not.toBeNull();
    expect(r.sent).toHaveLength(4);
  });
  test('a snapshot that finishes after the target changed is dropped, and the new target is taken', async () => {
    const r = fakeRedis('redis://a:6379');
    const first = r.send;
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    let slow = true;
    r.send = async (argv: string[]) => {
      if (slow) {
        slow = false;
        await gate;
      }
      return first(argv);
    };
    const cd = new CommandDocs(r as never, silent);
    const pending = cd.ensure();
    r.url = 'redis://b:6379';
    void cd.ensure(); // the new target's "up" arrives while the old attempt is busy: skipped, not lost
    release();
    await pending;
    expect(cd.snapshot()).not.toBeNull();
    expect(r.sent.filter((a) => a[1] === 'DOCS')).toHaveLength(2);
  });
});

describe('routes', () => {
  let root: string;
  let app: Awaited<ReturnType<typeof buildServer>>;
  const redis = fakeRedis();
  const cd = new CommandDocs(redis as never, silent);

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'quest-e06-'));
    await cp(join(REPO, 'levels/_examples/example-code'), join(root, 'levels', 'example-code'), {
      recursive: true,
    });
    const cfg: Config = {
      port: 0,
      redisUrl: 'redis://a:6379',
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
      redisUrl: 'redis://a:6379',
      activeSlots: [],
      now: new Date(),
    });
    reconcileLevels(p, levels.orderedIds);
    await store.create(p);
    app = await buildServer({
      cfg,
      log: silent,
      bus: new EventBus(),
      store,
      redis: redis as never,
      mirror: { write: async () => undefined, setGift: async () => undefined } as never,
      levels,
      logtail: { attach: () => undefined, tail: async () => [] } as never,
      metrics: new MetricsStore(),
      runtime: { redisUrl: 'redis://a:6379', activeSlots: [], dbExtraLatencyMs: 0, boots: 1 },
      commandDocs: cd,
    });
  });
  afterAll(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const get = (url: string) => app.inject({ method: 'GET', url });

  test('before a snapshot exists: 200 { available: false } on both, health still says commandDocs', async () => {
    expect((await get('/api/command-docs/names')).json()).toEqual({ available: false });
    const r = await get('/api/command-docs?names=get');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ available: false });
    expect((await get('/health')).json().commandDocs).toBe(true);
  });
  test('bad input is a 400 in the engine error shape, even before a snapshot', async () => {
    for (const q of ['', '?names=', '?names=a,,b', '?names=a%20b', `?names=${'c,'.repeat(20)}c`]) {
      const r = await get(`/api/command-docs${q}`);
      expect(r.statusCode).toBe(400);
      expect(r.json()).toMatchObject({ error: 'invalid_names' });
    }
  });
  test('with a snapshot: names verbatim, docs for known names only, zero commands sent', async () => {
    await cd.ensure();
    const sentBefore = redis.sent.length;
    expect((await get('/api/command-docs/names')).json()).toEqual({ names: LIST });
    const r = await get('/api/command-docs?names=get,zadd,nosuchcommand');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ reply: ['get', GET_DOC, 'zadd', ZADD_DOC] });
    expect(redis.sent).toHaveLength(sentBefore);
  });
  test('after the target changes to a different server, both answer unavailable until its snapshot', async () => {
    redis.url = 'redis://b:6379';
    expect((await get('/api/command-docs/names')).json()).toEqual({ available: false });
    await cd.ensure();
    expect((await get('/api/command-docs/names')).json()).toEqual({ names: LIST });
  });
});
