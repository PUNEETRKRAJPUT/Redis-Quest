import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import {
  formatLevelError,
  levelFileSchema,
  loadAllLevels,
  loadChapter,
  validateLevels,
  type LevelError,
} from '../index.js';

function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('repo root not found');
    dir = up;
  }
  return dir;
}

const REPO = findRepoRoot();
const EXAMPLES = join(REPO, 'levels', '_examples');
const INVALID = join(EXAMPLES, 'invalid');
const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempTree(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'quest-levels-'));
  tempDirs.push(d);
  return d;
}

function messages(errors: LevelError[]): string[] {
  return errors.map((e) => `${e.path}: ${e.message}`);
}

/** A valid cli level as a plain object, built from the cli example, for schema-only tests. */
function baseLevel(): Record<string, unknown> {
  const file = join(EXAMPLES, 'example-cli', '01-hostel-scoreboard.yaml');
  const data = parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  data.story = 'An inline story.';
  return data;
}

/** The base level without its antipattern verifier and works_but_wrong solution, for tests that replace verify. */
function plainLevel(): Record<string, unknown> {
  const l = baseLevel();
  l.verify = (l.verify as { type: string }[]).filter((v) => v.type !== 'antipattern');
  const solutions = l.solutions as { wrong: { expect: string }[] };
  solutions.wrong = solutions.wrong.filter((w) => w.expect !== 'works_but_wrong');
  return l;
}

