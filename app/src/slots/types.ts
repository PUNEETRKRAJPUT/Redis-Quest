import type { LearnerDeps } from '@quest/shared';

/**
 * A baseline has exactly the learner's signature: the same counted `{ redis, db, log }` and the same
 * arguments, so swapping one for the other changes nothing else in the route.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SlotFn = (deps: LearnerDeps, ...args: any[]) => Promise<unknown>;

export interface SlotDef {
  /** `area.verbNoun`, matches SLOT_NAME from @quest/shared; this is what levels and the engine name. */
  name: string;
  /** Learner file, relative to WORKSPACE_DIR. */
  file: string;
  /** Export to call; `default` unless several slots share one file. */
  exportName?: string;
  /** Documentation for authors and the UI, e.g. `(deps, playerId)`. */
  signature: string;
  /** What the function must return; routes enforce it for learner code. */
  returns: string;
  /** The slow or naive path the incident is about. Runs whenever the slot is inactive or fails to load. */
  baseline: SlotFn;
}
