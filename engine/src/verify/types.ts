import type { Verdict, VerifyType } from '@quest/shared';

/**
 * One verifier's result as the UI reads it. `index` is the position in the level's `verify` list
 * (the same index the level payload and `answers` use). For `type: antipattern`, `ok: false` is a
 * hit: the "works, but wrong" feedback is in `message`.
 */
export interface CheckResult {
  index: number;
  type: VerifyType;
  ok: boolean;
  /** One or more lines, ready to show. Failing lines are the level's `message` plus the observed value. */
  message: string;
  details: Record<string, unknown>;
  durationMs: number;
  /** True when the engine did not run this verifier because the verdict was already `wrong` (traffic only). */
  skipped?: boolean;
}

/** The response of POST /api/levels/:id/verify (the route adds `attempts` and `status`). */
export interface VerifyOutcome {
  verdict: Verdict;
  levelId: string;
  attempt: number;
  startedAt: string | null;
  checks: CheckResult[];
  durationMs: number;
  /** Present when the level has a traffic verifier that ran: the graded run, its baseline and ratios. */
  metrics?: Record<string, unknown>;
}

/** A redis-shaped check (redis, antipattern `checks`, behavior `sideEffect`) after it ran. */
export interface CheckItem {
  cmd: string;
  ok: boolean;
  expected: string;
  observed: string;
  /** The line shown to the learner when `ok` is false. */
  feedback: string;
}

export type SendCommand = (argv: string[]) => Promise<unknown>;
