import Fastify, { type FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type pg from 'pg';
import { HttpError, SlotError, headerSafe } from './errors.js';
import type { MetricsRecorder } from './metrics.js';
import type { RedisTarget } from './redis.js';
import { registerRoutes } from './routes.js';
import { RequestScope, type SlotRuntime } from './slots/runtime.js';

export interface AppContext {
  instance: string;
  maxRequestsPerSocket?: number;
  log: Logger;
  redis: RedisTarget;
  /** The pool learner deps see (with the engine's extra DB latency applied). */
  pool: pg.Pool;
  slots: SlotRuntime;
  recorder: MetricsRecorder;
  /** The window most recently pushed to the engine (or computed, when no engine is configured). */
  lastWindow: () => unknown;
  /** Live view of the engine link, for /app/health. */
  status: () => { configEtag: string | null; engine: 'up' | 'down' | 'unconfigured'; dbExtraLatencyMs: number; slotTimeoutMs: number };
}

// Operational routes are not traffic: they get no request scope and no metrics.
const OPERATIONAL = new Set(['/app/health', '/app/slots', '/app/metrics']);

export function buildServer(ctx: AppContext): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024,
    ...(ctx.maxRequestsPerSocket ? { maxRequestsPerSocket: ctx.maxRequestsPerSocket } : {}),
  });

  app.addHook('preHandler', async (req) => {
    const url = req.routeOptions.url;
    if (!url || OPERATIONAL.has(url)) return;
    req.scope = await RequestScope.create({
      redis: ctx.redis.shared,
      pool: ctx.pool,
      log: (line) => ctx.log.info({ learner: true, route: url }, line),
    });
  });

  app.addHook('onSend', async (req, reply, payload) => {
    if (req.scope && req.scope.served.length > 0) reply.header('x-quest-slots', req.scope.served.join(', '));
    return payload;
  });

  const finish = (req: { scope?: RequestScope }) => {
    const scope = req.scope;
    req.scope = undefined;
    if (scope) void scope.close().catch(() => undefined);
  };

  app.addHook('onResponse', async (req, reply) => {
    const url = req.routeOptions.url;
    if (url && !OPERATIONAL.has(url) && req.scope) {
      ctx.recorder.record(`${req.method} ${url}`, {
        ms: reply.elapsedTime,
        status: reply.statusCode,
        dbQueries: req.scope.counters.dbQueries,
        redisCommands: req.scope.counters.redisCommands,
        slotError: reply.hasHeader('x-quest-slot-error'),
      });
    }
    finish(req);
  });
  app.addHook('onRequestAbort', async (req) => finish(req));

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof SlotError) {
      ctx.log.error(
        { slot: err.slot, route: req.routeOptions.url, err: err.learnerError },
        `learner code in slot ${err.slot} failed: ${err.learnerError.name}: ${err.learnerError.message}`,
      );
      return reply
        .code(500)
        .header('x-quest-slot-error', headerSafe(err.learnerError.message))
        .send({ error: 'slot_error', slot: err.slot, name: err.learnerError.name, message: err.learnerError.message });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, ...(err.message !== err.code ? { message: err.message } : {}) });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'bad_request', message: (err as Error).message });
    }
    ctx.log.error({ route: req.routeOptions.url, err }, 'request failed in app code');
    return reply.code(500).send({ error: 'internal', message: (err as Error).message });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }));

  app.get('/app/health', async () => {
    const s = ctx.status();
    return {
      ok: true,
      service: 'app',
      instance: ctx.instance,
      target: { redisUrl: ctx.redis.url },
      activeSlots: ctx.slots.active,
      redis: ctx.redis.ready ? 'up' : 'down',
      engine: s.engine,
      configEtag: s.configEtag,
    };
  });

  app.get('/app/slots', async () => {
    const s = ctx.status();
    return {
      instance: ctx.instance,
      timeoutMs: s.slotTimeoutMs,
      dbExtraLatencyMs: s.dbExtraLatencyMs,
      configEtag: s.configEtag,
      slots: ctx.slots.status(),
    };
  });

  // Per-instance view of what is pushed to the engine: running totals since boot plus the last window.
  app.get('/app/metrics', async () => ({
    instance: ctx.instance,
    since: ctx.recorder.since,
    totals: ctx.recorder.totals,
    lastWindow: ctx.lastWindow() ?? null,
  }));

  registerRoutes(app, ctx.slots);
  return app;
}
