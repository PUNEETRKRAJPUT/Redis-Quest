import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { connect as tcpConnect } from 'node:net';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyReply } from 'fastify';
import type { Logger } from 'pino';
import { renderTemplates, SLOT_NAME, TemplateError } from '@quest/shared';
import { etagOf, matchesEtag, type AppConfig } from './appconfig.js';
import { DANGEROUS_COMMANDS, runCli } from './cli.js';
import type { Config } from './config.js';
import type { EventBus } from './events.js';
import { renderLevel, templateContext, type LevelIndexEntry, type LevelService } from './levels.js';
import { LOG_SERVICES, type LogService, type LogTail } from './logtail.js';
import {
  chargeHint,
  interviewSpec,
  interviewView,
  settlePass,
  startInterview,
  verifyTiming,
} from './interview.js';
import { KEY_BOOTS, type Mirror } from './mirror.js';
import { MetricsStore, parsePush } from './metrics.js';
import { newProgress, reconcileLevels, type ProgressFile, type ProgressStore } from './progress.js';
import type { RedisManager } from './redis.js';
import { runSetup, SetupRefusedError } from './setup.js';
import { runVerification, type Answers } from './verify.js';
import { loadVerifyConfig } from './verify/config.js';
import { levelSlots, Verifier, VerifyBusyError } from './verify/index.js';
import { ScenarioError } from './load/scenario.js';
import { TrafficError } from './verify/traffic.js';
import { buildIdeal, idealAccess } from './verify/ideal.js';
import { listTree, readWorkspaceFile, WorkspaceError, writeWorkspaceFile } from './workspace.js';

export interface Deps {
  cfg: Config;
  log: Logger;
  bus: EventBus;
  store: ProgressStore;
  redis: RedisManager;
  mirror: Mirror;
  levels: LevelService;
  logtail: LogTail;
  metrics: MetricsStore;
  runtime: Runtime;
}

