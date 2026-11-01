// E-05: follow-up questions on a `rebuild_of` interview level. The level payload lists them after the level's own
// verifiers, verify grades them after the level's checks (answer indices continue), and `questionsFrom` says where
// they start. A rebuild_of level without questions, and every other level, is untouched.
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Config } from '../src/config.js';
import { EventBus } from '../src/events.js';
import { MetricsStore } from '../src/metrics.js';
import { newProgress, ProgressStore, reconcileLevels } from '../src/progress.js';
import { buildServer } from '../src/server.js';
import { LevelService, renderLevel } from '../src/levels.js';
import { effectiveLevel, ownQuestions } from '../src/pool.js';
import { Verifier } from '../src/verify/index.js';
import { loadCaps } from '../src/verify/config.js';
import { formatCommand } from '../src/verify/reply.js';
import type { RunFn } from '../src/verify/behavior.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(HERE, '../../levels/_examples');
const SCRATCH = join(HERE, 'fixtures/scratch-e05');
const WITH = 'scratch-e05-01-cache-aside-questions';
const PLAIN = 'example-interview-01-cache-aside-rebuild';

let root: string;
let svc: LevelService;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'quest-e05-'));
  const dir = join(root, 'levels');
  await cp(join(EXAMPLES, 'example-code'), join(dir, 'example-code'), { recursive: true });
  await cp(join(EXAMPLES, 'example-interview'), join(dir, 'example-interview'), {
    recursive: true,
  });
  await cp(SCRATCH, join(dir, 'scratch-e05'), { recursive: true });
  svc = new LevelService(dir);
  await svc.load();
});
afterAll(() => rm(root, { recursive: true, force: true }));

const ctx = (id: string) => ({
  player: { id: 'p-1', name: 'Asha' },
  level: { id },
  chapter: { id: 'scratch-e05' },
  env: {},
});

describe('own questions', () => {
  test('the scratch tree loads clean', () => {
    expect(svc.errors).toEqual([]);
  });

  test('ownQuestions: the rebuild_of level has two, the plain interview and an ordinary level none', () => {
    expect(ownQuestions(svc.get(WITH)!.level)).toHaveLength(2);
    expect(ownQuestions(svc.get(PLAIN)!.level)).toEqual([]);
    expect(ownQuestions(svc.get('example-code-01-cache-aside')!.level)).toEqual([]);
  });

  test('effectiveLevel appends them after the level own checks; the level itself is not mutated', () => {
    const entry = svc.get(WITH)!;
    const eff = effectiveLevel(entry, undefined, (id) => svc.get(id));
    expect(eff.pool).toBe(false);
    expect(eff.questions).toHaveLength(2);
    expect(eff.verifyLevel.level.verify.map((v) => v.type)).toEqual(['behavior', 'quiz', 'quiz']);
    expect(eff.verifyLevel.level.id).toBe(WITH);
    expect(eff.verifyLevel.dir).toBe(entry.level.dir);
    expect(entry.level.level.verify.map((v) => v.type)).toEqual(['behavior']);
    const plain = svc.get(PLAIN)!;
    expect(effectiveLevel(plain, undefined, (id) => svc.get(id))).toMatchObject({
      pool: false,
      questions: [],
      verifyLevel: plain.level,
    });
  });

  test('renderLevel lists them after the level own verifiers, without the answers', () => {
    const entry = svc.get(WITH)!;
    const out = renderLevel(entry, ctx(WITH), {});
    expect(out.verifiers.map((v) => [v.index, v.type])).toEqual([
      [0, 'behavior'],
      [1, 'quiz'],
      [2, 'quiz'],
    ]);
    const q = out.verifiers[1] as {
      question: string;
      options: { id: string }[];
      multiple: boolean;
    };
    expect(q.question).toBe('Why does the cached stats hash get a TTL (one)?');
    expect(q.options.map((o) => o.id)).toEqual(['stale-heals', 'ram-only', 'free-speed']);
    expect(q.multiple).toBe(false);
    expect(JSON.stringify(out.verifiers)).not.toMatch(/correct|explanation/);
    const plain = renderLevel(svc.get(PLAIN)!, ctx(PLAIN), {});
    expect(plain.verifiers.map((v) => v.type)).toEqual(['behavior']);
  });
});

