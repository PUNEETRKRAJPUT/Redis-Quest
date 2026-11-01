# A-03: app work Chapter 4 needs

**Goal.** Give Chapter 4 ("Work in the background": streams with consumer groups, the reliable job queue,
idempotent credits, delayed jobs, the contest lock, TTL jitter, the Bloom username check and the ops wall) its
slots, baselines and routes, plus one provided hook that feeds the learner's ops-wall recorder with the app's own
requests.

**Depends on.** nothing (C4 is being written in parallel from the same contracts; your handoff is binding for
it, so every deviation from the table below must be in your handoff in bold).

**Files owned.**
- `app/` (routes, slots registry, baselines, tests, fixtures)
- `engine/src/verify/slots.ts` only (the engine's copy of the slot table; its test fails when the two disagree)
- `scripts/check/A-03.sh`, `.env.a03` (gitignored; `PROXY_PORT=3800 REDIS_PORT=6398 PG_PORT=5440 INSIGHT_PORT=5548`)
- `docs/handoffs/A-03.md`

**Must not touch.** `engine/` beyond that one file, `ui/`, `packages/`, `runner/`, `levels/` (C4 is writing
`levels/ch4-*` right now), `scenarios/`, `docker-compose.yml`, `docker/`, `scripts/grade/`, other checks,
`docs/BUILD.md`. Compose project `quest-a03` only.

**Interfaces to honour.** `docs/handoffs/P0-07.md` ("Adding a slot", call semantics), `docs/handoffs/A-01.md`
and `docs/handoffs/A-02.md` (workers, background slot calls, the fail-fast client, `x-quest-instance`),
`docs/redis-docs-digest.md` sections: streams, use-cases/streaming, use-cases/job-queue, distributed-locks,
bloom-filter, time-series-dashboard, timeseries. Key names are the digest's where it has them.

**Slots** (file under `workspace/ch4/`; every return value is JSON-safe; baselines are the naive or legacy path on
purpose and say why in a comment):

| name | file | signature | returns | baseline |
|---|---|---|---|---|
| `points.consume` | `ch4/points-consume.js` | `(deps, matchId, consumer, count)` | `{ processed: string[] }` (entry ids it processed and acked, in order) | reads `balls` rows from Postgres for the match (`SELECT over_no, ball_no, batter_id, runs FROM balls WHERE match_id = $1 ORDER BY id LIMIT count`; check the real column names in `postgres/init/001-schema.sql`) and returns `{ processed: [] }` after adding nothing: the legacy path recomputes from the table and never acks anything |
| `points.sweep` | `ch4/points-sweep.js` | `(deps, matchId, consumer, minIdleMs, maxDeliveries)` | `{ reclaimed: string[], deadLettered: string[] }` | returns both empty (nothing to sweep in the legacy path) |
| `jobs.enqueue` | `ch4/jobs-enqueue.js` | `(deps, payload)` | the job id (string) | in-process `Map` queue per instance (the "works on one instance" bug): random 16-hex id |
| `jobs.claim` | `ch4/jobs-claim.js` | `(deps, worker, timeoutMs)` | `{ id, payload, token, attempts }` or `null` when nothing arrived within `timeoutMs` | the `Map` queue: shift the oldest, token = random hex |
| `jobs.complete` | `ch4/jobs-complete.js` | `(deps, id, token, result)` | `true` when this worker still owned the job and it is now completed, `false` otherwise (fenced) | `Map` |
| `jobs.fail` | `ch4/jobs-fail.js` | `(deps, id, token, error, maxAttempts)` | `"retry"` (back to pending), `"failed"` (gave up), or `false` (not the owner) | `Map` |
| `jobs.reclaim` | `ch4/jobs-reclaim.js` | `(deps, visibilityMs)` | the number of jobs moved back to pending | `Map`: 0 |
| `jobs.schedule` | `ch4/jobs-schedule.js` | `(deps, payload, runAtMs)` | the job id | `Map` with a timer |
| `jobs.promoteDue` | `ch4/jobs-promote.js` | `(deps, nowMs)` | the number of jobs moved from delayed to pending | `Map`: 0 |
| `wallet.credit` | `ch4/wallet-credit.js` | `(deps, userId, amount, idempotencyKey)` | `{ credited: boolean, balance: number }` | Postgres: `UPDATE wallets SET balance = balance + $2 ... RETURNING balance` plus a ledger row **every time** (the double-credit bug the level fixes; `reason = 'contest_payout'`, `ref = idempotencyKey`) |
| `contest.claimLastSlot` | `ch4/contest-last-slot.js` | `(deps, contestId, userId)` | `true` (got the slot) or `false` | reads `contest:<contestId>:slots` with `GET`, and when above 0 `DECR`s it and returns true (the check-then-act race the level fixes) |
| `sessions.expireWithJitter` | `ch4/sessions-jitter.js` | `(deps, keys, baseSeconds, jitterSeconds)` | the number of keys given a TTL | `EXPIRE key baseSeconds` for every key, one await per key, no jitter (the expiry storm) |
| `users.usernameTaken` | `ch4/username-taken.js` | `(deps, name)` | `{ taken: boolean, checkedDb: boolean }` | Postgres every time: `SELECT 1 FROM users WHERE handle = $1`, `checkedDb: true` |
| `ops.record` | `ch4/ops-record.js` | `(deps, sample)` with `sample = { route, status, ms, at }` (`at` epoch ms) | anything (ignored) | nothing (returns null) |
| `ops.range` | `ch4/ops-range.js` | `(deps, route, fromMs, toMs, bucketMs)` | `{ route, buckets: [{ at, requests, errors, avgMs }] }` | `{ route, buckets: [] }` |

The Redis side is the learner's: stream `match:<matchId>:balls` with group `points` (entries carry `over`,
`ball`, `batter`, `runs`), points in `lb:match:<matchId>` (zset by batter), dead letters in
`match:<matchId>:balls:dead`; the queue keys exactly as the job-queue page names them (`queue:jobs:pending`,
`queue:jobs:processing`, `queue:jobs:completed`, `queue:jobs:failed`, `queue:jobs:job:<id>`, plus
`queue:jobs:delayed` zset); `wallet:<userId>` and `idem:<key>`; `lock:contest:<id>` and `contest:<id>:slots`;
`bf:usernames`; `ts:requests:<route>`, `ts:errors:<route>`, `ts:latency:<route>` (route in keys is the
route key with spaces and slashes replaced by `_`, e.g. `GET_app_players_:id_stats`; say the exact rule in the
handoff and expose it as `routeKey()` in a comment the levels can quote).

