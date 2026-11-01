# C2a: Chapter 2 opening, "Everyone showed up", levels 2.1 to 2.4

**Goal.** The four levels that prove the whole machine to the first testers: feel real pain from real
traffic against real Postgres, fix it with cache-aside, learn that stale is a bug, survive a stampede.
These are the first `traffic`-graded levels and the first three-verdict code levels.

**Depends on.** P0-07 (slots), P0-09 (verifier, scenario format, verify response), C1 (shape and tone).

**Files owned.** `levels/ch2-everyone-showed-up/**`, `scenarios/stats-hot-100.yaml`,
`scenarios/stampede-one-key.yaml`, `scripts/check/C2a.sh`.

**Must not touch.** anything else.

**Source of truth.** `docs/handoffs/P0-07.md` (slot names, signatures, the stats row shape, baseline
latencies, `x-quest-slot-error`), `docs/handoffs/P0-09.md` (scenario file format, baseline semantics,
traffic assertion names, feedback strings), `docs/handoffs/P0-04.md` (hot players p-028, p-101, p-151;
cold p-001), `docs/redis-docs-digest.md` (the cache-aside use-case page: hash per entity with TTL, delete
on write, Lua single-flight lock, negative caching; `SET NX PX`; `HGETALL`/`HSET`/`EXPIRE`; `TTL`),
`levels/README.md`, `levels/ch1-keyspace` for shape and tone.

**Chapter.** `chapter.yaml` id `ch2`, title "Everyone showed up", incident thread: it is 7:25 pm, toss
at 7:30, the stats page takes four seconds, the senior is in the mess hall with the big screen, the
roommate is reading Postgres logs aloud. List exactly these four levels; later levels are added by C2b.

**Levels.**
| # | title (yours may differ) | mode | binding |
|---|---|---|---|
| 01 | Feel it | decision | `scenario: stats-hot-100` so the live pain panel runs; brainstorm; a `quiz` with four options (add an index, cache in Redis, bigger Postgres, cache in the app's memory) whose correct answer is "cache in Redis" with an explanation that names why each other is wrong for tonight (the index is also right but is the DBA's lesson, say so); no solutions files, decision mode |
| 02 | Cache-aside v1 | code | slot `cache.getPlayerStats` `(deps, playerId)`; must return the same row shape the baseline returns (strings as they come from Postgres; a miss on a bad id returns `null`); key `cache:player:<id>` as a hash with `EXPIRE 30`; `fixtures` delete `cache:player:p-151` and `cache:player:p-028`; `behavior`: call with `p-151` twice, side effects `TYPE` hash and `HGET ... player_id` equals `p-151` (do NOT check TTL here, or a no-TTL cache can never be works-but-wrong); `traffic` on `stats-hot-100` with `baseline: true`, `p99_ratio_lte: 0.2`, `db_calls_ratio_lte: 0.1`; `antipattern` redis check `TTL cache:player:p-151` gte 1 with the "This passes today, but a cached row with no TTL is stale forever and memory only grows" message; solutions: reference (HGETALL hit, else `db.query('SELECT * FROM player_stats($1)')`, `HSET` + `EXPIRE 30`), wrong `02-wrong-no-cache.js` (just the query), works-but-wrong `02-works-but-wrong-no-ttl.js` |
| 03 | Stale is a bug | code | slot `cache.invalidatePlayerStats` `(deps, playerId)`; `fixtures` set `cache:player:p-028` to a hash with a stale `runs` field; `behavior`: call with `p-028`, side effect `EXISTS cache:player:p-028` equals 0; teach: the docs say delete on write, never update the cache directly; solutions: reference (`DEL`), wrong `03-wrong-noop.js` (does nothing), wrong `03-wrong-write-through.js` (re-reads Postgres and rewrites the cache: explain in `because` that it works for one writer and races with two, which the schema cannot show yet) |
| 04 | Stampede at the toss | code | slot `cache.getPlayerStats` again; `setup` deletes `cache:player:p-028`; `traffic` on `stampede-one-key` with `db_queries_lte: 3` and `error_rate_lte: 0`; `antipattern` redis check `EXISTS lock:cache:player:p-028` equals 0 after the run with a "lock left behind: no PX or no release" message; teach: the single-flight lock from the cache-aside docs page (`SET lock NX PX`, winner loads, others poll the cache until the lock TTL, release only if the token matches); solutions: reference (single-flight), wrong `04-wrong-plain-cache-aside.js` (the 2.2 reference: every concurrent miss hits Postgres), works-but-wrong `04-works-but-wrong-lock-no-expiry.js` (`SET NX` without `PX`, released by `DEL` only on success) |

**Scenarios** (format per `docs/handoffs/P0-09.md`): `stats-hot-100`: 100 users, Zipf skew, 60%
`GET /app/players/{hot}/stats` across the three hot ids, 40% across cold ids, 50 connections, 10 s.
`stampede-one-key`: 200 connections, 5 s, only `GET /app/players/p-028/stats`.

**Check.** `scripts/check/C2a.sh`: shared build; `levels:validate levels/ch2-everyone-showed-up` clean;
scenario files parse against the scenario schema P0-09 exposes (or at least as YAML with the required
keys); every solution and fixture exists; prints each level id. Running the solutions live is the
orchestrator's job with the verifier.

**Handoff complete when.** check passes; `docs/handoffs/C2a.md` written with one line per level, the
check output, gaps, and `git status --short`.

**Model.** sonnet
