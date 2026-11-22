import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { formatLevelError } from '../../levels/source.js';
import { loadLeague, parseHole } from '../loader.js';

const GOOD = `title: Stock the shelves
task: Put five things on the shelf.
par: 5
checks:
  - cmd: [GET, stock:a]
    equals: apples
`;

const temps: string[] = [];
afterAll(async () => {
  await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
});

async function tree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'quest-golf-'));
  temps.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, text);
  }
  return root;
}

describe('parseHole', () => {
  test('a good hole parses; YAML numbers become strings in commands', () => {
    const r = parseHole('h.yaml', `${GOOD}setup:\n  - cmd: [EXPIRE, a, 60]\n`);
    expect(r.errors).toEqual([]);
    expect(r.hole?.setup?.[0]?.cmd).toEqual(['EXPIRE', 'a', '60']);
    expect(r.hole?.par).toBe(5);
  });

  test('an unknown key is reported at the key', () => {
    const r = parseHole('h.yaml', GOOD.replace('par: 5', 'par: 5\nparr: 4'));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ line: 4, col: 1, path: 'parr' });
  });

  test('par must be a positive integer', () => {
    expect(parseHole('h.yaml', GOOD.replace('par: 5', 'par: 0')).errors[0]?.path).toBe('par');
    expect(parseHole('h.yaml', GOOD.replace('par: 5', 'par: 2.5')).errors[0]?.path).toBe('par');
  });

  test('a check needs exactly one assertion and may not write', () => {
    const none = parseHole('h.yaml', GOOD.replace('    equals: apples\n', ''));
    expect(none.errors[0]?.message).toMatch(/exactly one assertion/);
    const write = parseHole('h.yaml', GOOD.replace('[GET, stock:a]', '[SET, stock:a, x]'));
    expect(write.errors[0]?.message).toMatch(/read-only allowlist/);
    const allow = parseHole(
      'h.yaml',
      GOOD.replace('equals: apples', 'equals: apples\n    allowWrite: true\n    reason: because'),
    );
    expect(allow.errors.map((e) => e.message).join('\n')).toMatch(
      /league checks never write|read-only/,
    );
  });

  test('setup may not use a refused command', () => {
    const r = parseHole('h.yaml', `${GOOD}setup:\n  - cmd: [FLUSHALL]\n`);
    expect(r.errors[0]).toMatchObject({ path: 'setup[0].cmd[0]' });
    expect(r.errors[0]?.message).toMatch(/FLUSHALL is not allowed/);
  });

  test('bad YAML is one positioned error', () => {
    const r = parseHole('h.yaml', 'title: [oops\n');
    expect(r.errors[0]?.path).toBe('(yaml)');
  });

  test('a missing required key says required', () => {
    const r = parseHole('h.yaml', GOOD.replace('task: Put five things on the shelf.\n', ''));
    expect(r.errors.map((e) => `${e.path}: ${e.message}`)).toContain('task: required');
  });
});

describe('loadLeague', () => {
  test('loads holes and entries in order', async () => {
    const root = await tree({
      'holes/02-b/hole.yaml': GOOD,
      'holes/01-a/hole.yaml': GOOD,
      'holes/01-a/entries/puneet.redis': '# note\nSET stock:a apples\n',
      'holes/01-a/entries/.gitkeep': '',
    });
    const r = await loadLeague(root);
    expect(r.errors).toEqual([]);
    expect(r.holes.map((h) => h.id)).toEqual(['01-a', '02-b']);
    expect(r.holes[0]?.entries.map((e) => e.handle)).toEqual(['puneet']);
  });

  test('problems come as file:line:col with the repo-relative path', async () => {
    const root = await tree({
      'holes/01-a/hole.yaml': GOOD,
      'holes/01-a/entries/puneet.redis': 'SET stock:a apples\nEVAL "return 1" 0\n',
      'holes/01-a/entries/notes.txt': 'hello',
      'holes/01-a/entries/Amy.redis': 'SET a 1',
      'holes/01-a/entries/amy.redis': 'SET a 1',
    });
    const r = await loadLeague(root);
    const lines = r.errors.map((e) => formatLevelError(e, root));
    expect(
      lines.some((l) =>
        l.startsWith('holes/01-a/entries/puneet.redis:2:1 (root): EVAL is not allowed'),
      ),
    ).toBe(true);
    expect(lines.some((l) => l.includes('notes.txt') && l.includes('<github-handle>.redis'))).toBe(
      true,
    );
    expect(lines.some((l) => l.includes('same GitHub handle'))).toBe(true);
  });

  test('a hole directory without hole.yaml, a badly named one, and a missing golf folder are errors', async () => {
    const root = await tree({
      'holes/01-a/entries/x.redis': 'SET a 1',
      'holes/Bad_Name/hole.yaml': GOOD,
    });
    const r = await loadLeague(root);
    expect(r.errors.map((e) => e.message).join('\n')).toMatch(/hole.yaml is missing/);
    expect(r.errors.map((e) => e.message).join('\n')).toMatch(/<nn>-<slug>/);
    const none = await loadLeague(join(root, 'nope'));
    expect(none.errors[0]?.message).toMatch(/no holes\/ directory/);
  });
});
