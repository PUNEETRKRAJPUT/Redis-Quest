import type { LearnerError } from '@quest/shared';

/** An expected HTTP outcome raised from a route or a baseline (400, 404, 409 ...). */
export class HttpError extends Error {
  override name = 'HttpError';
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/**
 * The learner's code failed: it threw, timed out, or broke the slot's return contract. Always a 500 with
 * `x-quest-slot-error`, so a verifier can tell "your code failed" from "the app failed".
 */
export class SlotError extends Error {
  override name = 'SlotError';
  constructor(
    readonly slot: string,
    readonly learnerError: LearnerError,
  ) {
    super(learnerError.message);
  }
}

/** Header values must be visible ASCII on one line; learner messages can contain anything. */
export function headerSafe(text: string, max = 300): string {
  const flat = text.replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7e]/g, '?').trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat || 'error';
}
