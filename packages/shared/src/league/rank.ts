// Ordering of scores. Lowest wins: commands, then bytes the checked keys use, then characters. Two entries that tie on all
// three share a rank. Nothing about time is ever part of a score.

export interface ScoreKey {
  commands: number;
  bytes: number;
  chars: number;
}

export interface BoardRow extends ScoreKey {
  handle: string;
}

export function compareScores(a: ScoreKey, b: ScoreKey): number {
  return a.commands - b.commands || a.bytes - b.bytes || a.chars - b.chars;
}

const byHandle = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Best first; entries that tie are listed by handle so the table does not move between runs. */
export function sortBoard<T extends BoardRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => compareScores(a, b) || byHandle(a.handle, b.handle));
}

/** Standard competition ranking over a sorted board: 1, 2, 2, 4. */
export function rankBoard<T extends BoardRow>(rows: readonly T[]): (T & { rank: number })[] {
  const sorted = sortBoard(rows);
  const out: (T & { rank: number })[] = [];
  sorted.forEach((row, i) => {
    const prev = out[i - 1];
    const rank = prev && compareScores(prev, row) === 0 ? prev.rank : i + 1;
    out.push({ ...row, rank });
  });
  return out;
}

export interface AttemptRank {
  /** Where the attempt would stand among the committed entries: 1 is best. */
  position: number;
  /** Committed entries plus the attempt. */
  of: number;
  /** Handles of committed entries with exactly the same score. */
  tiedWith: string[];
  /** The best committed score, when there is one. */
  best?: ScoreKey & { handle: string };
}

export function rankAttempt(attempt: ScoreKey, board: readonly BoardRow[]): AttemptRank {
  const sorted = sortBoard(board);
  const better = sorted.filter((r) => compareScores(r, attempt) < 0).length;
  const tied = sorted.filter((r) => compareScores(r, attempt) === 0).map((r) => r.handle);
  const best = sorted[0];
  return {
    position: better + 1,
    of: board.length + 1,
    tiedWith: tied,
    ...(best
      ? {
          best: {
            handle: best.handle,
            commands: best.commands,
            bytes: best.bytes,
            chars: best.chars,
          },
        }
      : {}),
  };
}
