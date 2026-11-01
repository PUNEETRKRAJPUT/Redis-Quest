import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { summarizeAutocannon } from '../src/load/run.js';
import { indexSampler, requestFactory, rng, userId, weightedPicker } from '../src/load/sample.js';
import { applyCaps, loadScenario, parseScenario, ScenarioError, scenarioHash } from '../src/load/scenario.js';
import { loadCaps } from '../src/verify/config.js';

const SCENARIOS = join(dirname(fileURLToPath(import.meta.url)), '../../scenarios');

const base = {
  id: 'demo',
  durationSec: 10,
  connections: 50,
  users: { count: 100, distribution: 'uniform' },
  requests: [{ method: 'GET', path: '/app/players/{user}' }],
};

describe('parseScenario', () => {
  test('defaults: pipelining 1, seed 1, weight 1, idPattern u-{n} padded to 6', () => {
    const s = parseScenario(base, 'demo');
    expect(s).toMatchObject({ pipelining: 1, seed: 1, users: { idPattern: 'u-{n}', pad: 6 }, requests: [{ weight: 1, method: 'GET' }], params: {} });
  });
  test('rejects what can never be right', () => {
    const bad = (patch: object, msg: RegExp) => expect(() => parseScenario({ ...base, ...patch }, 'demo')).toThrow(msg);
    bad({ id: 'other' }, /id must be demo/);
    bad({ extra: 1 }, /unknown key 'extra'/);
    bad({ durationSec: 0 }, /durationSec must be an integer/);
    bad({ users: { count: 10, distribution: 'zipf' } }, /zipfSkew must be a number/);
    bad({ users: { count: 10, distribution: 'uniform', zipfSkew: 1 } }, /only used with distribution: zipf/);
    bad({ requests: [{ method: 'GET', path: '/players/1' }] }, /must start with \/app\//);
    bad({ requests: [{ method: 'GET', path: '/app/x/{nope}' }] }, /\{nope\}/);
    bad({ requests: [{ method: 'BREW', path: '/app/x' }] }, /method must be one of/);
    bad({ requests: [] }, /non-empty list/);
    bad({ params: { user: { values: ['a'] } } }, /'user' is reserved/);
    expect(() => parseScenario('nope')).toThrow(ScenarioError);
  });
  test('every file in scenarios/ parses and its id matches its name', async () => {
    const files = readdirSync(SCENARIOS).filter((f) => f.endsWith('.yaml'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) await expect(loadScenario(SCENARIOS, f.replace(/\.yaml$/, ''))).resolves.toBeTruthy();
  });
  test('missing scenario', async () => {
    await expect(loadScenario(SCENARIOS, 'no-such-scenario')).rejects.toThrow('scenarios/no-such-scenario.yaml does not exist');
  });
  test('hash changes with content', () => {
    expect(scenarioHash(parseScenario(base))).not.toBe(scenarioHash(parseScenario({ ...base, connections: 51 })));
  });
});

describe('caps', () => {
  test('defaults 200 connections, 30 s; LOW_POWER halves both', () => {
    expect(loadCaps({})).toEqual({ maxConnections: 200, maxDurationSec: 30, lowPower: false });
    expect(loadCaps({ LOW_POWER: '1' })).toEqual({ maxConnections: 100, maxDurationSec: 15, lowPower: true });
    expect(loadCaps({ LOAD_MAX_CONNECTIONS: '40', LOAD_MAX_DURATION_SEC: '8', LOW_POWER: '1' })).toEqual({ maxConnections: 20, maxDurationSec: 4, lowPower: true });
    expect(loadCaps({ LOAD_MAX_CONNECTIONS: 'abc' }).maxConnections).toBe(200);
  });
  test('applyCaps clamps the scenario and the warmup, and says so', () => {
    const s = parseScenario({ ...base, connections: 500, durationSec: 60, warmup: { durationSec: 20, connections: 300 } });
    expect(applyCaps(s, loadCaps({}))).toEqual({
      connections: 200,
      durationSec: 30,
      warmup: { durationSec: 20, connections: 200 },
      capped: { connections: true, durationSec: true },
    });
    expect(applyCaps(parseScenario(base), loadCaps({})).capped).toEqual({ connections: false, durationSec: false });
  });
});

describe('sampling (deterministic with a seed)', () => {
  test('same seed, same stream', () => {
    const a = rng(42);
    const b = rng(42);
    const xs = [...Array(5)].map(() => a());
    expect([...Array(5)].map(() => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(rng(43)()).not.toBe(xs[0]);
  });
  test('uniform covers the range evenly', () => {
    const pick = indexSampler(4, 'uniform', rng(1));
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 40_000; i++) counts[pick()]! += 1;
    for (const c of counts) expect(c).toBeGreaterThan(9_000);
  });
  test('zipf makes rank 1 the hot key with the expected share', () => {
    const n = 100;
    const pick = indexSampler(n, 'zipf', rng(7), 1);
    const counts = new Array(n).fill(0);
    const N = 100_000;
    for (let i = 0; i < N; i++) counts[pick()] += 1;
    let h = 0;
    for (let k = 1; k <= n; k++) h += 1 / k;
    const expectedTop = 1 / h; // about 0.193 for n = 100, s = 1
    expect(Math.abs(counts[0] / N - expectedTop)).toBeLessThan(0.01);
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[9]);
  });
  test('weighted mix', () => {
    const pick = weightedPicker([{ id: 'a', weight: 3 }, { id: 'b', weight: 1 }], rng(3));
    let a = 0;
    for (let i = 0; i < 40_000; i++) if (pick().id === 'a') a += 1;
    expect(a / 40_000).toBeCloseTo(0.75, 1);
  });
  test('requestFactory fills {user} and params, sets the user header, same seed same requests', () => {
    const s = parseScenario({
      ...base,
      params: { player: { values: ['p-028', 'p-101'], distribution: 'uniform' } },
      requests: [{ method: 'GET', path: '/app/players/{player}/stats', userIdHeader: 'x-user-id' }, { method: 'POST', path: '/app/login', weight: 1, body: { userId: '{user}' } }],
    });
    const f1 = requestFactory(s, 9);
    const f2 = requestFactory(s, 9);
    const r1 = [...Array(20)].map(() => f1());
    expect([...Array(20)].map(() => f2())).toEqual(r1);
    const get = r1.find((r) => r.method === 'GET');
    expect(get?.path).toMatch(/^\/app\/players\/p-(028|101)\/stats$/);
    expect(get?.headers['x-user-id']).toMatch(/^u-\d{6}$/);
    const post = r1.find((r) => r.method === 'POST');
    expect(JSON.parse(post?.body ?? '{}').userId).toMatch(/^u-\d{6}$/);
    expect(userId('u-{n}', 6, 42)).toBe('u-000042');
  });
});

describe('summarizeAutocannon', () => {
  test('error rate counts 5xx and missing responses, not 404 or 429', () => {
    const r = summarizeAutocannon(
      {
        latency: { p50: 2, p99: 40 } as never,
        requests: {} as never,
        duration: 10,
        errors: 5,
        timeouts: 2,
        non2xx: 40,
        '2xx': 950,
        statusCodeStats: { '200': { count: 950 }, '404': { count: 20 }, '429': { count: 10 }, '503': { count: 10 } },
        start: new Date(),
        finish: new Date(),
      },
      50,
    );
    expect(r).toMatchObject({ responses: 990, status5xx: 10, connErrors: 5, p99Ms: 40, rps: 99 });
    expect(r.errorRate).toBeCloseTo(15 / 995, 4);
  });
});
