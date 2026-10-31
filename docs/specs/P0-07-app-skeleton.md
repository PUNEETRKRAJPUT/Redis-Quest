# P0-07: App skeleton: baseline routes, slot registry, target switching, metrics push

> DRAFT until the P0-04, P0-05 and P0-08 handoffs land (hot player ids, level types, the shared learner
> module). The orchestrator finalises this spec before spawning.

**Goal.** The pre-built fantasy-cricket backend the learner extends. It serves the slow baseline paths
out of the box, loads the learner's workspace files into named slots when the engine says a slot is
active, follows the engine's Redis target, scales to N instances, and reports per-route metrics. This is
the mechanism the whole game stands on; design it so a level author never touches it.

**Depends on.** P0-01, P0-02, P0-04, P0-05, P0-08

**Files owned.**
- `app/` (everything except what P0-01 created, which you may change)
- `scripts/check/P0-07.sh`

**Must not touch.** `engine/`, `runner/`, `ui/`, `packages/`, `levels/`, `docker/`, `docker-compose.yml`,
`postgres/`, `workspace/` (read only; your tests use `workspace/_examples` and temp dirs).

**Interfaces to honour.**
- Fastify on `PORT` 4000; **every route is under `/app`** (Caddy forwards the path unchanged).
  `GET /app/health` → `{ ok, service: 'app', instance, target, activeSlots }`. `instance` = hostname.
- **Pull configuration from the engine**: `GET ${ENGINE_URL}/internal/app-config` every 2 s with
  `If-None-Match`; apply changes to target (reconnect Redis) and active slots (load/unload). Works for any
  number of instances because each pulls. If the engine is unreachable, keep the last config.
- **Push metrics to the engine**: every second, `POST ${ENGINE_URL}/internal/metrics`
  `{ instance, at, routes: { [route]: { count, errors, p50Ms, p99Ms, dbQueries, redisCommands } } }`,
  computed from the last second. Use the counters from `@quest/shared/learner`.
- **Slots.** `app/src/slots/registry.ts` declares each slot once:
  `{ name: 'cache.getPlayerStats', file: 'ch2/cache.js', baseline: fn, signature: '(deps, playerId)' }`.
  A route calls `slots.call('cache.getPlayerStats', playerId)`: if the slot is active and the learner file
  loads, run the learner function with `createLearnerDeps` (same deps as the runner, shared client and
  pool per instance, counters per request); otherwise run the baseline. Learner files are re-checked by
  polling mtime every 1 s (`chokidar` with `usePolling`). A learner function that throws returns `500`
  with header `x-quest-slot-error: <message>` and the error is logged to `${LOG_DIR}/app/app.log`; the
  process never dies. A learner function slower than `SLOT_TIMEOUT_MS` (default 10 s) is cut off the
  same way.
- **Baseline routes for Milestone 1** (all read from Postgres, none from Redis, by design):
  - `GET /app/players/:id` → player row
  - `GET /app/players/:id/stats` → `SELECT * FROM player_stats($1)` (the deliberately slow function;
    slot `cache.getPlayerStats`)
  - `POST /app/players/:id/stats/refresh` → recompute marker (slot `cache.invalidatePlayerStats`; the
    baseline is a no-op that touches `players.updated_at`)
  - `GET /app/fixtures` → scheduled and live matches (slot `prefetch.getFixtures`)
  - `POST /app/login { userId }` and `GET /app/me` with cookie `sid` (slots `session.create`,
    `session.get`; the baseline keeps sessions in an in-process Map, which is the Chapter 3.1 lesson)
  - `GET /app/leaderboard/:contestId?limit=10` → `ORDER BY points DESC` over `contest_entries`
    (slot `leaderboard.top`)
  - `GET /app/limits/ping` → a route guarded by slot `ratelimit.allow` (baseline: in-process fixed window
    per `x-user-id`, again on purpose)
  - Optional extra latency on every DB call from `dbExtraLatencyMs` in the app config (one level uses it).
- Redis client: node-redis v5, one shared client per instance plus one `duplicate()` reserved for the
  learner's subscribe/blocking needs later; `error` handler; reconnect; never crash when Redis is down
  (baselines do not need it).

**Work.** Build the above with vitest covering: slot fallback to baseline, learner override, error
isolation, timeout, hot reload after file change, config pull with ETag, metrics push shape. 
`scripts/check/P0-07.sh`: build; `docker compose up -d --build redis postgres engine app`; curl each
baseline route with ids from `docs/handoffs/P0-04.md`; `/app/players/<hot id>/stats` takes over 100 ms
(print it); activate `cache.getPlayerStats` via the engine (`PUT /api/slots`) with a learner file copied
into `workspace/ch2/cache.js` from `workspace/_examples` (a 10-line cache-aside using `HGETALL`/`HSET`/
`EXPIRE`); second call is under 20 ms and `redisCommands` rises in `GET /api/metrics`; replace the file
with one that throws → `500` with the header, app still healthy; `docker compose up -d --scale app=2`,
`/app/health` through the proxy shows two different `instance` values across 20 calls; metrics in the
engine list two instances; `docker compose down`; clean the copied workspace file.

**Acceptance check.** `scripts/check/P0-07.sh` exits 0.

**Handoff complete when.** check passes; `docs/handoffs/P0-07.md` written with the check output, the
slot list with signatures, the config-pull and metrics-push contracts as implemented, and the rules a
level author follows to add a new slot; no files outside "Files owned" changed.

**Model.** opus. The slot/target mechanism is the load-bearing wall of the game.
