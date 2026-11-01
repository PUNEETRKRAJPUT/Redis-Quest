import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadAllLevels, validateLevels } from '../loader.js';
import { levelFileSchema } from '../schema.js';
import { formatLevelError } from '../source.js';

const EXAMPLES = fileURLToPath(new URL('../../../../../levels/_examples', import.meta.url));
const INTERVIEW_FILE = join(EXAMPLES, 'example-interview', '01-cache-aside-rebuild.yaml');

async function raw(): Promise<Record<string, unknown>> {
  return parse(await readFile(INTERVIEW_FILE, 'utf8')) as Record<string, unknown>;
}

describe('interview (F-12) schema', () => {
  it('accepts the example interview level and defaults the hint cost', async () => {
    const data = await raw();
    const r = levelFileSchema.safeParse(data);
    expect(r.success).toBe(true);
    if (!r.success || r.data.mode !== 'code') return;
    expect(r.data.interview).toEqual({
      minutes: 10,
      rebuild_of: 'example-code-01-cache-aside',
      hint_xp_cost: 10,
    });
    const noCost = {
      ...data,
      interview: { minutes: 20, rebuild_of: 'example-code-01-cache-aside' },
    };
    const r2 = levelFileSchema.safeParse(noCost);
    expect(r2.success && r2.data.mode === 'code' && r2.data.interview?.hint_xp_cost).toBe(10);
  });

  it.each([4, 61, 0, 10.5, '10'])('rejects minutes = %s', async (minutes) => {
    const data = await raw();
    const r = levelFileSchema.safeParse({
      ...data,
      interview: { minutes, rebuild_of: 'example-code-01-cache-aside' },
    });
    expect(r.success).toBe(false);
  });

  it('accepts the limits 5 and 60', async () => {
    const data = await raw();
    for (const minutes of [5, 60]) {
      expect(
        levelFileSchema.safeParse({
          ...data,
          interview: { minutes, rebuild_of: 'example-code-01-cache-aside' },
        }).success,
      ).toBe(true);
    }
  });

  it('rejects a malformed rebuild_of, a negative cost and unknown keys', async () => {
    const data = await raw();
    const base = { minutes: 10, rebuild_of: 'example-code-01-cache-aside' };
    expect(
      levelFileSchema.safeParse({ ...data, interview: { ...base, rebuild_of: 'Cache Aside' } })
        .success,
    ).toBe(false);
    expect(
      levelFileSchema.safeParse({ ...data, interview: { ...base, hint_xp_cost: -1 } }).success,
    ).toBe(false);
    expect(
      levelFileSchema.safeParse({ ...data, interview: { ...base, timer: true } }).success,
    ).toBe(false);
  });

  it('makes teach optional only when interview is set', async () => {
    const data = await raw();
    expect('teach' in data).toBe(false);
    const without = { ...data };
    delete without.interview;
    const r = levelFileSchema.safeParse(without);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === 'teach')).toBe(true);
  });

  it('only a code level can be an interview', async () => {
    const data = await raw();
    const r = levelFileSchema.safeParse({
      ...data,
      mode: 'cli',
      teach: 'x',
      solutions: {
        reference: 'solutions/a.redis',
        wrong: [{ path: 'solutions/b.redis', expect: 'wrong', because: 'b' }],
      },
    });
    expect(r.success).toBe(false);
  });
});

describe('interview (F-12) rebuild_of across chapters', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'f12-'));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function tree(name: string, edit?: (yaml: string) => string): Promise<string> {
    const dir = join(root, name);
    await cp(join(EXAMPLES, 'example-code'), join(dir, 'example-code'), { recursive: true });
    await cp(join(EXAMPLES, 'example-interview'), join(dir, 'example-interview'), {
      recursive: true,
    });
    if (edit) {
      const f = join(dir, 'example-interview', '01-cache-aside-rebuild.yaml');
      await writeFile(f, edit(await readFile(f, 'utf8')));
    }
    return dir;
  }

  it('is valid when the target is in an earlier chapter', async () => {
    const r = await loadAllLevels(await tree('ok'));
    expect(r.errors).toEqual([]);
    expect(r.chapters.map((c) => c.id)).toEqual(['example-code', 'example-interview']);
  });

  it('rejects a rebuild_of that names no level, with a position', async () => {
    const dir = await tree('missing', (y) =>
      y.replace('rebuild_of: example-code-01-cache-aside', 'rebuild_of: example-code-09-nothing'),
    );
    const r = await loadAllLevels(dir);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.path).toBe('interview.rebuild_of');
    expect(r.errors[0]?.line).toBe(10);
    expect(formatLevelError(r.errors[0]!, dir)).toMatch(
      /example-interview\/01-cache-aside-rebuild\.yaml:10:\d+ interview\.rebuild_of: example-code-09-nothing is not a level/,
    );
  });

  it('rejects a rebuild_of that names itself', async () => {
    const dir = await tree('self', (y) =>
      y.replace(
        'rebuild_of: example-code-01-cache-aside',
        'rebuild_of: example-interview-01-cache-aside-rebuild',
      ),
    );
    const r = await loadAllLevels(dir);
    expect(r.errors.map((e) => e.message).join('\n')).toMatch(
      /comes after this level in its chapter/,
    );
  });

  it('rejects a rebuild_of in a later chapter', async () => {
    // example-code sorts before example-interview, so point the example-code chapter's check the other way round
    // by giving it an interview level that rebuilds the interview level.
    const dir = await tree('later');
    const f = join(dir, 'example-code', '03-late.yaml');
    const src = (
      await readFile(join(dir, 'example-interview', '01-cache-aside-rebuild.yaml'), 'utf8')
    )
      .replace('id: example-interview-01-cache-aside-rebuild', 'id: example-code-03-late')
      .replace('chapter: example-interview', 'chapter: example-code')
      .replace(
        'rebuild_of: example-code-01-cache-aside',
        'rebuild_of: example-interview-01-cache-aside-rebuild',
      )
      .replaceAll('solutions/', '../example-interview/solutions/')
      .replace('fixtures/01-cold-cache.yaml', '../example-interview/fixtures/01-cold-cache.yaml');
    await writeFile(f, src);
    const ch = join(dir, 'example-code', 'chapter.yaml');
    await writeFile(ch, `${await readFile(ch, 'utf8')}  - example-code-03-late\n`);
    const r = await loadAllLevels(dir);
    expect(r.errors.map((e) => e.message).join('\n')).toMatch(/in a later chapter/);
  });

  it('validateLevels resolves a reference across the directories it is given', async () => {
    const dir = await tree('union');
    expect(
      await validateLevels([join(dir, 'example-code'), join(dir, 'example-interview')]),
    ).toEqual([]);
    const alone = await validateLevels(join(dir, 'example-interview'));
    expect(alone).toHaveLength(1);
    expect(alone[0]?.message).toMatch(/pass the chapter holding it too/);
  });
});
