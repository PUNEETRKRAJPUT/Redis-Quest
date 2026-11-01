// The `behavior` verifier and the behavior-shaped `antipattern`: call the learner's slot function in
// the runner (P0-08) and judge what it returned, what it threw, and what it left in Redis.

import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import {
  fixtureFileSchema,
  renderTemplates,
  resolveLevelPath,
  type BehaviorAssertion,
  type JsonValue,
  type LoadedLevel,
  type SetupStep,
  type TemplateContext,
} from '@quest/shared';
import { assertSetupCommandAllowed } from '../setup.js';
import { runChecks } from './redis-checks.js';
import { formatJson } from './reply.js';
import type { CheckItem, SendCommand } from './types.js';

/** What `POST ${RUNNER_URL}/run` answers (docs/handoffs/P0-08.md). */
export interface RunnerCallResult {
  ok: boolean;
  value?: unknown;
  error?: { name: string; message: string };
  ms: number;
}
export interface RunnerResponse {
  results: RunnerCallResult[];
  metrics?: Record<string, number>;
  logs?: string[];
  runError?: { name: string; message: string };
}
export interface RunnerRequest {
  module: string;
  calls: Array<{ args: unknown[] }>;
  concurrency: number;
  timeoutMs: number;
  redisUrl?: string;
}
export type RunFn = (req: RunnerRequest) => Promise<RunnerResponse>;

/** The runner clamps concurrency to this (runner/src/server.ts). */
export const RUNNER_MAX_CONCURRENCY = 200;

