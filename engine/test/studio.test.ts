// D-05: the studio's engine side. A draft is validated with the real loader and play-tested through the real
// verifier against a tiny in-memory Redis (INCR, EXPIRE, TTL, GET, EXISTS, RPUSH, SET, UNLINK, COMMAND GETKEYS), so
// no stack is needed. The routes themselves are covered by scripts/check/D-05.sh against a running stack.
import pino from 'pino';
import { describe, expect, test } from 'vitest';
import type { StudioDraft } from '@quest/shared';
import { splitArgs } from '../src/cli.js';
import { playtest, refusalFor } from '../src/community/playtest.js';
import { validateDraft } from '../src/community/validate.js';
import { loadVerifyConfig } from '../src/verify/config.js';
import { Verifier } from '../src/verify/index.js';

class FakeRedis {
  url = 'redis://fake';
  isUp = true;
  data = new Map<string, string | string[]>();
  ttl = new Map<string, number>();
  onUp() {}
  async openSubscriber(): Promise<never> {
    throw new Error('not used');
  }
  async send(argv: string[]): Promise<unknown> {
    const [name = '', a = '', b = ''] = argv;
    switch (name.toUpperCase()) {
      case 'COMMAND':
        return argv[3] === undefined ? [] : [argv[3]];
      case 'INCR': {
        const n = Number(this.data.get(a) ?? 0) + 1;
        this.data.set(a, String(n));
        return n;
      }
      case 'EXPIRE':
        this.ttl.set(a, Number(b));
        return 1;
      case 'TTL':
        return this.ttl.get(a) ?? (this.data.has(a) ? -1 : -2);
      case 'GET':
        return (this.data.get(a) as string | undefined) ?? null;
      case 'SET':
        this.data.set(a, b);
        return 'OK';
      case 'EXISTS':
        return this.data.has(a) ? 1 : 0;
      case 'RPUSH':
        this.data.set(a, argv.slice(2));
        return argv.length - 2;
      case 'UNLINK':
      case 'DEL':
        for (const k of argv.slice(1)) {
          this.data.delete(k);
          this.ttl.delete(k);
        }
        return 1;
      default:
        throw new Error(`fake redis: ${name} is not implemented`);
    }
  }
}

const quietBus = { emit() {}, subscribe: () => () => true, since: () => [] };

function draft(): StudioDraft {
  return {
    mode: 'cli',
    pack: 'mine',
    number: 1,
    slug: 'a-counter',
    title: 'A counter',
    chapterTitle: 'Mine',
    incident: [{ from: 'roommate', time: '10:00', text: 'need a counter' }],
    story: 'A story.',
    brainstormPrompt: 'What would you reach for?',
    brainstormOptions: [{ label: 'A string key', reasonable: true }],
    teach: 'INCR adds one.',
    task: 'Increment `c:n` twice and expire it.',
    setup: 'DEL c:n c:copy',
    hints: ['INCR takes the key.'],
    checks: [
      { kind: 'string_equals', key: 'c:n', value: '2', message: 'Should be 2.' },
      { kind: 'ttl_between', key: 'c:n', min: 1, max: 60, message: 'Needs an expiry.' },
      { kind: 'not_exists', key: 'c:copy', antipattern: true, message: 'No copy of the count.' },
    ],
    quizzes: [],
    reference: 'INCR c:n\nINCR c:n\nEXPIRE c:n 60\n',
    wrong: [
      { script: 'INCR c:n\nINCR c:n\n', expect: 'wrong', because: 'No expiry.' },
      {
        script: 'INCR c:n\nINCR c:n\nEXPIRE c:n 60\nSET c:copy 2\n',
        expect: 'works_but_wrong',
        because: 'A copy.',
      },
    ],
    author: { name: 'Asha', github: 'asha' },
  };
}

const ctx = {
  player: { id: 'p1', name: 'P' },
  level: { id: 'mine-01-a-counter' },
  chapter: { id: 'mine' },
};

function depsFor(redis: FakeRedis) {
  const verifier = new Verifier({
    cfg: loadVerifyConfig({ progressDir: '/tmp/quest-studio-test', port: 1 }),
    log: pino({ level: 'silent' }),
    bus: quietBus,
    redis,
  });
  return {
    send: (argv: string[]) => redis.send(argv),
    cli: async (line: string) => {
      const argv = splitArgs(line) ?? [];
      const reply = await redis.send(argv);
      return { reply: String(reply), type: 'status', ms: 0 };
    },
    verify: (
      level: Parameters<Verifier['verify']>[0],
      c: typeof ctx,
      answers: Record<string, string | string[]>,
    ) => verifier.verify(level, { templateCtx: c, attempt: 1, answers }),
  };
}

