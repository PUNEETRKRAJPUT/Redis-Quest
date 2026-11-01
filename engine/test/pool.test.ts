// E-04: interview pools. The draw (seeded, stable, no repeats across pool levels), blank start, the level payload
// of a pool level, grading as the drawn level with the follow-up questions after its checks, the verdict metrics,
// and the portfolio. Pure functions are tested directly; the routes through Fastify's inject with a stubbed Redis.
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadChapter, type LoadedChapter } from '@quest/shared';
import type { Config } from '../src/config.js';
import { EventBus } from '../src/events.js';
import { LevelService } from '../src/levels.js';
import { MetricsStore } from '../src/metrics.js';
import {
  blankStartOf,
  chooseDraw,
  drawnByOthers,
  drawSeed,
  effectiveLevel,
  poolEntries,
} from '../src/pool.js';
import { buildPortfolio, escapeMd, metricPhrases } from '../src/portfolio.js';
import { newProgress, ProgressStore, reconcileLevels, type ProgressFile } from '../src/progress.js';
import { buildServer } from '../src/server.js';
import { verdictMetrics } from '../src/verdict-metrics.js';
import type { RunFn } from '../src/verify/behavior.js';
import { loadCaps } from '../src/verify/config.js';
import { Verifier } from '../src/verify/index.js';
import { formatCommand } from '../src/verify/reply.js';
import { listTree, moveAside, writeWorkspaceFile } from '../src/workspace.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(HERE, '../../levels/_examples');
const SCRATCH = join(HERE, 'fixtures/scratch-e04');
const CACHE = 'example-code-01-cache-aside';
const BUCKET = 'example-code-02-token-bucket';
const ONE = 'scratch-e04-01-mock-one';
const TWO = 'scratch-e04-02-mock-two';
const THREE = 'scratch-e04-03-write-story';

async function levelsDir(root: string): Promise<string> {
  const dir = join(root, 'levels');
  await cp(join(EXAMPLES, 'example-code'), join(dir, 'example-code'), { recursive: true });
  await cp(SCRATCH, join(dir, 'scratch-e04'), { recursive: true });
  return dir;
}

