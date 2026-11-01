# C2b handoff: Chapter 2, levels 2.5 to 2.11

## What I did
Nine new level files (2.5 to 2.10 are files 05 to 10; the three interview rebuilds 11a, 11b, 11c are files 11, 12, 13), their
solutions, fixtures, three scenarios, `chapter.yaml` (nine ids appended in order) and `scripts/check/C2b.sh`. Levels 01 to 04 are untouched.
`levels:validate levels/ch2-everyone-showed-up` reports 13 levels, clean. No Docker was used; nothing was committed or staged.

## One line per level
| file | mode | verify | solutions |
|---|---|---|---|
| 05 the-player-who-does-not-exist | code | behavior (`cache.getPlayerStats`, p-999 null twice, sentinel exists, TTL >= 1), traffic `bad-id-hammer` (`db_queries_lte 3`, `error_rate_lte 0`, no baseline), antipattern `TTL cache:player:p-999 lte 10` | reference = level 4 single-flight + sentinel (TTL 5); wrong `05-wrong-no-sentinel.js` (level 4 reference); works_but_wrong `05-works-but-wrong-long-ttl.js` (TTL 30) |
| 06 hit-ratio-is-the-number | cli | redis (`INFO stats` hits and misses), 2 quizzes (900/100 ratio; shorter TTL), trivial behavior on `cache.getPlayerStats` (slot activation), traffic `stats-hot-100` `hit_ratio_gte 0.9` | `06-reference.redis` (`INFO stats`); wrong `06-wrong-info-server.redis` (wrong through its quiz pick only) |
| 07 fixtures-must-never-miss | code | behaviors on `prefetch.bulkLoad`, `.applyChange`, `.getFixtures`; antipattern (behavior shape) cold `getFixtures` must be `null`; traffic `fixtures-read` (`db_calls_ratio_lte 0.01`, `error_rate_lte 0`, baseline) | reference `07-reference.js` (all three functions); wrong `07-wrong-no-apply.js`; works_but_wrong `07-wrong-fallback-to-postgres.js` |
| 08 otp-login-properly | code | behaviors on `session.create/get/destroy/destroyAll`; antipattern on `session.create` (min session TTL in 1700..1800 and `SCARD user:u-000010:sessions` = 1) | reference `08-reference.js` (four functions); wrong `08-wrong-in-memory.js`; works_but_wrong `08-wrong-no-ttl.js` and `08-works-but-wrong-no-user-set.js` |
| 09 the-box-is-full | ops | redis (`CONFIG GET maxmemory` = 67108864, policy contains allkeys-lru), 2 quizzes (sessions in the same Redis; what noeviction does) | `09-reference.redis` (two CONFIG SETs + INFO stats); wrong `09-wrong-noeviction.redis` |
| 10 redis-is-down-the-app-is-not | code | event `redis_disconnect` (5 s, already happened), event `redis_reconnect` (300000 ms), behavior with a poisoned cache (WRONGTYPE), traffic `stats-redis-down` (`error_rate_lte 0`, no baseline) | reference `10-reference.js` (level 5 cache wrapped, Postgres fallback); wrong `10-wrong-no-catch.js` (level 2 reference) |
| 11 interview-cache-aside (11a) | code | copy of 02's verifiers (behavior, traffic `stats-hot-100` with baseline, antipattern TTL), own fixtures `11-cold-cache.yaml`; `interview: 20 min, rebuild_of ch2-02-cache-aside-v1, hint 10 XP`; no teach | reuses `02-reference.js`, `02-wrong-no-cache.js`, `02-works-but-wrong-no-ttl.js` by path |
| 12 interview-prefetch (11b) | code | copy of 07's verify list with `12-*` fixtures; `interview: 30 min, rebuild_of ch2-07-...` | reuses 07's three files by path |
| 13 interview-session-store (11c) | code | copy of 08's verify list with `13-*` fixtures; `interview: 30 min, rebuild_of ch2-08-...` | reuses 08's four files by path |

## Scenarios
`scenarios/bad-id-hammer.yaml` (100 connections, 8 s, only `/app/players/p-999/stats`, no warmup), `scenarios/fixtures-read.yaml` (50 connections, 6 s,
only `/app/fixtures`, 2 s warmup with 5 connections), `scenarios/stats-redis-down.yaml` (30 connections, 6 s, Zipf over p-028, p-101, p-151).
All three parse with the engine's own `loadScenario`.

## Gaps and deviations (every one of them)
1. **Numbering.** The validator wants `NN-slug` with a two-digit number, so 11a, 11b, 11c are files 11, 12, 13 (ids `ch2-11-interview-cache-aside`,
   `ch2-12-interview-prefetch`, `ch2-13-interview-session-store`). The chapter has 13 levels; the spec's "11 levels" counted 2.1 to 2.11.
   **`scripts/check/C2a.sh` hardcodes 4 levels and 4 files, so it now fails; it is not mine to edit, the orchestrator must relax it.**
