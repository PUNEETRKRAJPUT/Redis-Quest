import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from './errors.js';
import {
  inMemoryQueueStats,
  loadMatchRows,
  oncallLeakedClients,
  loadRecomputeRows,
  type SessionUser,
} from './slots/baselines.js';
import type { RequestScope, SlotRuntime } from './slots/runtime.js';
import { TickerError, type TickerSubscriber } from './workers/ticker.js';

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
export function registerRoutes(
  app: FastifyInstance,
  slots: SlotRuntime,
  ticker: TickerSubscriber,
  instance = 'app',
): void {
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

  // Chapter 2.7: refill the prefetch cache by hand. The rows are the whole matches table with team names.
  app.post('/app/prefetch/reload', async (req) => {
    const scope = scopeOf(req);
    const rows = await loadMatchRows(scope.deps);
    const result = await slots.call(scope, 'prefetch.bulkLoad', rows);
    return { ok: true, rows: rows.length, result: result ?? null };
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

  // Chapter 2.8: logout forgets the session named by the cookie; the cookie is cleared either way.
  app.post('/app/logout', async (req, reply) => {
    const sid = readCookie(req.headers.cookie, 'sid');
    if (!sid) throw new HttpError(401, 'not_logged_in');
    const result = await slots.call(scopeOf(req), 'session.destroy', sid);
    reply.header('set-cookie', 'sid=; Path=/app; HttpOnly; SameSite=Lax; Max-Age=0');
    return { ok: true, result: result ?? null };
  });

  app.post('/app/logout-all', async (req) => {
    const body = isObj(req.body) ? req.body : {};
    if (!str(body.userId, 64))
      throw new HttpError(400, 'invalid_user_id', 'body must be { "userId": "u-000001" }');
    const result = await slots.call(scopeOf(req), 'session.destroyAll', body.userId);
    return { ok: true, userId: body.userId, result: result ?? null };
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

  // ---- Chapter 3: leaderboard writes, rank, recompute ------------------------------------------

  const contestIdOf = (raw: string): number => {
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'invalid_contest_id');
    return id;
  };

  app.post<{ Params: { contestId: string } }>('/app/contests/:contestId/points', async (req) => {
    const contestId = contestIdOf(req.params.contestId);
    const b = isObj(req.body) ? req.body : {};
    if (!str(b.teamId, 64)) throw new HttpError(400, 'invalid_team_id', 'teamId must be a string');
    if (typeof b.delta !== 'number' || !Number.isFinite(b.delta))
      throw new HttpError(400, 'invalid_delta', 'delta must be a finite number');
    const score = await slots.call(
      scopeOf(req),
      'leaderboard.addPoints',
      contestId,
      b.teamId,
      b.delta,
    );
    if (score === null || score === undefined) throw new HttpError(404, 'entry_not_found');
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      throw slots.contractError(
        'leaderboard.addPoints',
        'must return the new score as a number, or null when the entry does not exist',
      );
    }
    return { contestId, teamId: b.teamId, score };
  });

  app.get<{ Params: { contestId: string; teamId: string } }>(
    '/app/leaderboard/:contestId/teams/:teamId',
    async (req) => {
      const contestId = contestIdOf(req.params.contestId);
      if (!str(req.params.teamId, 64)) throw new HttpError(400, 'invalid_team_id');
      const out = await slots.call(scopeOf(req), 'leaderboard.rank', contestId, req.params.teamId);
      if (out === null || out === undefined) throw new HttpError(404, 'entry_not_found');
      const around = isObj(out) ? out.around : undefined;
      if (
        !isObj(out) ||
        typeof out.rank !== 'number' ||
        !Number.isInteger(out.rank) ||
        out.rank < 1 ||
        typeof out.score !== 'number' ||
        !Array.isArray(around) ||
        !around.every(
          (e) => isObj(e) && typeof e.teamId === 'string' && typeof e.score === 'number',
        )
      ) {
        throw slots.contractError(
          'leaderboard.rank',
          'must return { rank (integer, 1 = best), score (number), around: [{ teamId (string), score (number) }] }, or null',
        );
      }
      return { rank: out.rank, score: out.score, around };
    },
  );

  // Level 3.3: rebuild the leaderboards of up to ten matches from Postgres. The route loads the rows once
  // and times only the slot, so the number is the learner's write path and not the SELECT.
  app.post('/app/leaderboards/recompute', async (req) => {
    const b = isObj(req.body) ? req.body : {};
    const ids = b.matchIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10 || !ids.every((m) => str(m, 64)))
      throw new HttpError(400, 'invalid_match_ids', 'matchIds must be 1 to 10 match id strings');
    const scope = scopeOf(req);
    const rows = await loadRecomputeRows(scope.deps, ids as string[]);
    const t0 = performance.now();
    const result = await slots.call(scope, 'leaderboard.recompute', rows);
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    return { ok: true, rows: rows.length, ms, result: result ?? null };
  });

  // ---- Chapter 3.4: the wallet debit -----------------------------------------------------------

  app.post<{ Params: { contestId: string } }>(
    '/app/contests/:contestId/join',
    async (req, reply) => {
      const contestId = contestIdOf(req.params.contestId);
      const b = isObj(req.body) ? req.body : {};
      if (!str(b.userId, 64))
        throw new HttpError(400, 'invalid_user_id', 'userId must be a string');
      const fee = b.fee === undefined ? 10 : b.fee;
      if (typeof fee !== 'number' || !Number.isInteger(fee) || fee < 1 || fee > 100_000)
        throw new HttpError(400, 'invalid_fee', 'fee must be an integer from 1 to 100000');
      const joined = await slots.call(scopeOf(req), 'contest.join', b.userId, contestId, fee);
      if (typeof joined !== 'boolean') {
        throw slots.contractError(
          'contest.join',
          'must return true (fee taken) or false (balance too low)',
        );
      }
      if (!joined) return reply.code(402).send({ error: 'insufficient_balance' });
      return { joined: true };
    },
  );

  // ---- Chapter 3.5 and 3.6: the ticker --------------------------------------------------------

  app.post<{ Params: { matchId: string } }>('/app/matches/:matchId/balls', async (req) => {
    const matchId = req.params.matchId;
    if (!str(matchId, 64)) throw new HttpError(400, 'invalid_match_id');
    const b = isObj(req.body) ? req.body : {};
    if (typeof b.seq !== 'number' || !Number.isInteger(b.seq) || b.seq < 1)
      throw new HttpError(400, 'invalid_seq', 'seq must be an integer of 1 or more');
    for (const k of ['over', 'ball', 'runs'] as const) {
      if (b[k] !== undefined && (typeof b[k] !== 'number' || !Number.isFinite(b[k])))
        throw new HttpError(400, `invalid_${k}`, `${k} must be a number`);
    }
    for (const k of ['batter', 'commentary'] as const) {
      if (b[k] !== undefined && !(typeof b[k] === 'string' && (b[k] as string).length <= 200))
        throw new HttpError(400, `invalid_${k}`, `${k} must be a string of at most 200 characters`);
    }
    if (
      b.wicket !== undefined &&
      typeof b.wicket !== 'boolean' &&
      !(typeof b.wicket === 'string' && b.wicket.length <= 200)
    )
      throw new HttpError(400, 'invalid_wicket', 'wicket must be a boolean or a short string');
    const ball: Record<string, unknown> = {};
    for (const k of ['seq', 'over', 'ball', 'batter', 'runs', 'wicket', 'commentary'])
      if (b[k] !== undefined) ball[k] = b[k];
    const result = await slots.call(scopeOf(req), 'ticker.publish', matchId, ball);
    return { ok: true, matchId, result: result ?? null };
  });

  // The provided subscriber's view and its one lever. These are game routes: they are counted in metrics.
  app.get<{ Params: { matchId: string } }>('/app/ticker/:matchId', async (req) => {
    const view = ticker.view(req.params.matchId);
    if (!view) throw new HttpError(404, 'unknown_match');
    return view;
  });

  app.post('/app/ticker/resubscribe', async (req) => {
    const b = isObj(req.body) ? req.body : {};
    if (!str(b.matchId, 64)) throw new HttpError(400, 'invalid_match_id');
    const pauseMs = b.pauseMs === undefined ? 1000 : b.pauseMs;
    if (
      typeof pauseMs !== 'number' ||
      !Number.isInteger(pauseMs) ||
      pauseMs < 0 ||
      pauseMs > 10_000
    )
      throw new HttpError(400, 'invalid_pause', 'pauseMs must be an integer from 0 to 10000');
    try {
      const pausedMs = await ticker.resubscribe(b.matchId, pauseMs);
      return { ok: true, instance: ticker.view(b.matchId)?.instance ?? null, pausedMs };
    } catch (err) {
      if (err instanceof TickerError) throw new HttpError(err.status, err.code);
      throw err;
    }
  });

  // ---- Chapter 4: work in the background ---------------------------------------------------------
  // Inputs are validated here, in the route, like Chapter 3. Slot results are checked against the contract in
  // the registry so a wrong return is a 500 with x-quest-slot-error, not a crash.

  const intIn = (v: unknown, min: number, max: number): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  const strArray = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === 'string');
  const idParam = (raw: string, what: string): string => {
    if (!str(raw, 64)) throw new HttpError(400, `invalid_${what}`);
    return raw;
  };

  app.post('/app/workers/points/consume', async (req) => {
    const b = isObj(req.body) ? req.body : {};
    if (!str(b.matchId, 64)) throw new HttpError(400, 'invalid_match_id');
    if (!str(b.consumer, 64)) throw new HttpError(400, 'invalid_consumer');
    const count = b.count === undefined ? 10 : b.count;
    if (!intIn(count, 1, 100))
      throw new HttpError(400, 'invalid_count', 'count must be an integer from 1 to 100');
    const result = await slots.call(scopeOf(req), 'points.consume', b.matchId, b.consumer, count);
    if (!isObj(result) || !strArray(result.processed)) {
      throw slots.contractError(
        'points.consume',
        'must return { processed: string[] } (the entry ids it processed and acked)',
      );
    }
    return { ok: true, result };
  });

  app.post('/app/workers/points/sweep', async (req) => {
    const b = isObj(req.body) ? req.body : {};
    if (!str(b.matchId, 64)) throw new HttpError(400, 'invalid_match_id');
    if (!str(b.consumer, 64)) throw new HttpError(400, 'invalid_consumer');
    const minIdleMs = b.minIdleMs === undefined ? 60_000 : b.minIdleMs;
    if (!intIn(minIdleMs, 0, 86_400_000))
      throw new HttpError(
        400,
        'invalid_min_idle',
        'minIdleMs must be an integer from 0 to 86400000',
      );
    const maxDeliveries = b.maxDeliveries === undefined ? 5 : b.maxDeliveries;
    if (!intIn(maxDeliveries, 1, 1000))
      throw new HttpError(
        400,
        'invalid_max_deliveries',
        'maxDeliveries must be an integer from 1 to 1000',
      );
    const result = await slots.call(
      scopeOf(req),
      'points.sweep',
      b.matchId,
      b.consumer,
      minIdleMs,
      maxDeliveries,
    );
    if (!isObj(result) || !strArray(result.reclaimed) || !strArray(result.deadLettered)) {
      throw slots.contractError(
        'points.sweep',
        'must return { reclaimed: string[], deadLettered: string[] }',
      );
    }
    return { ok: true, result };
  });

  // The job queue. Payload is any JSON value up to 4 KB once serialised.
  const payloadOf = (b: Record<string, unknown>): unknown => {
    if (!('payload' in b) || b.payload === undefined)
      throw new HttpError(400, 'invalid_payload', 'body must be { "payload": <any JSON> }');
    if (JSON.stringify(b.payload).length > 4096)
      throw new HttpError(400, 'payload_too_large', 'payload must be at most 4 KB of JSON');
    return b.payload;
  };

  app.post('/app/jobs', async (req, reply) => {
    const b = isObj(req.body) ? req.body : {};
    const id = await slots.call(scopeOf(req), 'jobs.enqueue', payloadOf(b));
    if (!str(id, 256))
      throw slots.contractError('jobs.enqueue', 'must return the job id as a non-empty string');
    return reply.code(201).send({ id });
  });

  app.post('/app/jobs/claim', async (req) => {
    const b = isObj(req.body) ? req.body : {};
    if (!str(b.worker, 64)) throw new HttpError(400, 'invalid_worker');
    const timeoutMs = b.timeoutMs === undefined ? 1000 : b.timeoutMs;
    if (!intIn(timeoutMs, 0, 5000))
      throw new HttpError(400, 'invalid_timeout', 'timeoutMs must be an integer from 0 to 5000');
    const job = await slots.call(scopeOf(req), 'jobs.claim', b.worker, timeoutMs);
    if (job === null || job === undefined) return { job: null };
    if (
      !isObj(job) ||
      !str(job.id, 256) ||
      !str(job.token, 256) ||
      typeof job.attempts !== 'number'
    ) {
      throw slots.contractError(
        'jobs.claim',
        'must return { id, payload, token, attempts } (strings id and token, a number attempts), or null',
      );
    }
    return { job };
  });

  app.post<{ Params: { id: string } }>('/app/jobs/:id/complete', async (req) => {
    const id = idParam(req.params.id, 'job_id');
    const b = isObj(req.body) ? req.body : {};
    if (!str(b.token, 256)) throw new HttpError(400, 'invalid_token');
    const ok = await slots.call(scopeOf(req), 'jobs.complete', id, b.token, b.result ?? null);
    if (typeof ok !== 'boolean')
      throw slots.contractError(
        'jobs.complete',
        'must return true (completed) or false (this worker no longer owns the job)',
      );
    if (!ok) throw new HttpError(409, 'not_owner');
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/app/jobs/:id/fail', async (req) => {
    const id = idParam(req.params.id, 'job_id');
    const b = isObj(req.body) ? req.body : {};
    if (!str(b.token, 256)) throw new HttpError(400, 'invalid_token');
    if (!str(b.error, 1000)) throw new HttpError(400, 'invalid_error', 'error must be a string');
    const maxAttempts = b.maxAttempts === undefined ? 3 : b.maxAttempts;
    if (!intIn(maxAttempts, 1, 100))
      throw new HttpError(
        400,
        'invalid_max_attempts',
        'maxAttempts must be an integer from 1 to 100',
      );
    const outcome = await slots.call(scopeOf(req), 'jobs.fail', id, b.token, b.error, maxAttempts);
    if (outcome === false) throw new HttpError(409, 'not_owner');
    if (outcome !== 'retry' && outcome !== 'failed')
      throw slots.contractError('jobs.fail', 'must return "retry", "failed" or false');
    return { outcome };
  });

  app.post('/app/jobs/reclaim', async (req) => {
    const b = isObj(req.body) ? req.body : {};
    const visibilityMs = b.visibilityMs === undefined ? 5000 : b.visibilityMs;
    if (!intIn(visibilityMs, 0, 86_400_000))
      throw new HttpError(
        400,
        'invalid_visibility',
        'visibilityMs must be an integer from 0 to 86400000',
      );
    const reclaimed = await slots.call(scopeOf(req), 'jobs.reclaim', visibilityMs);
    if (!intIn(reclaimed, 0, Number.MAX_SAFE_INTEGER))
      throw slots.contractError('jobs.reclaim', 'must return a non-negative integer');
    return { reclaimed };
  });

  app.post('/app/jobs/schedule', async (req, reply) => {
    const b = isObj(req.body) ? req.body : {};
    const payload = payloadOf(b);
    if (!intIn(b.runAtMs, 0, 8.64e15))
      throw new HttpError(
        400,
        'invalid_run_at',
        'runAtMs must be an integer epoch in milliseconds',
      );
    const id = await slots.call(scopeOf(req), 'jobs.schedule', payload, b.runAtMs);
    if (!str(id, 256))
      throw slots.contractError('jobs.schedule', 'must return the job id as a non-empty string');
    return reply.code(201).send({ id });
  });

  app.post('/app/jobs/promote', async (req) => {
    const b = isObj(req.body) ? req.body : {};
    const nowMs = b.nowMs === undefined ? Date.now() : b.nowMs;
    if (!intIn(nowMs, 0, 8.64e15))
      throw new HttpError(400, 'invalid_now', 'nowMs must be an integer epoch in milliseconds');
    const promoted = await slots.call(scopeOf(req), 'jobs.promoteDue', nowMs);
    if (!intIn(promoted, 0, Number.MAX_SAFE_INTEGER))
      throw slots.contractError('jobs.promoteDue', 'must return a non-negative integer');
    return { promoted };
  });

  // Not a slot: the route reads the queue keys itself so a level can see the lists whatever the learner wrote.
  // `inMemory` is the baseline Map queue of this instance (always there; it only moves while the slots are off).
  app.get('/app/jobs/stats', async (req) => {
    const r = scopeOf(req).deps.redis;
    const [pending, processing, completed, failed, delayed] = await Promise.all([
      r.lLen('queue:jobs:pending'),
      r.lLen('queue:jobs:processing'),
      r.lLen('queue:jobs:completed'),
      r.lLen('queue:jobs:failed'),
      r.zCard('queue:jobs:delayed'),
    ]);
    return { pending, processing, completed, failed, delayed, inMemory: inMemoryQueueStats() };
  });

  app.post<{ Params: { userId: string } }>('/app/wallets/:userId/credit', async (req) => {
    const userId = idParam(req.params.userId, 'user_id');
    const b = isObj(req.body) ? req.body : {};
    if (!intIn(b.amount, 1, 100_000))
      throw new HttpError(400, 'invalid_amount', 'amount must be an integer from 1 to 100000');
    if (!str(b.key, 64))
      throw new HttpError(400, 'invalid_key', 'key must be a string of at most 64 characters');
    const out = await slots.call(scopeOf(req), 'wallet.credit', userId, b.amount, b.key);
    if (!isObj(out) || typeof out.credited !== 'boolean' || typeof out.balance !== 'number') {
      throw slots.contractError(
        'wallet.credit',
        'must return { credited: boolean, balance: number }',
      );
    }
    return { credited: out.credited, balance: out.balance };
  });

  app.post<{ Params: { contestId: string } }>(
    '/app/contests/:contestId/last-slot',
    async (req, reply) => {
      const contestId = contestIdOf(req.params.contestId);
      const b = isObj(req.body) ? req.body : {};
      if (!str(b.userId, 64))
        throw new HttpError(400, 'invalid_user_id', 'userId must be a string');
      const got = await slots.call(scopeOf(req), 'contest.claimLastSlot', contestId, b.userId);
      if (typeof got !== 'boolean')
        throw slots.contractError(
          'contest.claimLastSlot',
          'must return true (got a slot) or false (none left)',
        );
      if (!got) return reply.code(409).send({ error: 'contest_full' });
      return { got: true };
    },
  );

  // Expire a batch of keys. Keys under game:* belong to the engine and are refused.
  app.post('/app/ops/expire-batch', async (req) => {
    const b = isObj(req.body) ? req.body : {};
    const keys = b.keys;
    if (
      !Array.isArray(keys) ||
      keys.length < 1 ||
      keys.length > 5000 ||
      !keys.every((k) => str(k, 256))
    )
      throw new HttpError(400, 'invalid_keys', 'keys must be 1 to 5000 non-empty strings');
    if ((keys as string[]).some((k) => k.startsWith('game:')))
      throw new HttpError(400, 'reserved_key', 'keys under game:* belong to the engine');
    if (!intIn(b.baseSeconds, 1, 86_400))
      throw new HttpError(400, 'invalid_base', 'baseSeconds must be an integer from 1 to 86400');
    if (!intIn(b.jitterSeconds, 0, 3600))
      throw new HttpError(400, 'invalid_jitter', 'jitterSeconds must be an integer from 0 to 3600');
    const expired = await slots.call(
      scopeOf(req),
      'sessions.expireWithJitter',
      keys,
      b.baseSeconds,
      b.jitterSeconds,
    );
    if (!intIn(expired, 0, Number.MAX_SAFE_INTEGER))
      throw slots.contractError('sessions.expireWithJitter', 'must return a non-negative integer');
    return { expired };
  });

  app.get<{ Params: { name: string } }>('/app/usernames/:name', async (req) => {
    const name = req.params.name;
    if (!str(name, 64)) throw new HttpError(400, 'invalid_name');
    const out = await slots.call(scopeOf(req), 'users.usernameTaken', name);
    if (!isObj(out) || typeof out.taken !== 'boolean' || typeof out.checkedDb !== 'boolean') {
      throw slots.contractError(
        'users.usernameTaken',
        'must return { taken: boolean, checkedDb: boolean }',
      );
    }
    return { name, taken: out.taken, checkedDb: out.checkedDb };
  });

  // The ops wall. `route` is the metrics route key, e.g. "GET /app/players/:id/stats" (see routeKey() in
  // workers/ops.ts for how it becomes part of a Redis key). Counted like any game route, but the wall's own
  // reads and this sample route are not fed back into ops.record.
  app.post('/app/ops/samples', async (req) => {
    const b = isObj(req.body) ? req.body : {};
    if (!str(b.route, 200)) throw new HttpError(400, 'invalid_route');
    if (!intIn(b.status, 100, 599)) throw new HttpError(400, 'invalid_status');
    if (typeof b.ms !== 'number' || !Number.isFinite(b.ms) || b.ms < 0)
      throw new HttpError(400, 'invalid_ms', 'ms must be a number of 0 or more');
    const at = b.at === undefined ? Date.now() : b.at;
    if (!intIn(at, 0, 8.64e15))
      throw new HttpError(400, 'invalid_at', 'at must be an integer epoch in milliseconds');
    await slots.call(scopeOf(req), 'ops.record', {
      route: b.route,
      status: b.status,
      ms: b.ms,
      at,
    });
    return { ok: true };
  });

  app.get<{ Querystring: { route?: string; from?: string; to?: string; bucket?: string } }>(
    '/app/ops/wall',
    async (req) => {
      const q = req.query;
      if (!str(q.route, 200)) throw new HttpError(400, 'invalid_route');
      const to = q.to === undefined ? Date.now() : Number(q.to);
      const from = q.from === undefined ? to - 15 * 60_000 : Number(q.from);
      const bucket = q.bucket === undefined ? 60_000 : Number(q.bucket);
      if (!intIn(to, 0, 8.64e15)) throw new HttpError(400, 'invalid_to');
      if (!intIn(from, 0, 8.64e15) || from >= to)
        throw new HttpError(400, 'invalid_from', 'from must be an epoch in ms before to');
      if (!intIn(bucket, 1000, 86_400_000))
        throw new HttpError(400, 'invalid_bucket', 'bucket must be 1000 to 86400000 ms');
      if ((to - from) / bucket > 10_000)
        throw new HttpError(400, 'too_many_buckets', 'at most 10000 buckets per call');
      const out = await slots.call(scopeOf(req), 'ops.range', q.route, from, to, bucket);
      const buckets = isObj(out) ? out.buckets : undefined;
      if (
        !isObj(out) ||
        typeof out.route !== 'string' ||
        !Array.isArray(buckets) ||
        !buckets.every(
          (x) =>
            isObj(x) &&
            typeof x.at === 'number' &&
            typeof x.requests === 'number' &&
            typeof x.errors === 'number' &&
            (typeof x.avgMs === 'number' || x.avgMs === null),
        )
      ) {
        throw slots.contractError(
          'ops.range',
          'must return { route: string, buckets: [{ at, requests, errors: numbers, avgMs: number or null }] }',
        );
      }
      return out;
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

  // ---- Chapter 4b "On call": the baselines behind these routes are planted faults (see baselines.ts) --------
  // All answers are checked against the slot contract so a wrong learner return is a 500 with x-quest-slot-error.

  const GLOB_CHARS = /[*?[\]\\]/;
  const SAFE_ID = /^[A-Za-z0-9_.-]{1,64}$/;
  const RESERVED = 'game:';

  app.get<{ Querystring: { prefix?: string } }>('/app/oncall/users/count', async (req) => {
    const prefix = req.query.prefix;
    if (!str(prefix, 64) || GLOB_CHARS.test(prefix))
      throw new HttpError(
        400,
        'invalid_prefix',
        'prefix must be 1 to 64 characters without glob characters (* ? [ ] \\)',
      );
    if (prefix.startsWith(RESERVED) || RESERVED.startsWith(prefix))
      throw new HttpError(400, 'reserved_prefix', 'keys under game:* belong to the engine');
    const count = await slots.call(scopeOf(req), 'oncall.countUsers', prefix);
    if (!intIn(count, 0, Number.MAX_SAFE_INTEGER))
      throw slots.contractError('oncall.countUsers', 'must return a non-negative integer');
    return { prefix, count };
  });

  app.post('/app/oncall/views', async (req) => {
    const b = isObj(req.body) ? req.body : {};
    if (typeof b.userId !== 'string' || !SAFE_ID.test(b.userId))
      throw new HttpError(400, 'invalid_user_id', 'userId must be 1 to 64 of A-Z a-z 0-9 _ . -');
    if (typeof b.matchId !== 'string' || !SAFE_ID.test(b.matchId))
      throw new HttpError(400, 'invalid_match_id', 'matchId must be 1 to 64 of A-Z a-z 0-9 _ . -');
    await slots.call(scopeOf(req), 'oncall.recordView', b.userId, b.matchId);
    return { ok: true };
  });

  app.post('/app/oncall/ttl-sweep', async (req) => {
    const b = isObj(req.body) ? req.body : {};
    const pattern = b.pattern;
    if (!str(pattern, 128))
      throw new HttpError(400, 'invalid_pattern', 'pattern must be 1 to 128 characters');
    // The literal head (before the first glob character) must exist and must not lead towards game:*, so no
    // pattern can match the engine's keys: "*", "g*", "ga?e:x" and "[g]ame:*" are all refused.
    const head = pattern.split(/[*?[\\]/)[0] ?? '';
    if (head.length === 0 || head.startsWith(RESERVED) || RESERVED.startsWith(head))
      throw new HttpError(
        400,
        'reserved_pattern',
        'a pattern must start with literal characters and must not be able to match game:*',
      );
    if (!intIn(b.seconds, 1, 604_800))
      throw new HttpError(400, 'invalid_seconds', 'seconds must be an integer from 1 to 604800');
    const expired = await slots.call(scopeOf(req), 'oncall.addTtls', pattern, b.seconds);
    if (!intIn(expired, 0, Number.MAX_SAFE_INTEGER))
      throw slots.contractError('oncall.addTtls', 'must return a non-negative integer');
    return { expired };
  });

  // The slot call has no deadline of its own in the baseline path; learner code gets SLOT_TIMEOUT_MS (10 s here).
  // The fault itself blocks Redis for ONCALL_SPIN_MS; the app's learner Redis wrapper answers 500 after 2 s.
  app.post('/app/oncall/badges/recompute', async (req) => {
    const result = await slots.call(scopeOf(req), 'oncall.recomputeBadges');
    return { ok: true, result: result ?? null };
  });

  app.get<{ Params: { teamId: string } }>('/app/oncall/teams/:teamId', async (req) => {
    const teamId = req.params.teamId;
    if (!SAFE_ID.test(teamId)) throw new HttpError(400, 'invalid_team_id');
    const team = await slots.call(scopeOf(req), 'oncall.lookupTeam', teamId);
    if (team === null || team === undefined || (isObj(team) && Object.keys(team).length === 0))
      throw new HttpError(404, 'team_not_found');
    if (!isObj(team) || typeof team.id !== 'string' || typeof team.name !== 'string')
      throw slots.contractError('oncall.lookupTeam', 'must return { id, name } (strings) or null');
    return { id: team.id, name: team.name };
  });

  app.post('/app/oncall/split', async (req) => {
    const b = isObj(req.body) ? req.body : {};
    if (!str(b.key, 256))
      throw new HttpError(400, 'invalid_key', 'key must be 1 to 256 characters');
    if (b.key.startsWith(RESERVED))
      throw new HttpError(400, 'reserved_key', 'keys under game:* belong to the engine');
    if (!intIn(b.buckets, 2, 1024))
      throw new HttpError(400, 'invalid_buckets', 'buckets must be an integer from 2 to 1024');
    const out = await slots.call(scopeOf(req), 'oncall.splitBigKey', b.key, b.buckets);
    if (
      !isObj(out) ||
      !intIn(out.fields, 0, Number.MAX_SAFE_INTEGER) ||
      !intIn(out.buckets, 0, 1024)
    )
      throw slots.contractError(
        'oncall.splitBigKey',
        'must return { fields, buckets } (non-negative integers)',
      );
    return { key: b.key, fields: out.fields, buckets: out.buckets };
  });

  // Not a slot: how many never-closed clients the faulty lookupTeam baseline holds on THIS instance.
  app.get('/app/oncall/status', async () => ({ leakedClients: oncallLeakedClients(), instance }));
}