function schemaErrors(level: unknown): string[] {
  const r = levelFileSchema.safeParse(level);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('valid examples', () => {
  const levelCounts: Record<string, number> = { 'example-cli': 1, 'example-code': 2, 'example-decision': 1, 'example-ops': 1 };
  for (const [name, count] of Object.entries(levelCounts)) {
    test(`${name} loads with no errors`, async () => {
      const r = await loadChapter(join(EXAMPLES, name));
      expect(messages(r.errors)).toEqual([]);
      expect(r.chapter?.levels).toHaveLength(count);
    });
  }

  test('the token bucket example uses a behavior-shaped antipattern', async () => {
    const r = await loadChapter(join(EXAMPLES, 'example-code'));
    const level = r.chapter!.levels[1]!.level;
    const anti = level.verify.find((v) => v.type === 'antipattern');
    expect(anti && 'slot' in anti && anti.slot).toBe('ratelimit.allow');
    expect(anti && 'concurrency' in anti && anti.concurrency).toBe(100);
  });

  test('markdown from { file } is inlined and its source recorded', async () => {
    const r = await loadChapter(join(EXAMPLES, 'example-cli'));
    const loaded = r.chapter!.levels[0]!;
    expect(loaded.level.story).toContain('Shivneri Hostel');
    expect(loaded.sources.story).toBe(join(EXAMPLES, 'example-cli', '01-hostel-scoreboard.story.md'));
  });

  test('command arguments are normalised to strings', async () => {
    const r = await loadChapter(join(EXAMPLES, 'example-cli'));
    const setup = r.chapter!.levels[0]!.level.setup!;
    expect(setup[1]).toEqual({ cmd: ['ZADD', 'lb:hostel:h-c-02-2', '140', 'user:teja'] });
  });

  test('quiz correct and decision reference are normalised to lists', async () => {
    const r = await loadChapter(join(EXAMPLES, 'example-decision'));
    const level = r.chapter!.levels[0]!.level;
    expect(level.mode).toBe('decision');
    if (level.mode !== 'decision') return;
    expect(level.solutions.reference).toEqual(['lb-sorted-set', 'profile-hash', 'streak-bitmap']);
    const quiz = level.verify[0]!;
    expect(quiz.type === 'quiz' && quiz.correct).toEqual(['lb-sorted-set']);
  });

  test('the real levels/ tree skips _examples', async () => {
    const r = await loadAllLevels(join(REPO, 'levels'));
    expect(messages(r.errors)).toEqual([]);
    expect(r.chapters.every((c) => !c.dir.includes('_examples'))).toBe(true);
  });

  test('loading levels/_examples as a whole reports the invalid cases', async () => {
    const errors = await validateLevels(EXAMPLES);
    const cases = await readdir(INVALID);
    expect(new Set(errors.map((e) => e.file.split('/invalid/')[1]?.split('/')[0]))).toEqual(new Set(cases));
  });
});

describe('invalid examples fail with file:line:col and the right message', () => {
  const expected: Record<string, { path: string; message: string }> = {
    'unknown-key': { path: 'difficulty', message: "unknown key 'difficulty'" },
    'two-assertions': { path: 'verify[0].checks[0]', message: 'exactly one assertion required (found: equals, gte)' },
    'write-command': { path: 'verify[0].checks[0].cmd[0]', message: 'SET is not on the read-only allowlist' },
    'missing-solution-file': { path: 'solutions.reference', message: 'file not found: solutions/does-not-exist.redis' },
    'id-mismatch': { path: 'id', message: 'id must be id-mismatch-01-scoreboard' },
    'unknown-template-variable': { path: 'task', message: 'unknown template variable {{player.email}}' },
    'bad-docs-url': { path: 'docs[0]', message: 'must be official pages starting with https://redis.io/docs/' },
    'antipattern-both-shapes': { path: 'verify[1]', message: 'an antipattern uses either checks or slot/fixtures/assertions, not both' },
  };

  test('every invalid directory has an expectation', async () => {
    expect((await readdir(INVALID)).sort()).toEqual(Object.keys(expected).sort());
  });

  for (const [name, want] of Object.entries(expected)) {
    test(name, async () => {
      const errors = await validateLevels(join(INVALID, name));
      expect(errors).toHaveLength(1);
      const e = errors[0]!;
      const file = join(INVALID, name, '01-scoreboard.yaml');
      expect(e.file).toBe(file);
      // The fixture marks the offending line with "# INVALID".
      const markedLine = readFileSync(file, 'utf8').split('\n').findIndex((l, i) => i > 0 && l.includes('# INVALID')) + 1;
      expect(e.line).toBe(markedLine);
      expect(e.col).toBeGreaterThan(0);
      expect(e.path).toBe(want.path);
      expect(e.message).toContain(want.message);
      expect(formatLevelError(e, REPO)).toMatch(
        new RegExp(`^levels/_examples/invalid/${name}/01-scoreboard\\.yaml:${markedLine}:\\d+ ${want.path.replace(/[[\].]/g, '\\$&')}: `),
      );
    });
  }
});

describe('schema rules', () => {
  test('the base level is valid', () => {
    expect(schemaErrors(baseLevel())).toEqual([]);
  });

  test('allowWrite needs a reason, and only on write commands', () => {
    const write = (check: Record<string, unknown>) => {
      const l = plainLevel();
      l.verify = [{ type: 'redis', checks: [{ cmd: ['SET', 'x', '1'], equals: 'OK', ...check }] }];
      return schemaErrors(l);
    };
    expect(write({ allowWrite: true, reason: 'checks a write path on purpose' })).toEqual([]);
    expect(write({ allowWrite: true })).toEqual(['verify.0.checks.0.allowWrite: allowWrite: true requires a reason']);
    const l = plainLevel();
    l.verify = [{ type: 'redis', checks: [{ cmd: ['GET', 'x'], equals: '1', allowWrite: true, reason: 'x' }] }];
    expect(schemaErrors(l)).toEqual(['verify.0.checks.0.allowWrite: GET is read-only; remove allowWrite']);
  });

  test('container commands are judged by their subcommand', () => {
    const check = (cmd: string[]) => {
      const l = plainLevel();
      l.verify = [{ type: 'redis', checks: [{ cmd, exists: true }] }];
      return schemaErrors(l);
    };
    expect(check(['CONFIG', 'GET', 'maxmemory'])).toEqual([]);
    expect(check(['config', 'set', 'maxmemory', '1mb'])[0]).toContain('CONFIG SET is not on the read-only allowlist');
    expect(check(['{{env.CMD}}', 'x'])[0]).toContain('must be literal');
  });

  test('zero assertions is an error too', () => {
    const l = plainLevel();
    l.verify = [{ type: 'redis', checks: [{ cmd: ['GET', 'x'] }] }];
    expect(schemaErrors(l)[0]).toContain('exactly one assertion required (none found');
  });

  test('brainstorm must offer not-redis and one reasonable option', () => {
    const l = baseLevel();
    l.brainstorm = { prompt: 'p', options: [{ id: 'a', label: 'A', is_reasonable: false }, { id: 'b', label: 'B', is_reasonable: false }] };
    expect(schemaErrors(l)).toEqual([
      'brainstorm.options: the options must include id: not-redis',
      'brainstorm.options: at least one option must have is_reasonable: true',
    ]);
  });

  test('antipattern and works_but_wrong come as a pair', () => {
    const noWbw = baseLevel();
    (noWbw.solutions as { wrong: unknown[] }).wrong = [{ path: 'solutions/x.redis', expect: 'wrong', because: 'b' }];
    expect(schemaErrors(noWbw)[0]).toContain('an antipattern verifier needs at least one solutions.wrong entry');
    const noAnti = baseLevel();
    noAnti.verify = (noAnti.verify as { type: string }[]).filter((v) => v.type !== 'antipattern');
    expect(schemaErrors(noAnti)[0]).toContain('works_but_wrong needs an antipattern verifier');
  });

  test('antipattern checks need a message', () => {
    const l = baseLevel();
    l.verify = [
      { type: 'redis', checks: [{ cmd: ['GET', 'x'], exists: true }] },
      { type: 'antipattern', checks: [{ cmd: ['EXISTS', 'y'], equals: 0 }] },
    ];
    expect(schemaErrors(l)).toEqual(['verify.1.checks.0: antipattern checks need a message (it is the "works, but wrong" feedback)']);
  });

  test('solution files must match the mode', () => {
    const l = baseLevel();
    (l.solutions as { reference: string }).reference = 'solutions/ref.js';
    expect(schemaErrors(l)).toEqual(['solutions.reference: a cli solution must be a .redis file']);
  });

  test('a code level needs behavior or traffic', () => {
    const l = baseLevel();
    l.mode = 'code';
    l.solutions = { reference: 'r.js', wrong: [{ path: 'w.js', expect: 'works_but_wrong', because: 'b' }] };
    expect(schemaErrors(l)).toEqual(['verify: a code level needs at least one behavior or traffic verifier']);
  });

  test('decision references must match the quizzes', () => {
    const l = baseLevel();
    l.mode = 'decision';
    l.verify = [
      { type: 'quiz', question: 'q', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], correct: 'a', explanation: 'e' },
    ];
    l.solutions = { reference: 'b', wrong: [{ option: 'a', expect: 'wrong', because: 'x' }] };
    expect(schemaErrors(l)).toEqual([
      'solutions.reference.0: b is not a correct option of any quiz in this level',
      'solutions.reference: the reference must list every correct option (missing: a)',
      'solutions.wrong.0.option: a is a correct answer, not a wrong one',
    ]);
  });

  test('quiz correct must name an option', () => {
    const l = plainLevel();
    l.verify = [{ type: 'quiz', question: 'q', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], correct: ['c'], explanation: 'e' }];
    l.solutions = { reference: 'solutions/r.redis', wrong: [{ path: 'solutions/w.redis', expect: 'wrong', because: 'b' }] };
    expect(schemaErrors(l)).toEqual(["verify.0.correct.0: c is not one of this quiz's option ids"]);
  });

  test('traffic ratios need a baseline', () => {
    const l = baseLevel();
    l.verify = [
      { type: 'traffic', scenario: 'toss-time-100', baseline: false, assertions: { p99_ratio_lte: 0.2, error_rate_lte: 0 } },
      { type: 'antipattern', checks: [{ cmd: ['EXISTS', 'y'], equals: 0, message: 'm' }] },
    ];
    expect(schemaErrors(l)).toEqual(['verify.0.assertions.p99_ratio_lte: p99_ratio_lte is relative to the baseline run; set baseline: true']);
  });

  test('event kinds that need a match key', () => {
    const l = baseLevel();
    l.verify = [{ type: 'event', kind: 'custom', timeoutMs: 1000 }, ...(l.verify as unknown[]).slice(1)];
    expect(schemaErrors(l)).toEqual(['verify.0: event kind custom needs match.name (a string)']);
  });

  test('behavior assertions', () => {
    const behavior = (assertion: Record<string, unknown>) => {
      const l = baseLevel();
      l.verify = [{ type: 'behavior', slot: 'ratelimit.allow', fixtures: 'f.yaml', assertions: [assertion] }, ...(l.verify as unknown[]).slice(1)];
      return schemaErrors(l);
    };
    expect(behavior({ call: { args: ['u1'] }, repeat: 100, expectCount: { value: true, equals: 10 } })).toEqual([]);
    expect(behavior({ call: { args: ['u1'] }, expectCount: { value: true, equals: 10 } })).toEqual([
      'verify.0.assertions.0.expectCount: expectCount counts over repeated calls; set repeat to 2 or more',
    ]);
    expect(behavior({ call: { args: [] }, expect: 1, expectError: true })[0]).toContain('use only one of expect, expectError, expectCount');
    expect(behavior({ call: { args: [] } })[0]).toContain('needs expect, expectError, expectCount or sideEffect');
    expect(behavior({ call: { args: [] }, expectError: '(' })[0]).toContain('not a valid regular expression');
  });

  test('setup may not flush or touch game:* keys', () => {
    const l = baseLevel();
    l.setup = [{ cmd: ['FLUSHALL'] }, { cmd: ['DEL', 'game:player:1'] }, { cmd: ['DEL', 'x'], sql: 'select 1' }];
    expect(schemaErrors(l)).toEqual([
      "setup.0.cmd.0: FLUSHALL is not allowed in setup: it would wipe the engine's game:* keys (delete your level's own keys instead)",
      'setup.1.cmd.1: the game:* key prefix belongs to the engine; levels use their own prefixes',
      'setup.2: a setup step is exactly one of cmd, sql or script (found: cmd, sql)',
    ]);
  });

  test('min_redis_version must be a quoted version', () => {
    const l = baseLevel();
    l.min_redis_version = 8.4;
    expect(schemaErrors(l)[0]).toContain('must be a quoted version string');
  });
});