describe('the draw', () => {
  let chapters: LoadedChapter[];
  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), 'quest-e04-draw-'));
    const dir = await levelsDir(root);
    chapters = [
      (await loadChapter(join(dir, 'example-code'))).chapter!,
      (await loadChapter(join(dir, 'scratch-e04'))).chapter!,
    ];
    await rm(root, { recursive: true, force: true });
  });
  const level = (id: string) => chapters.flatMap((c) => c.levels).find((l) => l.level.id === id)!;

  test('a pool level is found; other levels are not pools', () => {
    expect(poolEntries(level(ONE))!.map((e) => e.rebuild_of)).toEqual([CACHE, BUCKET]);
    expect(poolEntries(level(CACHE))).toBeNull();
    expect(poolEntries(level(THREE))).toBeNull();
    expect(blankStartOf(level(ONE))).toBe(true);
    expect(blankStartOf(level(CACHE))).toBe(false);
  });

  test('the seed is a function of the player and the level only', () => {
    expect(drawSeed('p-1', ONE)).toBe(drawSeed('p-1', ONE));
    expect(drawSeed('p-1', ONE)).not.toBe(drawSeed('p-2', ONE));
    expect(drawSeed('p-1', ONE)).not.toBe(drawSeed('p-1', TWO));
    expect(Number.isInteger(drawSeed('p-1', ONE))).toBe(true);
  });

  test('the same player and level always draw the same entry, and players spread over the pool', () => {
    const pool = poolEntries(level(ONE))!;
    const none = new Set<string>();
    expect(chooseDraw(pool, 'p-same', ONE, none)).toBe(chooseDraw(pool, 'p-same', ONE, none));
    const seen = new Set(
      Array.from({ length: 40 }, (_, i) => chooseDraw(pool, `p-${i}`, ONE, none).rebuild_of),
    );
    expect(seen).toEqual(new Set([CACHE, BUCKET]));
  });

  test('entries drawn by other pool levels are excluded; when all are taken repeats are allowed', () => {
    const pool = poolEntries(level(ONE))!;
    for (let i = 0; i < 20; i++) {
      expect(chooseDraw(pool, `p-${i}`, TWO, new Set([CACHE])).rebuild_of).toBe(BUCKET);
      expect(chooseDraw(pool, `p-${i}`, TWO, new Set([BUCKET])).rebuild_of).toBe(CACHE);
    }
    const all = new Set([CACHE, BUCKET]);
    const seen = new Set(
      Array.from({ length: 40 }, (_, i) => chooseDraw(pool, `p-${i}`, TWO, all).rebuild_of),
    );
    expect(seen).toEqual(new Set([CACHE, BUCKET]));
  });

  test('drawnByOthers reads the drawn field of the other levels', () => {
    const p = newProgress({
      id: 'p-1',
      name: 'A',
      redisUrl: 'redis://x',
      activeSlots: [],
      now: new Date(),
    });
    p.levels[ONE] = { status: 'passed', attempts: 1, verdicts: [], drawn: CACHE };
    p.levels[TWO] = { status: 'in_progress', attempts: 0, verdicts: [], drawn: BUCKET };
    p.levels[THREE] = { status: 'available', attempts: 0, verdicts: [] };
    expect([...drawnByOthers(p, TWO)]).toEqual([CACHE]);
    expect([...drawnByOthers(p, THREE)].sort()).toEqual([CACHE, BUCKET].sort());
  });

  test('effectiveLevel: nothing drawn, ordinary level, and the drawn level with the questions after its checks', () => {
    const get = (id: string) => {
      const l = chapters.flatMap((c) => c.levels).find((x) => x.level.id === id);
      const c = chapters.find((x) => x.levels.includes(l!))!;
      return l ? { chapter: c, level: l, index: 0 } : undefined;
    };
    const pool = get(ONE)!;
    expect(effectiveLevel(pool, undefined, get)).toMatchObject({ pool: true, drawn: null });
    expect(effectiveLevel(pool, { drawn: 'not-in-the-pool' }, get)).toMatchObject({ drawn: null });
    const plain = get(CACHE)!;
    expect(effectiveLevel(plain, undefined, get)).toMatchObject({
      pool: false,
      verifyLevel: plain.level,
    });
    const eff = effectiveLevel(pool, { drawn: BUCKET }, get);
    expect(eff.drawn!.level.level.id).toBe(BUCKET);
    const v = eff.verifyLevel;
    expect(v.level.id).toBe(ONE); // events and progress stay on the pool level
    expect(v.dir).toBe(get(BUCKET)!.level.dir); // fixtures resolve from the drawn level's directory
    expect(v.level.verify.map((x) => x.type)).toEqual(['behavior', 'antipattern', 'quiz']);
    expect(eff.questions).toHaveLength(1);
  });
});

describe('grading a pool level as the drawn level', () => {
  const tokenBucketRun =
    (seq: boolean[], conc: boolean[]): RunFn =>
    async (req) => ({
      results: req.calls.map((_, i) => ({
        ok: true,
        value: (req.concurrency > 1 ? conc : seq)[i] ?? false,
        ms: 1,
      })),
    });
  const tenOf = (n: number) => Array.from({ length: n }, (_, i) => i < 10);

  async function grade(answers: Record<string, string>) {
    const root = await mkdtemp(join(tmpdir(), 'quest-e04-grade-'));
    try {
      const svc = new LevelService(await levelsDir(root));
      await svc.load();
      expect(svc.errors).toEqual([]);
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
            if (k === 'TYPE ratelimit:u-limit-1') return 'hash';
            if (argv[0] === 'DEL') return 1;
            throw new Error(`fake redis has no reply for ${k}`);
          },
          openSubscriber: async () => {
            throw new Error('no subscriber');
          },
          onUp: () => undefined,
        } as never,
        run: tokenBucketRun(tenOf(15), tenOf(100)),
      });
      const eff = effectiveLevel(svc.get(ONE)!, { drawn: BUCKET }, (id) => svc.get(id));
      return verifier.verify(eff.verifyLevel, {
        templateCtx: {
          player: { id: 'p-1', name: 'Asha' },
          level: { id: BUCKET },
          chapter: { id: 'example-code' },
          env: {},
        },
        attempt: 1,
        answers,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  test('the drawn checks run first and the follow-up question is the next index', async () => {
    const o = await grade({ '2': 'atomic-one' });
    expect(o.levelId).toBe(ONE);
    expect(o.checks.map((c) => [c.index, c.type, c.ok])).toEqual([
      [0, 'behavior', true],
      [1, 'antipattern', true],
      [2, 'quiz', true],
    ]);
    expect(o.verdict).toBe('right');
  });

  test('a wrong follow-up answer makes the whole verdict wrong, with the interviewer-voice quiz failing', async () => {
    const o = await grade({ '2': 'faster-one' });
    expect(o.checks[2]).toMatchObject({ index: 2, type: 'quiz', ok: false });
    expect(o.verdict).toBe('wrong');
  });

  test('no answer to the follow-up question is wrong too', async () => {
    expect((await grade({})).verdict).toBe('wrong');
  });
});

