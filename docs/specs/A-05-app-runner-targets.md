# A-05: the app and the runner follow replica, sentinel and cluster targets; a client-side-cached client

**Goal.** When the engine's target moves (Chapter 5), the app's shared client, its workers and every learner
call, and the runner's learner client, must follow to a replica, a Sentinel-managed master or a cluster, using the
same target string the engine uses. The celebrity level also needs a long-lived client with client-side caching
that learner code can use.

**Depends on.** E-03's `packages/shared/src/learner/target.ts` (being written right now, first thing, with the
exported signatures in `docs/specs/E-03-engine-targets.md`). Until the file exists, build everything else; code
against the signatures; the build goes green once it lands. Do not write that file yourself.

**Files owned.**
- `app/` (`src/redis.ts`, workers, routes, tests), `runner/` (`src/server.ts` validation of `redisUrl`, tests)
- `packages/shared/src/learner/deps.ts`, `counting.ts`, `failfast.ts`, `types.ts`, `index.ts` (export additions only;
  E-03 owns `target.ts`), `packages/shared/src/learner/__tests__/` except `target.test.ts`
- `engine/src/verify/slots.ts` (only, if a slot changes; probably not)
- `scripts/check/A-05.sh`, `scripts/check/compose.a05.yaml` (an override that removes the published host ports of the
  profile services so this check can run profiles while E-03's does), `.env.a05` (gitignored:
  `PROXY_PORT=3950 REDIS_PORT=6387 PG_PORT=5442 INSIGHT_PORT=5550`)
- `docs/handoffs/A-05.md`

**Must not touch.** `engine/` beyond `engine/src/verify/slots.ts`, `ui/`, `packages/shared/src/learner/target.ts`,
`packages/shared/src/levels/`, `levels/`, `scenarios/`, `docker-compose.yml`, `docker/`, `scripts/grade/`, other
checks, `docs/BUILD.md`. Compose project `quest-a05` only.

**Interfaces to honour.** `docs/handoffs/P0-07.md` (config pull: the target URL arrives in `/internal/app-config`
as `target.redisUrl`, `switchTo(url)` swaps the shared client and the reserved duplicate), `docs/handoffs/A-01.md`
and `A-02.md` (workers own connections: outbox, changes consumer, ticker), `docs/handoffs/A-03.md` (ops hook),
`docs/handoffs/P0-08.md` (runner: `redisUrl` override per job), the digest (node-redis guide: cluster and sentinel
constructors; client-side caching: `RESP: 3`, `clientSideCache`, node-redis ≥ 5.1, flush on disconnect).

**Work.**

1. **App target kinds.** `RedisTarget.switchTo(url)` parses with `parseTarget` and builds the shared client with
   `createTargetClient`; `/app/health` reports `target: { redisUrl, kind, description }`. Workers: the outbox
   drainer's `XADD`, the change consumer's `XREAD`, the ticker's `SUBSCRIBE` and the ops hook must either work on the
   new kind or stand down with one log line per switch (sentinel: everything works through the master; cluster:
   `XADD`/`XREAD` on one key work, `SUBSCRIBE` is not supported by the cluster client the same way: measure, and if
   it does not work, the ticker logs "ticker: not subscribed on a cluster target (sharded pub/sub is Chapter 5's
   lesson)" and `/app/ticker/:id` says `subscribed: false, reason`). A replica target is read-only: learner writes
   fail with `READONLY`, which is the lesson; the app itself must not crash or loop on it (the mirror is the
   engine's, not the app's).
2. **Learner deps.** `createLearnerDeps({ redisUrl })` (the runner path) builds the client with the helper; the
   injected-client path (the app) is unchanged. The counting and fail-fast proxies must wrap cluster and sentinel
   clients too (`duplicate()`, `multi()`, namespaces exist on all three; test what differs and say so).
   `deps.redis` on a cluster: a `multi()` across slots or a cross-slot `MGET` throws `CROSSSLOT`; make sure the
   error reaches the learner as an ordinary rejection with that text.
3. **`deps.redisCached`.** A second, long-lived client per target with `RESP: 3` and
   `clientSideCache: { ttl: 0, maxEntries: 5000, evictPolicy: 'LRU' }` for **single-node** targets, created lazily on
   first use and shared by every request on that instance (and by every job in the runner child), reconnected or
   rebuilt on target switch; on sentinel and cluster targets `deps.redisCached` is the ordinary client plus one log
   line (say whether node-redis supports CSC on those kinds; the digest's note covers single clients). Its calls
   are **not** added to `redisCommands` (a hit never reaches the server; the handoff must say so and point to `INFO
   commandstats` as the server-side truth). Counted or not, the learner's `deps.log` still works. Add it to the
   `LearnerDeps` type and to `levels/README.md`? No: README is E-03's; put the contract in the handoff and A-05's
   section of `docs/handoffs/P0-07.md` style table (your handoff), the content author copies it.
4. **Runner.** `POST /run` and `/load` accept the three schemes in `redisUrl` (validation currently expects
   `redis://`); the child builds deps through the helper; the fail-fast timeout still applies.
5. **Route.** `GET /app/target` → `{ redisUrl, kind, description, ready }` (the app's own view; the engine's is
   `/api/target`).

**Measure and record.** On the cluster target: which of `deps.redis` methods the leaderboard reference
(`app/test/fixtures/leaderboard-*.js`), the contest-join reference (WATCH on a duplicate, MULTI over `wallet:<u>` and
`contest:<id>:entries`) and the ticker publish do: which succeed, which fail and with what error text
(expect `CROSSSLOT` for the join's MULTI); a join rewritten with hash tags `{wallet:<u>}` and
`{wallet:<u>}:joins:<contest>` succeeds (write that fixture: `app/test/fixtures/contest-join-cluster.js`). On the
sentinel target: how long after `docker compose stop redis` the app's shared client is writing to the new master
(the app log and `/app/target`). On the replica target: the exact error of a learner `SET`. For `redisCached`: a
second `hGetAll` of the same key issues no server command (`INFO commandstats` `cmdstat_hgetall` calls unchanged),
and a `HSET` from another connection invalidates it (the third read goes to the server).

**Check.** `scripts/check/A-05.sh` (bash 3.2, project `quest-a05`, the ports override, profiles replica, sentinel and
cluster up, the cluster formed as E-03's spec says, scratch levels/progress, `down -v` on exit): the target
switches above driven through the engine's `PUT /api/target` (E-03's engine code may not be merged yet: then drive
the app directly by writing the target into a scratch engine? No: the app only follows the engine. If E-03's
`PUT /api/target` does not accept the new schemes yet in your tree, the check sets the app's `REDIS_URL` env per
scheme in the override and restarts the app for each target instead, and says so; switch to the engine route once it
accepts them); for each target: `/app/health` and `/app/target` show the kind, a learner file through the runner
(`POST /run` with `redisUrl`) and through the app (slot active) does `SET`/`GET` on `{a}:1`; replica: learner `SET` →
`READONLY` in the 500 body; cluster: the join reference → `CROSSSLOT` 500, the hash-tag join → 200 ten times with
wallet 100 and fee 10 under 50 parallel calls (exactly 10); sentinel: stop `redis`, within 20 s a learner `SET`
through the app succeeds again and `/app/target` shows the new master; `redisCached` behaviour as measured; app and
runner vitest, lint, format; exit 0, print each thing verified.

**Handoff.** `docs/handoffs/A-05.md`: what each kind supports in the app and runner, the `deps.redisCached`
contract, every measured error text and timing, and the check output.

**Model.** sonnet
