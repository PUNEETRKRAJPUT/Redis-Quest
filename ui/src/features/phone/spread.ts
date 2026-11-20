export interface Spread {
  n: number;
  minMs: number;
  p50Ms: number;
  p90Ms: number;
  maxMs: number;
  meanMs: number;
}

/** Nearest-rank percentile of an ascending list. */
function rank(sorted: readonly number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i] as number;
}

/** The numbers behind "Refresh 20 times". Null for no samples. */
export function summarizeSpread(samples: readonly number[]): Spread | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    minMs: sorted[0] as number,
    p50Ms: rank(sorted, 50),
    p90Ms: rank(sorted, 90),
    maxMs: sorted[sorted.length - 1] as number,
    meanMs: sum / sorted.length,
  };
}

/** Where each sample sits on a strip from the fastest to the slowest, in percent (all the same: the middle). */
export function dotPositions(samples: readonly number[]): number[] {
  if (samples.length === 0) return [];
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  if (hi === lo) return samples.map(() => 50);
  return samples.map((s) => ((s - lo) / (hi - lo)) * 100);
}