describe('verdict metrics', () => {
  const traffic = {
    index: 1,
    run: {
      load: { p99Ms: 11, rps: 842.5 },
      app: { requests: 400, redisCommands: 800, dbPerRequest: 0.02, hitRatio: 0.98 },
    },
    baseline: {
      reused: true,
      run: { load: { p99Ms: 4100 }, app: { requests: 300, dbPerRequest: 1 } },
    },
  };

  test('takes the numbers the traffic check produced', () => {
    expect(verdictMetrics(traffic)).toEqual({
      p99Ms: 11,
      baselineP99Ms: 4100,
      dbPerRequest: 0.02,
      baselineDbPerRequest: 1,
      redisPerRequest: 2,
      hitRatio: 0.98,
      rps: 842.5,
    });
  });

  test('keeps only what exists: no baseline, no app metrics, or no traffic run at all', () => {
    expect(verdictMetrics({ run: { load: { p99Ms: 30, rps: 10 }, app: null } })).toEqual({
      p99Ms: 30,
      rps: 10,
    });
    expect(verdictMetrics(undefined)).toBeUndefined();
    expect(verdictMetrics({ index: 1 })).toBeUndefined();
    expect(verdictMetrics({ run: { load: { p99Ms: 'fast' } } })).toBeUndefined();
    expect(verdictMetrics({ run: { load: { p99Ms: Number.NaN } } })).toBeUndefined();
  });
});

describe('moveAside', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'quest-e04-ws-'));
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  test('moves a non-empty file and never overwrites a backup', async () => {
    await writeWorkspaceFile(root, 'ch2/cache.js', 'first');
    expect(await moveAside(root, 'ch2/cache.js', '.before-x')).toBe('ch2/cache.js.before-x');
    await writeWorkspaceFile(root, 'ch2/cache.js', 'second');
    expect(await moveAside(root, 'ch2/cache.js', '.before-x')).toBe('ch2/cache.js.before-x-2');
    await writeWorkspaceFile(root, 'ch2/cache.js', 'third');
    expect(await moveAside(root, 'ch2/cache.js', '.before-x')).toBe('ch2/cache.js.before-x-3');
    expect(await readFile(join(root, 'ch2/cache.js.before-x'), 'utf8')).toBe('first');
    expect(await readFile(join(root, 'ch2/cache.js.before-x-2'), 'utf8')).toBe('second');
    expect(await readFile(join(root, 'ch2/cache.js.before-x-3'), 'utf8')).toBe('third');
    expect((await readdir(join(root, 'ch2'))).sort()).toEqual([
      'cache.js.before-x',
      'cache.js.before-x-2',
      'cache.js.before-x-3',
    ]);
  });

  test('leaves a missing or empty file alone', async () => {
    expect(await moveAside(root, 'ch9/none.js', '.before-x')).toBeNull();
    await writeWorkspaceFile(root, 'ch9/empty.js', '');
    expect(await moveAside(root, 'ch9/empty.js', '.before-x')).toBeNull();
    expect((await readdir(join(root, 'ch9'))).sort()).toEqual(['empty.js']);
  });

  test('refuses a path that leaves the workspace', async () => {
    await expect(moveAside(root, '../outside.js', '.before-x')).rejects.toThrow();
  });
});

