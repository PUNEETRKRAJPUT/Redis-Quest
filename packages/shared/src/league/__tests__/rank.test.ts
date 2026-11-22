import { describe, expect, test } from 'vitest';
import { compareScores, rankAttempt, rankBoard, sortBoard } from '../rank.js';

const row = (handle: string, commands: number, bytes = 100, chars = 20) => ({
  handle,
  commands,
  bytes,
  chars,
});

describe('ordering', () => {
  test('commands, then bytes, then characters, lowest first', () => {
    expect(compareScores(row('a', 1), row('b', 2))).toBeLessThan(0);
    expect(compareScores(row('a', 2, 90), row('b', 2, 100))).toBeLessThan(0);
    expect(compareScores(row('a', 2, 100, 10), row('b', 2, 100, 11))).toBeLessThan(0);
    expect(compareScores(row('a', 2), row('b', 2))).toBe(0);
  });

  test('ties are listed by handle and share a rank', () => {
    const board = rankBoard([row('zed', 2), row('amy', 2), row('bob', 1), row('cy', 3)]);
    expect(board.map((r) => [r.handle, r.rank])).toEqual([
      ['bob', 1],
      ['amy', 2],
      ['zed', 2],
      ['cy', 4],
    ]);
    expect(sortBoard([row('b', 1), row('A', 1)]).map((r) => r.handle)).toEqual(['A', 'b']);
  });
});

describe('rankAttempt', () => {
  const board = [row('bob', 1), row('amy', 2), row('cy', 4)];
  test('position among the committed entries', () => {
    expect(rankAttempt(row('x', 3), board)).toMatchObject({ position: 3, of: 4, tiedWith: [] });
    expect(rankAttempt(row('x', 1, 50), board).position).toBe(1);
    expect(rankAttempt(row('x', 5), board).position).toBe(4);
  });
  test('an equal score ties with the entry it equals', () => {
    const r = rankAttempt(row('x', 2), board);
    expect(r.position).toBe(2);
    expect(r.tiedWith).toEqual(['amy']);
    expect(r.best?.handle).toBe('bob');
  });
  test('an empty board puts the attempt first', () => {
    expect(rankAttempt(row('x', 9), [])).toEqual({ position: 1, of: 1, tiedWith: [] });
  });
});
