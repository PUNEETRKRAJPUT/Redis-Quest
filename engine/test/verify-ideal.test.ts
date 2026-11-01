import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { loadChapter } from '@quest/shared';
import { buildIdeal, idealAccess, solutionComments } from '../src/verify/ideal.js';

const LEVELS = join(dirname(fileURLToPath(import.meta.url)), '../../levels/_examples');
const ctx = (id: string, ch: string) => ({ player: { id: 'p-1', name: 'Asha' }, level: { id }, chapter: { id: ch }, env: {} });

describe('ideal', () => {
  test('access: passed, or 3 attempts', () => {
    expect(idealAccess('passed', 1).allowed).toBe(true);
    expect(idealAccess('in_progress', 3)).toEqual({ allowed: true, reason: 'Shown after 3 attempts (3 so far).' });
    expect(idealAccess('in_progress', 2)).toEqual({ allowed: false, reason: 'Not passed yet, and 2 of 3 attempts used. You can still reveal it.' });
  });
  test('comments per file type', () => {
    expect(solutionComments('a.redis', '# one\nZADD k 1 m\n# two')).toEqual(['one', 'two']);
    expect(solutionComments('a.sh', '#!/usr/bin/env bash\n# why\nset -eu')).toEqual(['why']);
    expect(solutionComments('a.js', '// because\nconst x = 1; // not this')).toEqual(['because']);
  });
  test('cli level: reference rendered with the player, wrong ones with because, reasoning from comments', async () => {
    const r = await loadChapter(join(LEVELS, 'example-cli'));
    const lv = r.chapter!.levels[0]!;
    const i = await buildIdeal(lv, ctx(lv.level.id, 'example-cli'));
    if (i.mode === 'decision') throw new Error('mode');
    expect(i.reference.path).toBe('solutions/01-reference.redis');
    expect(i.reference.content).toContain('ZADD lb:hostel:h-c-02-2 120 user:p-1');
    expect(i.wrong.map((w) => w.expect)).toEqual(['wrong', 'works_but_wrong']);
    expect(i.reasoning).toMatch(/^Reference: one sorted set is the whole scoreboard/);
    expect(i.reasoning).toContain('- solutions/01-wrong-zadd-twice.redis (wrong): The second ZADD replaces');
  });
  test('decision level: correct options and explanations', async () => {
    const r = await loadChapter(join(LEVELS, 'example-decision'));
    const lv = r.chapter!.levels[0]!;
    const i = await buildIdeal(lv, ctx(lv.level.id, 'example-decision'));
    if (i.mode !== 'decision') throw new Error('mode');
    expect(i.reference.options).toEqual(['lb-sorted-set', 'profile-hash', 'streak-bitmap']);
    expect(i.quizzes[0]).toMatchObject({ index: 0, correct: ['lb-sorted-set'] });
    expect(i.wrong).toHaveLength(3);
  });
});