describe('loader rules (file system)', () => {
  async function copyCliExample(): Promise<string> {
    const root = await tempTree();
    const dir = join(root, 'example-cli');
    await cp(join(EXAMPLES, 'example-cli'), dir, { recursive: true });
    return dir;
  }
  const levelFile = (dir: string) => join(dir, '01-hostel-scoreboard.yaml');
  const read = (f: string) => readFileSync(f, 'utf8');

  test('YAML syntax errors carry a position', async () => {
    const dir = await copyCliExample();
    await writeFile(levelFile(dir), 'id: x\ntitle: a\nmode: b: c\n');
    const [e] = await validateLevels(dir);
    expect(e).toMatchObject({ path: '(yaml)', line: 3, col: 7 });
  });

  test('duplicate keys are rejected', async () => {
    const dir = await copyCliExample();
    await writeFile(levelFile(dir), read(levelFile(dir)).replace('title: "The hostel scoreboard"', 'title: a\ntitle: b'));
    const errors = await validateLevels(dir);
    expect(errors[0]?.path).toBe('(yaml)');
    expect(errors[0]?.message).toMatch(/unique/i);
  });

  test('an unquoted {{ value gets a quoting hint', async () => {
    const dir = await copyCliExample();
    await writeFile(levelFile(dir), read(levelFile(dir)).replace('title: "The hostel scoreboard"', 'title: {{player.name}}'));
    const errors = await validateLevels(dir);
    expect(errors.map((e) => e.message).join('\n')).toContain('a value starting with {{ must be quoted in YAML');
  });

  test('missing markdown file is reported on the file key', async () => {
    const dir = await copyCliExample();
    await rm(join(dir, '01-hostel-scoreboard.story.md'));
    const errors = await validateLevels(dir);
    expect(messages(errors)).toEqual(['story.file: file not found: ./01-hostel-scoreboard.story.md']);
    expect(errors[0]?.line).toBe(8);
  });

  test('template errors inside a markdown file point into that file', async () => {
    const dir = await copyCliExample();
    const md = join(dir, '01-hostel-scoreboard.story.md');
    await writeFile(md, 'line one\nhello {{player.nmae}}\n');
    const [e] = await validateLevels(dir);
    expect(e).toMatchObject({ file: md, line: 2, col: 7, path: 'story' });
  });

  test('template errors in .redis solutions are reported', async () => {
    const dir = await copyCliExample();
    await writeFile(join(dir, 'solutions', '01-reference.redis'), 'ZADD k 1 {{player}}\n');
    const [e] = await validateLevels(dir);
    expect(e).toMatchObject({ line: 1, col: 10, path: 'solutions.reference' });
  });

  test('paths may not escape the levels tree', async () => {
    const dir = await copyCliExample();
    await writeFile(levelFile(dir), read(levelFile(dir)).replace('reference: solutions/01-reference.redis', 'reference: ../../../etc/hosts.redis'));
    expect(messages(await validateLevels(dir))).toEqual(['solutions.reference: ../../../etc/hosts.redis points outside the levels directory']);
  });

  test('chapter manifest: unlisted level, missing level and order', async () => {
    const dir = await copyCliExample();
    await cp(levelFile(dir), join(dir, '02-second.yaml'));
    await writeFile(
      join(dir, '02-second.yaml'),
      read(join(dir, '02-second.yaml')).replace('id: example-cli-01-hostel-scoreboard', 'id: example-cli-02-second'),
    );
    const chapter = join(dir, 'chapter.yaml');
    await writeFile(chapter, read(chapter).replace('  - example-cli-01-hostel-scoreboard', '  - example-cli-03-ghost\n  - example-cli-01-hostel-scoreboard'));
    expect(messages(await validateLevels(dir))).toEqual([
      'id: example-cli-02-second is not listed in chapter.yaml levels',
      'levels[0]: no level file for example-cli-03-ghost (expected 03-ghost.yaml in this directory)',
    ]);
    await writeFile(chapter, read(chapter).replace('  - example-cli-03-ghost\n', '').replace('  - example-cli-01-hostel-scoreboard', '  - example-cli-02-second\n  - example-cli-01-hostel-scoreboard'));
    expect(messages(await validateLevels(dir))).toEqual(['levels[1]: levels must be listed in file-number order (example-cli-01-hostel-scoreboard is out of order)']);
  });

  test('bad file names and stray YAML are reported', async () => {
    const dir = await copyCliExample();
    await writeFile(join(dir, 'notes.yaml'), 'a: 1\n');
    await writeFile(join(dir, '03-x.yml'), 'a: 1\n');
    await writeFile(join(dirname(dir), 'stray.yaml'), 'a: 1\n');
    const errors = await validateLevels(dirname(dir));
    expect(errors.map((e) => `${e.file.split('/').pop()}: ${e.message}`)).toEqual([
      '03-x.yml: use the .yaml extension',
      'notes.yaml: level files are named NN-slug.yaml (two-digit number, kebab-case slug)',
      `stray.yaml: YAML file outside a chapter directory (no chapter.yaml next to it)`,
    ]);
  });

  test('canonical chapter directories have fixed short ids', async () => {
    const root = await tempTree();
    const dir = join(root, 'ch1-keyspace');
    await mkdir(dir);
    await writeFile(join(dir, 'chapter.yaml'), 'id: ch1-keyspace\ntitle: t\nincident:\n  - { from: you, time: "09:00", text: hi }\nlevels: [ch1-keyspace-01-a]\n');
    const errors = await validateLevels(root);
    expect(messages(errors)).toContain('id: the ch1-keyspace chapter has id ch1');
  });

  test('behavior fixtures are validated with their own file positions', async () => {
    const root = await tempTree();
    const dir = join(root, 'example-code');
    await cp(join(EXAMPLES, 'example-code'), dir, { recursive: true });
    const fixture = join(dir, 'fixtures', '01-cold-cache.yaml');
    await writeFile(fixture, 'steps:\n  - cmd: [FLUSHDB]\n');
    const [e] = await validateLevels(dir);
    expect(e).toMatchObject({ file: fixture, line: 2, path: 'steps[0].cmd[0]' });
  });
});

