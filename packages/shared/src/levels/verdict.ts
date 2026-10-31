import type { VerifyType } from './schema.js';

/** The three outcomes of a verify run (PLAN.md section 4b, beat 6). */
export type Verdict = 'right' | 'works_but_wrong' | 'wrong';

/**
 * One verifier's outcome, in the order the level lists its `verify` entries.
 *
 * `passed` means "every check in this verifier held". For an `antipattern` verifier the checks
 * describe the healthy state (e.g. `EXISTS lb:hostel:h-c-02-1:list` equals 0), so `passed: false`
 * is a hit: the antipattern was detected.
 */
export interface VerifierResult {
  type: VerifyType;
  passed: boolean;
}

/**
 * The verdict rule, as a pure function:
 * any failing `redis | behavior | traffic | event | quiz` verifier gives `wrong`;
 * otherwise any `antipattern` hit gives `works_but_wrong`; otherwise `right`.
 *
 * An empty result list is `wrong`: a level always has at least one verifier, so "nothing ran"
 * means the run broke, and a broken run must never count as a pass.
 */
export function verdict(results: readonly VerifierResult[]): Verdict {
  if (results.length === 0) return 'wrong';
  if (results.some((r) => r.type !== 'antipattern' && !r.passed)) return 'wrong';
  if (results.some((r) => r.type === 'antipattern' && !r.passed)) return 'works_but_wrong';
  return 'right';
}
