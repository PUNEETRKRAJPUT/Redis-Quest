// Runs one scenario with autocannon from inside the engine and reduces the result to what verifiers grade.

import autocannon, { type Result } from 'autocannon';
import { requestFactory } from './sample.js';
import type { Scenario } from './scenario.js';

export interface LoadRunResult {
  startedAt: number;
  finishedAt: number;
  durationSec: number;
  connections: number;
  /** Completed responses (any status). */
  responses: number;
  ok2xx: number;
  non2xx: number;
  status5xx: number;
  /** Connection errors including timeouts (no response at all). */
  connErrors: number;
  timeouts: number;
  p50Ms: number;
  p99Ms: number;
  rps: number;
  /** (5xx + no response) / (responses + no response). A 404 or 429 is an answer, not an error. */
  errorRate: number;
  statusCodes: Record<string, number>;
}

export interface RunLoadOptions {
  /** Origin of the proxy, e.g. http://proxy:3000; scenario paths start with /app/. */
  origin: string;
  scenario: Scenario;
  connections: number;
  durationSec: number;
  seed?: number;
  timeoutSec?: number;
}

export type LoadRunner = (o: RunLoadOptions) => Promise<LoadRunResult>;

export function summarizeAutocannon(
  r: Result,
  connections: number,
): Omit<LoadRunResult, 'startedAt' | 'finishedAt'> {
  const statusCodes: Record<string, number> = {};
  let status5xx = 0;
  let responses = 0;
  for (const [code, v] of Object.entries(r.statusCodeStats ?? {})) {
    const n = Number(v.count) || 0;
    statusCodes[code] = n;
    responses += n;
    if (Number(code) >= 500) status5xx += n;
  }
  const connErrors = r.errors ?? 0;
  const durationSec = r.duration || 1;
  const attempts = responses + connErrors;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    durationSec: round(durationSec),
    connections,
    responses,
    ok2xx: r['2xx'] ?? 0,
    non2xx: r.non2xx ?? 0,
    status5xx,
    connErrors,
    timeouts: r.timeouts ?? 0,
    p50Ms: round(r.latency?.p50 ?? 0),
    p99Ms: round(r.latency?.p99 ?? 0),
    rps: round(responses / durationSec),
    errorRate: attempts === 0 ? 1 : round(((status5xx + connErrors) / attempts) * 10000) / 10000,
    statusCodes,
  };
}

export const runLoad: LoadRunner = async (o) => {
  const next = requestFactory(o.scenario, o.seed);
  const startedAt = Date.now();
  const result = await autocannon({
    url: o.origin,
    connections: o.connections,
    duration: o.durationSec,
    pipelining: o.scenario.pipelining,
    timeout: o.timeoutSec ?? 10,
    requests: [
      {
        setupRequest: (req) => {
          const p = next();
          req.method = p.method;
          req.path = p.path;
          req.headers = { ...p.headers };
          if (p.body !== undefined) req.body = p.body;
          else delete req.body;
          return req;
        },
      },
    ],
  });
  return { startedAt, finishedAt: Date.now(), ...summarizeAutocannon(result, o.connections) };
};