describe('grading a rebuild_of level with questions', () => {
  // Redis answers what the behavior check reads after the call; the call itself runs through the stubbed runner.
  const run: RunFn = async (req) => ({
    results: req.calls.map(() => ({ ok: true, value: {}, ms: 1 })),
  });

  async function grade(answers: Record<string, string>) {
    const verifier = new Verifier({
      cfg: {
        runnerUrl: '',
        appUrl: 'http://proxy:3000/app',
        scenariosDir: '',
        baselinesDir: '/nonexistent',
        engineApi: 'http://127.0.0.1:1/api',
        caps: loadCaps({}),
        maxEventWaitMs: 50,
      },
      log: pino({ level: 'silent' }),
      bus: new EventBus(),
      redis: {
        url: 'redis://fake:6379',
        isUp: true,
        send: async (argv: string[]) => {
          const k = formatCommand(argv);
          if (k === 'TYPE cache:player:p-028') return 'hash';
          if (k === 'TTL cache:player:p-028') return 20;
          if (argv[0] === 'DEL') return 1;
          throw new Error(`fake redis has no reply for ${k}`);
        },
        openSubscriber: async () => {
          throw new Error('no subscriber');
        },
        onUp: () => undefined,
      } as never,
      run,
    });
    const eff = effectiveLevel(svc.get(WITH)!, undefined, (id) => svc.get(id));
    return verifier.verify(eff.verifyLevel, { templateCtx: ctx(WITH), attempt: 1, answers });
  }

  test('the level checks run first, then the questions at the next indices', async () => {
    const o = await grade({ '1': 'stale-heals', '2': 'hset-and-expire' });
    expect(o.checks.map((c) => [c.index, c.type, c.ok])).toEqual([
      [0, 'behavior', true],
      [1, 'quiz', true],
      [2, 'quiz', true],
    ]);
    expect(o.verdict).toBe('right');
  });

  test('one wrong follow-up answer makes the verdict wrong, and names that question', async () => {
    const o = await grade({ '1': 'ram-only', '2': 'hset-and-expire' });
    expect(o.checks[1]).toMatchObject({ index: 1, type: 'quiz', ok: false });
    expect(o.checks[2]).toMatchObject({ index: 2, ok: true });
    expect(o.verdict).toBe('wrong');
  });

  test('a missing answer is wrong too', async () => {
    expect((await grade({ '1': 'stale-heals' })).verdict).toBe('wrong');
  });
});

describe('GET /api/levels/:id', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let routesRoot: string;
  beforeAll(async () => {
    routesRoot = await mkdtemp(join(tmpdir(), 'quest-e05-routes-'));
    const dir = join(routesRoot, 'levels');
    await cp(join(EXAMPLES, 'example-code'), join(dir, 'example-code'), { recursive: true });
    await cp(join(EXAMPLES, 'example-interview'), join(dir, 'example-interview'), {
      recursive: true,
    });
    await cp(SCRATCH, join(dir, 'scratch-e05'), { recursive: true });
    const cfg: Config = {
      port: 0,
      redisUrl: 'redis://fake',
      databaseUrl: 'postgres://nobody@127.0.0.1:1/x',
      logDir: join(routesRoot, 'logs'),
      progressDir: join(routesRoot, 'progress'),
      workspaceDir: join(routesRoot, 'workspace'),
      levelsDir: dir,
      uiDistDir: join(routesRoot, 'ui'),
      dev: true,
      templateEnv: {},
    };
    const levels = new LevelService(dir);
    await levels.load();
    const store = new ProgressStore(cfg.progressDir);
    const p = newProgress({
      id: 'p-e05',
      name: 'Asha',
      redisUrl: 'redis://fake',
      activeSlots: [],
      now: new Date(),
    });
    reconcileLevels(p, levels.orderedIds);
    await store.create(p);
    app = await buildServer({
      cfg,
      log: pino({ level: 'silent' }),
      bus: new EventBus(),
      store,
      redis: {
        url: 'redis://fake',
        isUp: true,
        send: async () => 'OK',
        onUp: () => undefined,
      } as never,
      mirror: { write: async () => undefined, setGift: async () => undefined } as never,
      levels,
      logtail: { attach: () => undefined, tail: async () => [] } as never,
      metrics: new MetricsStore(),
      runtime: { redisUrl: 'redis://fake', activeSlots: [], dbExtraLatencyMs: 0, boots: 1 },
    });
    for (const id of levels.orderedIds.slice(0, levels.orderedIds.indexOf(PLAIN) + 1)) {
      await app.inject({ method: 'POST', url: `/api/levels/${id}/complete` });
    }
    await app.inject({ method: 'POST', url: `/api/levels/${WITH}/start` });
  });
  afterAll(async () => {
    await app.close();
    await rm(routesRoot, { recursive: true, force: true });
  });
  const get = (id: string) => app.inject({ method: 'GET', url: `/api/levels/${id}` });

  test('the level lists its own verifier, then the two questions, and says where they start', async () => {
    const lv = (await get(WITH)).json();
    expect(lv.verifiers.map((v: { index: number; type: string }) => [v.index, v.type])).toEqual([
      [0, 'behavior'],
      [1, 'quiz'],
      [2, 'quiz'],
    ]);
    expect(lv.interview).toMatchObject({
      pool: false,
      drawn: null,
      questionsFrom: 1,
      rebuildOf: { id: 'example-code-01-cache-aside' },
    });
    expect(lv.teach).toBe('');
  });

  test('an interview level without questions has no questionsFrom and no extra verifier', async () => {
    const lv = (await get(PLAIN)).json();
    expect(lv.verifiers.map((v: { type: string }) => v.type)).toEqual(['behavior']);
    expect(lv.interview.questionsFrom).toBeNull();
  });
});
