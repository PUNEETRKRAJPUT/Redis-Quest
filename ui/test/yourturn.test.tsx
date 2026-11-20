// D-06: "Your turn" (state, steps, events, git commands), the wanted-commands board, and the credits' sections.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { Board } from '../src/features/yourturn/Board';
import {
  EMPTY_STATE,
  PLAYTEST_EVENT,
  filterGroups,
  finalePassed,
  gitCommands,
  markPullRequest,
  parseState,
  pickCommand,
  playtestFromEvents,
  readCoverage,
  recordPlaytest,
  stepsOf,
  studioLink,
  yourTurnCard,
  type BoardData,
} from '../src/features/yourturn/logic';
import {
  SECTION_MS,
  authorLines,
  buildSections,
  playerNumbers,
  rollKey,
  stepIndex,
} from '../src/features/credits/logic';
import type { ChaptersResponse, Progress } from '../src/types';

const T0 = new Date('2026-11-20T10:00:00Z');
const T1 = new Date('2026-11-20T10:05:00Z');

describe('your turn state', () => {
  test('parseState survives garbage and drops bad fields', () => {
    expect(parseState(null)).toEqual(EMPTY_STATE);
    expect(parseState('not json')).toEqual(EMPTY_STATE);
    expect(parseState('[]')).toEqual(EMPTY_STATE);
    expect(parseState(JSON.stringify({ command: 'Bad Name!' }))).toEqual(EMPTY_STATE);
    const ok = parseState(
      JSON.stringify({
        command: 'lmove',
        pickedAt: T0.toISOString(),
        playtest: { levelId: 'house-02-x', pack: 'house', at: T1.toISOString() },
        prOpenedAt: 7,
      }),
    );
    expect(ok.command).toBe('lmove');
    expect(ok.playtest?.pack).toBe('house');
    expect(ok.prOpenedAt).toBeNull();
  });

  test('picking resets the path only for a different command', () => {
    const a = pickCommand(EMPTY_STATE, 'lmove', T0);
    expect(a.command).toBe('lmove');
    const b = recordPlaytest(a, { levelId: 'x-01-y', pack: 'x', at: T1.toISOString() });
    expect(pickCommand(b, 'lmove', T1)).toBe(b);
    expect(pickCommand(b, 'smove', T1)).toMatchObject({ command: 'smove', playtest: null });
    expect(pickCommand(EMPTY_STATE, 'NOT A NAME', T0)).toBe(EMPTY_STATE);
  });

  test('a play-test needs a picked command; the pull request needs a play-test', () => {
    const p = { levelId: 'x-01-y', pack: 'x', at: T1.toISOString() };
    expect(recordPlaytest(EMPTY_STATE, p)).toBe(EMPTY_STATE);
    const picked = pickCommand(EMPTY_STATE, 'lmove', T0);
    expect(markPullRequest(picked, T1)).toBe(picked);
    const tested = recordPlaytest(picked, p);
    expect(markPullRequest(tested, T1).prOpenedAt).toBe(T1.toISOString());
  });

  test('steps tick in order: the first not done is current', () => {
    expect(stepsOf(EMPTY_STATE).map((s) => s.status)).toEqual(['current', 'waiting', 'waiting']);
    const picked = pickCommand(EMPTY_STATE, 'lmove', T0);
    expect(stepsOf(picked).map((s) => s.status)).toEqual(['done', 'current', 'waiting']);
    const tested = recordPlaytest(picked, { levelId: 'a-01-b', pack: 'a', at: T1.toISOString() });
    expect(stepsOf(tested).map((s) => s.status)).toEqual(['done', 'done', 'current']);
    expect(stepsOf(markPullRequest(tested, T1)).map((s) => s.status)).toEqual([
      'done',
      'done',
      'done',
    ]);
  });
});

