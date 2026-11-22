import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createLearnerDeps } from '@quest/shared';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { databaseUrl, redisUrl, workspaceDir } from './env.js';

let app: FastifyInstance;
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), 'quest-runner-'));
  app = buildServer({ port: 0, workspaceDir, redisUrl, databaseUrl }, pino({ level: 'silent' }));
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await rm(scratch, { recursive: true, force: true });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function post(url: string, payload: unknown): Promise<{ status: number; body: any }> {
  const res = await app.inject({ method: 'POST', url, payload: payload as object });
  return { status: res.statusCode, body: res.json() };
}

describe('runner HTTP API', () => {
  test('GET /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ ok: true, service: 'runner' });
  });

  test('/load: ok, helpers, syntax error, no default, missing, bad path', async () => {
    expect((await post('/load', { module: '_examples/ok.js' })).body).toEqual({
      ok: true,
      exports: ['default'],
    });
    expect((await post('/load', { module: '_examples/helpers.js' })).body.exports.sort()).toEqual([
      'default',
      'double',
    ]);
    const bad = (await post('/load', { module: '_examples/bad-syntax.js' })).body;
    expect(bad.ok).toBe(false);
    expect(bad.error.name).toBe('SyntaxError');
    expect((await post('/load', { module: '_examples/no-default.js' })).body.error.message).toMatch(
      /no default export/,
    );
    expect((await post('/load', { module: '_examples/missing.js' })).body.error.message).toMatch(
      /not found/,
    );
    const trav = await post('/load', { module: '../package.json' });
    expect(trav.status).toBe(400);
  });

  test('/run ok.js: value, 1 db query, 2 redis commands, logs', async () => {
    const { body } = await post('/run', {
      module: '_examples/ok.js',
      calls: [{ args: ['quest'] }],
    });
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ ok: true, value: { greeting: 'hello quest', two: 2 } });
    expect(body.metrics).toMatchObject({ calls: 1, errors: 0, dbQueries: 1, redisCommands: 2 });
    expect(body.logs).toContain('read greeting: hello quest');
  });

  test('/run multi.js counts the transaction as one command', async () => {
    const { body } = await post('/run', { module: '_examples/multi.js' });
    expect(body.results[0].value).toEqual(['OK', 2, '2']);
    expect(body.metrics.redisCommands).toBe(1);
  });

  test('/run throws.js reports the error and the runner stays healthy', async () => {
    const { body } = await post('/run', { module: '_examples/throws.js', calls: [{}, {}] });
    expect(body.results[0]).toMatchObject({
      ok: false,
      error: { name: 'TypeError', message: expect.stringContaining('always throws') },
    });
    expect(body.results[0].error.stack).toContain('throws.js');
    expect(body.metrics).toMatchObject({ calls: 2, errors: 2 });
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  test('/run on a syntax-error module fails every call with SyntaxError', async () => {
    const { body } = await post('/run', { module: '_examples/bad-syntax.js', calls: [{}, {}] });
    expect(body.results.map((r: any) => r.error.name)).toEqual(['SyntaxError', 'SyntaxError']); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  test('/run hangs.js: TimeoutError within the limit', async () => {
    const { body } = await post('/run', { module: '_examples/hangs.js', timeoutMs: 1000 });
    expect(body.results[0].error.name).toBe('TimeoutError');
    expect(body.runError).toBeUndefined();
    // The limit is the call's own clock, measured inside the child. How long the child took to start is not the
    // learner's time: on a busy CI machine that alone has been close to a second.
    expect(body.results[0].ms).toBeGreaterThanOrEqual(950);
    expect(body.results[0].ms).toBeLessThan(1500);
  });

  test('/run: a child that is slow to start still answers TimeoutError, not KilledError', async () => {
    // The hard kill comes timeoutMs + 1000 after the learner's code STARTS. It used to be counted from the spawn,
    // so whatever the child spent booting, connecting and importing came out of that one second, and a slow start
    // turned a polite timeout into "the process was killed" (seen on a hosted CI runner, 2026-11-22). The import
    // below waits 1.1 s on purpose: with the old clock the kill at 3.0 s always beat the timeout at 3.1 s or later.
    const local = buildServer(
      { port: 0, workspaceDir: scratch, redisUrl, databaseUrl },
      pino({ level: 'silent' }),
    );
    await writeFile(
      path.join(scratch, 'slow-start.js'),
      'await new Promise((r) => setTimeout(r, 1100));\nexport default async () => {\n  await new Promise(() => {});\n};\n',
    );
    const res = (
      await local.inject({
        method: 'POST',
        url: '/run',
        payload: { module: 'slow-start.js', timeoutMs: 2000 },
      })
    ).json();
    await local.close();
    expect(res.results[0].error.name).toBe('TimeoutError');
    expect(res.runError).toBeUndefined();
  });

  test('/run spins.js (sync infinite loop): hard-killed by timeoutMs + 1000', async () => {
    const t = performance.now();
    const { body } = await post('/run', { module: '_examples/spins.js', timeoutMs: 1000 });
    const took = performance.now() - t;
    // Killed timeoutMs + 1000 after the code started: never before two seconds, and the rest is the child's start.
    expect(took).toBeGreaterThanOrEqual(1950);
    expect(took).toBeLessThan(5000);
    expect(body.results[0].error.name).toBe('KilledError');
    expect(body.runError.name).toBe('KilledError');
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  test('/run exits.js is reported and the runner stays healthy', async () => {
    const { body } = await post('/run', { module: '_examples/exits.js' });
    expect(body.results[0].error.name).toBe('ChildExitError');
    expect(body.results[0].error.message).toContain('exit code 3');
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  test('/run unhandled.js: child survives, call succeeds, rejection is logged', async () => {
    const { body } = await post('/run', { module: '_examples/unhandled.js' });
    expect(body.results[0].ok).toBe(true);
    expect(body.logs.join('\n')).toContain('nobody caught this');
  });

  test('/run concurrent-counter.js with concurrency 50 leaves exactly 50', async () => {
    const { deps, close } = await createLearnerDeps({ redisUrl });
    const r = deps.redis;
    await r.del('runner:example:counter');
    const calls = Array.from({ length: 50 }, () => ({ args: [] }));
    const { body } = await post('/run', {
      module: '_examples/concurrent-counter.js',
      calls,
      concurrency: 50,
    });
    expect(body.metrics).toMatchObject({ calls: 50, errors: 0, redisCommands: 50 });
    expect(await r.get('runner:example:counter')).toBe('50');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(body.results.map((x: any) => x.value).sort((a: number, b: number) => a - b)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
    await r.del('runner:example:counter');
    await close();
  });

  test('an edited module returns the new value on the next run (no stale cache)', async () => {
    const local = buildServer(
      { port: 0, workspaceDir: scratch, redisUrl, databaseUrl },
      pino({ level: 'silent' }),
    );
    const file = path.join(scratch, 'edit.js');
    await writeFile(file, 'export default async () => "v1";\n');
    const a = (
      await local.inject({ method: 'POST', url: '/run', payload: { module: 'edit.js' } })
    ).json();
    await writeFile(file, 'export default async () => "v2 and longer";\n');
    const b = (
      await local.inject({ method: 'POST', url: '/run', payload: { module: 'edit.js' } })
    ).json();
    expect([a.results[0].value, b.results[0].value]).toEqual(['v1', 'v2 and longer']);
    await local.close();
  });

  test('redisUrl override is honoured (dead port gives a clear error)', async () => {
    const { body } = await post('/run', {
      module: '_examples/ok.js',
      redisUrl: 'redis://127.0.0.1:1',
    });
    expect(body.results[0].ok).toBe(false);
    expect(body.metrics.errors).toBe(1);
  });

  test('bad requests get 400', async () => {
    expect((await post('/run', {})).status).toBe(400);
    expect((await post('/run', { module: '_examples/ok.js', calls: 'x' })).status).toBe(400);
    expect((await post('/run', { module: '_examples/ok.js', timeoutMs: 'x' })).status).toBe(400);
  });
});
