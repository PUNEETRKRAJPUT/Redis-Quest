# A-04: the faulty code Chapter 4b (on call) diagnoses and fixes

**Goal.** Chapter 4b hands the learner code that is already written and already wrong, under traffic, and asks
them to name the problem before touching it. This task plants those faults as app baselines: a `KEYS` in a cron,
page views written without a TTL, a Lua loop that freezes Redis, a client opened per request and never closed,
plus the two repair slots (split a big key, sweep TTLs onto old keys). The hot-key level reuses
`cache.getPlayerStats`, so it needs nothing here.

**Depends on.** nothing (E-02 is adding the engine pieces in parallel; it does not touch `app/`).

**Files owned.** `app/`, `engine/src/verify/slots.ts` (only), `scripts/check/A-04.sh`, `.env.a04` (gitignored:
`PROXY_PORT=3900 REDIS_PORT=6388 PG_PORT=5441 INSIGHT_PORT=5549`), `docs/handoffs/A-04.md`.

**Must not touch.** `engine/` beyond that one file, `ui/`, `packages/`, `runner/`, `levels/`, `scenarios/`,
`docker-compose.yml`, `docker/`, `scripts/grade/`, other checks, `docs/BUILD.md`. Compose project `quest-a04` only.

**Interfaces to honour.** `docs/handoffs/P0-07.md` ("Adding a slot"), `docs/handoffs/A-02.md` and `A-03.md`
(patterns, the fail-fast client: a learner command rejects after 2 s; the app's own shared client is separate),
`docs/redis-docs-digest.md` programmability section (`busy-reply-threshold` 5 s, `SCRIPT KILL` only before a write).

**Slots** (files under `workspace/ch4b/`; baselines are the planted faults and say so in a comment):

| name | file | signature | returns | baseline (the fault) |
|---|---|---|---|---|
| `oncall.countUsers` | `ch4b/count-users.js` | `(deps, prefix)` | the number of keys starting with `prefix` | `KEYS <prefix>*` and its length: the cron that stalls Redis on a big keyspace |
| `oncall.recordView` | `ch4b/record-view.js` | `(deps, userId, matchId)` | anything | `SET view:<userId>:<matchId> <ISO now>` with **no TTL**: memory grows every day |
| `oncall.addTtls` | `ch4b/add-ttls.js` | `(deps, pattern, seconds)` | the number of keys given a TTL | nothing, returns 0 (the repair the learner writes: SCAN + EXPIRE, pipelined) |
| `oncall.recomputeBadges` | `ch4b/recompute-badges.js` | `(deps)` | anything | one `EVAL` whose Lua loop spins, read-only, until `ONCALL_SPIN_MS` (env, default 20000) have passed by `redis.call('TIME')`, then returns `"done"`; a `SCRIPT KILL` surfaces as the EVAL's error (a 500 with the message). Read-only on purpose so `SCRIPT KILL` can stop it (digest) |
| `oncall.lookupTeam` | `ch4b/lookup-team.js` | `(deps, teamId)` | `{ id, name }` from the hash `team:<teamId>` (fields `id`, `name`), or `null` | creates a **new** `createClient()` to the current Redis URL on every call, connects, reads, and never closes it: connections climb. Safety cap: after 2,000 leaked clients close the oldest and log once a minute; say the cap in the handoff |
| `oncall.splitBigKey` | `ch4b/split-big-key.js` | `(deps, key, buckets)` | `{ fields, buckets }` (fields moved, buckets written) | nothing, `{ fields: 0, buckets: 0 }` (the repair: `HSCAN` the big hash, `HSET` each field into `<key>:<n>` with `n = crc or simple hash of the field mod buckets` (say which), pipelined in batches, then `UNLINK` the original) |

Reference learner files for the check in `app/test/fixtures/` (`count-users.js` with `SCAN MATCH COUNT 1000`,
`record-view.js` with `EX 86400`, `add-ttls.js`, `recompute-badges.js` that does its work in batches from
JavaScript with no `EVAL` (define the work as: for every `lb:match:*` zset, count members with score ≥ 50 into the
hash `badges:fifties` field `<matchId>`; the fixture seeds two zsets), `lookup-team.js` using `deps.redis`,
`split-big-key.js`).

**Routes** (all `/app/oncall/...`, counted in metrics, validated like A-02):
- `GET /app/oncall/users/count?prefix=<p>` (prefix 1..64 chars, must not start with `game:`) → `{ prefix, count }`
- `POST /app/oncall/views { userId, matchId }` → `{ ok }`
- `POST /app/oncall/ttl-sweep { pattern, seconds (1..604800) }` (pattern must not match `game:*`) → `{ expired }`
- `POST /app/oncall/badges/recompute` → `{ ok, result }` or the slot error (500, with the EVAL error text when killed; the
  app's slot timeout is 10 s, so the route may answer 500 `call exceeded 10000 ms` while the script is still running: document it)
- `GET /app/oncall/teams/:teamId` → `{ id, name }` or 404 `team_not_found`
- `POST /app/oncall/split { key, buckets (2..1024) }` (key must not start with `game:`) → `{ key, fields, buckets }`
- `GET /app/oncall/status` → `{ leakedClients, instance }` (the count of never-closed clients the faulty baseline is holding on this instance; 0 after a restart)

**Measure and record.** During the baseline `recomputeBadges`: what the app's other routes do (the baseline paths
never touch Redis, so they should keep answering; learner slots with the fail-fast client reject at 2 s; say what
the ticker and outbox workers log), what `redis-cli SCRIPT KILL` answers, and what the EVAL returns to the route
after a kill. For `lookupTeam`: how fast `INFO clients` `connected_clients` climbs under 100 parallel requests, and
that it drops after `docker compose -p quest-a04 restart app`. For `countUsers`: with 200,000 keys seeded by one
`EVAL` (`SET oncall:user:<i> x`), the time `KEYS oncall:user:*` takes and whether it appears in `SLOWLOG GET`
(default threshold 10 ms). The memory of a 300,000-field hash (`MEMORY USAGE`) and its `OBJECT ENCODING`.

**Check.** `scripts/check/A-04.sh` (bash 3.2, project `quest-a04`, scratch levels and progress as in A-03,
refuses to overwrite `workspace/ch4b/*.js`, `down -v` on exit):
- faults reproduce: 200k keys seeded, three `GET /app/oncall/users/count?prefix=oncall:user:` → count 200000 and
  `SLOWLOG GET 5` shows a `keys` entry; 50 `POST /app/oncall/views` → 50 `view:*` keys with TTL -1;
  `POST /app/oncall/badges/recompute` in the background → within 7 s a `redis-cli PING` answers BUSY, `redis-cli SCRIPT KILL`
  answers OK, the route returns 500 with the kill error (or the timeout; print which); 200 parallel
  `GET /app/oncall/teams/t-01` (team hashes seeded by the check) → `connected_clients` rose by at least 100 and
  `/app/oncall/status` reports the leak; `restart app` → back down;
- repairs work with the reference fixtures activated through `PUT /api/slots`: count via SCAN = 200000 and no new
  `keys` entry in `SLOWLOG` (reset it first with `SLOWLOG RESET`); views carry a TTL; ttl-sweep over `view:*` leaves 0
  keys without TTL; recompute without EVAL fills `badges:fifties` and `INFO commandstats` after `CONFIG RESETSTAT` has no
  `cmdstat_eval`; lookupTeam via the shared client does not raise `connected_clients`; split of a 300,000-field hash into
  64 buckets → original gone (`EXISTS` 0), the buckets' `HLEN`s sum to 300000, `cmdstat_unlink` present;
- app vitest, lint, format:check, engine `verify-slots` test; exit 0; print each thing verified.

**Handoff.** `docs/handoffs/A-04.md`: slot table as built (deviations in bold), routes, the measurements, and the
check output.

**Model.** sonnet