describe('follow-up 1: behavior-shaped antipatterns, absolute traffic, answer', () => {
  const antiBehavior = (extra: Record<string, unknown> = {}) => ({
    type: 'antipattern',
    slot: 'ratelimit.allow',
    fixtures: 'f.yaml',
    concurrency: 100,
    assertions: [{ call: { args: ['u'] }, repeat: 100, expectCount: { value: true, lte: 10 }, message: 'races' }],
    ...extra,
  });
  const withAnti = (anti: Record<string, unknown>) => {
    const l = baseLevel();
    l.verify = [(l.verify as unknown[])[0], anti];
    return schemaErrors(l);
  };

  test('a behavior-shaped antipattern is valid', () => {
    expect(withAnti(antiBehavior())).toEqual([]);
  });

  test('both shapes, or a partial behavior shape, are errors', () => {
    expect(withAnti(antiBehavior({ checks: [{ cmd: ['EXISTS', 'x'], equals: 0, message: 'm' }] }))[0]).toContain('not both');
    expect(withAnti({ type: 'antipattern', slot: 'ratelimit.allow' })).toEqual([
      'verify.1: a behavior-shaped antipattern needs slot, fixtures and assertions (missing: fixtures, assertions)',
    ]);
    expect(withAnti({ type: 'antipattern' })).toEqual(['verify.1: an antipattern needs checks, or slot + fixtures + assertions']);
  });

  test('behavior-shaped antipattern assertions need a message', () => {
    expect(withAnti(antiBehavior({ assertions: [{ call: { args: [] }, expect: true }] }))).toEqual([
      'verify.1.assertions.0: antipattern assertions need a message (it is the "works, but wrong" feedback)',
    ]);
  });

  test('a missing antipattern fixtures file is reported', async () => {
    const root = await tempTree();
    const dir = join(root, 'example-code');
    await cp(join(EXAMPLES, 'example-code'), dir, { recursive: true });
    const file = join(dir, '02-token-bucket.yaml');
    await writeFile(file, readFileSync(file, 'utf8').replace(/(concurrency: 100)/, '$1').replace(/(type: antipattern[\s\S]*?)fixtures: fixtures\/02-reset-buckets\.yaml/, '$1fixtures: fixtures/nope.yaml'));
    expect(messages(await validateLevels(dir))).toEqual(['verify[1].fixtures: file not found: fixtures/nope.yaml']);
  });

  test('absolute traffic assertions need no baseline', () => {
    const traffic = (assertions: Record<string, unknown>) =>
      withAnti({ type: 'traffic', scenario: 'toss-time-100', baseline: false, assertions }).filter((e) => !e.includes('works_but_wrong'));
    expect(traffic({ db_queries_lte: 2, p99_ms_lte: 50 })).toEqual([]);
    expect(traffic({ db_queries_lte: 2.5 })[0]).toContain('verify.1.assertions.db_queries_lte');
  });

  const answer = (extra: Record<string, unknown> = {}) => ({
    type: 'answer',
    prompt: 'How many users did SCAN find?',
    expected: { cmd: ['SCARD', 'users:{{player.id}}'], transform: 'number' },
    message: 'Not the count Redis has.',
    ...extra,
  });
  const withAnswer = (a: Record<string, unknown>) => {
    const l = plainLevel();
    l.verify = [a];
    return schemaErrors(l);
  };

  test('answer verifiers', () => {
    expect(withAnswer(answer())).toEqual([]);
    expect(withAnswer(answer({ compare: 'numeric_within', tolerance: 5, expected: { cmd: ['TTL', 'k'], transform: 'number' } }))).toEqual([]);
    expect(withAnswer(answer({ compare: 'numeric_within' }))).toEqual(['verify.0.compare: numeric_within needs a tolerance']);
    expect(withAnswer(answer({ tolerance: 1 }))).toEqual(['verify.0.tolerance: tolerance is only used with compare: numeric_within']);
    expect(withAnswer(answer({ expected: { cmd: ['DEL', 'k'] } }))[0]).toContain('DEL is not on the read-only allowlist');
    expect(withAnswer(answer({ expected: { cmd: ['{{env.C}}'] } }))[0]).toContain('must be literal');
    expect(withAnswer(answer({ message: undefined }))).toEqual(['verify.0.message: Invalid input: expected string, received undefined']);
  });

  test('the cli example carries an answer verifier', async () => {
    const r = await loadChapter(join(EXAMPLES, 'example-cli'));
    const a = r.chapter!.levels[0]!.level.verify.find((v) => v.type === 'answer');
    expect(a && a.type === 'answer' && a.expected.cmd).toEqual(['ZREVRANK', 'lb:hostel:h-c-02-2', 'user:{{player.id}}']);
  });
});
