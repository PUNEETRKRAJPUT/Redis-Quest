# P0-06: Engine skeleton: health, levels API, progress file + Redis mirror, WebSocket, CLI proxy, log tail

> DRAFT until the P0-05 handoff lands; the level types and loader names below must match what
> `docs/handoffs/P0-05.md` reports. The orchestrator finalises this spec before spawning.

**Goal.** The single-instance game server that the UI talks to: it knows the levels, owns the learner's
progress, runs the in-browser Redis CLI, streams events and logs, and tells the app which Redis target
and which learner slots are active. No verifiers yet (P0-09) and no real UI yet (P0-10); a scripted
Chapter 0 must be playable from `curl`.

**Depends on.** P0-01, P0-02, P0-05

**Files owned.**
- `engine/` (everything except what P0-01 created, which you may change)
- `docker-compose.yml`: only inside markers `# --- P0-06 engine mounts start/end`: add `./levels:/levels:ro`
  to the `engine` service and `LEVELS_DIR=/levels`
- `scripts/check/P0-06.sh`

**Must not touch.** `app/`, `runner/`, `ui/`, `packages/`, `levels/` content, `docker/`, `postgres/`.

**Interfaces to honour.**
- Fastify on `PORT` 4200. Serves `ui/dist` statically at `/` (if present) with SPA fallback; everything
  under `/api` and `/ws` is the engine. Env from the P0-02 spec plus `LEVELS_DIR`.
- **Progress file is the source of truth:** `${PROGRESS_DIR}/progress.json`, schema versioned
  (`version: 1`), written atomically (temp file + rename) on every change:
  `{ version, player: { id, name, createdAt }, target: { redisUrl }, activeSlots: [slot], levels:
  { [levelId]: { status: 'locked'|'available'|'in_progress'|'passed', attempts, verdicts: [{ at, verdict }],
  brainstorm?: { optionId, text, at }, completedAt? } }, xp, badges: [] }`. Export the TypeScript type from
  the engine for now (P0-10 will import it; moving it to shared is a later chore).
- **Redis mirror** under `game:*` in the current target: `game:player:<id>` hash (name, xp, level
  counts), `game:progress` hash (levelId → status), `game:welcome:gift` string with a 24 h TTL set once
  at player creation (Chapter 0.4 reads it). `POST /api/progress/restore` rewrites the mirror from the
  file; a mirror write that fails (Redis down) is logged and never blocks the file write.
- **HTTP API** (JSON):
  - `GET /health` → `{ ok, service: 'engine', redis: 'up'|'down', postgres: 'up'|'down' }`
  - `POST /api/player { name }` (first run) → progress; `GET /api/progress`
  - `GET /api/chapters` (ordered, with level summaries and statuses); `GET /api/levels/:id` (rendered
    markdown fields with templating applied, hints hidden until requested)
  - `POST /api/levels/:id/start`, `POST /api/levels/:id/brainstorm { optionId, text }`,
    `POST /api/levels/:id/hint` (reveals next hint, records it), `POST /api/levels/:id/verify` (runs
    `setup` once, then returns `{ verdict: 'not_implemented' }` for now; P0-09 fills it),
    `POST /api/levels/:id/complete` (dev-only shortcut behind `ENGINE_DEV=1`, used by the check)
  - `POST /api/cli { command }` → `{ reply, type, ms }`: split like a shell (quotes), run with
    `redis.sendCommand`, format replies like `redis-cli` (integers, bulk, arrays with indices, nil,
    errors). Never refuse a command (it is the learner's machine) but emit a `cli.dangerous` event for
    `KEYS`, `FLUSHALL`, `FLUSHDB`, `MONITOR`, `DEBUG`.
  - `GET /api/target`, `PUT /api/target { redisUrl }`; `GET /api/slots`, `PUT /api/slots { active: [] }`
  - `GET /internal/app-config` → `{ target, activeSlots, dbExtraLatencyMs, etag }` (polled by every
    app instance every 2 s; include `ETag`/`If-None-Match` support)
  - `POST /internal/metrics` (app instances push per-second route metrics; keep the last 5 minutes in
    memory keyed by instance id; `GET /api/metrics` returns the aggregate)
- **WebSocket** at `/ws`: JSON events `{ type, at, data }` for `progress.changed`, `level.event`,
  `cli.dangerous`, `metrics.tick`, `log.line { service, line }`, `redis.state { up }`.
- **Log tail:** watch `${LOG_DIR}/{app,runner,proxy,postgres}/**` with polling (bind mounts), stream new
  lines as `log.line` events, keep a 500-line ring per service for `GET /api/logs/:service`.
- Redis connection: node-redis v5 with an `error` handler, reconnect strategy, `connectTimeout 3000`;
  `redis.state` events on connect/disconnect. Switching target reconnects cleanly.
- Structured logs (pino) to stdout and `${LOG_DIR}/engine/engine.log`.

**Work.** Build the above; vitest for progress file atomicity and restore, CLI parsing and formatting,
app-config ETag; `scripts/check/P0-06.sh`: build, `docker compose up -d --build redis postgres engine`
(use the repo `.env`), then via curl: health; create player; chapters list contains `ch0-boot` levels
from `levels/` (if Chapter 0 content is not written yet, the check creates a temporary chapter from
`levels/_examples` in a temp `LEVELS_DIR`); start level, brainstorm, hint, `complete` with `ENGINE_DEV=1`;
`progress.json` updated and `game:progress` hash in Redis matches; `FLUSHALL` through `/api/cli`, mirror
gone, `restore`, mirror back; `PUT /api/target` to the same URL reconnects; `/internal/app-config` returns
304 on matching ETag; a WebSocket client receives `progress.changed`; `docker compose down`.

**Acceptance check.** `scripts/check/P0-06.sh` exits 0.

**Handoff complete when.** check passes; `docs/handoffs/P0-06.md` written with the check output, the
exact API shapes (P0-09 and P0-10 code against them), and the progress file schema; no files outside
"Files owned" changed.

**Model.** sonnet
