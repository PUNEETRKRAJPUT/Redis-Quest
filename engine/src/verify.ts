import type { LoadedLevel, TemplateContext } from '@quest/shared';
import type { EventBus } from './events.js';
import type { RedisManager } from './redis.js';
import type { Answers, Verifier, VerifyOutcome } from './verify/index.js';

export type { Answers } from './verify/index.js';

export interface VerificationContext {
  templateCtx: TemplateContext;
  redis: RedisManager;
  events: EventBus;
  /** ISO time of the last POST /levels/:id/start; event verifiers look back to here. */
  startedAt?: string;
  /** 1-based number of this attempt. */
  attempt: number;
  /** The verifier engine (engine/src/verify/), built once per server. */
  verifier: Verifier;
}

export type VerificationOutcome = VerifyOutcome;

/** Grades one attempt. The HTTP route owns locking (409), attempts and persistence. */
export async function runVerification(
  level: LoadedLevel,
  ctx: VerificationContext,
  answers: Answers,
): Promise<VerificationOutcome> {
  return ctx.verifier.verify(level, {
    templateCtx: ctx.templateCtx,
    startedAt: ctx.startedAt,
    attempt: ctx.attempt,
    answers,
  });
}
