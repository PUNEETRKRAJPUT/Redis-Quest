import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from './errors.js';
import type { SessionUser } from './slots/baselines.js';
import type { RequestScope, SlotRuntime } from './slots/runtime.js';

declare module 'fastify' {
  interface FastifyRequest {
    scope?: RequestScope;
  }
}

function scopeOf(req: FastifyRequest): RequestScope {
  if (!req.scope)
    throw new Error('request scope missing (route registered without the slot hooks)');
  return req.scope;
}

const PLAYER_ID = /^p-\d{3}$/;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 128): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** The Milestone 1 baseline routes. Every path is under /app (Caddy forwards it unchanged). */
export function registerRoutes(app: FastifyInstance, slots: SlotRuntime): void {
  app.get<{ Params: { id: string } }>('/app/players/:id', async (req) => {
    const { rows } = await scopeOf(req).deps.db.query('SELECT * FROM players WHERE id = $1', [
      req.params.id,
    ]);
    if (rows.length === 0) throw new HttpError(404, 'player_not_found');
    return rows[0];
  });

  app.get<{ Params: { id: string } }>('/app/players/:id/stats', async (req) => {
    const scope = scopeOf(req);
    const row = await slots.call(scope, 'cache.getPlayerStats', req.params.id);
    // An empty object is what HGETALL returns for a missing key; for the API it means "no such player".
    if (row === null || row === undefined || (isObj(row) && Object.keys(row).length === 0)) {
      throw new HttpError(404, 'player_not_found');
    }
    if (!isObj(row))
      throw slots.contractError('cache.getPlayerStats', 'must return an object or null');
    return row;
  });

  app.post<{ Params: { id: string } }>('/app/players/:id/stats/refresh', async (req) => {
    if (!PLAYER_ID.test(req.params.id))
      throw new HttpError(400, 'invalid_player_id', 'player ids look like p-028');
    const result = await slots.call(scopeOf(req), 'cache.invalidatePlayerStats', req.params.id);
    return { ok: true, playerId: req.params.id, result: result ?? null };
  });

  app.get('/app/fixtures', async (req) => {
    const fixtures = await slots.call(scopeOf(req), 'prefetch.getFixtures');
    if (!Array.isArray(fixtures))
      throw slots.contractError('prefetch.getFixtures', 'must return an array');
    return { fixtures };
  });

  app.post('/app/login', async (req, reply) => {
    const body = isObj(req.body) ? req.body : {};
    if (!str(body.userId, 64))
      throw new HttpError(400, 'invalid_user_id', 'body must be { "userId": "u-000001" }');
    const scope = scopeOf(req);
    const { rows } = await scope.deps.db.query(
      'SELECT id, handle, display_name, college_id, hostel_id FROM users WHERE id = $1',
      [body.userId],
    );
    const user = rows[0] as SessionUser | undefined;
    if (!user) throw new HttpError(404, 'user_not_found');
    const sid = await slots.call(scope, 'session.create', user);
    if (!str(sid, 512) || /[;,\s]/.test(sid)) {
      throw slots.contractError(
        'session.create',
        'must return a non-empty session id string without spaces, ";" or ","',
      );
    }
    reply.header('set-cookie', `sid=${encodeURIComponent(sid)}; Path=/app; HttpOnly; SameSite=Lax`);
    return { ok: true, userId: user.id, sid };
  });

  app.get('/app/me', async (req) => {
    const sid = readCookie(req.headers.cookie, 'sid');
    if (!sid) throw new HttpError(401, 'not_logged_in');
    const session = await slots.call(scopeOf(req), 'session.get', sid);
    if (
      session === null ||
      session === undefined ||
      (isObj(session) && Object.keys(session).length === 0)
    ) {
      throw new HttpError(401, 'not_logged_in');
    }
    if (!isObj(session) || typeof session.userId !== 'string') {
      throw slots.contractError(
        'session.get',
        'must return an object with a string userId, or null',
      );
    }
    return { userId: session.userId, session };
  });

  app.get<{ Params: { contestId: string }; Querystring: { limit?: string } }>(
    '/app/leaderboard/:contestId',
    async (req) => {
      const contestId = Number(req.params.contestId);
      if (!Number.isInteger(contestId) || contestId < 1)
        throw new HttpError(400, 'invalid_contest_id');
      const limit = req.query.limit === undefined ? 10 : Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new HttpError(400, 'invalid_limit', 'limit must be 1 to 100');
      const entries = await slots.call(scopeOf(req), 'leaderboard.top', contestId, limit);
      if (!Array.isArray(entries))
        throw slots.contractError('leaderboard.top', 'must return an array');
      return {
        contestId,
        entries: entries
          .slice(0, limit)
          .map((e, i) => (isObj(e) ? { rank: i + 1, ...e } : { rank: i + 1, value: e })),
      };
    },
  );

  app.get('/app/limits/ping', async (req, reply) => {
    const userId = req.headers['x-user-id'];
    if (!str(userId, 64)) throw new HttpError(400, 'missing_user_id', 'send an x-user-id header');
    const verdict = await slots.call(scopeOf(req), 'ratelimit.allow', userId);
    const allowed = isObj(verdict) ? Boolean(verdict.allowed) : Boolean(verdict);
    if (!allowed) return reply.code(429).send({ error: 'rate_limited' });
    return { ok: true, pong: true };
  });

  app.post('/app/register', async (req, reply) => {
    const b = isObj(req.body) ? req.body : {};
    if (!str(b.id, 64) || !str(b.name) || !str(b.college_id, 32) || !str(b.hostel_id, 32)) {
      throw new HttpError(
        400,
        'invalid_user',
        'body must be { id, name, college_id, hostel_id } (strings)',
      );
    }
    const user = { id: b.id, name: b.name, college_id: b.college_id, hostel_id: b.hostel_id };
    const result = await slots.call(scopeOf(req), 'onboarding.registerUser', user);
    if (isObj(result) && result.created === false) throw new HttpError(409, 'user_exists');
    return reply.code(201).send({ ok: true, id: user.id, result: result ?? null });
  });
}