describe('portfolio', () => {
  let root: string;
  let chapters: LoadedChapter[];
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'quest-e04-pf-'));
    const dir = await levelsDir(root);
    chapters = [
      (await loadChapter(join(dir, 'example-code'))).chapter!,
      (await loadChapter(join(dir, 'scratch-e04'))).chapter!,
    ];
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  function save(): ProgressFile {
    const p = newProgress({
      id: 'p-1',
      name: 'Asha *Rao*',
      redisUrl: 'redis://x',
      activeSlots: [],
      now: new Date(),
    });
    p.xp = 1230;
    p.badges = ['First cache', 'Mock one'];
    p.levels[CACHE] = {
      status: 'passed',
      attempts: 2,
      verdicts: [
        { at: 'a', verdict: 'wrong' },
        {
          at: 'b',
          verdict: 'right',
          metrics: { p99Ms: 11, baselineP99Ms: 4100, dbPerRequest: 0.02, baselineDbPerRequest: 1 },
        },
      ],
      brainstorm: { optionId: 'cache-aside-ttl', text: 'a TTL, _so stale fixes itself_', at: 'x' },
    };
    p.levels[BUCKET] = { status: 'passed', attempts: 1, verdicts: [{ at: 'c', verdict: 'right' }] };
    p.levels[ONE] = {
      status: 'passed',
      attempts: 1,
      verdicts: [{ at: 'd', verdict: 'right' }],
      drawn: CACHE,
      blanked: [{ file: 'ch2/cache.js', backup: 'ch2/cache.js.before-x' }],
      interviewElapsedMs: 7 * 60_000 + 12_000,
      overtime: false,
      hintsBought: 1,
    };
    p.levels[TWO] = {
      status: 'passed',
      attempts: 1,
      verdicts: [{ at: 'e', verdict: 'right' }],
      drawn: BUCKET,
      interviewElapsedMs: 16 * 60_000,
      overtime: true,
    };
    p.levels[THREE] = { status: 'in_progress', attempts: 0, verdicts: [] };
    return p;
  }
  const tree = [
    { path: 'ch2', type: 'dir' as const },
    { path: 'ch2/cache.js', type: 'file' as const, size: 812 },
    { path: 'ch2/cache.js.before-x', type: 'file' as const, size: 99 },
    { path: 'ch3/_bundle-a-b.js', type: 'file' as const, size: 5 },
    { path: 'ch3/ratelimit.js', type: 'file' as const, size: 0 },
    { path: 'PORTFOLIO.md', type: 'file' as const, size: 1000 },
  ];

  test('the page is made only of the save: numbers from stored metrics, each line names its level', () => {
    const { markdown, stats } = buildPortfolio({ progress: save(), chapters, tree });
    expect(markdown).toContain("# Asha \\*Rao\\*'s Redis Quest portfolio");
    expect(markdown).toContain('4 of 5 levels passed, 1,230 XP, 2 badges: First cache, Mock one.');
    expect(markdown).toContain(
      '- **Cache-aside, version one** (example-code-01-cache-aside): p99 4,100 ms to 11 ms; Postgres calls per request 1 to 0.02',
    );
    // a passed level whose save has no number has a line and no number
    expect(markdown).toContain('- **The OTP limiter, properly** (example-code-02-token-bucket)\n');
    expect(markdown).toContain(
      `- **Mock interview one** (${ONE}): the interviewer drew "Cache-aside, version one" (${CACHE}); rebuilt in 7:12 from a blank file with 1 hint bought`,
    );
    expect(markdown).toContain('rebuilt in 16:00, over the 15:00 limit');
    expect(markdown).not.toContain('Your story'); // level 3 is not passed
    expect(markdown).toContain(
      `- **Cache-aside, version one** (${CACHE}): I picked "Cache-aside: check Redis, on a miss read Postgres and store it with a TTL", and wrote: a TTL, \\_so stale fixes itself\\_`,
    );
    expect(markdown).toContain('- `ch2/cache.js` (812 bytes)');
    expect(markdown).toContain('- `ch3/ratelimit.js` (empty)');
    expect(markdown).not.toContain('before-x`');
    expect(markdown).not.toContain('_bundle');
    expect(markdown).not.toContain('`PORTFOLIO.md`');
    const closing = markdown.slice(markdown.indexOf('## What I would say in an interview'));
    expect(closing).toContain(
      `On "Cache-aside, version one" (${CACHE}) the traffic check measured p99 4,100 ms to 11 ms`,
    );
    expect(closing).toContain(
      `the interviewer drew "Cache-aside, version one" (${CACHE}) and I rebuilt it from a blank file in 7:12`,
    );
    expect(closing).not.toContain('On "The OTP limiter, properly"'); // nothing measured for that level on its own
    for (const line of closing.split('\n').filter((l) => l.startsWith('- '))) {
      expect(line).toMatch(/\(([a-z0-9-]+)\)/); // every sentence names its level id
    }
    expect(stats).toMatchObject({
      player: { id: 'p-1', name: 'Asha *Rao*' },
      xp: 1230,
      levelsPassed: 4,
      levelsTotal: 5,
      brainstorms: 1,
      workspace: { files: 2, bytes: 812 },
    });
    expect(stats.traffic.map((t) => t.levelId)).toEqual([CACHE]);
    expect(stats.interviews.map((i) => [i.levelId, i.elapsedMs, i.overtime, i.drawn?.id])).toEqual([
      [ONE, 432_000, false, CACHE],
      [TWO, 960_000, true, BUCKET],
    ]);
  });

  test('a save with nothing passed says so and invents nothing', () => {
    const p = newProgress({
      id: 'p-9',
      name: 'Newcomer',
      redisUrl: 'redis://x',
      activeSlots: [],
      now: new Date(),
    });
    reconcileLevels(
      p,
      chapters.flatMap((c) => c.levels.map((l) => l.level.id)),
    );
    const { markdown, stats } = buildPortfolio({ progress: p, chapters, tree: [] });
    expect(markdown).toContain('0 of 5 levels passed, 0 XP, 0 badges.');
    expect(markdown).toContain('No level passed yet.');
    expect(markdown).toContain('My save has no measured numbers yet');
    expect(markdown).toContain('No files in the workspace yet.');
    expect(markdown).not.toMatch(/\d+ ms/);
    expect(stats.levelsPassed).toBe(0);
  });

  test('the dev shortcut (a pass with no verdict) gives a line and no number', () => {
    const p = save();
    p.levels[CACHE] = { status: 'passed', attempts: 0, verdicts: [] };
    const { markdown } = buildPortfolio({ progress: p, chapters, tree });
    expect(markdown).toContain('- **Cache-aside, version one** (example-code-01-cache-aside)\n');
    expect(markdown).not.toContain('p99 4,100');
  });

  test('metricPhrases only says what the numbers allow; escapeMd keeps learner text plain', () => {
    expect(metricPhrases({ p99Ms: 30 })).toEqual(["p99 30 ms under the check's load"]);
    expect(metricPhrases({ baselineP99Ms: 30 })).toEqual([]);
    expect(metricPhrases({ dbPerRequest: 0.5 })).toEqual(['0.5 Postgres calls per request']);
    expect(metricPhrases({ hitRatio: 0.987, rps: 1234.4 })).toEqual([
      '98.7% of requests made no Postgres call',
      '1,234 requests per second',
    ]);
    expect(escapeMd('a [link](x) <b>bold</b> | pipe\n# not a heading')).toBe(
      'a \\[link\\](x) \\<b\\>bold\\</b\\> \\| pipe # not a heading',
    );
  });
});

