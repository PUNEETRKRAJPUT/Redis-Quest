// The fixed-step clock behind every cabinet. The game advances in equal steps whatever the frame rate, so a run is
// the same on a slow screen and a fast one. Pure: the hook that drives it is in useFixedLoop.ts.

export interface ClockResult {
  /** Whole steps to run now. */
  steps: number;
  /** Time left over, to pass to the next call. */
  accMs: number;
}

export interface ClockLimits {
  /** A frame longer than this counts as this long (a hidden tab or a stall must not fast-forward the game). */
  maxDeltaMs?: number;
  /** At most this many steps per frame; the rest is dropped. */
  maxSteps?: number;
}

export function advanceClock(
  accMs: number,
  deltaMs: number,
  stepMs: number,
  limits: ClockLimits = {},
): ClockResult {
  const maxDelta = limits.maxDeltaMs ?? 250;
  const maxSteps = limits.maxSteps ?? 5;
  const delta = Math.min(Math.max(Number.isFinite(deltaMs) ? deltaMs : 0, 0), maxDelta);
  let acc = Math.max(0, accMs) + delta;
  let steps = Math.floor(acc / stepMs);
  if (steps > maxSteps) steps = maxSteps;
  acc -= steps * stepMs;
  if (acc >= stepMs) acc = 0;
  return { steps, accMs: acc };
}
