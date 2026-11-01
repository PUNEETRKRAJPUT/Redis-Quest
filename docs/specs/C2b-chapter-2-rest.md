# C2b: Chapter 2, levels 2.5 to 2.11

> A-01 facts confirmed from `docs/handoffs/A-01.md` (binding): slot files are `ch2/prefetch-bulk.js`,
> `ch2/prefetch-apply.js`, `ch3/session-create.js`, `ch3/session-get.js`, `ch3/session-destroy.js`,
> `ch3/session-destroy-all.js`; `bulkLoad` rows are the 60 `matches` rows joined with team names
> (`id, season, home_team_id, away_team_id, home_team_name, away_team_name, venue, starts_at, status`);
> `applyChange` events are `{ aggregate, aggregateId, op, payload }` with a parsed payload and arrive for
> every aggregate (the learner filters `matches`); the fail-fast errors are `Error: The client is offline`
> (Redis stopped, about 10 ms) and `RedisCommandTimeoutError` (Redis hung, 2 s), so level 10 teaches a
> catch-all around the Redis calls. The `interview` field is confirmed from `docs/handoffs/F-12.md`:
> `interview: { minutes: 5..60, rebuild_of: <level id>, hint_xp_cost: <int, default 10> }` on a `code` level, and
> `teach` may be omitted only then; see `levels/_examples/example-interview/` for a complete example.

**Goal.** Finish Chapter 2: negative caching, the hit ratio as the number, the prefetch cache fed by
CDC, sessions done properly, eviction, the Redis-is-down drill, and the first three interview rebuilds.

**Depends on.** C2a (shape and tone), A-01, F-12.

**Files owned.** `levels/ch2-everyone-showed-up/` (new level files 05 to 11 and their solutions and
fixtures; `chapter.yaml` gains the new ids in order; levels 01 to 04 untouched), new scenarios
`scenarios/bad-id-hammer.yaml`, `scenarios/fixtures-read.yaml`, `scenarios/stats-redis-down.yaml`,
`scripts/check/C2b.sh`.

**Source of truth.** `docs/handoffs/A-01.md` (slots, stream format, error shape), `docs/handoffs/F-12.md`
(interview field), `docs/handoffs/P0-09.md` (scenario format, assertions, baseline rules),
`docs/handoffs/P0-07.md`, `docs/handoffs/P0-04.md` (ids; p-999 is not a player), the digest's
cache-aside, session-store, prefetch-cache and eviction sections, `levels/README.md`, and
`levels/ch2-everyone-showed-up/01..04` for shape and tone.