2. **Level 05, the 2.2 rule.** The spec asks the behavior step for `TTL between [1,10]` and the antipattern for `lte 10`. A works-but-wrong
   long-TTL sentinel could then never occur (the behavior step would reject it). The behavior step checks `EXISTS = 1` and `TTL >= 1` only; the
   upper bound lives in the antipattern. `db_queries_lte: 3` is only reachable with level 4's single-flight lock still in the learner's file
   (100 connections arrive cold); the task says to extend the level 4 version, and the reference does. Expect 2 queries, up to 3 if timing is
   unlucky (the 5 s sentinel expires once or twice inside the 8 s run): margin one, **not run live**. Re-verifying level 2.2 after 2.5 fails on its
   own `EXISTS cache:player:p-999 = 0` check, by design of 2.5.
3. **Level 06.** `cli` mode with behavior and traffic verifiers, as the spec binds. The spec says `EVAL_RO` is not allowed; it is on the allowlist
   (`packages/shared/src/levels/commands.ts`) and level 08 uses it. The wrong `.redis` is wrong only through the grader's wrong quiz pick (the redis
   checks read global state). The traffic and behavior verifiers need the learner's cache already in `workspace/ch2/cache.js`; a `.redis` solution
   cannot place one, so the grader needs it in place (the task says so).
4. **Levels 07 and 08 have several slots, the schema allows one `reference` path.** The reference and wrong solutions are bundle modules: one file
   with named exports (`bulkLoad`, `applyChange`, `getFixtures`; `create`, `get`, `destroy`, `destroyAll`) plus a default export, and a header comment
   saying that in the workspace each function is its own file with a default export. `scripts/grade/grade.mjs` skips several-slot levels ("several slots"),
   so 07, 08, 12 and 13 get no automatic live grade; `scripts/check/C2b.sh` proves their verdicts locally instead (below). `engine/src/verify/slots.ts`
   already lists the new slots.
5. **Level 07 details.** `getFixtures` must return an array for the route, so "returns null on a miss" means the route answers 500 `slot_error` (said in
   the task as the intended alarm). The behavior step pins the return shape (hashes as stored, string values, scheduled and live only, ordered by `starts_at`
   then `id`) because `expect` is the only way to assert a non-trivial return; the task states the shape. The antipattern's clean fixture leaves the cache
   empty when traffic starts, so the graded run depends on the app's `bulkLoad` on slot activation plus the 2 s warmup (A-01: it runs only when the slot
   turns active; if the slots were already active the cache stays empty and traffic fails). Sample hashes `cache:match:m-901..903` (TTL 100 or 600 s) can
   linger only if an earlier verifier fails. The reference keeps the two team-name fields on update (the payload has ids, not names), which A-01's fixture
   did not; the verifier does not assert it.
6. **Level 08, sids are dynamic.** A behavior call has static arguments, so the spec's single chain (create, get, TTL, destroyAll) cannot be expressed.
   I split it into four behaviors whose fixtures seed known sids (`quest-sid-1..3`), and read dynamic keys with `EVAL_RO` Lua (`KEYS 'session:*'`, minimum TTL,
   `HGET user_id`). `get` must return exactly `{ userId, createdAt }` (stated in the task). The 2.2 rule applies: the create behavior checks only that a hash with the
   user's id exists; "TTL set at create" and "per-user set" are the antipattern, so `08-wrong-no-ttl.js` (it slides the TTL in `get`, forgets it in `create`) is
   works_but_wrong. I added a fourth solution, `08-works-but-wrong-no-user-set.js`, so the `SCARD` detector is proven. Spec file names kept: `08-wrong-no-ttl.js`
   and `07-wrong-fallback-to-postgres.js` contain "wrong" but are declared works_but_wrong, as the spec says. The session files live in `workspace/ch3/` (A-01).
   The fixtures delete every `session:*` key in the learner's Redis.
7. **Level 09, filler (not in the spec).** With a nearly empty Redis, `evicted_keys` cannot move at 64 MB, so `setup` runs one `EVAL` writing 90,000 cold keys
   `filler:ch2-09:<i>` (about 95 MB on Redis 8.2.1 locally; after `CONFIG SET maxmemory 64mb` plus `allkeys-lru`, `evicted_keys` moved from 0 to 160 at once). It grows
   the learner's AOF/RDB, and re-entering the level while Redis sits at 64 MB with `noeviction` would make that setup fail. The task tells the learner to restore
   512 MB (the compose value) and the policy they noted, and warns that `game:*` has no protection under `allkeys-lru`. Remove the setup step if you would rather not.