**Routes** (all `/app/...`, counted in metrics, inputs validated in the route like A-02):
- `POST /app/workers/points/consume { matchId, consumer, count? (1..100, default 10) }` → `{ ok, result }`
- `POST /app/workers/points/sweep { matchId, consumer, minIdleMs? (default 60000), maxDeliveries? (default 5) }` → `{ ok, result }`
- `POST /app/jobs { payload }` (payload any JSON ≤ 4 KB) → 201 `{ id }`
- `POST /app/jobs/claim { worker, timeoutMs? (0..5000, default 1000) }` → `{ job }` (`null` when none)
- `POST /app/jobs/:id/complete { token, result? }` → `{ ok: true }` or 409 `not_owner`
- `POST /app/jobs/:id/fail { token, error, maxAttempts? (default 3) }` → `{ outcome: "retry" | "failed" }` or 409 `not_owner`
- `POST /app/jobs/reclaim { visibilityMs? (default 5000) }` → `{ reclaimed }`
- `POST /app/jobs/schedule { payload, runAtMs }` → 201 `{ id }`; `POST /app/jobs/promote { nowMs? }` → `{ promoted }`
- `GET /app/jobs/stats` → `{ pending, processing, completed, failed, delayed }` read directly by the route with
  `LLEN`/`ZCARD` on the queue keys (not a slot; the baseline `Map` queue is reported under `inMemory: {...}` too)
