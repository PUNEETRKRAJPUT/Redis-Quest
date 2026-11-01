// Deterministic sampling for scenarios: a seeded PRNG, uniform and Zipf choices, weighted request mix.

import type { Distribution, Scenario, ScenarioRequest } from './scenario.js';

/** mulberry32: tiny, fast, good enough for picking ids; the same seed gives the same stream. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Index in [0, n) by binary search over a cumulative distribution. */
function fromCdf(cdf: Float64Array, r: number): number {
  const target = r * (cdf[cdf.length - 1] ?? 1);
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((cdf[mid] ?? 0) <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Returns a sampler of indexes in [0, n). Zipf: P(rank k) is proportional to 1 / k^skew, rank 1
 * (index 0) the hottest, which is how one celebrity player becomes the hot key.
 */
export function indexSampler(
  n: number,
  dist: Distribution,
  rand: () => number,
  skew = 1,
): () => number {
  if (dist === 'uniform') return () => Math.min(n - 1, Math.floor(rand() * n));
  const cdf = new Float64Array(n);
  let sum = 0;
  for (let k = 1; k <= n; k++) {
    sum += 1 / k ** skew;
    cdf[k - 1] = sum;
  }
  return () => fromCdf(cdf, rand());
}

export function weightedPicker<T extends { weight: number }>(
  items: readonly T[],
  rand: () => number,
): () => T {
  const cdf = new Float64Array(items.length);
  let sum = 0;
  items.forEach((it, i) => {
    sum += it.weight;
    cdf[i] = sum;
  });
  return () => items[fromCdf(cdf, rand())] as T;
}

export function userId(pattern: string, pad: number, n: number): string {
  return pattern.replace('{n}', String(n).padStart(pad, '0'));
}

export interface PlannedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

function fill(s: string, vars: Record<string, string>, encode = false): string {
  return s.replace(/\{([^}]*)\}/g, (m, name: string) => {
    const v = vars[name];
    if (v === undefined) return m;
    return encode ? encodeURIComponent(v) : v;
  });
}

function fillDeep(v: unknown, vars: Record<string, string>): unknown {
  if (typeof v === 'string') return fill(v, vars);
  if (Array.isArray(v)) return v.map((x) => fillDeep(x, vars));
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillDeep(x, vars)]));
  return v;
}

/** A stream of concrete requests for a scenario: same seed, same sequence. */
export function requestFactory(s: Scenario, seed = s.seed): () => PlannedRequest {
  const rand = rng(seed);
  const pickRequest = weightedPicker<ScenarioRequest>(s.requests, rand);
  const pickUser = indexSampler(s.users.count, s.users.distribution, rand, s.users.zipfSkew);
  const pools = Object.entries(s.params).map(([name, p]) => ({
    name,
    values: p.values,
    pick: indexSampler(p.values.length, p.distribution, rand, p.zipfSkew),
  }));
  return () => {
    const req = pickRequest();
    const vars: Record<string, string> = {
      user: userId(s.users.idPattern, s.users.pad, pickUser() + 1),
    };
    for (const p of pools) vars[p.name] = p.values[p.pick()] as string;
    const headers: Record<string, string> = {};
    if (req.userIdHeader) headers[req.userIdHeader] = vars.user as string;
    const out: PlannedRequest = { method: req.method, path: fill(req.path, vars, true), headers };
    if (req.body !== undefined) {
      out.body = JSON.stringify(fillDeep(req.body, vars));
      headers['content-type'] = 'application/json';
    }
    return out;
  };
}
