import { describe, expect, it } from 'vitest';
import type { OverPlan } from '../fixture.js';
import {
  addResult,
  BEST_KEPT,
  coerceResults,
  emptyResults,
  innings,
  RECENT_KEPT,
  scorecardText,
  scoreOver,
  summarizeMatch,
  totalLine,
  type MatchResult,
  type OverMeasurement,
  type OverScore,
} from '../score.js';

const plan = (over = 1): OverPlan => ({
  over,
  scenario: 'toss-time-100',
  connections: 40,
  durationSec: 10,
  cardId: null,
  errorBudget: 0.01,
  p99BudgetMs: 400,
});
const m = (p: Partial<OverMeasurement> = {}): OverMeasurement => ({
  requests: 1000,
  errors: 0,
  status5xx: 0,
  p99Ms: 100,
  rps: 100,
  ...p,
});

describe('scoreOver', () => {
  it('scores 36 runs and no wicket for a clean over', () => {
    const s = scoreOver(plan(), m());
    expect(s.runs).toBe(36);
    expect(s.wicket).toBe(false);
    expect(s.answeredShare).toBe(1);
  });

  it('scores runs from the share answered without error', () => {
    const s = scoreOver(plan(), m({ requests: 1000, errors: 500, status5xx: 500 }));
    expect(s.answeredShare).toBe(0.5);
    expect(s.runs).toBe(18);
    expect(s.wicket).toBe(true);
  });

  it('counts requests with no response as attempts', () => {
    // 1000 responses of which 100 are 5xx, plus 100 with no response: attempts 1100, answered 900.
    const s = scoreOver(plan(), m({ requests: 1000, errors: 200, status5xx: 100 }));
    expect(s.answeredShare).toBeCloseTo(900 / 1100, 3);
  });

  it('the error budget is a strict limit: exactly at the budget is safe', () => {
    expect(scoreOver(plan(), m({ requests: 1000, errors: 10, status5xx: 10 })).wicket).toBe(false);
    expect(scoreOver(plan(), m({ requests: 1000, errors: 11, status5xx: 11 })).wicket).toBe(true);
  });

  it('loses a wicket when the 99th percentile is over budget, and says why', () => {
    expect(scoreOver(plan(), m({ p99Ms: 400 })).wicket).toBe(false);
    const s = scoreOver(plan(), m({ p99Ms: 401 }));
    expect(s.wicket).toBe(true);
    expect(s.why.join(' ')).toContain('99th percentile');
    expect(s.runs).toBe(36);
  });

  it('an over with no attempts scores nothing and loses a wicket', () => {
    const s = scoreOver(plan(), m({ requests: 0, errors: 0, status5xx: 0, p99Ms: 0 }));
    expect(s.runs).toBe(0);
    expect(s.wicket).toBe(true);
  });

  it('a 404 is an answer: it is not in errors, so it costs nothing', () => {
    expect(scoreOver(plan(), m({ requests: 1000, errors: 0 })).runs).toBe(36);
  });
});

const over = (n: number, runs: number, wicket = false): OverScore => ({
  over: n,
  scenario: 'toss-time-100',
  cardId: null,
  requests: 1000,
  errors: 0,
  p99Ms: 100,
  rps: 100,
  answeredShare: runs / 36,
  errorShare: 0,
  runs,
  wicket,
  why: wicket ? ['a reason'] : [],
});

describe('innings', () => {
  const fx = { wicketsInHand: 3, overs: Array.from({ length: 6 }, (_, i) => plan(i + 1)) };
  it('is over when all out or when every over is bowled', () => {
    expect(innings(fx, [over(1, 30), over(2, 30, true)]).finished).toBe(false);
    expect(innings(fx, [over(1, 1, true), over(2, 1, true), over(3, 1, true)]).allOut).toBe(true);
    expect(
      innings(
        fx,
        Array.from({ length: 6 }, (_, i) => over(i + 1, 30)),
      ).finished,
    ).toBe(true);
  });
});

function result(
  seed: number,
  runs: number,
  wickets = 0,
  endedBy: MatchResult['endedBy'] = 'complete',
  at = '2026-11-20T10:00:00.000Z',
): MatchResult {
  return {
    version: 1,
    seed,
    date: null,
    finishedAt: at,
    endedBy,
    runs,
    wickets,
    oversBowled: 6,
    overs: [],
  };
}

describe('results file', () => {
  it('keeps the best five and the best of each seed', () => {
    let f = emptyResults();
    for (let i = 0; i < 8; i++) f = addResult(f, result(i % 2, 100 + i));
    expect(f.best).toHaveLength(BEST_KEPT);
    expect(f.best[0]?.runs).toBe(107);
    expect(f.bySeed['0']?.runs).toBe(106);
    expect(f.bySeed['1']?.runs).toBe(107);
    expect(f.recent).toHaveLength(8);
  });

  it('ranks fewer wickets above more at equal runs', () => {
    let f = emptyResults();
    f = addResult(f, result(1, 100, 2));
    f = addResult(f, result(2, 100, 1));
    expect(f.best[0]?.seed).toBe(2);
  });

  it('keeps a stopped or failed match out of the best list', () => {
    let f = addResult(emptyResults(), result(1, 500, 0, 'stopped'));
    f = addResult(f, result(1, 400, 0, 'error'));
    expect(f.best).toEqual([]);
    expect(f.bySeed).toEqual({});
    expect(f.recent).toHaveLength(2);
  });

  it('keeps only the last matches in recent', () => {
    let f = emptyResults();
    for (let i = 0; i < RECENT_KEPT + 4; i++) f = addResult(f, result(1, i));
    expect(f.recent).toHaveLength(RECENT_KEPT);
    expect(f.recent[0]?.runs).toBe(RECENT_KEPT + 3);
  });

  it('does not change the file it is given', () => {
    const f = emptyResults();
    addResult(f, result(1, 10));
    expect(f).toEqual(emptyResults());
  });

  it('turns anything unexpected into an empty file', () => {
    expect(coerceResults(null)).toEqual(emptyResults());
    expect(coerceResults({ version: 2 })).toEqual(emptyResults());
    expect(coerceResults('x')).toEqual(emptyResults());
    const ok = addResult(emptyResults(), result(1, 10));
    expect(coerceResults(JSON.parse(JSON.stringify(ok)))).toEqual(ok);
  });
});

describe('scorecard text', () => {
  const r = summarizeMatch(
    { seed: 20261120, date: '2026-11-20' },
    [over(1, 30), { ...over(2, 12, true), cardId: 'cache-wiped' }],
    'all_out',
    '2026-11-20T10:00:00.000Z',
  );

  it('totals runs and wickets', () => {
    expect(r.runs).toBe(42);
    expect(r.wickets).toBe(1);
    expect(totalLine(r)).toBe('42/1 after 2 overs');
    expect(totalLine({ runs: 3, wickets: 0, oversBowled: 1 })).toBe('3/0 after 1 over');
  });

  it('reads like a scorecard, says whose machine it is, and is plain ASCII', () => {
    const t = scorecardText(r, (id) => `title of ${id}`);
    expect(t).toContain('seed 20261120 (2026-11-20)');
    expect(t).toContain('Over 2');
    expect(t).toContain('incident: title of cache-wiped');
    expect(t).toContain('wicket: a reason');
    expect(t).toContain('Total 42/1 after 2 overs. All out.');
    expect(t).toContain('your own machine');
    expect([...t].every((c) => c === '\n' || (c >= ' ' && c <= '~'))).toBe(true);
  });
});
