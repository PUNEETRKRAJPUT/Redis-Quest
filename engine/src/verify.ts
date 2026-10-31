import type { LoadedLevel, TemplateContext } from '@quest/shared';
import type { EventBus } from './events.js';
import type { RedisManager } from './redis.js';

export type VerificationVerdict = 'right' | 'works_but_wrong' | 'wrong' | 'not_implemented';

export interface VerificationContext {
  templateCtx: TemplateContext;
  redis: RedisManager;
  events: EventBus;
  /** ISO time of the last POST /levels/:id/start; event verifiers look back to here. */
  startedAt?: string;
  /** 1-based number of this attempt. */
  attempt: number;
}

export interface VerificationOutcome {
  verdict: VerificationVerdict;
  /** P0-09 adds per-verifier results and messages here; the HTTP handler passes unknown fields through. */
  [extra: string]: unknown;
}

export type Answers = Record<string, string | string[]>;

/** P0-09 replaces the body of this function; nothing else in the engine knows how grading works. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function runVerification(level: LoadedLevel, ctx: VerificationContext, answers: Answers): Promise<VerificationOutcome> {
  return { verdict: 'not_implemented' };
}