/** State that lives outside progress.json until a player exists (and is copied into it afterwards). */
export interface Runtime {
  redisUrl: string;
  activeSlots: string[];
  dbExtraLatencyMs: number;
  /** Value of game:engine:boots after this boot's INCR, or null if Redis was not reachable yet. */
  boots: number | null;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const STATUS_FOR_WORKSPACE: Record<WorkspaceError['code'], number> = {
  invalid_path: 400,
  extension_not_allowed: 400,
  path_escapes_workspace: 403,
  not_found: 404,
  too_large: 413,
  not_a_file: 400,
};

async function postgresUp(databaseUrl: string): Promise<boolean> {
  let host: string;
  let port: number;
  try {
    const u = new URL(databaseUrl);
    host = u.hostname;
    port = Number(u.port || 5432);
  } catch {
    return false;
  }
  return new Promise((resolve) => {
    const sock = tcpConnect({ host, port, timeout: 1000 });
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.once('error', () => resolve(false));
  });
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export async function buildServer(d: Deps): Promise<FastifyInstance> {
  const { cfg, log, bus, store, redis, mirror, levels, logtail, metrics, runtime } = d;
  const app = Fastify({
    loggerInstance: log as unknown as FastifyBaseLogger,
    disableRequestLogging: true,
  });

  // An empty body with a JSON content type is `{}`, so `curl -X POST -H 'content-type: ...'` just works.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, body === '' ? {} : JSON.parse(body as string));
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      e.statusCode = 400;
      done(e, undefined);
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, ...err.extra });
    }
    if (err instanceof WorkspaceError) {
      return reply
        .code(STATUS_FOR_WORKSPACE[err.code])
        .send({ error: err.code, message: err.message });
    }
    if (err instanceof TemplateError) {
      return reply.code(500).send({ error: 'template', message: err.message });
    }
    if (err instanceof SetupRefusedError) {
      return reply.code(500).send({ error: 'setup_refused', message: err.message });
    }
    if (err instanceof VerifyBusyError) {
      return reply.code(409).send({ error: 'verify_in_progress', message: err.message });
    }
    if (err instanceof ScenarioError) {
      return reply.code(400).send({ error: 'invalid_scenario', message: err.message });
    }
    if (err instanceof TrafficError) {
      return reply.code(502).send({ error: 'traffic_failed', message: err.message });
    }
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) log.error({ err }, 'request failed');
    return reply
      .code(status)
      .send({ error: status >= 500 ? 'internal' : 'bad_request', message: err.message });
  });

  // P0-09: the verifier engine (one per server); it taps app metric pushes and keeps its own event log.
  const verifier = new Verifier({
    cfg: loadVerifyConfig({ progressDir: cfg.progressDir, port: cfg.port }),
    log,
    bus,
    redis,
    metrics,
  });
  verifier.startCommandCheck();

  // ---- helpers -------------------------------------------------------------------------------
  const redisUrl = () => store.current?.target.redisUrl ?? runtime.redisUrl;
  const activeSlots = () => store.current?.activeSlots ?? runtime.activeSlots;
  const appConfig = (): AppConfig => ({
    target: { redisUrl: redisUrl() },
    activeSlots: [...activeSlots()],
    dbExtraLatencyMs: runtime.dbExtraLatencyMs,
  });

  function needPlayer(): ProgressFile {
    if (!store.current)
      throw new HttpError(404, 'no_player', 'no player yet: POST /api/player { name } first');
    return store.current;
  }

  function needLevel(id: string): LevelIndexEntry {
    const entry = levels.get(id);
    if (!entry) throw new HttpError(404, 'unknown_level', `no level ${id}`);
    return entry;
  }

  /** Applies a change to progress.json (atomic), tells listeners, then mirrors to Redis (best effort). */
  async function commit<T>(
    reason: string,
    levelId: string | undefined,
    fn: (draft: ProgressFile) => T,
  ): Promise<T> {
    const out = await store.update(fn);
    const p = store.current as ProgressFile;
    bus.emit('progress.changed', { reason, levelId: levelId ?? null, progress: p });
    await mirror.write(p);
    return out;
  }

  /** `atMs` is when the learner asked for the verdict (an interview deadline is judged at the click, not after a slow load run). */
  function markPassed(
    draft: ProgressFile,
    entry: LevelIndexEntry,
    now: string,
    atMs: number = Date.parse(now),
  ): void {
    const lp = draft.levels[entry.level.level.id];
    if (!lp || lp.status === 'passed') return;
    lp.status = 'passed';
    lp.completedAt = now;
    const iv = interviewSpec(entry.level);
    if (iv) settlePass(iv, lp, atMs);
    draft.xp += entry.level.level.reward.xp;
    const badge = entry.level.level.reward.badge;
    if (badge && !draft.badges.includes(badge)) draft.badges.push(badge);
    reconcileLevels(draft, levels.orderedIds);
  }

  function activeEntry(
    id: string,
    allowStatuses: string[],
  ): { entry: LevelIndexEntry; p: ProgressFile } {
    const p = needPlayer();
    const entry = needLevel(id);
    const lp = p.levels[id];
    if (!lp || lp.status === 'locked')
      throw new HttpError(409, 'level_locked', `${id} is locked: pass the level before it first`);
    if (!allowStatuses.includes(lp.status)) {
      throw new HttpError(
        409,
        'level_not_started',
        `${id} is ${lp.status}: POST /api/levels/${id}/start first`,
      );
    }
    return { entry, p };
  }

  const send = (reply: FastifyReply, code: number, body: unknown) => reply.code(code).send(body);

  // ---- non-/api routes ------------------------------------------------------------------------
  app.get('/health', async (req) => {
    const [pg, boots] = await Promise.all([
      postgresUp(cfg.databaseUrl),
      redis.isUp
        ? redis.send<string | null>(['GET', KEY_BOOTS]).then(
            (v) => (v === null ? null : Number(v)),
            () => null,
          )
        : Promise.resolve(null),
    ]);
    return {
      ok: true,
      service: 'engine',
      redis: redis.isUp ? 'up' : 'down',
      postgres: pg ? 'up' : 'down',
      boots,
      levels: levels.errors.length === 0 ? 'ok' : 'error',
      insightUrl: insightUrlFor(req.headers.host, process.env.INSIGHT_PORT),
    };
  });

  app.get('/internal/app-config', async (req, reply) => {
    const cfgNow = appConfig();
    const etag = etagOf(cfgNow);
    reply.header('ETag', `"${etag}"`).header('Cache-Control', 'no-cache');
    if (matchesEtag(req.headers['if-none-match'], etag)) return reply.code(304).send();
    return { ...cfgNow, etag };
  });

  app.post('/internal/metrics', async (req) => {
    try {
      metrics.push(parsePush(req.body));
    } catch (err) {
      throw new HttpError(400, 'invalid_metrics', (err as Error).message);
    }
    return { ok: true };
  });

  // ---- /ws ------------------------------------------------------------------------------------
  await app.register(fastifyWebsocket);
  app.get('/ws', { websocket: true }, (socket) => {
    const sendEvent = (e: unknown) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(e));
    };
    // A new client learns the current Redis state straight away.
    sendEvent({ type: 'redis.state', at: new Date().toISOString(), data: { up: redis.isUp } });
    const off = bus.subscribe(sendEvent);
    socket.on('close', off);
    socket.on('error', off);
  });

  // ---- /api -----------------------------------------------------------------------------------
  await app.register(
    async (api) => {
      // A broken level file stops the whole API rather than serving half a game.
      api.addHook('onRequest', async (_req, reply) => {
        if (levels.errors.length > 0) {
          return send(reply, 503, {
            error: 'levels_invalid',
            message: 'level files have errors; fix them and restart the engine',
            errors: levels.errors,
          });
        }
      });

      api.post('/player', async (req, reply) => {
        if (store.current)
          throw new HttpError(
            409,
            'player_exists',
            'a player already exists; progress.json is the save file',
          );
        const name =
          isObject(req.body) && typeof req.body.name === 'string' ? req.body.name.trim() : '';
        // eslint-disable-next-line no-control-regex
        if (name.length < 1 || name.length > 40 || /[\u0000-\u001f]/.test(name)) {
          throw new HttpError(400, 'invalid_name', 'name must be 1 to 40 characters');
        }
        const p = newProgress({
          id: `p-${randomBytes(4).toString('hex')}`,
          name,
          redisUrl: runtime.redisUrl,
          activeSlots: runtime.activeSlots,
          now: new Date(),
        });
        reconcileLevels(p, levels.orderedIds);
        await store.create(p);
        bus.emit('progress.changed', { reason: 'player_created', levelId: null, progress: p });
        await mirror.write(p);
        await mirror.setGift(p);
        return send(reply, 201, p);
      });

      api.get('/progress', async () => needPlayer());

      api.get('/progress/mirror', async () => {
        const p = needPlayer();
        return { redis: redis.isUp ? 'up' : 'down', ...(await mirror.status(p)) };
      });

      api.post('/progress/restore', async () => {
        const r = await store.reloadFromDisk();
        if (r.kind === 'missing')
          throw new HttpError(404, 'no_player', 'there is no progress.json to restore from');
        if (r.kind === 'invalid')
          throw new HttpError(500, 'progress_invalid', `progress.json ${r.reason}`);
        const p = r.progress;
        try {
          await mirror.writeStrict(p);
        } catch (err) {
          throw new HttpError(
            503,
            'redis_unavailable',
            `could not write the mirror: ${(err as Error).message}`,
          );
        }
        // The gift always exists while the game runs: set again with a fresh 24 h TTL if missing.
        // The boot counter comes from this engine's memory.
        await mirror.setGift(p);
        if (runtime.boots !== null)
          await redis.send(['SET', KEY_BOOTS, String(runtime.boots)]).catch(() => undefined);
        bus.emit('progress.changed', { reason: 'restored', levelId: null, progress: p });
        // Level 1.15 (FLUSHALL, then restore) verifies on this custom event.
        bus.emit('level.event', { kind: 'custom', name: 'progress_restored' });
        return { ok: true, restored: true, levels: Object.keys(p.levels).length };
      });

      api.get('/chapters', async () => {
        const p = store.current;
        return {
          player: p ? { id: p.player.id, name: p.player.name } : null,
          xp: p?.xp ?? 0,
          chapters: levels.chapters.map((c) => ({
            id: c.id,
            dirName: c.dirName,
            title: c.chapter.title,
            incident: c.chapter.incident,
            levels: c.levels.map((l) => {
              const lp = p?.levels[l.level.id];
              return {
                id: l.level.id,
                title: l.level.title,
                mode: l.level.mode,
                xp: l.level.reward.xp,
                status: lp?.status ?? 'locked',
                attempts: lp?.attempts ?? 0,
              };
            }),
          })),
        };
      });

      api.get<{ Params: { id: string } }>('/levels/:id', async (req) => {
        const p = needPlayer();
        const entry = needLevel(req.params.id);
        const lp = p.levels[entry.level.level.id];
        if (!lp || lp.status === 'locked')
          throw new HttpError(409, 'level_locked', `${req.params.id} is locked`);
        const iv = interviewSpec(entry.level);
        const timing = iv
          ? interviewView(iv, lp, Date.now(), levels.get(iv.rebuildOf)?.level.level.title ?? null)
          : { interview: null, remainingMs: null };
        return {
          ...renderLevel(entry, templateContext(cfg, p, entry), lp),
          ...timing,
          status: lp.status,
          attempts: lp.attempts,
          brainstormAnswer: lp.brainstorm ?? null,
          startedAt: lp.startedAt ?? null,
          completedAt: lp.completedAt ?? null,
        };
      });

      api.post<{ Params: { id: string } }>('/levels/:id/start', async (req) => {
        const p = needPlayer();
        const entry = needLevel(req.params.id);
        const id = entry.level.level.id;
        const lp = p.levels[id];
        if (!lp || lp.status === 'locked')
          throw new HttpError(
            409,
            'level_locked',
            `${id} is locked: pass the level before it first`,
          );
        if (!redis.isUp)
          throw new HttpError(
            503,
            'redis_unavailable',
            'Redis is down, so the level setup cannot run',
          );
        const setup = await runSetup(entry.level, templateContext(cfg, p, entry), redis);
        const now = new Date().toISOString();
        const level = await commit('level_started', id, (draft) => {
          const l = draft.levels[id] as NonNullable<ProgressFile['levels'][string]>;
          if (l.status === 'available') l.status = 'in_progress';
          l.startedAt = now;
          if (interviewSpec(entry.level)) startInterview(l, now);
          return l;
        });
        bus.emit('level.event', { kind: 'custom', name: 'level_started', data: { levelId: id } });
        return { status: level.status, startedAt: now, setup, level };
      });

      api.post<{ Params: { id: string } }>('/levels/:id/brainstorm', async (req) => {
        const { entry } = activeEntry(req.params.id, ['in_progress', 'passed']);
        const body = isObject(req.body) ? req.body : {};
        const optionId = body.optionId;
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        const option = entry.level.level.brainstorm.options.find((o) => o.id === optionId);
        if (!option)
          throw new HttpError(
            400,
            'unknown_option',
            "optionId is not one of this level's brainstorm options",
          );
        if (text.length < 1 || text.length > 500)
          throw new HttpError(
            400,
            'invalid_text',
            'write one line (1 to 500 characters) about why',
          );
        const at = new Date().toISOString();
        await commit('brainstorm', entry.level.level.id, (draft) => {
          (
            draft.levels[entry.level.level.id] as NonNullable<ProgressFile['levels'][string]>
          ).brainstorm = { optionId: option.id, text, at };
        });
        return {
          brainstorm: { optionId: option.id, text, at },
          isReasonable: option.is_reasonable,
        };
      });

      api.post<{ Params: { id: string } }>('/levels/:id/hint', async (req) => {
        const { entry, p } = activeEntry(req.params.id, ['in_progress', 'passed']);
        const id = entry.level.level.id;
        const hints = renderTemplates(
          entry.level.level.hints ?? [],
          templateContext(cfg, p, entry),
        );
        const revealed = p.levels[id]?.hintsRevealed ?? 0;
        if (revealed >= hints.length)
          throw new HttpError(
            409,
            'no_more_hints',
            'all hints for this level are already revealed',
            { hintsTotal: hints.length },
          );
        const iv = interviewSpec(entry.level);
        const paid = await commit('hint', id, (draft) => {
          const l = draft.levels[id] as NonNullable<ProgressFile['levels'][string]>;
          l.hintsRevealed = revealed + 1;
          return iv ? chargeHint(iv, draft, l) : null;
        });
        return {
          index: revealed,
          hint: hints[revealed],
          revealed: revealed + 1,
          hintsTotal: hints.length,
          // Interview levels only: what this hint cost, the XP left, and how many were bought.
          ...(paid ? { xpCost: paid.charged, xp: paid.xp, hintsBought: paid.hintsBought } : {}),
        };
      });

      api.post<{ Params: { id: string } }>('/levels/:id/verify', async (req) => {
        const { entry, p } = activeEntry(req.params.id, ['in_progress', 'passed']);
        const id = entry.level.level.id;
        const body = isObject(req.body) ? req.body : {};
        const answers: Answers = {};
        if (body.answers !== undefined) {
          if (!isObject(body.answers))
            throw new HttpError(
              400,
              'invalid_answers',
              'answers must be an object { [verifyIndex]: string | string[] }',
            );
          for (const [k, v] of Object.entries(body.answers)) {
            const ok =
              typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
            if (!/^\d+$/.test(k) || !ok)
              throw new HttpError(
                400,
                'invalid_answers',
                `answers[${k}] must be a string or a list of strings under a numeric key`,
              );
            answers[k] = v as string | string[];
          }
        }
        const lp = p.levels[id] as NonNullable<ProgressFile['levels'][string]>;
        const requestedAtMs = Date.now();
        const iv = interviewSpec(entry.level);
        // Interview levels: grade as usual, but note whether the deadline had passed when it was asked for.
        const timing = iv ? verifyTiming(iv, lp, requestedAtMs) : null;
        const done = verifier.begin(p.player.id); // 409 verify_in_progress on overlap
        let outcome;
        try {
          outcome = await runVerification(
            entry.level,
            {
              templateCtx: templateContext(cfg, p, entry),
              redis,
              events: bus,
              startedAt: lp.startedAt,
              attempt: lp.attempts + 1,
              verifier,
            },
            answers,
          );
        } finally {
          done();
        }
        const now = new Date().toISOString();
        // Compact record in progress.json; the full feedback is in the response (and the WS events).
        const record = {
          at: now,
          verdict: outcome.verdict,
          durationMs: outcome.durationMs,
          ...(timing?.overtime ? { overtime: true as const } : {}),
          checks: outcome.checks.map((c) => ({
            index: c.index,
            type: c.type,
            ok: c.ok,
            ...(c.skipped ? { skipped: true } : {}),
          })),
        };
        // "The ideal way" rides along once allowed (passed, or 3 attempts); read before the commit.
        const ideal = await buildIdeal(entry.level, templateContext(cfg, p, entry));
        const result = await commit('verify', id, (draft) => {
          const l = draft.levels[id] as NonNullable<ProgressFile['levels'][string]> & {
            idealRevealedAt?: string;
          };
          l.attempts += 1;
          l.verdicts.push(record);
          if (outcome.verdict === 'right') markPassed(draft, entry, now, requestedAtMs);
          const access = idealAccess(l.status, l.attempts);
          if (access.allowed) l.idealRevealedAt ??= now;
          return { attempts: l.attempts, status: l.status, allowed: access.allowed };
        });
        return {
          ...outcome,
          attempts: result.attempts,
          status: result.status,
          ...(timing ? { overtime: timing.overtime, elapsedMs: timing.elapsedMs } : {}),
          ...(result.allowed ? { ideal } : {}),
        };
      });

      // The ideal way on request: always served, with whether it would have been shown anyway.
      api.get<{ Params: { id: string } }>('/levels/:id/ideal', async (req) => {
        const { entry, p } = activeEntry(req.params.id, ['available', 'in_progress', 'passed']);
        const id = entry.level.level.id;
        const lp = p.levels[id] as NonNullable<ProgressFile['levels'][string]>;
        const access = idealAccess(lp.status, lp.attempts);
        const ideal = await buildIdeal(entry.level, templateContext(cfg, p, entry));
        const now = new Date().toISOString();
        await commit('ideal', id, (draft) => {
          const l = draft.levels[id] as NonNullable<ProgressFile['levels'][string]> & {
            idealRevealedAt?: string;
          };
          l.idealRevealedAt ??= now;
        });
        return { ...access, ...ideal };
      });

      // Dev-only shortcut so checks and demos can walk the chapters without solving anything.
      api.post<{ Params: { id: string } }>('/levels/:id/complete', async (req) => {
        if (!cfg.dev) throw new HttpError(404, 'not_found', 'route not found');
        const p = needPlayer();
        const entry = needLevel(req.params.id);
        const id = entry.level.level.id;
        if (!p.levels[id] || p.levels[id]?.status === 'locked')
          throw new HttpError(409, 'level_locked', `${id} is locked`);
        const now = new Date().toISOString();
        return commit('completed', id, (draft) => {
          markPassed(draft, entry, now);
          return { status: draft.levels[id]?.status, xp: draft.xp };
        });
      });

      // ---- CLI --------------------------------------------------------------------------------
      api.post('/cli', async (req) => {
        const command = isObject(req.body) ? req.body.command : undefined;
        if (typeof command !== 'string' || command.trim() === '')
          throw new HttpError(400, 'invalid_command', 'command must be a non-empty string');
        const r = await runCli(redis, command);
        if (DANGEROUS_COMMANDS.has(r.command))
          bus.emit('cli.dangerous', { command: r.command, argv: r.argv });
        if (r.command === 'PING') bus.emit('level.event', { kind: 'custom', name: 'cli_ping' });
        return { reply: r.reply, type: r.type, ms: r.ms };
      });

      // ---- target and slots -------------------------------------------------------------------
      api.get('/target', async () => ({ redisUrl: redisUrl(), state: redis.isUp ? 'up' : 'down' }));
      api.put('/target', async (req) => {
        const url = isObject(req.body) ? req.body.redisUrl : undefined;
        let ok = typeof url === 'string';
        if (ok) {
          try {
            ok = ['redis:', 'rediss:'].includes(new URL(url as string).protocol);
          } catch {
            ok = false;
          }
        }
        if (!ok)
          throw new HttpError(400, 'invalid_url', 'redisUrl must look like redis://host:port');
        await redis.connect(url as string);
        runtime.redisUrl = url as string;
        if (store.current)
          await commit(
            'target',
            undefined,
            (draft) => void (draft.target.redisUrl = url as string),
          );
        return { redisUrl: url, state: redis.isUp ? 'up' : 'down' };
      });

      api.get('/slots', async () => ({ active: activeSlots() }));
      api.put('/slots', async (req) => {
        const active = isObject(req.body) ? req.body.active : undefined;
        if (
          !Array.isArray(active) ||
          active.length > 50 ||
          !active.every((s) => typeof s === 'string' && SLOT_NAME.test(s))
        ) {
          throw new HttpError(
            400,
            'invalid_slots',
            'active must be a list of slot names like cache.getPlayerStats',
          );
        }
        const unique = [...new Set(active as string[])];
        runtime.activeSlots = unique;
        if (store.current)
          await commit('slots', undefined, (draft) => void (draft.activeSlots = unique));
        return { active: unique };
      });

      // Not in the P0-06 spec: the source of `dbExtraLatencyMs` in /internal/app-config (in memory, resets to 0 on restart).
      api.put('/db-latency', async (req) => {
        const ms = isObject(req.body) ? req.body.ms : undefined;
        if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 0 || ms > 5000)
          throw new HttpError(400, 'invalid_ms', 'ms must be an integer from 0 to 5000');
        runtime.dbExtraLatencyMs = ms;
        return { dbExtraLatencyMs: ms };
      });

      // ---- workspace --------------------------------------------------------------------------
      api.get('/workspace/tree', async () => ({ entries: await listTree(cfg.workspaceDir) }));
      api.get<{ Querystring: { path?: string } }>('/workspace/file', async (req) =>
        readWorkspaceFile(cfg.workspaceDir, req.query.path),
      );
      api.put<{ Querystring: { path?: string } }>('/workspace/file', async (req) => {
        const content = isObject(req.body) ? req.body.content : undefined;
        return writeWorkspaceFile(cfg.workspaceDir, req.query.path, content);
      });

      // ---- events, metrics, logs --------------------------------------------------------------
      api.get<{ Querystring: { since?: string } }>('/events', async (req) => ({
        events: bus.since(req.query.since),
      }));
      api.post('/events', async (req) => {
        const b = isObject(req.body) ? req.body : {};
        if (b.kind !== 'custom') throw new HttpError(400, 'invalid_kind', 'kind must be "custom"');
        if (typeof b.name !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(b.name))
          throw new HttpError(
            400,
            'invalid_name',
            'name must be 1 to 64 characters of letters, digits, _ . -',
          );
        bus.emit('level.event', {
          kind: 'custom',
          name: b.name,
          ...(b.data !== undefined ? { data: b.data } : {}),
        });
        return { ok: true };
      });

      // ---- verifier: baselines and the read-only allowlist cross-check (P0-09) -------------------
      api.post<{ Params: { scenario: string } }>('/baselines/:scenario/refresh', async (req) => {
        const body = isObject(req.body) ? req.body : {};
        let keep: string[] | null = null;
        if (body.levelId !== undefined) {
          const entry = needLevel(String(body.levelId));
          const own = levelSlots(entry.level.level.verify);
          keep = activeSlots().filter((s) => !own.includes(s));
        }
        const owner = store.current?.player.id ?? 'no-player';
        const done = verifier.begin(owner);
        try {
          return await verifier.refreshBaseline(req.params.scenario, keep);
        } finally {
          done();
        }
      });
      api.get('/verify/command-check', async () => verifier.commandCheck ?? { pending: true });

      api.get<{ Querystring: { seconds?: string } }>('/metrics', async (req) => {
        const s = Number(req.query.seconds ?? 60);
        return metrics.summary(Number.isFinite(s) ? s : 60);
      });

      api.get<{ Params: { service: string }; Querystring: { lines?: string } }>(
        '/logs/:service',
        async (req) => {
          const service = req.params.service as LogService;
          if (!LOG_SERVICES.includes(service))
            throw new HttpError(
              404,
              'unknown_service',
              `service must be one of ${LOG_SERVICES.join(', ')}`,
            );
          const n = Number(req.query.lines ?? 500);
          return { service, lines: logtail.lines(service, Number.isFinite(n) ? n : 500) };
        },
      );

      api.setNotFoundHandler((_req, reply) =>
        send(reply, 404, { error: 'not_found', message: 'route not found' }),
      );
    },
    { prefix: '/api' },
  );

  // ---- static UI + SPA fallback ----------------------------------------------------------------
  const indexHtml = join(cfg.uiDistDir, 'index.html');
  const haveUi = existsSync(indexHtml);
  if (haveUi) await app.register(fastifyStatic, { root: cfg.uiDistDir, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0] ?? '/';
    const engineOwned = /^\/(api|ws|internal|health)(\/|$)/.test(path);
    if (haveUi && !engineOwned && (req.method === 'GET' || req.method === 'HEAD'))
      return reply.type('text/html').sendFile('index.html');
    return reply.code(404).send({ error: 'not_found', message: 'route not found' });
  });

  return app;
}

/** Insight is published on its own host port, so the link keeps the host the learner reached the engine on. */
export function insightUrlFor(hostHeader: string | undefined, port: string | undefined): string {
  const p = port && /^\d{2,5}$/.test(port) ? port : '5540';
  let host = (hostHeader ?? '').trim();
  if (host.startsWith('[')) host = host.slice(0, host.indexOf(']') + 1);
  else host = host.replace(/:\d*$/, '');
  if (!host || !/^[A-Za-z0-9.\-[\]:]+$/.test(host)) host = 'localhost';
  return `http://${host}:${p}`;
}