describe('validateDraft', () => {
  test('a good draft validates and carries its files', async () => {
    const r = await validateDraft(draft());
    expect(r.result.errors).toEqual([]);
    expect(r.result.ok).toBe(true);
    expect(r.result.directory).toBe('levels/community/mine');
    expect(r.loaded?.level.id).toBe('mine-01-a-counter');
    expect([...r.scripts.keys()].sort()).toEqual([
      'solutions/01-reference.redis',
      'solutions/01-works-but-wrong-2.redis',
      'solutions/01-wrong-1.redis',
    ]);
  });

  test('a missing author comes back positioned in the YAML the studio shows', async () => {
    const d = draft();
    d.author = { name: '' };
    const r = await validateDraft(d);
    expect(r.result.ok).toBe(false);
    const e = r.result.errors.find((x) => x.path === 'author.name');
    expect(e?.file).toBe('levels/community/mine/01-a-counter.yaml');
    expect(e?.line).toBeGreaterThan(1);
  });

  test('a draft shaped wrong is reported as problems, not errors', async () => {
    const r = await validateDraft({ mode: 'cli', pack: 'Bad Name' });
    expect(r.result.problems.map((p) => p.path)).toContain('pack');
    expect(r.result.ok).toBe(false);
  });
});

describe('playtest', () => {
  async function run(d: StudioDraft, redis = new FakeRedis()) {
    const v = await validateDraft(d);
    expect(v.result.errors).toEqual([]);
    if (!v.loaded) throw new Error('draft did not load');
    return {
      redis,
      result: await playtest(depsFor(redis), { level: v.loaded, ctx, scripts: v.scripts }),
    };
  }

  test('reference is right, the known-wrong ones behave as declared, and the keys are removed', async () => {
    const { redis, result } = await run(draft());
    expect(result.refused).toBeNull();
    expect(result.runs.map((r) => [r.name, r.verdict, r.ok])).toEqual([
      ['reference', 'right', true],
      ['solutions/01-wrong-1.redis', 'wrong', true],
      ['solutions/01-works-but-wrong-2.redis', 'works_but_wrong', true],
    ]);
    expect(result.passed).toBe(true);
    expect([...result.keys].sort()).toEqual(['c:copy', 'c:n']);
    expect(redis.data.size).toBe(0);
  });

  test('a known-wrong solution that actually passes fails the play-test', async () => {
    const d = draft();
    d.wrong = [
      {
        script: 'INCR c:n\nINCR c:n\nEXPIRE c:n 60\n',
        expect: 'wrong',
        because: 'It is actually right.',
      },
    ];
    d.checks = d.checks?.filter((c) => !c.antipattern);
    const { result } = await run(d);
    expect(result.passed).toBe(false);
    expect(result.runs[1]?.verdict).toBe('right');
  });

  test('a key that already exists is refused, and nothing is touched', async () => {
    const redis = new FakeRedis();
    redis.data.set('c:n', '41');
    const { result } = await run(draft(), redis);
    expect(result.refused).toMatch(/"c:n" already exists/);
    expect(result.runs).toEqual([]);
    expect(redis.data.get('c:n')).toBe('41');
  });

  test('game:* keys and server-changing commands are refused', () => {
    expect(refusalFor([['SET', 'game:progress', '1']])).toMatch(/game:\*/);
    expect(refusalFor([['config', 'set', 'maxmemory', '1']])).toMatch(/CONFIG/);
    expect(refusalFor([['INCR', 'c:n']])).toBeNull();
  });

  test('a decision draft: reference answers are right, each wrong option is wrong', async () => {
    const d: StudioDraft = {
      ...draft(),
      mode: 'decision',
      setup: '',
      checks: [],
      reference: '',
      wrong: [],
      quizzes: [
        {
          question: 'Which structure?',
          explanation: 'It needs ordering.',
          options: [
            { label: 'Sorted set', correct: true },
            { label: 'List', correct: false, because: 'Sorts on every read.' },
          ],
        },
      ],
    };
    const { result } = await run(d);
    expect(result.runs.map((r) => [r.name, r.verdict])).toEqual([
      ['reference', 'right'],
      ['q1-b', 'wrong'],
    ]);
    expect(result.passed).toBe(true);
  });
});
