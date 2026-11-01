// E-04: the numbers a traffic check measured, picked out of the verify outcome for the save file.

import type { VerdictMetrics } from './progress.js';

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const rec = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/**
 * `outcome.metrics` is `{ index, ...details }` of the traffic check: `run` (the graded run), and `baseline.run`
 * (the run with the learner's slots off). Returns only the fields that exist, or undefined when there are none
 * (no traffic check, or it was skipped).
 */
export function verdictMetrics(
  outcomeMetrics: Record<string, unknown> | undefined,
): VerdictMetrics | undefined {
  const m = rec(outcomeMetrics);
  const run = rec(m?.run);
  if (!run) return undefined;
  const load = rec(run.load);
  const app = rec(run.app);
  const baseRun = rec(rec(m?.baseline)?.run);
  const baseLoad = rec(baseRun?.load);
  const baseApp = rec(baseRun?.app);
  const requests = num(app?.requests);
  const redisCommands = num(app?.redisCommands);
  const out: VerdictMetrics = {};
  const put = <K extends keyof VerdictMetrics>(k: K, v: number | undefined) => {
    if (v !== undefined) out[k] = Math.round(v * 10_000) / 10_000;
  };
  put('p99Ms', num(load?.p99Ms));
  put('baselineP99Ms', num(baseLoad?.p99Ms));
  put('dbPerRequest', num(app?.dbPerRequest));
  put('baselineDbPerRequest', num(baseApp?.dbPerRequest));
  put(
    'redisPerRequest',
    requests && redisCommands !== undefined ? redisCommands / requests : undefined,
  );
  put('hitRatio', num(app?.hitRatio));
  put('rps', num(load?.rps));
  return Object.keys(out).length > 0 ? out : undefined;
}
