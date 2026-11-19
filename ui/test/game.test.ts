import { expect, test } from 'vitest';
import { ballFor } from '../src/game/outcome';
import { RANKS, rankFor } from '../src/game/rank';

test('rank ladder starts at zero and rises strictly', () => {
  expect(RANKS[0]!.minXp).toBe(0);
  for (let i = 1; i < RANKS.length; i++)
    expect(RANKS[i]!.minXp).toBeGreaterThan(RANKS[i - 1]!.minXp);
});

test('rankFor gives the rank, the next one, what is missing and the progress', () => {
  expect(rankFor(0)).toMatchObject({ rank: { id: 'gully' }, next: { id: 'club' }, toNext: 150 });
  expect(rankFor(0).progress).toBe(0);
  expect(rankFor(149).rank.id).toBe('gully');
  expect(rankFor(150).rank.id).toBe('club');
  const mid = rankFor(325);
  expect(mid.rank.id).toBe('club');
  expect(mid.toNext).toBe(175);
  expect(mid.progress).toBeCloseTo(0.5, 5);
});

test('rankFor is safe at the top and on bad input', () => {
  expect(rankFor(99999)).toEqual({
    rank: RANKS[RANKS.length - 1],
    next: null,
    toNext: 0,
    progress: 1,
  });
  expect(rankFor(-5).rank.id).toBe('gully');
  expect(rankFor(Number.NaN).rank.id).toBe('gully');
});

test('a level is a ball: the symbol is flavour, the label is plain words', () => {
  expect(ballFor('passed', 0)).toMatchObject({ symbol: '6', tone: 'six' });
  expect(ballFor('passed', 1).label).toBe('Passed first time');
  expect(ballFor('passed', 2)).toMatchObject({ symbol: '4', tone: 'four' });
  expect(ballFor('passed', 5)).toMatchObject({ symbol: '1', label: 'Passed in 5 tries' });
  expect(ballFor('in_progress', 3).tone).toBe('live');
  expect(ballFor('available', 0).tone).toBe('next');
  expect(ballFor('locked', 0)).toMatchObject({ tone: 'locked', label: 'Locked' });
});