- `POST /app/wallets/:userId/credit { amount (1..100000), key (string ≤ 64) }` → `{ credited, balance }`
- `POST /app/contests/:contestId/last-slot { userId }` → 200 `{ got: true }` or 409 `{ error: "contest_full" }`
- `POST /app/ops/expire-batch { keys (1..5000 strings), baseSeconds (1..86400), jitterSeconds (0..3600) }` → `{ expired }`
- `GET /app/usernames/:name` → `{ name, taken, checkedDb }`
- `POST /app/ops/samples { route, status, ms, at? }` → `{ ok }`; `GET /app/ops/wall?route=&from=&to=&bucket=` → the slot's result
- **Provided hook:** while `ops.record` is active, the app calls it in the background (never awaited in the
  request path, errors logged once per minute) for every counted request, with the real route key, status, elapsed
  ms and time. That is how the ops wall shows real traffic. Document the sampling (every request) and the cost.

**Measure and record** (facts the levels will quote): what `XAUTOCLAIM` returns in this node-redis (shape, the
`deletedMessages` field), what `XPENDING` extended returns (delivery counts), what `BLMOVE` on the fail-fast learner
client does when the queue is empty for longer than 2 s (the wrapper exempts blocking commands; confirm), whether
`BF.*`, `TS.*`, `TDIGEST.*`, `TOPK.*` have typed node-redis methods in this version or need `sendCommand`
(`redis.bf.reserve`, `redis.ts.add` ...; test them), what `TS.CREATE` answers when the key exists, and the handle of
seeded user `u-000010` (for the Bloom level).

**Check.** `scripts/check/A-03.sh` (bash 3.2, project `quest-a03`, `.env.a03`, scratch levels and progress as in
A-02, refuses to overwrite `workspace/ch4/*.js`, `down -v` on exit):
- every baseline route answers as specified (stream consume returns `processed: []`; the Map queue round trip
  enqueue → claim → complete; credit twice with the same key credits twice in Postgres and the handoff says so is
  the bug; last-slot with `contest:9001:slots = 1` and 50 parallel requests lets **more than one** through at least
  once in three tries or the handoff says it did not reproduce; expire-batch sets equal TTLs; username check always
  `checkedDb: true`; ops routes answer);
- learner path with reference fixtures in `app/test/fixtures/` (`points-consume.js`, `points-sweep.js`, the six
  `jobs-*.js`, `wallet-credit.js`, `contest-last-slot.js`, `sessions-jitter.js`, `username-taken.js`, `ops-record.js`,
  `ops-range.js`), activated through `PUT /api/slots`: six balls XADDed, consume as w1 then w2 → every id processed
  once, `XPENDING` 0; a w2 read without ack then sweep by w1 with `minIdleMs 0` → reclaimed; a poison entry claimed
  five times → dead-lettered; enqueue 20, claim from two workers in parallel → 20 distinct ids, complete all, lists
  as expected, a stale token → 409; a job left in processing with an old `claimed_at_ms` → reclaim moves it back;
  schedule in the past → promote moves it; credit twice with one key → one credit; last-slot with 1 slot and 50
  parallel → exactly one 200; expire-batch on 200 keys with jitter 60 → TTL spread ≥ 30 s; username seeded in the
  filter and in Postgres → taken, unknown → `checkedDb: false`; ops record + range returns a bucket; with `ops.record`
  active and 30 requests to `/app/players/p-028`, `TS.RANGE ts:requests:GET_app_players_:id - +` (or your route key
  rule) has samples;
- app vitest, lint, format:check, engine `verify-slots` test;
- exit 0, print each thing verified.

**Handoff.** `docs/handoffs/A-03.md`: the slot table as built (deviations in bold), routes, key rule, the
measured facts above, check output.

**Model.** sonnet