8. **Level 10 cannot be graded during a real outage.** Behavior fixtures are sent through the engine's own Redis connection, so no behavior verifier can run while Redis
   is stopped, and traffic runs after every other verifier (after the 5 minute reconnect wait), so it runs with Redis back. Kept: both events, and the
   traffic verifier, as the spec says. The part the engine can repeat is a stand-in for an unhealthy Redis: the fixture leaves a plain string (`EX 30`) where the code
   expects a hash, so every hash command fails with WRONGTYPE; a function that lets Redis errors escape throws, one that degrades to Postgres does not
   (`expectCount null equals 0` pins "a real player is never answered with null"). The learner's flow is: stop Redis, press Verify (it waits), start Redis. Not verified:
   whether Verify itself works with Redis stopped (the engine's progress mirror is best effort per the spec; I could not run the engine). `grade.sh` cannot see the events,
   so 10 is a manual level, as the spec expects.
9. **Not run live (no Docker):** every `traffic` threshold (05, 06, 07, 10), the quizzes, the events, the interview timer, and the real stream/outbox path for 07.

## Read for tone or accuracy
- The 05 teach says the sentinel is a hash with one `_missing` field and must be tested before "has fields"; the docs line behind it is only "cache not-found sentinels with a
  shorter TTL" (digest, cache-aside). The field name and the 5 s are my choices.
- 06 teach: the ratio, `evicted_keys` and "EXISTS on an absent key counts as a miss" are from the digest's eviction page. I did not claim how the polling lookups of the
  lock losers are counted ("not verified").
- 09: policies and `maxmemory-samples` 5 are from the digest; the "512 MB" is the repo's compose file, not a Redis default; I did not state Redis's default policy.
- 10: the two error shapes and the 2 s limit are from A-01 (`The client is offline`, `RedisCommandTimeoutError`); the text says the 2 s is this stack's setting.
- 07 story: the trigger, outbox, `legacydb:changes` and worker description follow A-01. 08 story: two app copies and Bunty's logout come from the cast file's warden bio.
- Interview levels 11 to 13 overwrite the learner's guided files; the 11 story tells them to copy the file aside.

## Check
`scripts/check/C2b.sh`, exit 0. It runs the static checks, then (when `redis-server` is on the PATH, no Docker) starts a throwaway `redis-server` on a free port and runs the engine's
own behavior, antipattern and redis evaluators over every reference and wrong solution with a fake Postgres, comparing each verdict with the declared one.

```

== build @quest/shared
PASS  build

== validate levels/ch2-everyone-showed-up
PASS  levels:validate: OK (1 chapter(s), 13 level(s))
PASS  13 levels (2.1 to 2.11 with 11a, 11b, 11c as three files)

== chapter.yaml
PASS  chapter id ch2
PASS  chapter lists exactly 13 levels
PASS  levels listed in order, 01 to 04 first

== levels
level ch2-01-feel-it
PASS    listed in chapter.yaml
PASS    docs link present
PASS    teach is 17 lines
PASS    scenario stats-hot-100 exists
level ch2-02-cache-aside-v1
PASS    listed in chapter.yaml
PASS    solutions/02-reference.js exists, non-empty
PASS    solutions/02-reference.js is valid JavaScript
PASS    solutions/02-wrong-no-cache.js exists, non-empty
PASS    solutions/02-wrong-no-cache.js is valid JavaScript
PASS    solutions/02-works-but-wrong-no-ttl.js exists, non-empty
PASS    solutions/02-works-but-wrong-no-ttl.js is valid JavaScript
PASS    fixtures/02-cold-cache.yaml exists, non-empty
PASS    docs link present
PASS    teach is 21 lines
PASS    scenario stats-hot-100 exists
PASS    traffic scenario stats-hot-100 exists
level ch2-03-stale-is-a-bug
PASS    listed in chapter.yaml
PASS    solutions/03-reference.js exists, non-empty
PASS    solutions/03-reference.js is valid JavaScript
PASS    solutions/03-wrong-noop.js exists, non-empty
PASS    solutions/03-wrong-noop.js is valid JavaScript
PASS    solutions/03-wrong-write-through.js exists, non-empty
PASS    solutions/03-wrong-write-through.js is valid JavaScript
PASS    fixtures/03-stale-chengappa.yaml exists, non-empty
PASS    docs link present
PASS    teach is 15 lines
level ch2-04-stampede-at-the-toss
PASS    listed in chapter.yaml
PASS    solutions/04-reference.js exists, non-empty
PASS    solutions/04-reference.js is valid JavaScript
PASS    solutions/04-wrong-plain-cache-aside.js exists, non-empty
PASS    solutions/04-wrong-plain-cache-aside.js is valid JavaScript
PASS    solutions/04-works-but-wrong-lock-no-expiry.js exists, non-empty
PASS    solutions/04-works-but-wrong-lock-no-expiry.js is valid JavaScript
PASS    fixtures/04-cold-and-unlocked.yaml exists, non-empty
PASS    docs link present
PASS    teach is 19 lines
PASS    scenario stampede-one-key exists
PASS    traffic scenario stampede-one-key exists
level ch2-05-the-player-who-does-not-exist
PASS    listed in chapter.yaml
PASS    solutions/05-reference.js exists, non-empty
PASS    solutions/05-reference.js is valid JavaScript
PASS    solutions/05-wrong-no-sentinel.js exists, non-empty
PASS    solutions/05-wrong-no-sentinel.js is valid JavaScript
PASS    solutions/05-works-but-wrong-long-ttl.js exists, non-empty
PASS    solutions/05-works-but-wrong-long-ttl.js is valid JavaScript
PASS    fixtures/05-cold-sentinel.yaml exists, non-empty
PASS    docs link present
PASS    teach is 22 lines
PASS    scenario bad-id-hammer exists
PASS    traffic scenario bad-id-hammer exists
level ch2-06-hit-ratio-is-the-number
PASS    listed in chapter.yaml
PASS    solutions/06-reference.redis exists, non-empty
PASS    solutions/06-wrong-info-server.redis exists, non-empty
PASS    fixtures/06-cold-p151.yaml exists, non-empty
PASS    docs link present
PASS    teach is 21 lines
PASS    scenario stats-hot-100 exists
PASS    traffic scenario stats-hot-100 exists
level ch2-07-fixtures-must-never-miss
PASS    listed in chapter.yaml
PASS    solutions/07-reference.js exists, non-empty
PASS    solutions/07-reference.js is valid JavaScript
PASS    solutions/07-wrong-no-apply.js exists, non-empty
PASS    solutions/07-wrong-no-apply.js is valid JavaScript
PASS    solutions/07-wrong-fallback-to-postgres.js exists, non-empty
PASS    solutions/07-wrong-fallback-to-postgres.js is valid JavaScript
PASS    fixtures/07-clean-matches.yaml exists, non-empty
PASS    fixtures/07-seed-for-apply.yaml exists, non-empty
PASS    fixtures/07-seed-for-read.yaml exists, non-empty
PASS    docs link present
PASS    teach is 20 lines
PASS    scenario fixtures-read exists
PASS    traffic scenario fixtures-read exists
level ch2-08-otp-login-properly
PASS    listed in chapter.yaml
PASS    solutions/08-reference.js exists, non-empty
PASS    solutions/08-reference.js is valid JavaScript
PASS    solutions/08-wrong-in-memory.js exists, non-empty
PASS    solutions/08-wrong-in-memory.js is valid JavaScript
PASS    solutions/08-wrong-no-ttl.js exists, non-empty
PASS    solutions/08-wrong-no-ttl.js is valid JavaScript
PASS    solutions/08-works-but-wrong-no-user-set.js exists, non-empty
PASS    solutions/08-works-but-wrong-no-user-set.js is valid JavaScript
PASS    fixtures/08-clean-sessions.yaml exists, non-empty
PASS    fixtures/08-seed-destroy-all.yaml exists, non-empty
PASS    fixtures/08-seed-destroy.yaml exists, non-empty
PASS    fixtures/08-seed-get.yaml exists, non-empty
PASS    docs link present
PASS    teach is 19 lines
level ch2-09-the-box-is-full
PASS    listed in chapter.yaml
PASS    solutions/09-reference.redis exists, non-empty
PASS    solutions/09-wrong-noeviction.redis exists, non-empty
PASS    docs link present
PASS    teach is 21 lines
PASS    scenario stats-hot-100 exists
level ch2-10-redis-is-down-the-app-is-not
PASS    listed in chapter.yaml
PASS    solutions/10-reference.js exists, non-empty
PASS    solutions/10-reference.js is valid JavaScript
PASS    solutions/10-wrong-no-catch.js exists, non-empty
PASS    solutions/10-wrong-no-catch.js is valid JavaScript
PASS    fixtures/10-poison-cache.yaml exists, non-empty
PASS    docs link present
PASS    teach is 22 lines
PASS    traffic scenario stats-redis-down exists
level ch2-11-interview-cache-aside
PASS    listed in chapter.yaml
PASS    solutions/02-reference.js exists, non-empty
PASS    solutions/02-reference.js is valid JavaScript
PASS    solutions/02-wrong-no-cache.js exists, non-empty
PASS    solutions/02-wrong-no-cache.js is valid JavaScript
PASS    solutions/02-works-but-wrong-no-ttl.js exists, non-empty
PASS    solutions/02-works-but-wrong-no-ttl.js is valid JavaScript
PASS    fixtures/11-cold-cache.yaml exists, non-empty
PASS    docs link present
PASS    interview level, no teach
PASS    traffic scenario stats-hot-100 exists
level ch2-12-interview-prefetch
PASS    listed in chapter.yaml
PASS    solutions/07-reference.js exists, non-empty
PASS    solutions/07-reference.js is valid JavaScript
PASS    solutions/07-wrong-no-apply.js exists, non-empty
PASS    solutions/07-wrong-no-apply.js is valid JavaScript
PASS    solutions/07-wrong-fallback-to-postgres.js exists, non-empty
PASS    solutions/07-wrong-fallback-to-postgres.js is valid JavaScript
PASS    fixtures/12-clean-matches.yaml exists, non-empty
PASS    fixtures/12-seed-for-apply.yaml exists, non-empty
PASS    fixtures/12-seed-for-read.yaml exists, non-empty
PASS    docs link present
PASS    interview level, no teach
PASS    traffic scenario fixtures-read exists
level ch2-13-interview-session-store
PASS    listed in chapter.yaml
PASS    solutions/08-reference.js exists, non-empty
PASS    solutions/08-reference.js is valid JavaScript
PASS    solutions/08-wrong-in-memory.js exists, non-empty
PASS    solutions/08-wrong-in-memory.js is valid JavaScript
PASS    solutions/08-wrong-no-ttl.js exists, non-empty
PASS    solutions/08-wrong-no-ttl.js is valid JavaScript
PASS    solutions/08-works-but-wrong-no-user-set.js exists, non-empty
PASS    solutions/08-works-but-wrong-no-user-set.js is valid JavaScript
PASS    fixtures/13-clean-sessions.yaml exists, non-empty
PASS    fixtures/13-seed-destroy-all.yaml exists, non-empty
PASS    fixtures/13-seed-destroy.yaml exists, non-empty
PASS    fixtures/13-seed-get.yaml exists, non-empty
PASS    docs link present
PASS    interview level, no teach
PASS  13 level files

== level files 01 to 04 untouched
PASS  01 to 04 have no changes against the index/HEAD

== spec rules, solution modules, scenarios (one node pass over the real parsed levels)
PASS  05 behavior is on cache.getPlayerStats
PASS  05 behavior step has no upper TTL bound (2.2 rule)
PASS  05 behavior: p-999 returns null twice
PASS  05 traffic: bad-id-hammer, db_queries_lte 3, error_rate_lte 0
PASS  05 antipattern: TTL cache:player:p-999 lte 10
PASS  05 solutions: no-sentinel wrong, long-ttl works_but_wrong
PASS  06 is a cli level
PASS  06 redis check on INFO stats keyspace_hits
PASS  06 has a quiz
PASS  06 traffic: stats-hot-100, hit_ratio_gte 0.9, baseline false
PASS  06 has a behavior on cache.getPlayerStats (slot activation)
PASS  07 behaviors cover bulkLoad, applyChange, getFixtures
PASS  07 behavior steps never assert the cold-miss null (2.2 rule)
PASS  07 antipattern: getFixtures on a cold cache returns null
PASS  07 traffic: fixtures-read, db_calls_ratio_lte 0.01, error_rate_lte 0
PASS  07 bulkLoad leaves TTL between 3000 and 3600
PASS  07 applyChange: venue changes within the call, a delete removes the key
PASS  07 solutions as bound (fallback is works_but_wrong)
PASS  08 behaviors cover the four session slots
PASS  08 create behavior asserts neither TTL nor the user set (2.2 rule)
PASS  08 antipattern: SCARD of the user set equals 1 and the session TTL is bounded
PASS  08 get behavior: sliding TTL back to 1700..1800
PASS  08 solutions: in-memory wrong, no-ttl works_but_wrong
PASS  09 is an ops level
PASS  09 checks maxmemory 67108864
PASS  09 checks allkeys-lru
PASS  09 has a quiz
PASS  10 events: redis_disconnect and redis_reconnect (timeoutMs 300000)
PASS  10 traffic: stats-redis-down, error_rate_lte 0, baseline false
PASS  10 has a behavior on cache.getPlayerStats
PASS  11 interview rebuilds ch2-02-cache-aside-v1
PASS  11 has no teach
PASS  11 has the same verifier list as ch2-02-cache-aside-v1 (behavior,traffic,antipattern)
PASS  12 interview rebuilds ch2-07-fixtures-must-never-miss
PASS  12 has no teach
PASS  12 has the same verifier list as ch2-07-fixtures-must-never-miss (behavior,behavior,behavior,antipattern,traffic)
PASS  13 interview rebuilds ch2-08-otp-login-properly
PASS  13 has no teach
PASS  13 has the same verifier list as ch2-08-otp-login-properly (behavior,behavior,behavior,behavior,antipattern)
PASS  scenarios/bad-id-hammer.yaml parses: 100 connections, 8 s, 1 request(s)
PASS  scenarios/fixtures-read.yaml parses: 50 connections, 6 s, 1 request(s)
PASS  scenarios/stats-redis-down.yaml parses: 30 connections, 6 s, 1 request(s)
PASS  bad-id-hammer only asks /app/players/p-999/stats
PASS  fixtures-read only asks /app/fixtures
PASS  07-reference.js: default export is a function, exports bulkLoad, applyChange, getFixtures
PASS  07-wrong-no-apply.js: default export is a function, exports bulkLoad, applyChange, getFixtures
PASS  07-wrong-fallback-to-postgres.js: default export is a function, exports bulkLoad, applyChange, getFixtures
PASS  08-reference.js: default export is a function, exports create, get, destroy, destroyAll
PASS  08-wrong-no-ttl.js: default export is a function, exports create, get, destroy, destroyAll
PASS  08-wrong-in-memory.js: default export is a function, exports create, get, destroy, destroyAll
PASS  08-works-but-wrong-no-user-set.js: default export is a function, exports create, get, destroy, destroyAll
PASS  05-reference.js: default export is a function
PASS  05-wrong-no-sentinel.js: default export is a function
PASS  05-works-but-wrong-long-ttl.js: default export is a function
PASS  10-reference.js: default export is a function
PASS  10-wrong-no-catch.js: default export is a function
PASS  static node checks

== local proof: engine evaluators against every solution (throwaway redis-server, fake Postgres, no Docker)
PASS  throwaway redis-server on 127.0.0.1:49964
PASS  ch2-05-the-player-who-does-not-exist solutions/05-reference.js: declared right, evaluators say right
PASS  ch2-05-the-player-who-does-not-exist solutions/05-wrong-no-sentinel.js: declared wrong, evaluators say wrong
PASS  ch2-05-the-player-who-does-not-exist solutions/05-works-but-wrong-long-ttl.js: declared works_but_wrong, evaluators say works_but_wrong
PASS  ch2-06-hit-ratio-is-the-number solutions/06-reference.redis: declared right, evaluators say right
PASS  ch2-06-hit-ratio-is-the-number solutions/06-wrong-info-server.redis: wrong through its quiz answer only (redis checks pass, not run by this proof)
PASS  ch2-07-fixtures-must-never-miss solutions/07-reference.js: declared right, evaluators say right
PASS  ch2-07-fixtures-must-never-miss solutions/07-wrong-no-apply.js: declared wrong, evaluators say wrong
PASS  ch2-07-fixtures-must-never-miss solutions/07-wrong-fallback-to-postgres.js: declared works_but_wrong, evaluators say works_but_wrong
PASS  ch2-08-otp-login-properly solutions/08-reference.js: declared right, evaluators say right
PASS  ch2-08-otp-login-properly solutions/08-wrong-in-memory.js: declared wrong, evaluators say wrong
PASS  ch2-08-otp-login-properly solutions/08-wrong-no-ttl.js: declared works_but_wrong, evaluators say works_but_wrong
PASS  ch2-08-otp-login-properly solutions/08-works-but-wrong-no-user-set.js: declared works_but_wrong, evaluators say works_but_wrong
PASS  ch2-09-the-box-is-full solutions/09-reference.redis: declared right, evaluators say right
PASS  ch2-09-the-box-is-full solutions/09-wrong-noeviction.redis: declared wrong, evaluators say wrong
PASS  ch2-10-redis-is-down-the-app-is-not solutions/10-reference.js: declared right, evaluators say right
PASS  ch2-10-redis-is-down-the-app-is-not solutions/10-wrong-no-catch.js: declared wrong, evaluators say wrong
PASS  ch2-11-interview-cache-aside solutions/02-reference.js: declared right, evaluators say right
PASS  ch2-11-interview-cache-aside solutions/02-wrong-no-cache.js: declared wrong, evaluators say wrong
PASS  ch2-11-interview-cache-aside solutions/02-works-but-wrong-no-ttl.js: declared works_but_wrong, evaluators say works_but_wrong
PASS  ch2-12-interview-prefetch solutions/07-reference.js: declared right, evaluators say right
PASS  ch2-12-interview-prefetch solutions/07-wrong-no-apply.js: declared wrong, evaluators say wrong
PASS  ch2-12-interview-prefetch solutions/07-wrong-fallback-to-postgres.js: declared works_but_wrong, evaluators say works_but_wrong
PASS  ch2-13-interview-session-store solutions/08-reference.js: declared right, evaluators say right
PASS  ch2-13-interview-session-store solutions/08-wrong-in-memory.js: declared wrong, evaluators say wrong
PASS  ch2-13-interview-session-store solutions/08-wrong-no-ttl.js: declared works_but_wrong, evaluators say works_but_wrong
PASS  ch2-13-interview-session-store solutions/08-works-but-wrong-no-user-set.js: declared works_but_wrong, evaluators say works_but_wrong
PASS  every solution gets its declared verdict from the engine's evaluators

== owned files
git status --short (this task's paths):
   M levels/ch2-everyone-showed-up/chapter.yaml
  ?? levels/ch2-everyone-showed-up/05-the-player-who-does-not-exist.yaml
  ?? levels/ch2-everyone-showed-up/06-hit-ratio-is-the-number.yaml
  ?? levels/ch2-everyone-showed-up/07-fixtures-must-never-miss.yaml
  ?? levels/ch2-everyone-showed-up/08-otp-login-properly.yaml
  ?? levels/ch2-everyone-showed-up/09-the-box-is-full.yaml
  ?? levels/ch2-everyone-showed-up/10-redis-is-down-the-app-is-not.yaml
  ?? levels/ch2-everyone-showed-up/11-interview-cache-aside.yaml
  ?? levels/ch2-everyone-showed-up/12-interview-prefetch.yaml
  ?? levels/ch2-everyone-showed-up/13-interview-session-store.yaml
  ?? levels/ch2-everyone-showed-up/fixtures/05-cold-sentinel.yaml
  ?? levels/ch2-everyone-showed-up/fixtures/06-cold-p151.yaml
  ?? levels/ch2-everyone-showed-up/fixtures/07-clean-matches.yaml
  ?? levels/ch2-everyone-showed-up/fixtures/07-seed-for-apply.yaml
  ?? levels/ch2-everyone-showed-up/fixtures/07-seed-for-read.yaml
  ?? levels/ch2-everyone-showed-up/fixtures/08-clean-sessions.yaml
  ?? levels/ch2-everyone-showed-up/fixtures/08-seed-destroy-all.yaml
  ?? levels/ch2-everyone-showed-up/fixtures/08-seed-destroy.yaml
  ?? levels/ch2-everyone-showed-up/fixtures/08-seed-get.yaml
  ?? levels/ch2-everyone-showed-up/fixtures/10-poison-cache.yaml
  ?? levels/ch2-everyone-showed-up/fixtures/11-cold-cache.yaml
  ?? levels/ch2-everyone-showed-up/fixtures/12-clean-matches.yaml
  ?? levels/ch2-everyone-showed-up/fixtures/12-seed-for-apply.yaml
  ?? levels/ch2-everyone-showed-up/fixtures/12-seed-for-read.yaml
  ?? levels/ch2-everyone-showed-up/fixtures/13-clean-sessions.yaml
  ?? levels/ch2-everyone-showed-up/fixtures/13-seed-destroy-all.yaml
  ?? levels/ch2-everyone-showed-up/fixtures/13-seed-destroy.yaml
  ?? levels/ch2-everyone-showed-up/fixtures/13-seed-get.yaml
  ?? levels/ch2-everyone-showed-up/solutions/05-reference.js
  ?? levels/ch2-everyone-showed-up/solutions/05-works-but-wrong-long-ttl.js
  ?? levels/ch2-everyone-showed-up/solutions/05-wrong-no-sentinel.js
  ?? levels/ch2-everyone-showed-up/solutions/06-reference.redis
  ?? levels/ch2-everyone-showed-up/solutions/06-wrong-info-server.redis
  ?? levels/ch2-everyone-showed-up/solutions/07-reference.js
  ?? levels/ch2-everyone-showed-up/solutions/07-wrong-fallback-to-postgres.js
  ?? levels/ch2-everyone-showed-up/solutions/07-wrong-no-apply.js
  ?? levels/ch2-everyone-showed-up/solutions/08-reference.js
  ?? levels/ch2-everyone-showed-up/solutions/08-works-but-wrong-no-user-set.js
  ?? levels/ch2-everyone-showed-up/solutions/08-wrong-in-memory.js
  ?? levels/ch2-everyone-showed-up/solutions/08-wrong-no-ttl.js
  ?? levels/ch2-everyone-showed-up/solutions/09-reference.redis
  ?? levels/ch2-everyone-showed-up/solutions/09-wrong-noeviction.redis
  ?? levels/ch2-everyone-showed-up/solutions/10-reference.js
  ?? levels/ch2-everyone-showed-up/solutions/10-wrong-no-catch.js
  ?? scenarios/bad-id-hammer.yaml
  ?? scenarios/fixtures-read.yaml
  ?? scenarios/stats-redis-down.yaml
  ?? scripts/check/C2b.sh

C2b OK
```

## git status --short
```
 M levels/ch2-everyone-showed-up/chapter.yaml
?? docs/handoffs/C2b.md
?? levels/ch2-everyone-showed-up/05-the-player-who-does-not-exist.yaml
?? levels/ch2-everyone-showed-up/06-hit-ratio-is-the-number.yaml
?? levels/ch2-everyone-showed-up/07-fixtures-must-never-miss.yaml
?? levels/ch2-everyone-showed-up/08-otp-login-properly.yaml
?? levels/ch2-everyone-showed-up/09-the-box-is-full.yaml
?? levels/ch2-everyone-showed-up/10-redis-is-down-the-app-is-not.yaml
?? levels/ch2-everyone-showed-up/11-interview-cache-aside.yaml
?? levels/ch2-everyone-showed-up/12-interview-prefetch.yaml
?? levels/ch2-everyone-showed-up/13-interview-session-store.yaml
?? levels/ch2-everyone-showed-up/fixtures/05-cold-sentinel.yaml
?? levels/ch2-everyone-showed-up/fixtures/06-cold-p151.yaml
?? levels/ch2-everyone-showed-up/fixtures/07-clean-matches.yaml
?? levels/ch2-everyone-showed-up/fixtures/07-seed-for-apply.yaml
?? levels/ch2-everyone-showed-up/fixtures/07-seed-for-read.yaml
?? levels/ch2-everyone-showed-up/fixtures/08-clean-sessions.yaml
?? levels/ch2-everyone-showed-up/fixtures/08-seed-destroy-all.yaml
?? levels/ch2-everyone-showed-up/fixtures/08-seed-destroy.yaml
?? levels/ch2-everyone-showed-up/fixtures/08-seed-get.yaml
?? levels/ch2-everyone-showed-up/fixtures/10-poison-cache.yaml
?? levels/ch2-everyone-showed-up/fixtures/11-cold-cache.yaml
?? levels/ch2-everyone-showed-up/fixtures/12-clean-matches.yaml
?? levels/ch2-everyone-showed-up/fixtures/12-seed-for-apply.yaml
?? levels/ch2-everyone-showed-up/fixtures/12-seed-for-read.yaml
?? levels/ch2-everyone-showed-up/fixtures/13-clean-sessions.yaml
?? levels/ch2-everyone-showed-up/fixtures/13-seed-destroy-all.yaml
?? levels/ch2-everyone-showed-up/fixtures/13-seed-destroy.yaml
?? levels/ch2-everyone-showed-up/fixtures/13-seed-get.yaml
?? levels/ch2-everyone-showed-up/solutions/05-reference.js
?? levels/ch2-everyone-showed-up/solutions/05-works-but-wrong-long-ttl.js
?? levels/ch2-everyone-showed-up/solutions/05-wrong-no-sentinel.js
?? levels/ch2-everyone-showed-up/solutions/06-reference.redis
?? levels/ch2-everyone-showed-up/solutions/06-wrong-info-server.redis
?? levels/ch2-everyone-showed-up/solutions/07-reference.js
?? levels/ch2-everyone-showed-up/solutions/07-wrong-fallback-to-postgres.js
?? levels/ch2-everyone-showed-up/solutions/07-wrong-no-apply.js
?? levels/ch2-everyone-showed-up/solutions/08-reference.js
?? levels/ch2-everyone-showed-up/solutions/08-works-but-wrong-no-user-set.js
?? levels/ch2-everyone-showed-up/solutions/08-wrong-in-memory.js
?? levels/ch2-everyone-showed-up/solutions/08-wrong-no-ttl.js
?? levels/ch2-everyone-showed-up/solutions/09-reference.redis
?? levels/ch2-everyone-showed-up/solutions/09-wrong-noeviction.redis
?? levels/ch2-everyone-showed-up/solutions/10-reference.js
?? levels/ch2-everyone-showed-up/solutions/10-wrong-no-catch.js
?? scenarios/bad-id-hammer.yaml
?? scenarios/fixtures-read.yaml
?? scenarios/stats-redis-down.yaml
?? scripts/check/C2b.sh
```
(taken after this file was written; `docs/handoffs/C2b.md` itself shows as untracked)

## Follow-up 1
- **Level 09:** the task now ends with `CONFIG SET maxmemory 512mb` (keep `allkeys-lru`); verify checks `CONFIG GET maxmemory` equals `["maxmemory","536870912"]`, the policy contains `allkeys-lru`, and `INFO stats` matches `evicted_keys:[1-9]`. Both `.redis` solutions end with `CONFIG SET maxmemory 512mb`; the wrong one still sets `noeviction` (never evicts, so it fails the policy and eviction checks) and its `because` says so. The teach panel gained a sentence on why the limit goes back. The 09 gap note about the learner restoring the limit by hand no longer applies; the filler setup step is unchanged.
- **Level 06:** now `mode: code`. Task step 1 says the 2.2 cache should still be in `workspace/ch2/cache.js`, "if it is not, paste it back". Solutions are `solutions/06-reference.js` (copy of 02's reference) and `solutions/06-wrong-no-cache.js` (copy of 02's no-cache); the two `.redis` files are deleted. The `INFO stats` redis check, the two quizzes, the behavior and the traffic verifier are unchanged. This replaces gap 3's cli/`.redis` remarks.
- **C2b.sh:** expects 06 as a code level and 09's 512 MB / evicted_keys checks; the local proof runs 09's setup filler first, runs each `.redis`, checks, then resets the throwaway Redis. Re-run: exit 0, every solution got its declared verdict (06 reference right, 06 wrong-no-cache wrong, 09 reference right, 09 wrong-noeviction wrong).
