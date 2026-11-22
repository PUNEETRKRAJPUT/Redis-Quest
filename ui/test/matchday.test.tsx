// D-09: Match Day's pure model and its views. The UI has no DOM test environment, so the views render to static
// markup from props (the pattern of runTraffic.test.tsx).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { ApiError } from '../src/api';
import { entry } from '../src/features/matchday/entry';
import { FixtureView } from '../src/features/matchday/FixtureView';
import {
  boardRows,
  liveFigures,
  parseSeedInput,
  randomSeed,
  secondsLeft,
  startErrorCopy,
  tickMs,
} from '../src/features/matchday/model';
import { ScorecardView } from '../src/features/matchday/ScorecardView';
import type {
  MatchdayOverview,
  MatchResult,
  MatchStatus,
  OverScore,
} from '../src/features/matchday/types';
import { WarRoom } from '../src/features/matchday/WarRoom';

const score = (
  over: number,
  runs: number,
  wicket = false,
  cardId: string | null = null,
): OverScore => ({
  over,
  scenario: 'toss-time-100',
  cardId,
  requests: 1000,
  errors: wicket ? 80 : 0,
  p99Ms: wicket ? 900 : 120,
  rps: 100,
  answeredShare: runs / 36,
  errorShare: wicket ? 0.08 : 0,
  runs,
  wicket,
  why: wicket ? ['8.0% of requests failed (budget 1.0%)'] : [],
});

const overs = Array.from({ length: 6 }, (_, i) => ({
  over: i + 1,
  scenario: i === 1 ? 'celebrity-100' : 'toss-time-100',
  connections: 40,
  durationSec: 10,
  incident: i === 1 || i === 4,
  errorBudget: 0.01,
  p99BudgetMs: i === 1 || i === 4 ? 800 : 400,
}));

function status(p: Partial<MatchStatus> = {}): MatchStatus {
  return {
    state: 'running',
    seed: 20261120,
    date: '2026-11-20',
    wicketsInHand: 3,
    overs,
    currentOver: 3,
    phase: 'bowling',
    overStartedAt: '2026-11-20T10:00:00.000Z',
    overEndsAt: '2026-11-20T10:00:10.000Z',
    card: null,
    cardTitles: { 'cache-wiped': 'The groundsman sweeps the cache' },
    scores: [score(1, 36), score(2, 20, true, 'cache-wiped')],
    runs: 56,
    wickets: 1,
    result: null,
    now: '2026-11-20T10:00:04.000Z',
    ...p,
  };
}

describe('seeds', () => {
  test('a typed seed is a whole number from 1 to 2147483647', () => {
    expect(parseSeedInput(' 20261120 ')).toBe(20261120);
    for (const bad of ['', '0', '-3', '1.5', 'abc', '2147483648', '12345678901', '1e3'])
      expect(parseSeedInput(bad)).toBeNull();
    expect(parseSeedInput('2147483647')).toBe(2147483647);
  });
  test('a random seed is always valid', () => {
    for (const r of [0, 0.5, 0.999999999]) {
      const n = randomSeed(() => r);
      expect(parseSeedInput(String(n))).toBe(n);
    }
  });
});

describe('live figures', () => {
  const t = (at: number, count: number, p99Ms: number, errors = 0) => ({
    at,
    count,
    errors,
    p50Ms: 5,
    p99Ms,
  });
  test('reads seconds, milliseconds and ISO strings', () => {
    expect(tickMs(1_795_000_000)).toBe(1_795_000_000_000);
    expect(tickMs(1_795_000_000_000)).toBe(1_795_000_000_000);
    expect(tickMs('2026-11-20T10:00:00.000Z')).toBe(Date.parse('2026-11-20T10:00:00.000Z'));
    expect(tickMs('garbage')).toBe(0);
  });
  test('averages the requests and takes the worst 99th percentile of the last ticks', () => {
    const now = 1_795_000_010_000;
    const f = liveFigures(
      [
        t(now - 30_000, 999, 999),
        t(now - 2000, 100, 40),
        t(now - 1000, 200, 90, 2),
        t(now, 300, 60),
      ],
      now,
    );
    expect(f).toEqual({ rps: 200, p99Ms: 90, errors: 2 });
  });
  test('says nothing when the app has served nothing lately', () => {
    expect(liveFigures([], 1_795_000_010_000)).toEqual({ rps: null, p99Ms: null, errors: 0 });
    expect(liveFigures([t(1_000_000_000_000, 5, 5)], 1_795_000_010_000).rps).toBeNull();
  });
});

