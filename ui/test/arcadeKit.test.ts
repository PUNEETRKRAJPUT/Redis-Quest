import { describe, expect, it } from 'vitest';
import { bestKey, readBest, recordScore, type StorageLike } from '@/features/arcade/kit/best';
import { advanceClock } from '@/features/arcade/kit/loop';
import {
  drawInt,
  drawWeighted,
  freshSeed,
  nextRandom,
  seedState,
} from '@/features/arcade/kit/random';

function memoryStorage(
  initial: Record<string, string> = {},
): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const brokenStorage: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('seeded random source', () => {
  it('gives the same sequence for the same seed', () => {
    const run = (seed: number) => {
      let s = seedState(seed);
      const out: number[] = [];
      for (let i = 0; i < 20; i++) {
        const d = nextRandom(s);
        out.push(d.value);
        s = d.state;
      }
      return out;
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it('stays in [0, 1)', () => {
    let s = seedState(7);
    for (let i = 0; i < 2000; i++) {
      const d = nextRandom(s);
      expect(d.value).toBeGreaterThanOrEqual(0);
      expect(d.value).toBeLessThan(1);
      s = d.state;
    }
  });

  it('draws whole numbers inside the closed range, and covers both ends', () => {
    let s = seedState(1);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const d = drawInt(s, 3, 6);
      expect(Number.isInteger(d.value)).toBe(true);
      seen.add(d.value);
      s = d.state;
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
    expect(drawInt(5, 9, 9).value).toBe(9);
  });

  it('chooses in proportion to the weights and never picks a zero weight', () => {
    let s = seedState(99);
    const counts = [0, 0, 0];
    for (let i = 0; i < 3000; i++) {
      const d = drawWeighted(s, [1, 0, 3]);
      counts[d.value] = (counts[d.value] ?? 0) + 1;
      s = d.state;
    }
    expect(counts[1]).toBe(0);
    expect((counts[2] ?? 0) / (counts[0] ?? 1)).toBeGreaterThan(2);
    expect((counts[2] ?? 0) / (counts[0] ?? 1)).toBeLessThan(4);
    expect(drawWeighted(1, [0, 0]).value).toBe(0);
  });

  it('turns any number into a valid state', () => {
    expect(seedState(-1)).toBe(0xffffffff);
    expect(seedState(1.9)).toBe(1);
    expect(seedState(Number.NaN)).toBe(0);
  });

  it('replays a run from ?seed= and ignores junk', () => {
    expect(freshSeed('?seed=12345', 1)).toBe(12345);
    expect(freshSeed('?seed=abc', 1_000_000)).toBeTypeOf('number');
    expect(freshSeed('', 5)).toBeGreaterThanOrEqual(0);
  });
});

describe('fixed-step clock', () => {
  it('runs whole steps and carries the remainder', () => {
    const a = advanceClock(0, 250, 100);
    expect(a).toEqual({ steps: 2, accMs: 50 });
    const b = advanceClock(a.accMs, 60, 100);
    expect(b).toEqual({ steps: 1, accMs: 10 });
  });

  it('is the same however the frames are cut', () => {
    let steps = 0;
    let acc = 0;
    for (let i = 0; i < 100; i++) {
      const r = advanceClock(acc, 16, 100);
      steps += r.steps;
      acc = r.accMs;
    }
    expect(steps).toBe(16);
  });

  it('does not fast-forward after a stall', () => {
    const r = advanceClock(0, 60_000, 100);
    expect(r.steps).toBeLessThanOrEqual(5);
    expect(r.accMs).toBeLessThan(100);
  });

  it('ignores negative and non-finite frame times', () => {
    expect(advanceClock(0, -5, 100).steps).toBe(0);
    expect(advanceClock(0, Number.NaN, 100).steps).toBe(0);
  });
});

describe('best-score store', () => {
  it('starts empty and saves the first score above zero', () => {
    const st = memoryStorage();
    expect(readBest('be-the-redis', st)).toBeNull();
    expect(recordScore('be-the-redis', 0, st)).toEqual({ best: 0, isNew: false });
    expect(st.data.size).toBe(0);
    expect(recordScore('be-the-redis', 12, st)).toEqual({ best: 12, isNew: true });
    expect(st.data.get(bestKey('be-the-redis'))).toBe('12');
  });

  it('keeps the higher score', () => {
    const st = memoryStorage();
    recordScore('c', 30, st);
    expect(recordScore('c', 20, st)).toEqual({ best: 30, isNew: false });
    expect(recordScore('c', 30, st)).toEqual({ best: 30, isNew: false });
    expect(recordScore('c', 31, st)).toEqual({ best: 31, isNew: true });
  });

  it('keeps cabinets apart', () => {
    const st = memoryStorage();
    recordScore('a', 5, st);
    expect(readBest('b', st)).toBeNull();
  });

  it('ignores garbage in storage', () => {
    expect(readBest('c', memoryStorage({ [bestKey('c')]: 'lots' }))).toBeNull();
    expect(readBest('c', memoryStorage({ [bestKey('c')]: '-4' }))).toBeNull();
    expect(readBest('c', memoryStorage({ [bestKey('c')]: '17' }))).toBe(17);
  });

  it('works when storage is blocked or missing', () => {
    expect(readBest('c', brokenStorage)).toBeNull();
    expect(recordScore('c', 9, brokenStorage)).toEqual({ best: 9, isNew: true });
    expect(readBest('c', null)).toBeNull();
    expect(recordScore('c', 9, null)).toEqual({ best: 9, isNew: true });
  });
});
