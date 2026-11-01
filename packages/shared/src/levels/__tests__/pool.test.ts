/* eslint-disable @typescript-eslint/no-explicit-any -- the tests poke at raw parsed YAML */
// E-04: interview pools. `interview.pool` is the alternative to `rebuild_of`: 2 to 12 earlier code levels, each with
// 1 to 5 follow-up quizzes. A pool level has no verify and no solutions of its own.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadAllLevels, validateLevels } from '../loader.js';
import { interviewBlankStart, levelFileSchema } from '../schema.js';

const EXAMPLES = fileURLToPath(new URL('../../../../../levels/_examples', import.meta.url));
const SCRATCH = fileURLToPath(
  new URL('../../../../../engine/test/fixtures/scratch-e04', import.meta.url),
);
const POOL_FILE = join(SCRATCH, '01-mock-one.yaml');

async function raw(): Promise<Record<string, any>> {
  return parse(await readFile(POOL_FILE, 'utf8')) as Record<string, any>;
}
const clone = <T>(v: T): T => structuredClone(v);
const errorsOf = (data: unknown): string[] => {
  const r = levelFileSchema.safeParse(data);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('interview.pool schema', () => {
  it('accepts the scratch pool level; blank_start defaults to true for a pool', async () => {
    const r = levelFileSchema.safeParse(await raw());
    expect(r.success).toBe(true);
    if (!r.success || r.data.mode !== 'code') return;
    const iv = r.data.interview!;
    expect(iv.pool).toHaveLength(2);
    expect(iv.rebuild_of).toBeUndefined();
    expect(iv.hint_xp_cost).toBe(20);
    expect(iv.pool![0]!.questions[0]!.correct).toEqual(['refills-one']); // normalised like any quiz
    expect(interviewBlankStart(iv)).toBe(true);
    expect(r.data.verify).toEqual([]);
    expect(r.data.solutions).toBeUndefined();
  });

  it('blank_start can be turned off for a pool, and defaults to false for rebuild_of', () => {
    expect(interviewBlankStart({ pool: [], blank_start: false })).toBe(false);
    expect(interviewBlankStart({ rebuild_of: undefined, pool: undefined } as never)).toBe(false);
    expect(interviewBlankStart({ pool: undefined, blank_start: true })).toBe(true);
  });

  it('rejects rebuild_of together with pool, and neither', async () => {
    const both = await raw();
    both.interview.rebuild_of = 'example-code-01-cache-aside';
    expect(errorsOf(both)).toEqual(['interview.pool: use either rebuild_of or pool, not both']);
    const neither = await raw();
    delete neither.interview.pool;
    expect(errorsOf(neither)).toEqual([
      'interview: needs rebuild_of (one level) or pool (a list of levels to draw from)',
    ]);
  });

  it('wants 2 to 12 entries and each rebuild_of once', async () => {
    const one = await raw();
    one.interview.pool = one.interview.pool.slice(0, 1);
    expect(errorsOf(one)).toEqual(['interview.pool: a pool needs at least 2 entries']);
    const many = await raw();
    many.interview.pool = Array.from({ length: 13 }, (_, i) => ({
      ...clone(many.interview.pool[0]),
      rebuild_of: `example-code-0${(i % 9) + 1}-x${i}`,
    }));
    expect(errorsOf(many)).toEqual(['interview.pool: a pool has at most 12 entries']);
    const twelve = await raw();
    twelve.interview.pool = Array.from({ length: 12 }, (_, i) => ({
      ...clone(twelve.interview.pool[0]),
      rebuild_of: `example-code-0${(i % 9) + 1}-x${i}`,
    }));
    expect(errorsOf(twelve)).toEqual([]);
    const dup = await raw();
    dup.interview.pool[1].rebuild_of = dup.interview.pool[0].rebuild_of;
    expect(errorsOf(dup)).toEqual([
      'interview.pool.1.rebuild_of: example-code-01-cache-aside is already in this pool',
    ]);
  });

  it('wants 1 to 5 questions per entry, with option ids unique inside the entry', async () => {
    const none = await raw();
    none.interview.pool[0].questions = [];
    expect(errorsOf(none)).toEqual([
      'interview.pool.0.questions: a pool entry needs at least one follow-up question',
    ]);
    const six = await raw();
    const q = six.interview.pool[0].questions[0];
    six.interview.pool[0].questions = Array.from({ length: 6 }, (_, i) => ({
      ...clone(q),
      options: q.options.map((o: any) => ({ ...o, id: `${o.id}-${i}` })),
      correct: `${q.correct}-${i}`,
    }));
    expect(errorsOf(six)).toEqual([
      'interview.pool.0.questions: a pool entry has at most 5 follow-up questions',
    ]);
    const clash = await raw();
    clash.interview.pool[0].questions.push(clone(clash.interview.pool[0].questions[0]));
    const msgs = errorsOf(clash);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatch(
      /^interview\.pool\.0\.questions\.1\.options\.0\.id: option id refills-one is used by another question/,
    );
  });

  it('a follow-up question is a normal quiz: a correct id must be one of its options', async () => {
    const d = await raw();
    d.interview.pool[0].questions[0].correct = 'nope';
    expect(errorsOf(d)).toEqual([
      "interview.pool.0.questions.0.correct: nope is not one of this quiz's option ids",
    ]);
  });

  it('a pool level has no verify and no solutions of its own', async () => {
    const withVerify = await raw();
    withVerify.verify = [{ type: 'quiz', question: 'q', options: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }], correct: 'a', explanation: 'e' }];
    expect(errorsOf(withVerify)).toEqual([
      'verify: a pool level has no verify of its own (its checks come from the drawn level); remove it',
    ]);
    const withSolutions = await raw();
    withSolutions.solutions = { reference: 'solutions/a.js', wrong: [{ path: 'solutions/b.js', expect: 'wrong', because: 'b' }] };
    expect(errorsOf(withSolutions)).toEqual([
      'solutions: a pool level has no solutions of its own (the drawn level has them); remove it',
    ]);
    const emptyVerify = await raw();
    emptyVerify.verify = [];
    expect(errorsOf(emptyVerify)).toEqual([]);
  });

  it('every other code level still needs verify (with a behavior or traffic check) and solutions', async () => {
    const data = parse(
      await readFile(join(EXAMPLES, 'example-code', '01-cache-aside.yaml'), 'utf8'),
    ) as Record<string, any>;
    expect(errorsOf(data)).toEqual([]);
    const noVerify = clone(data);
    delete noVerify.verify;
    expect(errorsOf(noVerify)).toEqual(['verify: a level needs at least one verifier']);
    const emptyVerify = clone(data);
    emptyVerify.verify = [];
    expect(errorsOf(emptyVerify)).toEqual(['verify: a level needs at least one verifier']);
    const noSolutions = clone(data);
    delete noSolutions.solutions;
    expect(errorsOf(noSolutions)).toEqual(['solutions: required']);
    const interviewNoVerify = await raw();
    interviewNoVerify.interview = { minutes: 10, rebuild_of: 'example-code-01-cache-aside' };
    expect(errorsOf(interviewNoVerify)).toEqual(['verify: a level needs at least one verifier']);
  });
});