describe('routes', () => {
  interface Boot {
    root: string;
    cfg: Config;
    store: ProgressStore;
    levels: LevelService;
    app: Awaited<ReturnType<typeof buildServer>>;
    bus: EventBus;
  }
  const noRedis = {
    url: 'redis://fake',
    isUp: true,
    send: async () => 'OK',
    onUp: () => undefined,
  };

  async function boot(root: string, existing?: ProgressStore): Promise<Boot> {
    const cfg: Config = {
      port: 0,
      redisUrl: 'redis://fake',
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
    expect(levels.errors).toEqual([]);
    const store = existing ?? new ProgressStore(cfg.progressDir);
    if (!existing) {
      const p = newProgress({
        id: 'p-e04',
        name: 'Asha',
        redisUrl: 'redis://fake',
        activeSlots: [],
        now: new Date(),
      });
      reconcileLevels(p, levels.orderedIds);
      await store.create(p);
    } else {
      await store.load();
    }
    const bus = new EventBus();
    const app = await buildServer({
      cfg,
      log: pino({ level: 'silent' }),
      bus,
      store,
      redis: noRedis as never,
      mirror: { write: async () => undefined, setGift: async () => undefined } as never,
      levels,
      logtail: { attach: () => undefined, tail: async () => [] } as never,
      metrics: new MetricsStore(),
      runtime: { redisUrl: 'redis://fake', activeSlots: [], dbExtraLatencyMs: 0, boots: 1 },
    });
    return { root, cfg, store, levels, app, bus };
  }

  let b: Boot;
  const get = (url: string) => b.app.inject({ method: 'GET', url });
  const post = (url: string, payload: unknown = {}) =>
    b.app.inject({ method: 'POST', url, payload: payload as object });
  const SLOT_FILE: Record<string, string> = {
    [CACHE]: 'ch2/cache.js',
    [BUCKET]: 'ch3/ratelimit.js',
  };

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), 'quest-e04-routes-'));
    await levelsDir(root);
    await mkdir(join(root, 'workspace', 'ch2'), { recursive: true });
    await mkdir(join(root, 'workspace', 'ch3'), { recursive: true });
    await writeFile(join(root, 'workspace/ch2/cache.js'), '// my own cache-aside\n');
    await writeFile(join(root, 'workspace/ch3/ratelimit.js'), '// my own limiter\n');
    b = await boot(root);
    for (const id of [CACHE, BUCKET]) {
      expect((await post(`/api/levels/${id}/start`)).statusCode).toBe(200);
      expect((await post(`/api/levels/${id}/complete`)).statusCode).toBe(200);
    }
  });
  afterAll(async () => {
    await b.app.close();
    await rm(b.root, { recursive: true, force: true });
  });

  test('before the first start nothing is drawn, the task says so, and no check is shown', async () => {
    const lv = (await get(`/api/levels/${ONE}`)).json();
    expect(lv.interview).toMatchObject({
      pool: true,
      drawn: null,
      rebuildOf: null,
      blanked: [],
      minutes: 20,
      hintXpCost: 20,
    });
    expect(lv.task).toBe('The interviewer picks when you start.');
    expect(lv.verifiers).toEqual([]);
    expect(lv.teach).toBe('');
    expect(lv.hintsTotal).toBe(1);
    expect(lv.title).toBe('Mock interview one');
    expect(lv.docs).toEqual([]);
    expect(lv.showMe).toBeNull();
    expect(lv.slots).toEqual({ own: [], active: false });
    expect(b.store.current!.levels[ONE]!.drawn).toBeUndefined();
  });

  let first = '';
  test("the first start draws, moves the drawn level's slot file aside and leaves an empty one", async () => {
    const r = await post(`/api/levels/${ONE}/start`);
    expect(r.statusCode).toBe(200);
    const body = r.json();
    first = body.drawn;
    expect([CACHE, BUCKET]).toContain(first);
    const file = SLOT_FILE[first]!;
    const backup = `${file}.before-${ONE}`;
    expect(body.blanked).toEqual([{ file, backup }]);
    expect(await readFile(join(b.cfg.workspaceDir, file), 'utf8')).toBe('');
    expect(await readFile(join(b.cfg.workspaceDir, backup), 'utf8')).toMatch(/my own/);
    // the other level's file was not the draw's business
    const other = SLOT_FILE[first === CACHE ? BUCKET : CACHE]!;
    expect(await readFile(join(b.cfg.workspaceDir, other), 'utf8')).toMatch(/my own/);
    const lp = b.store.current!.levels[ONE]!;
    expect(lp.drawn).toBe(first);
    expect(lp.blanked).toEqual([{ file, backup }]);
  });

  test('a second start keeps the draw and does not blank (or move the backup) again', async () => {
    await writeFile(join(b.cfg.workspaceDir, SLOT_FILE[first]!), '// started typing\n');
    const again = (await post(`/api/levels/${ONE}/start`)).json();
    expect(again.drawn).toBe(first);
    expect(again.blanked).toHaveLength(1);
    expect(await readFile(join(b.cfg.workspaceDir, SLOT_FILE[first]!), 'utf8')).toBe(
      '// started typing\n',
    );
    const names = await readdir(join(b.cfg.workspaceDir, SLOT_FILE[first]!.split('/')[0]!));
    expect(names.filter((n) => n.includes('.before-'))).toHaveLength(1);
  });

  test('GET shows the drawn level, its task, its verifiers and the follow-up question after them', async () => {
    const lv = (await get(`/api/levels/${ONE}`)).json();
    const drawn = b.levels.get(first)!;
    expect(lv.interview.drawn).toEqual({
      id: first,
      title: drawn.level.level.title,
      chapter: 'example-code',
      chapterTitle: 'Example: everyone showed up',
    });
    expect(lv.interview.rebuildOf).toEqual({ id: first, title: drawn.level.level.title });
    expect(lv.interview.blanked).toEqual([
      { file: SLOT_FILE[first], backup: `${SLOT_FILE[first]}.before-${ONE}` },
    ]);
    expect(lv.title).toBe('Mock interview one'); // the pool level's own title, story, reward
    expect(lv.story).toMatch(/I will pick the question/);
    expect(lv.reward).toEqual({ xp: 150, badge: 'Mock one' });
    expect(lv.task).toBe(drawn.level.level.task);
    expect(lv.docs).toEqual(drawn.level.level.docs ?? []);
    const drawnTypes = drawn.level.level.verify.map((v) => v.type);
    expect(lv.verifiers.map((v: { type: string }) => v.type)).toEqual([...drawnTypes, 'quiz']);
    const last = lv.verifiers.at(-1);
    expect(last.index).toBe(drawnTypes.length);
    expect(last.options.map((o: { id: string }) => o.id)).toEqual(
      first === CACHE ? ['refills-one', 'errors-one'] : ['atomic-one', 'faster-one'],
    );
    expect(JSON.stringify(lv.verifiers)).not.toContain('correct'); // never the answers
    expect(lv.slots.own).toEqual(first === CACHE ? ['cache.getPlayerStats'] : ['ratelimit.allow']);
    expect(lv.hintsTotal).toBe(1 + (drawn.level.level.hints?.length ?? 0));
  });

  test("hints: the pool level's first, then the drawn level's, all at the pool's cost", async () => {
    await b.store.update((d) => void (d.xp = 100));
    const h1 = (await post(`/api/levels/${ONE}/hint`)).json();
    expect(h1).toMatchObject({
      index: 0,
      hint: 'Name the keys first.',
      xpCost: 20,
      xp: 80,
      hintsTotal: 3,
    });
    const h2 = (await post(`/api/levels/${ONE}/hint`)).json();
    expect(h2.index).toBe(1);
    expect(h2.hint).toBe(b.levels.get(first)!.level.level.hints![0]);
    expect(h2).toMatchObject({ xpCost: 20, xp: 60 });
    const lv = (await get(`/api/levels/${ONE}`)).json();
    expect(lv.hints).toHaveLength(2);
    expect(lv.interview.hintsBought).toBe(2);
  });

  test("the ideal way is the drawn level's", async () => {
    const ideal = (await get(`/api/levels/${ONE}/ideal`)).json();
    expect(ideal.mode).toBe('code');
    expect(ideal.reference.path).toBe(
      'solutions/' + (first === CACHE ? '01' : '02') + '-reference.js',
    );
  });

  test('the second pool level draws the other use case', async () => {
    expect((await post(`/api/levels/${ONE}/complete`)).statusCode).toBe(200);
    const r = (await post(`/api/levels/${TWO}/start`)).json();
    expect(r.drawn).toBe(first === CACHE ? BUCKET : CACHE);
    const file = SLOT_FILE[r.drawn]!;
    expect(r.blanked).toEqual([{ file, backup: `${file}.before-${TWO}` }]);
  });

  test('the draw survives a restart (a new server on the same progress file)', async () => {
    const before = b.store.current!.levels;
    const second = await boot(b.root, new ProgressStore(b.cfg.progressDir));
    try {
      const lv = (await second.app.inject({ method: 'GET', url: `/api/levels/${ONE}` })).json();
      expect(lv.interview.drawn.id).toBe(first);
      expect(second.store.current!.levels[ONE]!.drawn).toBe(before[ONE]!.drawn);
      expect(second.store.current!.levels[TWO]!.drawn).toBe(before[TWO]!.drawn);
      const again = (
        await second.app.inject({ method: 'POST', url: `/api/levels/${ONE}/start` })
      ).json();
      expect(again.drawn).toBe(first);
    } finally {
      await second.app.close();
    }
  });

  test('verify grades as the drawn level: its checks, then the question at the next index', async () => {
    const drawn = b.levels.get(first)!;
    const n = drawn.level.level.verify.length;
    const wrongAnswer = first === CACHE ? 'errors-one' : 'faster-one';
    const r = await post(`/api/levels/${ONE}/verify`, { answers: { [String(n)]: wrongAnswer } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.levelId).toBe(ONE);
    expect(body.checks).toHaveLength(n + 1);
    expect(body.checks.at(-1)).toMatchObject({ index: n, type: 'quiz', ok: false });
    expect(body.verdict).toBe('wrong');
    const rec = b.store.current!.levels[ONE]!.verdicts.at(-1)!;
    expect(rec.verdict).toBe('wrong');
    expect(typeof rec.elapsedMs).toBe('number'); // interview levels record the time into the clock
    expect(rec.metrics).toBeUndefined(); // no traffic check ran
  });

  test('a pool level passed without a draw cannot be verified (409 not_drawn)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quest-e04-nodraw-'));
    await levelsDir(root);
    const c = await boot(root);
    try {
      for (const id of [CACHE, BUCKET]) {
        await c.app.inject({ method: 'POST', url: `/api/levels/${id}/start` });
        await c.app.inject({ method: 'POST', url: `/api/levels/${id}/complete` });
      }
      await c.app.inject({ method: 'POST', url: `/api/levels/${ONE}/complete` }); // the dev shortcut: no start, no draw
      const r = await c.app.inject({
        method: 'POST',
        url: `/api/levels/${ONE}/verify`,
        payload: {},
      });
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe('not_drawn');
    } finally {
      await c.app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test('GET /api/portfolio is the page from the save; POST writes it and emits portfolio_written', async () => {
    const seen: { name: string; data: unknown }[] = [];
    b.bus.subscribe((e: unknown) => {
      const ev = e as { type?: string; data?: { kind?: string; name?: string; data?: unknown } };
      if (ev.type === 'level.event' && ev.data?.name === 'portfolio_written')
        seen.push({ name: ev.data.name, data: ev.data.data });
    });
    const page = (await get('/api/portfolio')).json();
    expect(page.markdown).toContain("# Asha's Redis Quest portfolio");
    expect(page.markdown).toContain('Mock interview one');
    expect(page.markdown).toContain('the interviewer drew');
    expect(page.markdown).toContain('`' + SLOT_FILE[first]! + '`');
    expect(page.markdown).not.toContain('.before-');
    expect(page.stats.player).toEqual({ id: 'p-e04', name: 'Asha' });
    const w = await post('/api/portfolio/write');
    expect(w.statusCode).toBe(200);
    const body = w.json();
    expect(body).toMatchObject({ path: 'workspace/PORTFOLIO.md', file: 'PORTFOLIO.md' });
    const onDisk = await readFile(join(b.cfg.workspaceDir, 'PORTFOLIO.md'), 'utf8');
    expect(body.bytes).toBe(Buffer.byteLength(onDisk));
    expect(onDisk).toContain("# Asha's Redis Quest portfolio");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.data).toMatchObject({
      bytes: body.bytes,
      levels: body.levels,
      passed: body.passed,
    });
    // the page does not list itself, so writing it twice is stable
    const again = (await get('/api/portfolio')).json();
    expect(again.markdown).not.toContain('`PORTFOLIO.md`');
    expect((await listTree(b.cfg.workspaceDir)).some((e) => e.path === 'PORTFOLIO.md')).toBe(true);
  });

  test('a level without a pool is unchanged: interview.drawn is null and no blank start by default', async () => {
    const lv = (await get(`/api/levels/${CACHE}`)).json();
    expect(lv.interview).toBeNull();
    expect(lv.hintsTotal).toBe(2);
    expect(blankStartOf(b.levels.get(CACHE)!.level)).toBe(false);
  });
});
