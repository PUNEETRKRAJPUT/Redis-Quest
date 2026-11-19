import { describe, expect, test } from 'vitest';
import {
  HISTORY_KEY,
  HISTORY_MAX,
  loadHistory,
  newer,
  older,
  pushHistory,
  saveHistory,
  startWalk,
} from '../src/terminal/history';

describe('history list', () => {
  test('blank lines and an immediate repeat are not kept, the list is capped', () => {
    expect(pushHistory([], '   ')).toEqual([]);
    expect(pushHistory(['GET a'], 'GET a')).toEqual(['GET a']);
    expect(pushHistory(['GET a'], 'GET b')).toEqual(['GET a', 'GET b']);
    expect(pushHistory(['GET a', 'GET b'], 'GET a')).toEqual(['GET a', 'GET b', 'GET a']);
    const long = Array.from({ length: HISTORY_MAX }, (_, i) => `C${i}`);
    const next = pushHistory(long, 'NEW');
    expect(next).toHaveLength(HISTORY_MAX);
    expect(next[next.length - 1]).toBe('NEW');
    expect(next[0]).toBe('C1');
  });
  test('the input list is never mutated', () => {
    const list = ['A'];
    pushHistory(list, 'B');
    expect(list).toEqual(['A']);
  });
});

describe('walking with Up and Down', () => {
  const list = ['one', 'two', 'three'];
  test('Up goes back through the list, stops at the oldest, and Down returns to what was being typed', () => {
    let w = startWalk(list);
    const a = older(list, w, 'half typed');
    expect(a?.text).toBe('three');
    w = a!.walk;
    w = older(list, w, 'three')!.walk;
    const oldest = older(list, w, 'two')!;
    expect(oldest.text).toBe('one');
    expect(older(list, oldest.walk, 'one')).toBeNull();
    let d = newer(list, oldest.walk)!;
    expect(d.text).toBe('two');
    d = newer(list, d.walk)!;
    expect(d.text).toBe('three');
    d = newer(list, d.walk)!;
    expect(d.text).toBe('half typed');
    expect(newer(list, d.walk)).toBeNull();
  });
  test('an empty history has nowhere to go', () => {
    expect(older([], startWalk([]), 'x')).toBeNull();
    expect(newer([], startWalk([]))).toBeNull();
  });
});

describe('session persistence', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  };
  test('round trip', () => {
    const s = memory();
    saveHistory(['PING', 'GET a'], s);
    expect(loadHistory(s)).toEqual(['PING', 'GET a']);
  });
  test('garbage, wrong types and blocked storage give an empty list, never an error', () => {
    const s = memory();
    s.setItem(HISTORY_KEY, '{not json');
    expect(loadHistory(s)).toEqual([]);
    s.setItem(HISTORY_KEY, JSON.stringify({ a: 1 }));
    expect(loadHistory(s)).toEqual([]);
    s.setItem(HISTORY_KEY, JSON.stringify(['ok', 3, '  ', null, 'GET x']));
    expect(loadHistory(s)).toEqual(['ok', 'GET x']);
    const blocked = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadHistory(blocked)).toEqual([]);
    expect(() => saveHistory(['x'], blocked)).not.toThrow();
    expect(loadHistory(null)).toEqual([]);
  });
});
