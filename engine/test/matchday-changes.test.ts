import { describe, expect, test } from 'vitest';
import {
  configValue,
  deleteKeys,
  lowerMaxmemory,
  restoreMaxmemory,
  usedMemory,
  type UndoEntry,
  type UndoJournal,
} from '../src/matchday/changes.js';

class Journal implements UndoJournal {
  entry: UndoEntry | null = null;
  async read() {
    return this.entry;
  }
  async write(e: UndoEntry) {
    this.entry = e;
  }
  async clear() {
    this.entry = null;
  }
}

describe('configValue', () => {
  test('reads a flat array, a Map and an object', () => {
    expect(configValue(['maxmemory', '0'], 'maxmemory')).toBe('0');
    expect(configValue(new Map([['maxmemory', '5']]), 'maxmemory')).toBe('5');
    expect(configValue({ maxmemory: 7 }, 'maxmemory')).toBe('7');
    expect(configValue(['other', '1'], 'maxmemory')).toBeNull();
    expect(configValue(null, 'maxmemory')).toBeNull();
  });
});

describe('usedMemory', () => {
  test('finds used_memory and not used_memory_human', () => {
    expect(
      usedMemory(
        '# Memory\r\nused_memory_human:1M\r\nused_memory:1048576\r\nused_memory_rss:5\r\n',
      ),
    ).toBe(1048576);
    expect(usedMemory('nothing')).toBeNull();
  });
});

describe('deleteKeys', () => {
  test('refuses a prefix that is not a cache prefix, before sending anything', async () => {
    const sent: string[][] = [];
    const redis = { send: async (a: string[]) => void sent.push(a) };
    for (const p of ['game:', 'game:engine:', 'lb:match:', 'cache:*', 'g'])
      await expect(deleteKeys(redis, [p])).rejects.toThrow(/refused/);
    expect(sent).toEqual([]);
  });

  test('follows the cursor until it is 0 and never deletes a game: key', async () => {
    const pages: Array<[string, string[]]> = [
      ['17', ['cache:player:a', 'game:x']],
      ['0', ['cache:player:b']],
    ];
    const sent: string[][] = [];
    const redis = {
      send: async (a: string[]) => {
        sent.push(a);
        if (a[0] === 'SCAN') return pages.shift();
        return a.length - 1;
      },
    };
    const n = await deleteKeys(redis, ['cache:player:']);
    expect(n).toBe(2);
    const deleted = sent.filter((a) => a[0] === 'DEL').flatMap((a) => a.slice(1));
    expect(deleted).toEqual(['cache:player:a', 'cache:player:b']);
  });
});

describe('maxmemory', () => {
  function redisWith(policy: string, maxmemory: string, used = 2_000_000) {
    const state = { policy, maxmemory, sets: [] as string[][] };
    return {
      state,
      send: async (a: string[]) => {
        if (a[0] === 'CONFIG' && a[1] === 'GET')
          return a[2] === 'maxmemory-policy' ? [a[2], state.policy] : [a[2], state.maxmemory];
        if (a[0] === 'CONFIG' && a[1] === 'SET') {
          state.sets.push(a);
          state.maxmemory = String(a[3]);
          return 'OK';
        }
        if (a[0] === 'INFO') return `used_memory:${used}\r\n`;
        throw new Error('unexpected');
      },
    };
  }
  const now = () => '2026-11-20T00:00:00.000Z';

  test('lowers it above what is in use, journals the old value, and restores it', async () => {
    const r = redisWith('noeviction', '0');
    const j = new Journal();
    const res = await lowerMaxmemory(r, j, 256, now);
    expect(res.applied).toBe(true);
    expect(r.state.maxmemory).toBe(String(2_000_000 + 256 * 1024));
    expect(j.entry?.maxmemory).toBe('0');
    expect(await restoreMaxmemory(r, j)).toBe(true);
    expect(r.state.maxmemory).toBe('0');
    expect(j.entry).toBeNull();
  });

  test('leaves an eviction policy alone', async () => {
    const r = redisWith('allkeys-lru', '0');
    const j = new Journal();
    const res = await lowerMaxmemory(r, j, 256, now);
    expect(res.applied).toBe(false);
    expect(r.state.sets).toEqual([]);
    expect(j.entry).toBeNull();
  });

  test('does not loosen a limit the player already set tighter', async () => {
    const r = redisWith('noeviction', '1000000');
    const j = new Journal();
    expect((await lowerMaxmemory(r, j, 256, now)).applied).toBe(false);
    expect(r.state.maxmemory).toBe('1000000');
  });

  test('restore without a journal does nothing', async () => {
    const r = redisWith('noeviction', '5');
    expect(await restoreMaxmemory(r, new Journal())).toBe(false);
    expect(r.state.sets).toEqual([]);
  });
});
