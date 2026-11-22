import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';
import { compileDraft, loadAllLevels, loadCommunity, loadCommunityPack, splitCommandLine, type StudioDraft } from '../index.js';

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
const COMMUNITY = join(REPO, 'levels', 'community');
const temp: string[] = [];
afterAll(async () => {
  await Promise.all(temp.map((d) => rm(d, { recursive: true, force: true })));
});

async function copyOfHouse(): Promise<{ root: string; pack: string }> {
  const root = await mkdtemp(join(tmpdir(), 'quest-community-'));
  temp.push(root);
  await cp(join(COMMUNITY, 'house'), join(root, 'house'), { recursive: true });
  return { root, pack: join(root, 'house') };
}

describe('community packs', () => {
  test('the sample pack by the house loads clean and is credited', async () => {
    const packs = await loadCommunity(COMMUNITY);
    const house = packs.find((p) => p.id === 'house');
    expect(house?.errors).toEqual([]);
    const levels = house?.chapter?.levels ?? [];
    expect(levels.map((l) => l.level.id)).toEqual(['house-01-canteen-tokens']);
    expect(levels[0]?.level.author?.name).toBe('The house');
  });

  test('the campaign loader never sees community packs', async () => {
    const all = await loadAllLevels(join(REPO, 'levels'));
    expect(all.chapters.some((c) => c.id === 'house')).toBe(false);
  });

  test('a missing community directory is no packs, not an error', async () => {
    expect(await loadCommunity(join(tmpdir(), 'quest-no-such-community-dir'))).toEqual([]);
  });

  test('a level without an author is listed with an error and left out of the pack', async () => {
    const { pack } = await copyOfHouse();
    const file = join(pack, '01-canteen-tokens.yaml');
    const text = (await readFile(file, 'utf8')).replace(/author:\n {2}name: "The house"\n/, '');
    await writeFile(file, text);
    const r = await loadCommunityPack(pack);
    expect(r.errors.map((e) => e.message).join('\n')).toMatch(/needs an author/);
    expect(r.chapter?.levels).toEqual([]);
    expect(r.brokenFiles).toEqual(['01-canteen-tokens.yaml']);
  });

  test('a broken pack does not hide a good one', async () => {
    const { root, pack } = await copyOfHouse();
    await cp(pack, join(root, 'zzz-broken'), { recursive: true });
    await writeFile(join(root, 'zzz-broken', '01-canteen-tokens.yaml'), 'id: [unclosed');
    const packs = await loadCommunity(root);
    expect(packs.map((p) => p.id)).toEqual(['house', 'zzz-broken']);
    expect(packs[0]?.errors).toEqual([]);
    expect(packs[1]?.errors.length).toBeGreaterThan(0);
  });

  test('a pack named like a campaign chapter is refused', async () => {
    const { root, pack } = await copyOfHouse();
    await cp(pack, join(root, 'ch1'), { recursive: true });
    const r = await loadCommunityPack(join(root, 'ch1'));
    expect(r.errors.map((e) => e.message).join('\n')).toMatch(/campaign chapter id/);
  });

  test('a solution script that runs CONFIG is refused', async () => {
    const { pack } = await copyOfHouse();
    await writeFile(join(pack, 'solutions', '01-reference.redis'), 'CONFIG SET maxmemory 1\n');
    const r = await loadCommunityPack(pack);
    expect(r.errors.map((e) => e.message).join('\n')).toMatch(/CONFIG/);
  });

  test('splitCommandLine reads quotes and skips comments', () => {
    expect(splitCommandLine('# note\nSET k "a b"\n\nINCR n\n')).toEqual([
      ['SET', 'k', 'a b'],
      ['INCR', 'n'],
    ]);
  });
});

function cliDraft(): StudioDraft {
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
    task: 'Increment `c:n` twice.',
    setup: 'DEL c:n c:copy',
    hints: ['INCR takes the key.'],
    checks: [
      { kind: 'string_equals', key: 'c:n', value: '2', message: 'Should be 2.' },
      { kind: 'not_exists', key: 'c:copy', antipattern: true, message: 'No copy.' },
    ],
    quizzes: [],
    reference: 'INCR c:n\nINCR c:n\n',
    wrong: [
      { script: 'INCR c:n\n', expect: 'wrong', because: 'Only once.' },
      { script: 'INCR c:n\nINCR c:n\nSET c:copy 2\n', expect: 'works_but_wrong', because: 'A copy.' },
    ],
    author: { name: 'Asha', github: '@asha' },
  };
}

describe('studio drafts compile to files the real loader accepts', () => {
  async function load(d: StudioDraft) {
    const c = compileDraft(d);
    expect(c.problems).toEqual([]);
    const root = await mkdtemp(join(tmpdir(), 'quest-draft-'));
    temp.push(root);
    for (const f of c.files) {
      const rel = f.path.replace(/^levels\/community\//, '');
      const abs = join(root, rel);
      await (await import('node:fs/promises')).mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, f.content);
    }
    return { c, pack: await loadCommunityPack(join(root, 'mine')) };
  }

  test('a cli draft', async () => {
    const { c, pack } = await load(cliDraft());
    expect(c.id).toBe('mine-01-a-counter');
    expect(c.files.map((f) => f.path)).toEqual([
      'levels/community/mine/chapter.yaml',
      'levels/community/mine/01-a-counter.yaml',
      'levels/community/mine/solutions/01-reference.redis',
      'levels/community/mine/solutions/01-wrong-1.redis',
      'levels/community/mine/solutions/01-works-but-wrong-2.redis',
    ]);
    expect(pack.errors).toEqual([]);
    expect(pack.chapter?.levels[0]?.level.author).toEqual({ name: 'Asha', github: 'asha' });
  });

  test('a decision draft', async () => {
    const d: StudioDraft = {
      ...cliDraft(),
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
    const { c, pack } = await load(d);
    expect(c.files.map((f) => f.path)).toEqual(['levels/community/mine/chapter.yaml', 'levels/community/mine/01-a-counter.yaml']);
    expect(pack.errors).toEqual([]);
  });

  test('a draft without checks is reported by the validator, a bad check kind by the compiler', () => {
    const d = cliDraft();
    d.checks = [{ kind: 'nonsense', key: 'x' }];
    expect(compileDraft(d).problems[0]?.path).toBe('checks[0].kind');
    d.checks = [{ kind: 'type_is', key: '' }];
    expect(compileDraft(d).problems[0]?.path).toBe('checks[0].key');
  });

  test('a bad pack name or slug stops the compile', () => {
    const d = cliDraft();
    d.pack = 'Not Kebab';
    expect(compileDraft(d).problems[0]?.path).toBe('pack');
  });
});
