import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { newProgress, ProgressStore, reconcileLevels, writeFileAtomic } from '../src/progress.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'quest-progress-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const fresh = () => newProgress({ id: 'p-1', name: 'Asha', redisUrl: 'redis://redis:6379', activeSlots: [], now: new Date() });
const IDS = ['a-01-x', 'a-02-y', 'a-03-z'];

describe('atomic writes', () => {
  test('leaves only progress.json, never a temp file', async () => {
    const store = new ProgressStore(dir);
    const p = fresh();
    reconcileLevels(p, IDS);
    await store.create(p);
    await store.update((d) => void (d.xp = 10));
    expect((await readdir(dir)).sort()).toEqual(['progress.json']);
    expect(JSON.parse(await readFile(store.file, 'utf8')).xp).toBe(10);
  });

  test('a failed write keeps the previous file intact', async () => {
    const file = join(dir, 'f.json');
    await writeFileAtomic(file, 'old');
    // a directory where the temp name would be forces a failure in rename-less path: write into a missing parent file path
    await expect(writeFileAtomic(join(file, 'nested.json'), 'new')).rejects.toBeTruthy();
    expect(await readFile(file, 'utf8')).toBe('old');
  });

  test('concurrent updates are serialised, none lost', async () => {
    const store = new ProgressStore(dir);
    const p = fresh();
    reconcileLevels(p, IDS);
    await store.create(p);
    await Promise.all(Array.from({ length: 25 }, () => store.update((d) => void (d.xp += 1))));
    expect(store.current?.xp).toBe(25);
    expect(JSON.parse(await readFile(store.file, 'utf8')).xp).toBe(25);
  });

  test('stale temp files from a crash are removed on load', async () => {
    await writeFile(join(dir, 'progress.json.123.abcd.tmp'), 'half');
    const store = new ProgressStore(dir);
    expect((await store.load()).kind).toBe('missing');
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('load and restore', () => {
  test('reloadFromDisk replaces the in-memory copy with the file', async () => {
    const store = new ProgressStore(dir);
    const p = fresh();
    reconcileLevels(p, IDS);
    await store.create(p);
    const onDisk = { ...p, xp: 99 };
    await writeFile(store.file, JSON.stringify(onDisk));
    const r = await store.reloadFromDisk();
    expect(r.kind).toBe('ok');
    expect(store.current?.xp).toBe(99);
  });

  test('invalid files are reported, not parsed as a new game', async () => {
    const store = new ProgressStore(dir);
    await writeFile(store.file, '{not json');
    expect((await store.load()).kind).toBe('invalid');
    await writeFile(store.file, JSON.stringify({ version: 2 }));
    expect((await store.load()).kind).toBe('invalid');
    expect(store.current).toBeNull();
  });
});

describe('reconcileLevels', () => {
  test('first level available, rest locked; passing unlocks the next', () => {
    const p = fresh();
    expect(reconcileLevels(p, IDS)).toBe(true);
    expect(IDS.map((i) => p.levels[i]?.status)).toEqual(['available', 'locked', 'locked']);
    (p.levels['a-01-x'] as { status: string }).status = 'passed';
    reconcileLevels(p, IDS);
    expect(IDS.map((i) => p.levels[i]?.status)).toEqual(['passed', 'available', 'locked']);
    expect(reconcileLevels(p, IDS)).toBe(false);
  });

  test('new content is added without touching existing entries', () => {
    const p = fresh();
    reconcileLevels(p, IDS.slice(0, 2));
    (p.levels['a-01-x'] as { status: string }).status = 'passed';
    reconcileLevels(p, IDS);
    expect(p.levels['a-03-z']?.status).toBe('locked');
    expect(p.levels['a-01-x']?.status).toBe('passed');
  });
});