describe('the play-test event', () => {
  const data = { levelId: 'house-02-x', pack: 'house', mode: 'cli', runs: [] };
  test('reads the store shape and the engine ring shape, only after the pick', () => {
    const store = [
      { at: '2026-11-20T09:00:00Z', kind: 'custom', name: PLAYTEST_EVENT, data },
      { at: '2026-11-20T10:02:00Z', kind: 'custom', name: 'other', data },
    ];
    const ring = [
      {
        at: '2026-11-20T10:03:00Z',
        type: 'level.event',
        data: { kind: 'custom', name: PLAYTEST_EVENT, data },
      },
    ];
    expect(playtestFromEvents(store, T0.toISOString())).toBeNull();
    expect(playtestFromEvents(store, null)?.at).toBe('2026-11-20T09:00:00Z');
    expect(playtestFromEvents(ring, T0.toISOString())).toEqual({
      levelId: 'house-02-x',
      pack: 'house',
      at: '2026-11-20T10:03:00Z',
    });
  });

  test('ignores events without a level id or pack, and takes the latest', () => {
    const events = [
      { at: '2026-11-20T10:01:00Z', kind: 'custom', name: PLAYTEST_EVENT, data: {} },
      { at: '2026-11-20T10:02:00Z', kind: 'custom', name: PLAYTEST_EVENT, data },
      {
        at: '2026-11-20T10:04:00Z',
        kind: 'custom',
        name: PLAYTEST_EVENT,
        data: { ...data, levelId: 'house-03-z' },
      },
    ];
    expect(playtestFromEvents(events, T0.toISOString())?.levelId).toBe('house-03-z');
  });
});

describe('step three and the map card', () => {
  test('git commands name the pack and the level, with placeholders before a play-test', () => {
    const c = gitCommands({ levelId: 'house-02-x', pack: 'house' });
    expect(c[1]).toBe('git add levels/community/house CONTRIBUTORS.md');
    expect(c.join('\n')).toContain('Community level: house-02-x');
    expect(gitCommands(null)[1]).toContain('<pack>');
  });

  const chapters = (statuses: string[]): ChaptersResponse =>
    ({
      player: null,
      xp: 0,
      chapters: [
        {
          id: 'finale',
          dirName: 'finale',
          title: 'The architect',
          incident: [],
          levels: statuses.map((status, i) => ({
            id: `finale-0${i}`,
            title: 't',
            mode: 'cli',
            xp: 1,
            status,
            attempts: 1,
          })),
        },
      ],
    }) as unknown as ChaptersResponse;

  test('the card is the next thing only once every Finale level is passed', () => {
    expect(finalePassed(null)).toBe(false);
    expect(finalePassed(chapters(['passed', 'available']))).toBe(false);
    expect(finalePassed(chapters(['passed', 'passed']))).toBe(true);
    expect(yourTurnCard(chapters(['passed']), 'plain')).toMatchObject({ next: true });
    expect(yourTurnCard(chapters(['available']), 'plain')).toEqual({ next: false, blurb: 'plain' });
  });
});

const data: BoardData = {
  available: true,
  listed: 669,
  commands: 3,
  taught: 1,
  untaught: 2,
  skipped: { subcommands: 200, modules: 466 },
  levelsRead: 97,
  groups: [
    {
      group: 'list',
      total: 3,
      taught: 1,
      commands: [
        {
          name: 'lmove',
          summary: 'Returns an element after popping it from one list.',
          taught: false,
          usedBy: [],
        },
        {
          name: 'lpush',
          summary: 'Prepends elements to a list.',
          taught: true,
          usedBy: [{ levelId: 'ch1-05-a', via: 'solution' }],
        },
        { name: 'blmove', summary: 'Pops an element, blocking.', taught: false, usedBy: [] },
      ],
    },
  ],
};

describe('the board', () => {
  test('filter by text and by untaught; groups left empty go', () => {
    expect(filterGroups(data.groups, { query: '', untaughtOnly: true })[0]?.commands).toHaveLength(
      2,
    );
    expect(
      filterGroups(data.groups, { query: 'blocking', untaughtOnly: false })[0]?.commands.map(
        (c) => c.name,
      ),
    ).toEqual(['blmove']);
    expect(filterGroups(data.groups, { query: 'zzz', untaughtOnly: false })).toEqual([]);
    expect(
      filterGroups(data.groups, { query: 'LIST', untaughtOnly: false })[0]?.commands,
    ).toHaveLength(3);
  });

  test('readCoverage accepts the board and turns anything else into an unavailable', () => {
    expect(readCoverage(data).available).toBe(true);
    expect(readCoverage({ available: false, reason: 'Redis is down' })).toEqual({
      available: false,
      reason: 'Redis is down',
    });
    expect(readCoverage(null)).toMatchObject({ available: false });
    expect(readCoverage({ available: true })).toMatchObject({ available: false });
  });

  test('studioLink fills the command in', () => {
    expect(studioLink('lmove')).toBe('/studio?command=lmove');
  });

  const noop = () => {};
  test('renders counts, untaught rows with the action, taught rows without', () => {
    const html = renderToStaticMarkup(
      <Board coverage={data} picked={null} onPick={noop} onRetry={noop} />,
    );
    expect(html).toContain('data-testid="board-counts"');
    expect(html).toContain('LMOVE');
    expect(html).toContain('Returns an element after popping it from one list.');
    expect(html).toContain('data-testid="write-level-lmove"');
    expect(html).toContain('href="/studio?command=lmove"');
    // lpush is taught and the list shows only untaught by default
    expect(html).not.toContain('write-level-lpush');
    expect(html).not.toContain('board-row-lpush');
    expect(html).toContain('669');
  });

  test('says plainly when the server list is unavailable and shows no rows', () => {
    const html = renderToStaticMarkup(
      <Board
        coverage={{ available: false, reason: 'Redis is down' }}
        picked={null}
        onPick={noop}
        onRetry={noop}
      />,
    );
    expect(html).toContain('data-testid="board-unavailable"');
    expect(html).toContain('Redis is down');
    expect(html).not.toContain('board-row-');
  });

  test('a loading board is a skeleton, not an empty list', () => {
    const html = renderToStaticMarkup(
      <Board coverage={null} picked={null} onPick={noop} onRetry={noop} />,
    );
    expect(html).toContain('board-loading');
  });
});