describe('interview.pool across chapters', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'e04-pool-'));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function tree(name: string, edit?: (dir: string) => Promise<void>): Promise<string> {
    const dir = join(root, name);
    await cp(join(EXAMPLES, 'example-code'), join(dir, 'example-code'), { recursive: true });
    await cp(join(EXAMPLES, 'example-decision'), join(dir, 'example-decision'), { recursive: true });
    await cp(SCRATCH, join(dir, 'scratch-e04'), { recursive: true });
    if (edit) await edit(dir);
    return dir;
  }
  const editPool = (replace: [string, string][]) => async (dir: string) => {
    const f = join(dir, 'scratch-e04', '01-mock-one.yaml');
    let text = await readFile(f, 'utf8');
    for (const [a, b] of replace) text = text.replace(a, b);
    await writeFile(f, text);
  };

  it('accepts the scratch chapter next to the chapter it draws from', async () => {
    const dir = await tree('ok');
    const r = await loadAllLevels(dir);
    expect(r.errors).toEqual([]);
    expect(r.chapters.map((c) => c.id)).toEqual(['example-code', 'example-decision', 'scratch-e04']);
    expect(await validateLevels(dir)).toEqual([]);
  });

  it('rejects a pool entry that names no level, with the position of that entry', async () => {
    const dir = await tree(
      'missing',
      editPool([['rebuild_of: example-code-02-token-bucket', 'rebuild_of: example-code-09-nothing']]),
    );
    const errs = (await loadAllLevels(dir)).errors.filter((e) => e.path.startsWith('interview.pool'));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ path: 'interview.pool[1].rebuild_of', line: 23 });
    expect(errs[0]!.message).toMatch(/example-code-09-nothing is not a level that was loaded/);
  });

  it('rejects a pool entry in a later chapter or later in the same chapter', async () => {
    const later = await tree(
      'later',
      editPool([['rebuild_of: example-code-02-token-bucket', 'rebuild_of: scratch-e04-03-write-story']]),
    );
    expect((await loadAllLevels(later)).errors.map((e) => e.message).join('\n')).toMatch(
      /scratch-e04-03-write-story comes after this level in its chapter/,
    );
  });

  it('rejects a pool entry that is not a code level, or is itself a pool level', async () => {
    const dec = await tree(
      'decision',
      editPool([['rebuild_of: example-code-02-token-bucket', 'rebuild_of: example-decision-01-pick-the-structure']]),
    );
    expect((await loadAllLevels(dec)).errors.map((e) => e.message).join('\n')).toMatch(
      /example-decision-01-pick-the-structure is a decision level; a pool entry must name a code level/,
    );
    const nested = await tree('nested', async (dir) => {
      // level 02 draws from level 01, which is a pool level
      const f = join(dir, 'scratch-e04', '02-mock-two.yaml');
      await writeFile(
        f,
        (await readFile(f, 'utf8')).replace(
          'rebuild_of: example-code-02-token-bucket',
          'rebuild_of: scratch-e04-01-mock-one',
        ),
      );
    });
    expect((await loadAllLevels(nested)).errors.map((e) => e.message).join('\n')).toMatch(
      /scratch-e04-01-mock-one is itself a pool level/,
    );
  });

  it('a rebuild_of level next to the pool is unchanged (blank_start defaults to false)', async () => {
    const dir = await tree('rebuild', async (d) => {
      await cp(join(EXAMPLES, 'example-interview'), join(d, 'example-interview'), { recursive: true });
    });
    const r = await loadAllLevels(dir);
    expect(r.errors).toEqual([]);
    const lv = r.chapters.find((c) => c.id === 'example-interview')!.levels[0]!.level;
    expect(lv.mode === 'code' && interviewBlankStart(lv.interview!)).toBe(false);
  });
});
