import type { LearnerCallResult, LearnerCounters, LearnerMetrics } from './types.js';

/** Nearest-rank percentile over an ascending-sorted array; 0 for an empty array. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * sortedAsc.length));
  return sortedAsc[Math.min(rank, sortedAsc.length) - 1] ?? 0;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

export function aggregateMetrics(
  results: LearnerCallResult[],
  counters: LearnerCounters,
  totalMs: number,
): LearnerMetrics {
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  return {
    calls: results.length,
    errors: results.filter((r) => !r.ok).length,
    p50Ms: round(percentile(ms, 50)),
    p99Ms: round(percentile(ms, 99)),
    dbQueries: counters.dbQueries,
    redisCommands: counters.redisCommands,
    totalMs: round(totalMs),
  };
}