**Levels.**
| # | title | mode | binding |
|---|---|---|---|
| 05 | The player who does not exist | code | slot `cache.getPlayerStats` again; bots hammer `p-999` (`scenario: bad-id-hammer`: 100 connections, 8 s, only `/app/players/p-999/stats`); the learner caches a "not found" sentinel with a short TTL (teach: the docs' negative caching, shorter TTL than real rows); `behavior`: `p-999` returns `null` twice, side effect `TTL cache:player:p-999 between [1,10]` and the sentinel key exists; `traffic`: `db_queries_lte: 3`, `error_rate_lte: 0`; antipattern (healthy): `TTL cache:player:p-999 lte 10` message "a not-found cached as long as a real row hides a player who signs up tomorrow"; solutions: reference (sentinel with TTL 5), wrong `05-wrong-no-sentinel.js` (2.4's reference, every miss hits Postgres), works-but-wrong `05-works-but-wrong-long-ttl.js` (sentinel with the real rows' TTL 30) |
| 06 | Hit ratio is the number | cli | `scenario: stats-hot-100` runs so the counters move; the learner reads `INFO stats` and computes hits/(hits+misses); verify: `answer` with `expected.cmd: [INFO, stats]`... INFO is one blob, so instead: `redis` check `INFO stats` `matches: "keyspace_hits:[1-9]"` and an `answer` whose expected is `transform: 'number'` of a small read-only `EVAL_RO` is not allowed by the allowlist; so use a `quiz` ("if hits=900 and misses=100 the ratio is") plus the `redis` check, and a `traffic` on `stats-hot-100` with `hit_ratio_gte: 0.9` and `baseline: false` (the learner's 2.2 cache must be active: the level's `setup` cannot activate slots, so state in the task that the cache from 2.2 must still be in `workspace/ch2/cache.js`, and the verifier activates `cache.getPlayerStats` for traffic as it does for any level listing that slot in a `behavior`; include a trivial `behavior` on `cache.getPlayerStats` to get the slot activated); no solutions files beyond a `.redis` reference (`INFO stats`) and a wrong one (`INFO server`) |
| 07 | Fixtures must never miss | code | two slots: `prefetch.bulkLoad (deps, rows)` and `prefetch.applyChange (deps, event)` (exact shapes from the A-01 handoff); keys `cache:match:<id>` hashes with a long safety-net TTL (3600) refreshed on every upsert; `prefetch.getFixtures (deps)` reads only `HGETALL`, never Postgres, and returns `null` on a miss (a miss is an incident); `fixtures` delete `cache:match:*`; `behavior`: `bulkLoad` with three sample rows leaves three hashes with TTL in `[3000,3600]`; `applyChange` with an `update` event changes the `venue` field within the call; a `delete` event removes the key; `traffic`: `scenario: fixtures-read` (50 connections, 6 s, `/app/fixtures`) with `db_calls_ratio_lte: 0.01` and `error_rate_lte: 0`; antipattern: behavior-shaped, `getFixtures` on a cold key must NOT query Postgres (assert via `expect: null` for an unknown id and a `message` about falling back silently). Solutions: reference, wrong `07-wrong-fallback-to-postgres.js` (getFixtures reads Postgres on a miss: passes traffic, fails the antipattern → actually declare it `works_but_wrong`), wrong `07-wrong-no-apply.js` (applyChange does nothing) |
| 08 | OTP login, properly | code | slots `session.create (deps, user)` → returns `sid`, `session.get (deps, sid)` → the session or `null`, `session.destroy (deps, sid)`, `session.destroyAll (deps, userId)`; keys `session:<sid>` hash (`user_id`, `created_at`, `last_seen_at`) with `EXPIRE 1800` set in the same MULTI, sliding TTL refreshed on `get`, `user:<id>:sessions` set for logout-all; `fixtures` clear `session:*` and `user:u-000010:sessions`; `behavior`: create → get returns the user → TTL in `[1700,1800]` → after a get the TTL is refreshed (second TTL ≥ first) → destroyAll leaves no `session:*` for that user and an empty set; antipattern (healthy): `TTL session:<sid-from-fixture>`... the sid is dynamic, so use the behavior-shaped antipattern: a `create` followed by a `redis` side effect `SCARD user:u-000010:sessions` equals 1 (a session store that forgets the per-user set cannot log out everywhere); solutions: reference, wrong `08-wrong-no-ttl.js` as works-but-wrong only if expressible (TTL check must then live in the antipattern, not the behavior; follow the 2.2 rule), wrong `08-wrong-in-memory.js` (a Map: passes on one instance, and the task text explains why two instances break it; grade it `wrong` by asserting `EXISTS session:*` via `SCARD` of the user set equals 1) |
| 09 | The box is full | ops+decision | task: `CONFIG SET maxmemory 64mb` and `CONFIG SET maxmemory-policy allkeys-lru` on the game's Redis through the terminal, then watch `INFO stats` `evicted_keys` move while `scenario: stats-hot-100` runs; verify: `redis` checks `CONFIG GET maxmemory` equals `["maxmemory","67108864"]` and `CONFIG GET maxmemory-policy` contains `allkeys-lru`; `quiz` on the trap (sessions and cache in one instance: `volatile-*` or two instances; `noeviction` means writes fail, reads work); decision mode requires a `quiz`, so make the mode `ops` with both; reference `.redis` (the two CONFIG SETs), wrong `.redis` (`maxmemory-policy noeviction`, because the cache then errors on every write at the limit) |
| 10 | Redis is down, the app is not | ops+code | slot `cache.getPlayerStats` once more; teach the fail-fast error shape from the A-01 handoff and the docs' graceful degradation; the learner wraps the Redis calls in a try/catch with the 2 s timeout already enforced by the client and serves from Postgres on any Redis error, and must not throw; the task tells them to run `docker compose stop redis` in their own terminal, verify, then `docker compose start redis`; verify: `event redis_disconnect` (already happened since level start), `traffic` on `scenario: stats-redis-down` (30 connections, 6 s, hot ids; `error_rate_lte: 0`, `baseline: false`) which must pass with Redis down, then `event redis_reconnect` with `timeoutMs: 300000` (the learner starts Redis back; the verifier waits); note for the orchestrator: the engine's own mirror writes are best-effort, so verification with Redis down must work; if the engine refuses, record it in the handoff as a blocker instead of weakening the level; solutions: reference, wrong `10-wrong-no-catch.js` (2.2's reference: 500s while Redis is down) |
| 11a | Interview: cache-aside from a blank file | code | `interview: { minutes: 20, rebuild_of: ch2-02-..., hint_xp_cost: 10 }`; no teach; task is the interview wording ("Design and implement a read-through cache for player stats..."); same verifiers as 02 (behavior + traffic + antipattern) copied, fixtures reset keys; solutions reuse 02's by path |
| 11b | Interview: prefetch from a blank file | code | rebuild of 07 with 07's verifiers |
| 11c | Interview: session store from a blank file | code | rebuild of 08 with 08's verifiers |
Each: story (short; the roommate, the senior, the warden's nephew), brainstorm with `not-redis`, teach
(not for 11a-c), task, hints, show_me with keys (`cache_stats`, `hash_card`, `set_chips`, `ttl_timer`,
`stats_latency_panel` as fits), docs links from the digest, reward XP 25 to 60, every wrong solution
with a `because`.

**Check.** `scripts/check/C2b.sh`: shared build; `levels:validate levels/ch2-everyone-showed-up` clean
with 11 levels; the three scenario files parse; every solution and fixture exists; prints each level id.
Live grading is the orchestrator's job with `scripts/grade/grade.sh` (levels 10's ops part is manual).

**Handoff.** `docs/handoffs/C2b.md` with one line per level, gaps, and the check output.

**Model.** sonnet
