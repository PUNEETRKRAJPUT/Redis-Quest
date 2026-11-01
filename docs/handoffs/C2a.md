# C2a handoff: Chapter 2 opening, "Everyone showed up" (levels 2.1 to 2.4)

## Levels (verify, solutions)
- **ch2-01-feel-it** (decision, `scenario: stats-hot-100`): one `quiz` with four options; reference `cache-redis`; wrong `add-index`, `bigger-pg`, `app-memory`, each with a `because`. No solution files.
- **ch2-02-cache-aside-v1** (code, slot `cache.getPlayerStats`, file `workspace/ch2/cache.js`): behavior (p-151 twice: TYPE hash, HGET player_id; p-999 returns `null`, no key left; NO TTL check), traffic `stats-hot-100` baseline `p99_ratio_lte 0.2` + `db_calls_ratio_lte 0.1`, antipattern `TTL cache:player:p-151 gte 1`. Solutions: `02-reference.js`, wrong `02-wrong-no-cache.js`, works-but-wrong `02-works-but-wrong-no-ttl.js`. Miss returns the row as Postgres gave it, hit returns the hash strings, null columns stored as "".
- **ch2-03-stale-is-a-bug** (code, slot `cache.invalidatePlayerStats`, `workspace/ch2/invalidate.js`): behavior on p-028 after a fixture plants a stale hash (`runs 1`), side effect `EXISTS cache:player:p-028` equals 0. Solutions: `03-reference.js` (DEL), wrong `03-wrong-noop.js`, wrong `03-wrong-write-through.js` (because explains the two-writer race the schema cannot show yet).
- **ch2-04-stampede-at-the-toss** (code, slot `cache.getPlayerStats` again): behavior (p-101 cached as hash; p-999 returns `null`), traffic `stampede-one-key` `db_queries_lte 3`, `error_rate_lte 0`, `baseline: false`, antipattern on lock keys (see gaps). Solutions: `04-reference.js` (SET NX PX, token, Lua release in `finally`, poll, re-check after winning), wrong `04-wrong-plain-cache-aside.js`, works-but-wrong `04-works-but-wrong-lock-no-expiry.js`.

## Scenario files
- `scenarios/stats-hot-100.yaml`: 50 connections, 10 s, 100 users Zipf 1.1. Two requests: weight 6 on `{hot}` (p-028, p-101, p-151, Zipf) and weight 4 on `{cold}` (twelve colder ids, Zipf), so 60/40. Added a 2 s / 5 connection warmup (same reasoning as `toss-time-100`: grade the steady state; the spec did not list it).
- `scenarios/stampede-one-key.yaml`: 200 connections, 5 s, only `GET /app/players/p-028/stats`, no warmup so the empty key meets the whole crowd. 200 is exactly the default `LOAD_MAX_CONNECTIONS`; `LOW_POWER=1` halves it and weakens the stampede.

## Gaps and deviations (read these)
1. **Level 4 antipattern checks p-101 and p-999, not p-028.** P0-09 runs traffic after every other verifier, so a redis check cannot observe state "after the run". The leak is therefore provoked in the behavior step: the works-but-wrong solution returns before its `DEL` for a non-player (p-999), leaving `lock:cache:player:p-999`; p-101 catches a lock that is never released on the success path. Message keeps the spec wording ("no PX or no release").
2. **Level 4 has a behavior verifier the spec did not list.** A traffic-only level activates no slot (P0-09), so the learner's code would never run. The behavior step deliberately never touches p-028 and its fixtures delete `cache:player:p-028` plus its lock, which run right before traffic, so the stampede always meets an empty key even on a retry within 30 s.
3. **Level 4 behavior does not check TTL**, on purpose, same rule as 2.2.
4. Level 2 adds a p-999 assertion (`expect: null`, no key left) beyond the spec's p-151 pair; it enforces "a bad id returns null". The schema accepts `expect: null`; **not verified** that the engine treats a literal null as "assert null" rather than "no expectation".
5. Fixture steps use `HSET`/`EXPIRE` (writes); the validator allowed them.
6. Teach panels are 17, 21, 15 and 19 lines (C1's check allowed 8 to 20; `C2a.sh` allows up to 24; 2.2 is the 21).
7. Level 4 teach mentions `DELEX` only through the docs link; the reference uses Lua so it works on any `redis:8` tag (DELEX is 8.4+ per the digest).
8. **Not run live.** I checked logic only with an in-memory fake client in the scratchpad: with 200 concurrent calls the reference made 1 Postgres query for p-028 (3 including the p-101 and p-999 calls), the plain version 200, and the no-expiry lock left `lock:cache:player:p-999`. Live graded runs (verdicts, ratios, whether 3 queries is stable) are the orchestrator's job.

## Tone and accuracy for a reviewer
- Level 1's teach quotes ~200 ms uncached and a few ms cached; these are measured by this project's P0-07 check, labelled as such, not an industry figure.
- Level 1 quiz explanation and the `add-index` wrong reason say the index is also right but the DBA's lesson.
- Redis facts come only from the digest (cache-aside page, hashes, keyspace, distributed locks, EVAL). The claim "the stats row has null columns stored as empty strings" follows P0-07's note on `HGETALL` vs the baseline.

## Check output (`scripts/check/C2a.sh`, exit 0)
```

== build @quest/shared
PASS  build

== validate levels/ch2-everyone-showed-up
PASS  levels:validate: OK (1 chapter(s), 4 level(s))

== chapter.yaml
PASS  chapter id ch2
PASS  chapter lists exactly 4 levels

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
PASS  4 level files

== spec rules
PASS  02 behavior step does not check TTL
PASS  02 antipattern checks TTL on p-151
PASS  04 has a behavior verifier (slot activation)

== scenarios
PASS  scenarios/stats-hot-100.yaml parses: id=stats-hot-100 connections=50 durationSec=10 requests=2
PASS  scenarios/stampede-one-key.yaml parses: id=stampede-one-key connections=200 durationSec=5 requests=1

C2a OK
```

## git status --short
Owned paths changed: `levels/ch2-everyone-showed-up/`, `scenarios/stats-hot-100.yaml`, `scenarios/stampede-one-key.yaml`, `scripts/check/C2a.sh` (plus this handoff). The `ui/` and `scripts/check/F-UI.sh` entries were already modified or untracked before this task (another agent's work); I did not touch them.

```
 M ui/e2e/chapter0.e2e.ts
 M ui/src/screens/Built.tsx
 M ui/src/styles.css
 M ui/src/types.ts
?? docs/handoffs/C2a.md
?? levels/ch2-everyone-showed-up/
?? scenarios/stampede-one-key.yaml
?? scenarios/stats-hot-100.yaml
?? scripts/check/C2a.sh
?? scripts/check/F-UI.sh
?? ui/e2e/dbg.mjs
?? ui/test/insightLink.test.ts
```
