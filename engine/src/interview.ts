// F-12: interview mode. A `code` level with an `interview` block is a timed blank rebuild. The engine
// never stops the learner when time is up: a verify after the deadline still grades, and the result is
// marked overtime. All the rules live here as small functions of an explicit clock so tests do not sleep.

import type { LoadedLevel } from '@quest/shared';
import type { LevelProgress, ProgressFile } from './progress.js';

export interface InterviewSpec {
  minutes: number;
  /** The level this one repeats; null on a pool level (E-04), where the engine draws it at the first start. */
  rebuildOf: string | null;
  hintXpCost: number;
}

/** The interview block of a level, or null for an ordinary level. */
export function interviewSpec(level: LoadedLevel): InterviewSpec | null {
  const lv = level.level;
  if (lv.mode !== 'code' || !lv.interview) return null;
  return {
    minutes: lv.interview.minutes,
    rebuildOf: lv.interview.rebuild_of ?? null,
    hintXpCost: lv.interview.hint_xp_cost,
  };
}

export const limitMs = (spec: InterviewSpec): number => spec.minutes * 60_000;

/**
 * Records the moment the clock started. The first start wins: opening the level again (or POSTing /start a
 * second time) must not hand out a fresh ten minutes.
 */
export function startInterview(lp: LevelProgress, nowIso: string): void {
  lp.interviewStartedAt ??= nowIso;
}

function startMs(lp: LevelProgress): number | null {
  if (!lp.interviewStartedAt) return null;
  const t = Date.parse(lp.interviewStartedAt);
  return Number.isNaN(t) ? null : t;
}

/** Milliseconds since the clock started, never negative; null before it started. */
export function elapsedMs(lp: LevelProgress, nowMs: number): number | null {
  const s = startMs(lp);
  return s === null ? null : Math.max(0, nowMs - s);
}

/** Time left, never below 0; null before the clock started. */
export function remainingMs(spec: InterviewSpec, lp: LevelProgress, nowMs: number): number | null {
  const e = elapsedMs(lp, nowMs);
  return e === null ? null : Math.max(0, limitMs(spec) - e);
}

/** True once the deadline has passed (exactly at the deadline is still in time). */
export function isOvertime(spec: InterviewSpec, lp: LevelProgress, nowMs: number): boolean {
  const e = elapsedMs(lp, nowMs);
  return e !== null && e > limitMs(spec);
}

/** What a verify at `nowMs` records. `elapsedMs` is null when the clock never started. */
export function verifyTiming(
  spec: InterviewSpec,
  lp: LevelProgress,
  nowMs: number,
): { overtime: boolean; elapsedMs: number | null } {
  return { overtime: isOvertime(spec, lp, nowMs), elapsedMs: elapsedMs(lp, nowMs) };
}

/**
 * On the first pass: freeze the time. The clock stops being live and the screens read these two fields.
 * Does nothing when the level was not started as an interview (dev /complete on an unstarted level).
 */
export function settlePass(spec: InterviewSpec, lp: LevelProgress, nowMs: number): void {
  const t = verifyTiming(spec, lp, nowMs);
  if (t.elapsedMs === null) return;
  lp.interviewElapsedMs = t.elapsedMs;
  lp.overtime = t.overtime;
}

/**
 * Charges one hint: XP drops by `spec.hintXpCost` but never below 0, and `hintsBought` counts it.
 * Returns what was really taken, which is less than the cost when the learner had little XP.
 */
export function chargeHint(
  spec: InterviewSpec,
  progress: ProgressFile,
  lp: LevelProgress,
): { charged: number; xp: number; hintsBought: number } {
  const before = progress.xp;
  progress.xp = Math.max(0, before - spec.hintXpCost);
  lp.hintsBought = (lp.hintsBought ?? 0) + 1;
  return { charged: before - progress.xp, xp: progress.xp, hintsBought: lp.hintsBought };
}

export interface InterviewView {
  minutes: number;
  hintXpCost: number;
  /** The guided level this one repeats (on a pool level: the drawn one, null before the draw); the ideal-way panel links to it. */
  rebuildOf: { id: string; title: string | null } | null;
  startedAt: string | null;
  deadlineAt: string | null;
  overtime: boolean;
  /** How far past the deadline it is (live), or was when the level was passed. 0 when in time. */
  overtimeMs: number;
  hintsBought: number;
  /** Set once the level is passed: the time it took, frozen. */
  elapsedMs: number | null;
  /** E-04: true on a pool level. */
  pool: boolean;
  /** E-04: the level the interviewer drew (pool levels; null before the first start and on other levels). */
  drawn: { id: string; title: string; chapter: string; chapterTitle: string } | null;
  /** E-04: slot files moved aside when the level started blank, so the UI can say where the earlier file is. */
  blanked: { file: string; backup: string }[];
  /** E-04: index of the first follow-up question among `verifiers` (pool levels once drawn); null otherwise. */
  questionsFrom: number | null;
}

/** What a pool or blank-start level adds to the `interview` object (E-04). */
export interface InterviewExtras {
  pool: boolean;
  drawn: InterviewView['drawn'];
  blanked: InterviewView['blanked'];
  questionsFrom: number | null;
}

/**
 * The `interview` object of GET /api/levels/:id, and its sibling `remainingMs`. After a pass the clock is
 * frozen at the recorded elapsed time (`remainingMs` is what was left then, `overtime` what it was then).
 */
export function interviewView(
  spec: InterviewSpec,
  lp: LevelProgress,
  nowMs: number,
  rebuildTitle: string | null,
  extras: InterviewExtras = { pool: false, drawn: null, blanked: [], questionsFrom: null },
): { interview: InterviewView; remainingMs: number | null } {
  const s = startMs(lp);
  const frozen = lp.status === 'passed' && lp.interviewElapsedMs !== undefined;
  const remaining = frozen
    ? Math.max(0, limitMs(spec) - (lp.interviewElapsedMs as number))
    : remainingMs(spec, lp, nowMs);
  const elapsed = frozen ? (lp.interviewElapsedMs as number) : elapsedMs(lp, nowMs);
  return {
    interview: {
      minutes: spec.minutes,
      hintXpCost: spec.hintXpCost,
      rebuildOf: spec.rebuildOf
        ? { id: spec.rebuildOf, title: rebuildTitle }
        : extras.drawn
          ? { id: extras.drawn.id, title: extras.drawn.title }
          : null,
      startedAt: lp.interviewStartedAt ?? null,
      deadlineAt: s === null ? null : new Date(s + limitMs(spec)).toISOString(),
      overtime: frozen ? lp.overtime === true : isOvertime(spec, lp, nowMs),
      overtimeMs: elapsed === null ? 0 : Math.max(0, elapsed - limitMs(spec)),
      hintsBought: lp.hintsBought ?? 0,
      elapsedMs: frozen ? (lp.interviewElapsedMs as number) : null,
      pool: extras.pool,
      drawn: extras.drawn,
      blanked: extras.blanked,
      questionsFrom: extras.questionsFrom,
    },
    remainingMs: remaining,
  };
}