export function httpRunner(runnerUrl: string): RunFn {
  return async (req) => {
    const res = await fetch(`${runnerUrl.replace(/\/$/, '')}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(req.timeoutMs + 15_000),
    });
    const body = (await res.json()) as RunnerResponse & {
      ok?: boolean;
      error?: { message?: string };
    };
    if (!res.ok || !Array.isArray(body.results)) {
      throw new Error(
        `runner answered ${res.status}: ${body.error?.message ?? JSON.stringify(body).slice(0, 200)}`,
      );
    }
    return body;
  };
}

/** Deep equality on JSON values; object key order does not matter, types do (`"1"` is not `1`). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]));
  }
  const ka = Object.keys(a as object).filter(
    (k) => (a as Record<string, unknown>)[k] !== undefined,
  );
  const kb = Object.keys(b as object).filter(
    (k) => (b as Record<string, unknown>)[k] !== undefined,
  );
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

function countText(ec: NonNullable<BehaviorAssertion['expectCount']>): string {
  if (ec.equals !== undefined) return `exactly ${ec.equals}`;
  if (ec.gte !== undefined) return `at least ${ec.gte}`;
  if (ec.lte !== undefined) return `at most ${ec.lte}`;
  const [lo, hi] = ec.between ?? [0, 0];
  return `between ${lo} and ${hi}`;
}

function countOk(ec: NonNullable<BehaviorAssertion['expectCount']>, n: number): boolean {
  if (ec.equals !== undefined) return n === ec.equals;
  if (ec.gte !== undefined) return n >= ec.gte;
  if (ec.lte !== undefined) return n <= ec.lte;
  const [lo, hi] = ec.between ?? [0, -1];
  return n >= lo && n <= hi;
}

function errorText(e: { name: string; message: string } | undefined): string {
  if (!e) return 'an unknown error';
  if (e.name === 'LearnerModuleError') return `your file could not be loaded: ${e.message}`;
  if (e.name === 'TimeoutError') return `it did not finish in time (${e.message})`;
  return `${e.name}: ${e.message}`;
}

export interface AssertionReport {
  call: { args: JsonValue[] };
  repeat: number;
  ok: boolean;
  feedback: string;
  returnedMatching?: number;
  errors: number;
  firstError?: string;
  sideEffects?: CheckItem[];
  ms: number;
}

/** Judges one assertion's runner results. Exported for unit tests. */
export function judgeCalls(
  a: BehaviorAssertion,
  results: RunnerCallResult[],
): { ok: boolean; detail: string; matching?: number } {
  const n = results.length;
  const failed = results.filter((r) => !r.ok);
  const on = (i: number) => (n > 1 ? ` on call ${i + 1} of ${n}` : '');

  if (n === 0) return { ok: false, detail: 'the runner returned no results' };

  if (a.expectError !== undefined) {
    const re = typeof a.expectError === 'string' ? new RegExp(a.expectError) : null;
    for (const [i, r] of results.entries()) {
      if (r.ok)
        return {
          ok: false,
          detail: `expected it to throw, but it returned ${formatJson(r.value)}${on(i)}`,
        };
      if (re && !re.test(r.error?.message ?? '')) {
        return {
          ok: false,
          detail: `expected an error matching /${a.expectError}/, got ${errorText(r.error)}${on(i)}`,
        };
      }
    }
    return { ok: true, detail: '' };
  }

  // A correct function does not throw, so any thrown call fails the assertion, under any expectation.
  if (failed.length > 0) {
    const first = failed[0];
    const share = n > 1 ? `${failed.length} of ${n} calls threw; the first: ` : 'the call threw: ';
    return { ok: false, detail: `${share}${errorText(first?.error)}` };
  }

  if (a.expect !== undefined) {
    const i = results.findIndex((r) => !deepEqual(r.value, a.expect));
    if (i !== -1)
      return {
        ok: false,
        detail: `expected ${formatJson(a.expect)}, got ${formatJson(results[i]?.value)}${on(i)}`,
      };
    return { ok: true, detail: '' };
  }

  if (a.expectCount !== undefined) {
    const ec = a.expectCount;
    const matching = results.filter((r) => deepEqual(r.value, ec.value)).length;
    const ok = countOk(ec, matching);
    return {
      ok,
      matching,
      detail: ok
        ? ''
        : `expected ${countText(ec)} of ${n} calls to return ${formatJson(ec.value)}, got ${matching}`,
    };
  }
  return { ok: true, detail: '' };
}

export async function loadFixtureSteps(
  level: LoadedLevel,
  rel: string,
  ctx: TemplateContext,
): Promise<SetupStep[]> {
  const file = resolveLevelPath(level, rel);
  const parsed = fixtureFileSchema.parse(parseYaml(await readFile(file, 'utf8')));
  return renderTemplates(parsed.steps, ctx) as SetupStep[];
}

/** Runs fixture steps; returns an error line instead of throwing, so the verifier can report it. */
export async function runFixtureSteps(
  steps: readonly SetupStep[],
  send: SendCommand,
): Promise<string | null> {
  for (const [i, step] of steps.entries()) {
    if (!('cmd' in step)) {
      // Never skip silently: a skipped reset could make a wrong solution pass.
      return `fixtures step ${i + 1} is a ${'sql' in step ? 'sql' : 'script'} step, which the engine cannot run yet`;
    }
    try {
      assertSetupCommandAllowed(step.cmd);
      await send(step.cmd);
    } catch (err) {
      return `fixtures step ${i + 1} failed: ${(err as Error).message}`;
    }
  }
  return null;
}

export interface BehaviorInput {
  slot: string;
  module: string | undefined;
  concurrency?: number;
  assertions: BehaviorAssertion[];
}

export async function runAssertions(
  v: BehaviorInput,
  deps: { run: RunFn; send: SendCommand; redisUrl?: string; timeoutMs?: number },
): Promise<{ ok: boolean; message: string; reports: AssertionReport[]; concurrency: number }> {
  const concurrency = Math.min(v.concurrency ?? 1, RUNNER_MAX_CONCURRENCY);
  const reports: AssertionReport[] = [];
  const lines: string[] = [];
  if (!v.module) {
    return {
      ok: false,
      message: `The engine does not know which workspace file implements slot ${v.slot}.`,
      reports,
      concurrency,
    };
  }
  for (const a of v.assertions) {
    const repeat = a.repeat ?? 1;
    const base = a.message ?? `${v.slot}(${a.call.args.map((x) => formatJson(x, 60)).join(', ')})`;
    const started = Date.now();
    let results: RunnerCallResult[] = [];
    let runnerError: string | null = null;
    try {
      const res = await deps.run({
        module: v.module,
        calls: Array.from({ length: repeat }, () => ({ args: a.call.args })),
        concurrency,
        timeoutMs:
          deps.timeoutMs ?? Math.min(60_000, 10_000 + Math.ceil(repeat / concurrency) * 200),
        ...(deps.redisUrl ? { redisUrl: deps.redisUrl } : {}),
      });
      results = res.results;
    } catch (err) {
      runnerError = (err as Error).message;
    }
    const report: AssertionReport = {
      call: a.call,
      repeat,
      ok: false,
      feedback: '',
      errors: results.filter((r) => !r.ok).length,
      ms: 0,
    };
    const firstErr = results.find((r) => !r.ok)?.error;
    if (firstErr) report.firstError = errorText(firstErr);

    const assertionLines: string[] = [];
    if (runnerError) {
      assertionLines.push(
        `${base} (the runner that calls your function is not reachable: ${runnerError})`,
      );
    } else {
      const judged = judgeCalls(a, results);
      if (judged.matching !== undefined) report.returnedMatching = judged.matching;
      if (!judged.ok) assertionLines.push(`${base} (${judged.detail})`);
      if (a.sideEffect) {
        const items = await runChecks(deps.send, a.sideEffect);
        report.sideEffects = items;
        items.forEach((it, i) => {
          if (it.ok) return;
          // A side-effect check without its own message borrows the assertion's.
          const own = a.sideEffect?.[i]?.message;
          assertionLines.push(
            own
              ? it.feedback
              : `${base} (after the call, ${it.cmd}: expected ${it.expected}, got ${it.observed})`,
          );
        });
      }
    }
    report.ok = assertionLines.length === 0;
    report.feedback = assertionLines.join('\n');
    report.ms = Date.now() - started;
    reports.push(report);
    lines.push(...assertionLines);
  }
  const ok = lines.length === 0;
  const n = v.assertions.length;
  return {
    ok,
    message: ok
      ? n === 1
        ? 'The assertion held.'
        : `All ${n} assertions held.`
      : lines.join('\n'),
    reports,
    concurrency,
  };
}
