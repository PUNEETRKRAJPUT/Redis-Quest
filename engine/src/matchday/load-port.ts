import type { FastifyInstance } from 'fastify';
import type { LoadPort, LoadStartOutcome, LoadStatusView } from './runner.js';

/**
 * Drives the engine's own on-demand traffic routes in-process (Fastify inject, no network). Going through
 * POST /api/load/start is what gives Match Day the verifier's guard for free: while a level check or another
 * traffic run is going, the answer is 409 verify_in_progress, and the same caps apply as for every other run.
 */
export function injectLoadPort(api: Pick<FastifyInstance, 'inject'>): LoadPort {
  return {
    async start(o) {
      const res = await api.inject({ method: 'POST', url: '/api/load/start', payload: o });
      if (res.statusCode === 202) return { ok: true, status: 202, code: '', message: '' };
      let body: { error?: unknown; message?: unknown } = {};
      try {
        body = res.json() as typeof body;
      } catch {
        // not JSON: keep the status
      }
      return {
        ok: false,
        status: res.statusCode,
        code: typeof body.error === 'string' ? body.error : 'traffic_failed',
        message: typeof body.message === 'string' ? body.message : `HTTP ${res.statusCode}`,
      } satisfies LoadStartOutcome;
    },
    async status() {
      const res = await api.inject({ method: 'GET', url: '/api/load/status' });
      return res.json() as LoadStatusView;
    },
    async stop() {
      await api.inject({ method: 'POST', url: '/api/load/stop', payload: {} });
    },
  };
}
