// Pure helpers for the league screen: counting, wording, paths. No React, no network.

import type { AttemptRank, BoardEntry, LeagueHole, PlainEntry, ScoreResult } from './types';

/** Lines that will count as commands: not blank, not a `#` comment. The engine decides the real score. */
export function commandLines(text: string): number {
  return text.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return t !== '' && !t.startsWith('#');
  }).length;
}

export function underParLabel(underPar: number): string {
  if (underPar === 0) return 'at par';
  return underPar > 0 ? `${underPar} under par` : `${-underPar} over par`;
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "It would place 2nd of 4, tied with amy." Only committed entries and this attempt count. */
export function rankSentence(rank: AttemptRank): string {
  const base = `It would place ${ordinal(rank.position)} of ${rank.of}`;
  if (rank.tiedWith.length === 0) return `${base}.`;
  return `${base}, tied with ${rank.tiedWith.join(', ')}.`;
}

/** Where a contributor's entry file goes. */
export function entryPath(holeId: string, handle = '<your-github-handle>'): string {
  return `golf/holes/${holeId}/entries/${handle}.redis`;
}

export function isScored(e: BoardEntry | PlainEntry): e is BoardEntry {
  return 'rank' in e;
}

export function draftKey(holeId: string): string {
  return `quest.league.draft.${holeId}`;
}

/** A short sentence for each reason an attempt got no score. */
export function failureHeadline(reason: Extract<ScoreResult, { ok: false }>['reason']): string {
  switch (reason) {
    case 'checks_failed':
      return 'No score: a check failed.';
    case 'command_failed':
      return 'No score: Redis refused a command.';
    case 'refused':
      return 'No score: the entry uses a command the league does not allow.';
    case 'setup_failed':
      return 'No score: the hole itself failed to set up. Tell the maintainers.';
    case 'not_scratch':
      return 'No score: the scoring database could not be confirmed, so nothing ran.';
    case 'runner_failed':
      return 'No score: Redis could not be reached or written to.';
  }
}

export function holeById(holes: readonly LeagueHole[], id: string | null): LeagueHole | undefined {
  return holes.find((h) => h.id === id) ?? holes[0];
}
