// A seeded random source for cabinets, so a run can be replayed from its seed (mulberry32). Pure: the state is a
// plain number the game keeps in its own state, so the same seed and the same actions give the same round.

export interface Draw {
  /** In [0, 1). */
  value: number;
  /** Pass this to the next draw. */
  state: number;
}

/** Any number becomes a valid 32-bit state. */
export function seedState(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
}

export function nextRandom(state: number): Draw {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: a };
}

/** A whole number in [min, max], both included. */
export function drawInt(state: number, min: number, max: number): Draw {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  const d = nextRandom(state);
  return { value: lo + Math.floor(d.value * (hi - lo + 1)), state: d.state };
}

/** An index into `weights`, chosen in proportion to the weights (non-positive weights are never chosen). */
export function drawWeighted(state: number, weights: readonly number[]): Draw {
  const d = nextRandom(state);
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total <= 0) return { value: 0, state: d.state };
  let target = d.value * total;
  for (let i = 0; i < weights.length; i++) {
    target -= Math.max(0, weights[i] ?? 0);
    if (target < 0) return { value: i, state: d.state };
  }
  // Rounding left a sliver: the last candidate with weight.
  for (let i = weights.length - 1; i >= 0; i--)
    if ((weights[i] ?? 0) > 0) return { value: i, state: d.state };
  return { value: 0, state: d.state };
}

/** A fresh seed for a new run. `?seed=123` in the address replays a run. */
export function freshSeed(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
  now: number = Date.now(),
): number {
  const raw = new URLSearchParams(search).get('seed');
  if (raw !== null && /^\d{1,10}$/.test(raw)) return seedState(Number(raw));
  return seedState(now ^ Math.floor(Math.random() * 0x7fffffff));
}
