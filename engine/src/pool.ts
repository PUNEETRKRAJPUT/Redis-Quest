// E-04: interview pools. A pool level has no checks of its own: at its first start the engine draws one of the
// pool's earlier levels, and from then on the pool level is graded as that level (its fixtures, slots, scenario
// and verify list) followed by the pool entry's follow-up questions.

import { createHash } from 'node:crypto';
import {
  interviewBlankStart,
  type LoadedLevel,
  type PoolEntry,
  type QuizVerifier,
} from '@quest/shared';
import type { LevelIndexEntry } from './levels.js';
import type { LevelProgress, ProgressFile } from './progress.js';

/** The pool of a level, or null for any level that is not a pool level. */
export function poolEntries(level: LoadedLevel): readonly PoolEntry[] | null {
  const lv = level.level;
  return lv.mode === 'code' && lv.interview?.pool ? lv.interview.pool : null;
}

/** E-05: the follow-up questions of a `rebuild_of` interview level (none on any other level). */
export function ownQuestions(level: LoadedLevel): readonly QuizVerifier[] {
  const lv = level.level;
  return lv.mode === 'code' && lv.interview?.rebuild_of !== undefined
    ? (lv.interview.questions ?? [])
    : [];
}

/** `interview.blank_start` with its default (true for a pool level, false for a `rebuild_of` level). */
export function blankStartOf(level: LoadedLevel): boolean {
  const lv = level.level;
  return lv.mode === 'code' && lv.interview ? interviewBlankStart(lv.interview) : false;
}

/** A stable 32-bit number from the player and the level: the same save always draws the same way. */
export function drawSeed(playerId: string, levelId: string): number {
  return createHash('sha256').update(`${playerId}:${levelId}`).digest().readUInt32BE(0);
}

/** The `rebuild_of` targets this player has already drawn in pool levels other than `levelId`. */
export function drawnByOthers(p: ProgressFile, levelId: string): Set<string> {
  const out = new Set<string>();
  for (const [id, lp] of Object.entries(p.levels)) {
    if (id !== levelId && lp?.drawn) out.add(lp.drawn);
  }
  return out;
}

/**
 * Picks one entry: seeded by the player and the level, among the entries no other pool level of this player has
 * drawn (so three pool levels give three different use cases). When every entry is taken, repeats are allowed.
 */
export function chooseDraw(
  entries: readonly PoolEntry[],
  playerId: string,
  levelId: string,
  taken: ReadonlySet<string>,
): PoolEntry {
  const free = entries.filter((e) => !taken.has(e.rebuild_of));
  const candidates = free.length > 0 ? free : entries;
  return candidates[drawSeed(playerId, levelId) % candidates.length] as PoolEntry;
}

/**
 * What a level is graded as. An ordinary level is itself. A pool level is the level the interviewer drew (its
 * fixtures resolve from that level's directory, its slots and scenario apply) with the pool entry's follow-up
 * quizzes after its checks, under the pool level's own id so events and progress stay on the pool level.
 */
export interface Effective {
  pool: boolean;
  /** The drawn level; null on an ordinary level and on a pool level nobody has started. */
  drawn: LevelIndexEntry | null;
  /** The pool entry's follow-up quizzes (answer indices continue after the drawn level's checks). */
  questions: readonly QuizVerifier[];
  verifyLevel: LoadedLevel;
}

export function effectiveLevel(
  entry: LevelIndexEntry,
  lp: Pick<LevelProgress, 'drawn'> | undefined,
  get: (id: string) => LevelIndexEntry | undefined,
): Effective {
  const pool = poolEntries(entry.level);
  if (!pool) {
    // E-05: a `rebuild_of` level's own follow-up questions go after its own checks, exactly like a pool entry's.
    const own = ownQuestions(entry.level);
    if (own.length === 0)
      return { pool: false, drawn: null, questions: [], verifyLevel: entry.level };
    const el = entry.level;
    return {
      pool: false,
      drawn: null,
      questions: own,
      verifyLevel: {
        ...el,
        level: { ...el.level, verify: [...el.level.verify, ...own] } as LoadedLevel['level'],
      },
    };
  }
  const pe = lp?.drawn ? pool.find((e) => e.rebuild_of === lp.drawn) : undefined;
  const drawn = pe ? get(pe.rebuild_of) : undefined;
  if (!pe || !drawn) return { pool: true, drawn: null, questions: [], verifyLevel: entry.level };
  const dl = drawn.level;
  return {
    pool: true,
    drawn,
    questions: pe.questions,
    verifyLevel: {
      ...dl,
      level: {
        ...dl.level,
        id: entry.level.level.id,
        verify: [...dl.level.verify, ...pe.questions],
      },
    },
  };
}
