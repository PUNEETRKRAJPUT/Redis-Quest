import type { LearnerCallResult, LearnerDeps, LearnerError, LearnerFn } from './types.js';

export class LearnerTimeoutError extends Error {
  override name = 'TimeoutError';
}

export function toLearnerError(err: unknown): LearnerError {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return { name: 'Error', message: typeof err === 'string' ? err : safeString(err) };
}

function safeString(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/** Make a return value JSON-safe: bigint to string, cycles and exotic values to a string, undefined to null. */
export function toJsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    const text = JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
    return text === undefined ? String(value) : (JSON.parse(text) as unknown);
  } catch {
    return String(value);
  }
}

/**
 * Call a learner function once and time it. Never throws: errors (sync or async) and timeouts come back
 * as `{ ok: false, error }`. The timeout only abandons the call; it cannot interrupt a synchronous loop,
 * so an in-process caller (the app) must accept that, while the runner's child process can be killed.
 */
export async function callLearner(
  fn: LearnerFn,
  deps: LearnerDeps,
  args: unknown[] = [],
  opts: { timeoutMs?: number } = {},
): Promise<LearnerCallResult> {
  const start = performance.now();
  const timeoutMs = opts.timeoutMs ?? 5000;
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new LearnerTimeoutError(`call exceeded ${timeoutMs} ms`)), Math.max(1, timeoutMs));
    });
    const value = await Promise.race([Promise.resolve().then(() => fn(deps, ...args)), timeout]);
    return { ok: true, value: toJsonValue(value), ms: performance.now() - start };
  } catch (err) {
    return { ok: false, error: toLearnerError(err), ms: performance.now() - start };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface RunCallsOptions {
  concurrency?: number;
  /** Budget for the whole batch; each call gets the time that remains, calls not started in time fail. */
  timeoutMs?: number;
}

/** Run many calls with a bounded worker pool. Results keep the order of `calls`. */
export async function runLearnerCalls(
  fn: LearnerFn,
  deps: LearnerDeps,
  calls: Array<{ args?: unknown[] }>,
  opts: RunCallsOptions = {},
): Promise<LearnerCallResult[]> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const workers = Math.max(1, Math.min(opts.concurrency ?? 1, calls.length || 1));
  const deadline = performance.now() + timeoutMs;
  const results: LearnerCallResult[] = new Array<LearnerCallResult>(calls.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= calls.length) return;
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        results[i] = {
          ok: false,
          error: { name: 'TimeoutError', message: `run budget of ${timeoutMs} ms spent before this call started` },
          ms: 0,
        };
        continue;
      }
      results[i] = await callLearner(fn, deps, calls[i]?.args ?? [], { timeoutMs: remaining });
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
