import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { parseTarget, resolveWorkspacePath } from '@quest/shared';
import type { RunnerConfig } from './config.js';
import { crashResults, runInChild } from './executor.js';
import type { ChildJob } from './protocol.js';

const MAX_CALLS = 10_000;
const MAX_CONCURRENCY = 200;
const MAX_TIMEOUT_MS = 60_000;

class BadRequest extends Error {
  override name = 'BadRequest';
}

function validModule(config: RunnerConfig, body: Record<string, unknown>): string {
  const mod = body.module;
  if (typeof mod !== 'string' || mod === '')
    throw new BadRequest('"module" must be a path under the workspace, e.g. "_examples/ok.js"');
  try {
    resolveWorkspacePath(config.workspaceDir, mod);
  } catch (err) {
    throw new BadRequest((err as Error).message);
  }
  return mod;
}

function optString(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new BadRequest(`"${key}" must be a string`);
  return v;
}

/**
 * `redisUrl` may name any target the engine can: redis://, rediss://, sentinel://<master>@h:p,... or
 * cluster://h:p,... (the shared parseTarget decides). Anything else is a 400 with the parser's own words.
 */
function optTarget(body: Record<string, unknown>, key: string): string | undefined {
  const v = optString(body, key);
  if (v === undefined) return undefined;
  try {
    parseTarget(v);
  } catch (err) {
    throw new BadRequest(`"${key}" is not a valid Redis target: ${(err as Error).message}`);
  }
  return v;
}

function optInt(
  body: Record<string, unknown>,
  key: string,
  def: number,
  min: number,
  max: number,
): number {
  const v = body[key];
  if (v === undefined) return def;
  if (typeof v !== 'number' || !Number.isFinite(v))
    throw new BadRequest(`"${key}" must be a number`);
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

export function buildServer(config: RunnerConfig, log: FastifyBaseLogger): FastifyInstance {
  const app = Fastify({ loggerInstance: log, bodyLimit: 5 * 1024 * 1024 });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err instanceof BadRequest ? 400 : (err.statusCode ?? 500);
    void reply.status(status).send({ ok: false, error: { name: err.name, message: err.message } });
  });

  app.get('/health', async () => ({ ok: true, service: 'runner' }));

  app.post('/load', async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const module = validModule(config, body);
    const job: ChildJob = {
      mode: 'load',
      workspaceDir: config.workspaceDir,
      module,
      exportName: optString(body, 'export') ?? 'default',
      calls: [],
      concurrency: 1,
      timeoutMs: 5000,
    };
    const out = await runInChild(job, 6000);
    if (out.reply?.mode === 'load') {
      return {
        ok: out.reply.ok,
        exports: out.reply.exports,
        ...(out.reply.error ? { error: out.reply.error } : {}),
      };
    }
    return {
      ok: false,
      exports: [],
      error: out.crash ?? { name: 'Error', message: 'no reply from child' },
    };
  });

  app.post('/run', async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const module = validModule(config, body);
    let calls: Array<{ args?: unknown[] }> = [{ args: [] }];
    if (body.calls !== undefined) {
      if (!Array.isArray(body.calls) || body.calls.length > MAX_CALLS) {
        throw new BadRequest(`"calls" must be an array of at most ${MAX_CALLS} items`);
      }
      calls = body.calls.map((c: unknown) => {
        const args = (c as { args?: unknown } | null)?.args;
        if (args !== undefined && !Array.isArray(args))
          throw new BadRequest('"calls[].args" must be an array');
        return { args: (args as unknown[] | undefined) ?? [] };
      });
    }
    const timeoutMs = optInt(body, 'timeoutMs', 5000, 100, MAX_TIMEOUT_MS);
    const job: ChildJob = {
      mode: 'run',
      workspaceDir: config.workspaceDir,
      module,
      exportName: optString(body, 'export') ?? 'default',
      calls,
      concurrency: optInt(body, 'concurrency', 1, 1, MAX_CONCURRENCY),
      timeoutMs,
      redisUrl: optTarget(body, 'redisUrl') ?? config.redisUrl,
      databaseUrl: optString(body, 'databaseUrl') ?? config.databaseUrl,
    };
    const started = performance.now();
    const out = await runInChild(job, timeoutMs + 1000);
    if (out.reply?.mode === 'run') {
      return { results: out.reply.results, metrics: out.reply.metrics, logs: out.logs };
    }
    const crash = out.crash ?? { name: 'Error', message: 'no reply from child' };
    req.log.warn({ module, crash }, 'learner run did not complete');
    const { results, metrics } = crashResults(job, crash, performance.now() - started);
    return { results, metrics, logs: out.logs, runError: crash };
  });

  return app;
}
