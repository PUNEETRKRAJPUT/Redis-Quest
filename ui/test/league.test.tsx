// D-07: the league's presentational pieces render the right words and roles (static markup; the UI tests have no DOM).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { Board } from '../src/features/league/Board';
import { Scorecard } from '../src/features/league/Scorecard';
import { Submit } from '../src/features/league/Submit';
import type { LeagueHole, ScoreOutcome } from '../src/features/league/types';
import { entry as leagueEntry } from '../src/features/league/entry';
import { FEATURES } from '../src/features/registry';

const hole: LeagueHole = {
  id: '01-kit-room',
  title: 'Stock the kit room',
  task: 'Fill the shelves.',
  par: 5,
  setup: [],
  checks: [],
  entries: [
    { handle: 'octocat', rank: 1, commands: 1, bytes: 480, chars: 70, underPar: 4 },
    { handle: 'par-house', rank: 2, commands: 5, bytes: 480, chars: 78, underPar: 0 },
  ],
  failed: [],
};

const passed: ScoreOutcome = {
  kind: 'scored',
  data: {
    committed: 2,
    rank: { position: 1, of: 3, tiedWith: [] },
    result: {
      ok: true,
      holeId: '01-kit-room',
      handle: 'you',
      commands: 1,
      bytes: 480,
      chars: 70,
      par: 5,
      underPar: 4,
      checks: [],
    },
  },
};

describe('Scorecard', () => {
  test('always renders a polite live region, empty before the first score', () => {
    const html = renderToStaticMarkup(<Scorecard outcome={null} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('league-score"');
  });

  test('a score shows commands, under par and the rank sentence', () => {
    const html = renderToStaticMarkup(<Scorecard outcome={passed} />);
    expect(html).toContain('4 under par');
    expect(html).toContain('Par is 5.');
    expect(html).toContain('It would place 1st of 3.');
  });

  test('no score says why, with the engine text', () => {
    const html = renderToStaticMarkup(
      <Scorecard
        outcome={{
          kind: 'scored',
          data: {
            committed: 2,
            rank: null,
            result: {
              ok: false,
              holeId: '01-kit-room',
              handle: 'you',
              reason: 'checks_failed',
              message: 'kit:bat must hold 12 (expected 12, got 21)',
              checks: [],
            },
          },
        }}
      />,
    );
    expect(html).toContain('No score: a check failed.');
    expect(html).toContain('expected 12, got 21');
  });

  test('invalid entries list each line, a refusal and an offline engine show their message', () => {
    const invalid = renderToStaticMarkup(
      <Scorecard
        outcome={{
          kind: 'invalid',
          problems: [{ line: 2, col: 1, message: 'EVAL is not allowed: scripts' }],
        }}
      />,
    );
    expect(invalid).toContain('line 2');
    expect(invalid).toContain('EVAL is not allowed');
    const cluster = renderToStaticMarkup(
      <Scorecard
        outcome={{ kind: 'refused', error: 'cluster', message: 'a cluster has only one database' }}
      />,
    );
    expect(cluster).toContain('a cluster has only one database');
  });
});

describe('Board', () => {
  test('a table with a caption, ranks, and the house marked', () => {
    const html = renderToStaticMarkup(<Board hole={hole} scored />);
    expect(html).toContain('<caption class="sr-only">');
    expect(html).toContain('octocat');
    expect(html).toContain('the house');
    expect(html).toContain('4 under par');
  });

  test('unscored boards show handles and command counts only', () => {
    const html = renderToStaticMarkup(
      <Board hole={{ ...hole, entries: [{ handle: 'octocat', commands: 1 }] }} scored={false} />,
    );
    expect(html).toContain('octocat');
    expect(html).not.toContain('Bytes');
  });

  test('an empty board invites the first entry', () => {
    expect(renderToStaticMarkup(<Board hole={{ ...hole, entries: [] }} scored />)).toContain(
      'No entries yet',
    );
  });
});

describe('Submit and the registry', () => {
  test('names the file and shows the entry as it would be committed', () => {
    const html = renderToStaticMarkup(
      <Submit holeId="01-kit-room" entry={'SET a 1\nSET b 2\n\n'} />,
    );
    expect(html).toContain('golf/holes/01-kit-room/entries/&lt;your-github-handle&gt;.redis');
    expect(html).toContain('SET a 1\nSET b 2\n</pre>');
  });

  test('the league is switched on and shows on the map', () => {
    expect(leagueEntry.enabled).toBe(true);
    expect(FEATURES.map((f) => f.id)).toContain('league');
    expect(leagueEntry.path).toBe('/league');
  });
});
