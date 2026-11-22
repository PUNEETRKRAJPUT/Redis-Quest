import { describe, expect, test } from 'vitest';
import { parseEntry, type ParsedEntry } from '../entry.js';
import { parseHole } from '../loader.js';
import { keysNamedBy, scoreEntry, type HoleRef } from '../score.js';
import { fakeRedis } from './fake-redis.js';

// The last check reads `leftover`, a key no setup step and no entry writes: it holds only because the scorer empties
// the database first (one test plants it beforehand). It must not be the key the setup makes (`stale`), which is
// still there when the checks run: the first CI run of this file failed on exactly that.
const HOLE_YAML = `
title: Stock the shelves
task: Put apples in stock:a and pears in stock:b.
par: 2
setup:
  - cmd: [SET, stale, old]
checks:
  - cmd: [GET, stock:a]
    equals: apples
  - cmd: [GET, stock:b]
    equals: pears
    message: stock:b must hold pears
  - cmd: [GET, leftover]
    equals: null
`;

function hole(): HoleRef {
  const r = parseHole('/golf/holes/01-x/hole.yaml', HOLE_YAML);
  expect(r.errors).toEqual([]);
  return { id: '01-x', hole: r.hole! };
}

function entry(text: string, handle = 'amy'): ParsedEntry {
  const r = parseEntry(handle, text);
  expect(r.errors).toEqual([]);
  return r.entry!;
}

describe('scoreEntry', () => {
  test('the number of commands is the score, with par next to it', async () => {
    const redis = fakeRedis();
    const r = await scoreEntry(hole(), entry('SET stock:a apples\nSET stock:b pears'), redis.run);
    expect(r).toMatchObject({
      ok: true,
      commands: 2,
      par: 2,
      underPar: 0,
      handle: 'amy',
      holeId: '01-x',
    });
  });

  test('a shorter entry beats par', async () => {
    const r = await scoreEntry(hole(), entry('MSET stock:a apples stock:b pears'), fakeRedis().run);
    expect(r).toMatchObject({ ok: true, commands: 1, underPar: 1 });
  });

  test('bytes are the memory the keys named by the checks use; keys the checks do not name do not count', async () => {
    const plain = await scoreEntry(
      hole(),
      entry('MSET stock:a apples stock:b pears'),
      fakeRedis().run,
    );
    const padded = await scoreEntry(
      hole(),
      entry('MSET stock:a apples stock:b pears junk this-is-not-checked'),
      fakeRedis().run,
    );
    expect(plain.ok && padded.ok).toBe(true);
    if (plain.ok && padded.ok) {
      // fake: 50 + value length per string key: apples (6) and pears (5)
      expect(plain.bytes).toBe(50 + 6 + 50 + 5);
      expect(padded.bytes).toBe(plain.bytes);
      expect(padded.chars).toBeGreaterThan(plain.chars);
    }
  });

  test('a failed check is no score, and says which check', async () => {
    const r = await scoreEntry(
      hole(),
      entry('SET stock:a apples\nSET stock:b plums'),
      fakeRedis().run,
    );
    expect(r).toMatchObject({ ok: false, reason: 'checks_failed' });
    if (!r.ok) {
      expect(r.message).toBe('stock:b must hold pears (expected pears, got plums)');
      expect(r.checks.map((c) => c.ok)).toEqual([true, false, true]);
    }
  });

  test('setup runs before the entry, and the scratch database starts empty', async () => {
    const redis = fakeRedis();
    await redis.run(['SET', 'leftover', 'x']);
    redis.log.length = 0;
    const r = await scoreEntry(hole(), entry('SET stock:a apples\nSET stock:b pears'), redis.run);
    // the check on `leftover` passes only if the database was emptied before the setup ran
    expect(r).toMatchObject({ ok: true });
    const names = redis.log.map((c) => c.join(' '));
    expect(names.slice(0, 3)).toEqual(['CLIENT INFO', 'FLUSHDB', 'SET stale old']);
    // emptied again at the end
    expect(names[names.length - 1]).toBe('FLUSHDB');
  });

  test('a command that Redis answers with an error is no score, with its line', async () => {
    const r = await scoreEntry(hole(), entry('SET stock:a apples\nBOGUS x'), fakeRedis().run);
    expect(r).toMatchObject({ ok: false, reason: 'command_failed', line: 2 });
  });

  test('a connection on database 0, or any other database, is refused before anything runs', async () => {
    for (const db of [0, 3]) {
      const redis = fakeRedis(db);
      const r = await scoreEntry(hole(), entry('SET stock:a apples'), redis.run);
      expect(r).toMatchObject({ ok: false, reason: 'not_scratch' });
      expect(redis.log.map((c) => c[0])).toEqual(['CLIENT']);
    }
  });

  test('scoring on database 0 is refused even when the connection agrees', async () => {
    const redis = fakeRedis(0);
    const r = await scoreEntry(hole(), entry('SET stock:a apples'), redis.run, { scratchDb: 0 });
    expect(r).toMatchObject({ ok: false, reason: 'not_scratch' });
    expect(redis.log).toEqual([]);
  });

  test('a hand-built entry with a refused command never reaches Redis', async () => {
    const redis = fakeRedis();
    const sneaky: ParsedEntry = {
      handle: 'amy',
      chars: 10,
      commands: [{ line: 1, text: 'SELECT 0', argv: ['SELECT', '0'] }],
    };
    const r = await scoreEntry(hole(), sneaky, redis.run);
    expect(r).toMatchObject({ ok: false, reason: 'refused', line: 1 });
    expect(redis.log).toEqual([]);
  });

  test('a runner that cannot answer is reported, not thrown', async () => {
    const r = await scoreEntry(hole(), entry('SET a 1'), async () => {
      throw new Error('connection refused');
    });
    expect(r).toMatchObject({ ok: false, reason: 'runner_failed', message: 'connection refused' });
  });

  test('the same entry scores the same twice', async () => {
    const text = 'SET stock:a apples\nSET stock:b pears';
    const a = await scoreEntry(hole(), entry(text), fakeRedis().run);
    const b = await scoreEntry(hole(), entry(text), fakeRedis().run);
    expect(a).toEqual(b);
  });
});

describe('keysNamedBy', () => {
  test('every argument after the command name, once each', () => {
    expect(
      keysNamedBy([
        { cmd: ['HMGET', 'p', 'name', 'team'] },
        { cmd: ['HLEN', 'p'] },
        { cmd: ['GET', 'name'] },
      ]),
    ).toEqual(['p', 'name', 'team']);
  });
});