describe('credits', () => {
  const community = [
    { id: 'a-01-x', title: 'Canteen', author: { name: 'Asha Rao', github: 'asha' } },
    { id: 'a-02-y', title: 'Bus', author: { name: 'Asha Rao', github: 'asha' } },
    { id: 'b-01-z', title: 'Gate', author: null },
  ];
  const progress = {
    version: 1,
    player: { id: 'p', name: 'Puneet', createdAt: 'x' },
    target: { redisUrl: 'r' },
    activeSlots: [],
    levels: {
      a: { status: 'passed', attempts: 2, verdicts: [] },
      b: { status: 'in_progress', attempts: 1, verdicts: [] },
      c: undefined,
    },
    xp: 420,
    badges: ['one', 'two'],
  } as unknown as Progress;

  test('authors are grouped, a level with no author is left out', () => {
    expect(authorLines(community)).toEqual([
      { id: 'asha', primary: 'Asha Rao (@asha)', secondary: '2 levels: Canteen, Bus' },
    ]);
  });

  test('the player line carries their numbers', () => {
    expect(playerNumbers(progress)).toEqual({
      name: 'Puneet',
      xp: 420,
      levelsPassed: 1,
      attempts: 3,
      badges: 2,
    });
    expect(playerNumbers(null)).toBeNull();
  });

  test('four sections; a file the engine could not read is said, not shown empty', () => {
    const s = buildSections({
      credits: {
        cast: [{ slug: 'roommate', name: 'Sai Teja Vemuri', nickname: 'Teja', role: 'Roommate' }],
        contributors: null,
      },
      community,
      player: playerNumbers(progress),
    });
    expect(s.map((x) => x.id)).toEqual(['cast', 'authors', 'contributors', 'you']);
    expect(s[0]?.lines[0]).toEqual({
      id: 'roommate',
      primary: 'Sai Teja Vemuri (Teja)',
      secondary: 'Roommate',
    });
    expect(s[2]?.lines).toEqual([]);
    expect(s[2]?.note).toMatch(/not available/);
    expect(s[3]?.lines[0]?.secondary).toContain('420 XP');
  });

  test('nothing loaded: every section says so', () => {
    const s = buildSections({ credits: null, community: null, player: null });
    expect(s.every((x) => x.lines.length === 0 && !!x.note)).toBe(true);
    const none = buildSections({
      credits: { cast: [], contributors: [] },
      community: [],
      player: null,
    });
    expect(none[1]?.note).toMatch(/first one could be yours/);
    expect(none[2]?.note).toMatch(/Nobody has added/);
  });

  test('pacing stays inside the roll, and only roll keys are claimed', () => {
    expect(stepIndex(0, -1, 4)).toBe(0);
    expect(stepIndex(3, 1, 4)).toBe(3);
    expect(stepIndex(1, 1, 4)).toBe(2);
    expect(stepIndex(0, 1, 0)).toBe(0);
    expect(SECTION_MS).toBeGreaterThan(0);
    expect(rollKey('ArrowRight')).toBe('next');
    expect(rollKey('Escape')).toBe('skip');
    expect(rollKey(' ')).toBe('toggle');
    expect(rollKey('Tab')).toBeNull();
    expect(rollKey('Enter')).toBeNull();
  });
});
