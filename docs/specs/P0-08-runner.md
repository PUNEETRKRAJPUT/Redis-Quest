# P0-08: Runner: execute learner code with injected dependencies, metrics, crash isolation

**Goal.** A small internal service that loads a learner's workspace module, calls its function with
`{ redis, db, log }`, and reports results and metrics, so `behavior` verifiers can grade code without the
engine or the app ever importing learner code in-process.

**Depends on.** P0-01, P0-02 (its check uses the compose `redis` and `postgres` services). P0-07 depends on this task.

**Files owned.**
- `runner/` (everything except what P0-01 created, which you may change)
- `packages/shared/src/learner/` (the reusable pieces: module loader with cache-busting, dependency
  injection, the counting Proxy for redis and db, the metrics aggregator) and the matching export line in
  `packages/shared/src/index.ts`; `packages/shared/package.json` only to add `redis` and `pg` as
  dependencies
- `workspace/README.md` (replace the placeholder with the learner-facing contract below)
- `workspace/_examples/` (sample modules used by tests and by the README)
- `scripts/check/P0-08.sh`

**Must not touch.** `engine/`, `app/`, `ui/`, `packages/shared/src/levels/` (P0-05 owns it), `docker/`,
`docker-compose.yml`, `postgres/`, `fiction/`, `docs/` (other than your handoff).

**Interfaces to honour.**
- **Learner module contract** (this is what beginners write; keep it tiny): a plain JavaScript ES
  module at `workspace/<chapter>/<slot-file>.js` whose default export is
  `async function (deps, ...args)`, where `deps = { redis, db, log }`. `redis` is a connected node-redis
  v5 client (camelCase commands, `redis.sendCommand([...])` for anything else). `db` has one method
  `db.query(text, params)` returning `{ rows }` (a thin pg wrapper). `log(...)` prints to the level's log
  panel. Named exports are allowed for helpers. No other imports are needed; `import` of npm packages
  is not supported in v1 (say so in the README).
- **HTTP API** on `PORT` (default 4100), JSON:
  - `GET /health` → `{ ok: true, service: 'runner' }`
  - `POST /load` `{ module }` → `{ ok, exports: [...], error? }` (does the module parse and import?)
  - `POST /run` `{ module, export?: 'default', calls: [{ args: [...] }], concurrency?: 1, timeoutMs?: 5000,
    redisUrl?, databaseUrl? }` → `{ results: [{ ok, value?, error?: { name, message, stack }, ms }],
    metrics: { calls, errors, p50Ms, p99Ms, dbQueries, redisCommands, totalMs }, logs: [string] }`.
    `redisUrl` / `databaseUrl` override the env defaults (Chapter 5 points at replicas and clusters).
- **Isolation:** every `/run` executes in a fresh child process (`node` with `--max-old-space-size=256`),
  so module caches never go stale and a crash, `process.exit`, infinite loop or unhandled rejection in
  learner code cannot take the runner down. Hard kill at `timeoutMs + 1000`. The parent never imports
  learner code.
- **Metrics:** `dbQueries` counts `db.query` calls; `redisCommands` counts commands sent through the
  injected client (wrap the client with a Proxy that counts method invocations and `sendCommand`;
  `multi()` chains count as one when executed; document the rule). Percentiles are over the per-call
  `ms` values.
- **Shared module `@quest/shared/learner`** (the app in P0-07 imports this instead of copying): 
  `createLearnerDeps({ redisUrl, databaseUrl, log }) → { deps, counters, close() }`,
  `loadLearnerModule(workspaceDir, relPath) → { fn, exports }` (fresh import each call, cache-busted by
  mtime query string), `callLearner(fn, deps, args, { timeoutMs })`. The child process in the runner and
  the request path in the app both use these; only the isolation strategy differs.
- Env: `WORKSPACE_DIR` (default `/workspace`), `REDIS_URL`, `DATABASE_URL`, `PORT`, `LOG_DIR`.
  Structured logs (pino) to stdout and to `${LOG_DIR}/runner/runner.log`.

**Work.**
1. Fastify server in `runner/src/`, child-process executor, dependency injection, Proxy counters.
2. `workspace/_examples/`: `ok.js` (reads and writes a key, one db query), `throws.js`, `hangs.js`,
   `exits.js`, `concurrent-counter.js` (uses `INCR` so concurrency is observable), and
   `README`-quality comments in each.
3. Vitest tests against a real Redis and Postgres (use the compose services: `docker compose up -d redis
   postgres` with the repo's `.env`; the host port for Redis on this Mac is 6390).
4. `workspace/README.md`: the contract above, written for a beginner, with one complete example and
   the three rules (default export, deps first, no npm imports).
5. `scripts/check/P0-08.sh`: build, start `redis` and `postgres` via compose, run the runner on the
   host with the right env, then via curl: health; `/load` on `ok.js` and on a syntax-error file; `/run`
   `ok.js` returns the value with `dbQueries: 1` and `redisCommands ≥ 2`; `throws.js` reports the error
   with the runner still healthy; `hangs.js` with `timeoutMs: 1000` returns within 2.5 s; `exits.js`
   reported and runner still healthy; `concurrent-counter.js` with `concurrency: 50` leaves the counter at
   exactly 50; edit a copy of `ok.js` between two runs and see the new return value (no stale cache).
   Stop the runner, `docker compose stop redis postgres`. Print each verification.

**Acceptance check.** `scripts/check/P0-08.sh` exits 0.

**Handoff complete when.** check passes; `docs/handoffs/P0-08.md` written with the check output, the
exact counting rules for metrics, and what P0-07 (the app, which calls learner modules in-process on the
request path) must copy from the dependency-injection code; no files outside "Files owned" changed.

**Model.** sonnet