describe('countdown', () => {
  test('is read against the engine clock, not the browser clock', () => {
    // The engine says it is 10:00:04 and the over ends at 10:00:10. The browser clock is an hour wrong.
    const fetched = Date.parse('2026-11-20T11:00:00.000Z');
    expect(
      secondsLeft('2026-11-20T10:00:10.000Z', '2026-11-20T10:00:04.000Z', fetched, fetched),
    ).toBe(6);
    expect(
      secondsLeft('2026-11-20T10:00:10.000Z', '2026-11-20T10:00:04.000Z', fetched, fetched + 2500),
    ).toBe(4);
    expect(
      secondsLeft(
        '2026-11-20T10:00:10.000Z',
        '2026-11-20T10:00:04.000Z',
        fetched,
        fetched + 60_000,
      ),
    ).toBe(0);
  });
  test('is null when there is no over in play', () => {
    expect(secondsLeft(null, '2026-11-20T10:00:04.000Z', 0, 0)).toBeNull();
  });
});

describe('scoreboard rows', () => {
  test('marks overs as done, in play and to come, and names only the incidents already played', () => {
    const rows = boardRows(status());
    expect(rows.map((r) => r.state)).toEqual([
      'done',
      'done',
      'current',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
    expect(rows[1]?.cardTitle).toBe('The groundsman sweeps the cache');
    expect(rows[4]?.incident).toBe(true);
    expect(rows[4]?.cardTitle).toBeNull();
  });
  test('after the match the overs not bowled say so', () => {
    const rows = boardRows(status({ state: 'finished', currentOver: 3, scores: [score(1, 30)] }));
    expect(rows.map((r) => r.state)).toEqual([
      'done',
      'not_bowled',
      'not_bowled',
      'not_bowled',
      'not_bowled',
      'not_bowled',
    ]);
  });
});

describe('refusal copy', () => {
  test('says what to do in plain words', () => {
    expect(startErrorCopy(new ApiError(409, 'verify_in_progress', 'x'))).toContain(
      'Wait for it to end',
    );
    expect(startErrorCopy(new ApiError(409, 'redis_down', 'x'))).toContain(
      'Redis is not reachable',
    );
    expect(startErrorCopy(new ApiError(409, 'single_node_only', 'x'))).toContain('single-node');
    expect(startErrorCopy(new ApiError(0, 'offline', 'Cannot reach the game engine.'))).toBe(
      'Cannot reach the game engine.',
    );
    expect(startErrorCopy(new Error('boom'))).toBe('boom');
  });
});

describe('the views', () => {
  const overview: MatchdayOverview = {
    today: { seed: 20261120, date: '2026-11-20' },
    fixture: { seed: 20261120, date: '2026-11-20', wicketsInHand: 3, overs },
    results: { version: 1, best: [], bySeed: {}, recent: [] },
    bestForSeed: null,
    canStart: { ok: true, reason: null },
    deckErrors: [],
    machineNote: 'These scores are for your own machine and your own build.',
    caps: { maxConnections: 200, maxDurationSec: 30, lowPower: false },
  };
  const fixtureProps = {
    overview,
    seedLabel: 'today' as const,
    seedText: '',
    seedProblem: null,
    starting: false,
    error: null,
    hasLastMatch: false,
    onSeedText: () => undefined,
    onRandom: () => undefined,
    onUseSeed: () => undefined,
    onUseToday: () => undefined,
    onStart: () => undefined,
    onShowLast: () => undefined,
  };

  test('the fixture card shows the date as the seed, six overs, the hidden incidents and whose machine', () => {
    const html = renderToStaticMarkup(<FixtureView {...fixtureProps} />);
    expect(html).toContain('2026-11-20');
    expect(html).toContain('20261120');
    expect(html).toContain('data-testid="matchday-start"');
    expect(html).toContain('celebrity-100');
    expect(html).toContain('Incident before this over');
    expect(html).toContain('stays hidden until it is played');
    expect(html).toContain('your own machine');
    expect(html).not.toContain('groundsman');
  });

  test('a start that cannot happen says why and the button is disabled', () => {
    const html = renderToStaticMarkup(
      <FixtureView
        {...fixtureProps}
        overview={{ ...overview, canStart: { ok: false, reason: 'a traffic run is going' } }}
        error="A level check or a traffic run is going."
      />,
    );
    expect(html).toContain('Not now: a traffic run is going.');
    expect(html).toContain('role="alert"');
    expect(html).toMatch(
      /data-testid="matchday-start"[^>]*disabled|disabled[^>]*data-testid="matchday-start"/,
    );
  });

  test('the seed form names its problem', () => {
    const html = renderToStaticMarkup(
      <FixtureView {...fixtureProps} seedText="abc" seedProblem="A seed is a whole number." />,
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('A seed is a whole number.');
  });

  test('the war room shows the score, the clock, the live numbers and the card with its fact labels', () => {
    const html = renderToStaticMarkup(
      <WarRoom
        status={status({
          card: {
            id: 'the-box-is-full',
            title: 'The box is full',
            sees: 'Redis has a ceiling now.',
            causeSummary: 'The engine lowers maxmemory.',
            ends: 'It is put back.',
            facts: [
              { text: 'Writes fail at the limit.', source: 'digest', ref: 'x' },
              { text: 'Headroom is 256 KiB.', source: 'simulation' },
            ],
            applied: ['maxmemory set to 1 bytes'],
            skipped: ['a step that was skipped'],
          },
        })}
        figures={{ rps: 412, p99Ms: 88, errors: 0 }}
        secondsLeft={6}
        stopping={false}
        onStop={() => undefined}
      />,
    );
    expect(html).toContain('56/1');
    expect(html).toContain('Over 3 of 6');
    expect(html).toContain('6 s left');
    expect(html).toContain('412');
    expect(html).toContain('The box is full');
    expect(html).toContain('In the Redis docs digest');
    expect(html).toContain('A simulation');
    expect(html).toContain('a step that was skipped');
    expect(html).toContain('data-testid="matchday-stop"');
    expect(html).toContain('aria-current="step"');
  });

  test('the war room shows a dash, not a made-up number, when the app serves nothing', () => {
    const html = renderToStaticMarkup(
      <WarRoom
        status={status()}
        figures={{ rps: null, p99Ms: null, errors: 0 }}
        secondsLeft={null}
        stopping={false}
        onStop={() => undefined}
      />,
    );
    expect(html).toContain('>-<');
  });

  const result: MatchResult & { text: string } = {
    version: 1,
    seed: 20261120,
    date: '2026-11-20',
    finishedAt: '2026-11-20T10:01:00.000Z',
    endedBy: 'all_out',
    runs: 70,
    wickets: 3,
    oversBowled: 3,
    overs: [score(1, 36), score(2, 20, true), score(3, 14, true)],
    text: 'Redis Quest Match Day, seed 20261120',
  };

  test('the scorecard totals the innings, explains each wicket, and offers the text', () => {
    const html = renderToStaticMarkup(
      <ScorecardView
        status={status({ state: 'finished', scores: result.overs, result, runs: 70, wickets: 3 })}
        machineNote="These scores are for your own machine and your own build."
        copied={false}
        onCopy={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(html).toContain('70/3');
    expect(html).toContain('All out');
    expect(html).toContain('after 3 overs');
    expect(html).toContain('8.0% of requests failed');
    expect(html).toContain('Copy as text');
    expect(html).toContain('Redis Quest Match Day, seed 20261120');
    expect(html).toContain('your own machine');
  });

  test('the copy button says it has copied', () => {
    const html = renderToStaticMarkup(
      <ScorecardView
        status={status({ state: 'finished', scores: result.overs, result })}
        machineNote=""
        copied
        onCopy={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(html).toContain('Copied');
  });
});

describe('the feature entry', () => {
  test('is turned on and points at /matchday', () => {
    expect(entry.enabled).toBe(true);
    expect(entry.path).toBe('/matchday');
  });
});
