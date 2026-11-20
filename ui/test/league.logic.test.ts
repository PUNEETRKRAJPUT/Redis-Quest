import { describe, expect, test } from 'vitest';
import {
  commandLines,
  draftKey,
  entryPath,
  failureHeadline,
  holeById,
  isScored,
  ordinal,
  rankSentence,
  underParLabel,
} from '../src/features/league/logic';
import type { LeagueHole } from '../src/features/league/types';

describe('league logic', () => {
  test('commandLines skips blanks and # comments', () => {
    expect(commandLines('')).toBe(0);
    expect(commandLines('# only a comment\n\n  \n')).toBe(0);
    expect(commandLines('SET a 1\n# note\n  GET a  \r\nDEL a')).toBe(3);
  });

  test('underParLabel reads like golf', () => {
    expect(underParLabel(3)).toBe('3 under par');
    expect(underParLabel(0)).toBe('at par');
    expect(underParLabel(-2)).toBe('2 over par');
  });

  test('ordinals, including the teens', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '101st',
      '111th',
    ]);
  });

  test('rankSentence names ties', () => {
    expect(rankSentence({ position: 2, of: 4, tiedWith: [] })).toBe('It would place 2nd of 4.');
    expect(rankSentence({ position: 1, of: 3, tiedWith: ['amy', 'bob'] })).toBe(
      'It would place 1st of 3, tied with amy, bob.',
    );
  });

  test('entryPath is the file a contributor creates', () => {
    expect(entryPath('01-kit-room', 'octocat')).toBe(
      'golf/holes/01-kit-room/entries/octocat.redis',
    );
    expect(entryPath('01-kit-room')).toBe(
      'golf/holes/01-kit-room/entries/<your-github-handle>.redis',
    );
  });

  test('isScored tells a scored entry from a plain one', () => {
    expect(isScored({ handle: 'a', commands: 2 })).toBe(false);
    expect(isScored({ handle: 'a', rank: 1, commands: 2, bytes: 1, chars: 1, underPar: 0 })).toBe(
      true,
    );
  });

  test('every failure reason has a headline', () => {
    for (const r of [
      'refused',
      'not_scratch',
      'runner_failed',
      'setup_failed',
      'command_failed',
      'checks_failed',
    ] as const) {
      expect(failureHeadline(r)).toMatch(/^No score: /);
    }
  });

  test('holeById falls back to the first hole', () => {
    const h = (id: string) => ({ id }) as LeagueHole;
    expect(holeById([h('01-a'), h('02-b')], '02-b')?.id).toBe('02-b');
    expect(holeById([h('01-a'), h('02-b')], 'nope')?.id).toBe('01-a');
    expect(holeById([h('01-a')], null)?.id).toBe('01-a');
    expect(holeById([], null)).toBeUndefined();
  });

  test('drafts are kept per hole', () => {
    expect(draftKey('01-a')).not.toBe(draftKey('02-b'));
  });
});
