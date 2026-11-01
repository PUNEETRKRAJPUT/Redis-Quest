# C4b handoff: Chapter 4b "On call" (seven levels, three scenarios, one check)

## What I built
- `levels/ch4b-on-call/`: `chapter.yaml` (`id: ch4b`, "On call", seven lines 02:05 to 02:20: Teja, Mukul, you, Harry Bhaiya only at 02:20), seven
  level files, 13 solutions (`solutions/`), 6 fixtures (`fixtures/`).
- `scenarios/celebrity-100.yaml`, `scenarios/oncall-views-100.yaml`, `scenarios/oncall-teams-100.yaml` (all three parse with the engine's own parser; the check
  asserts their fields).
- `scripts/check/C4b.sh` (bash 3.2, shape of `C4.sh`; `C4B_LEVELS=levels/.c4b-wip` points it at a chapter that is not in the engine's tree yet).
- This handoff. Nothing staged, committed, or edited outside those paths; `docs/BUILD.md` untouched.
- While writing I kept the chapter in `levels/.c4b-wip/` (skipped by the loader) and moved it to `levels/ch4b-on-call/` in one `mv` once it validated, so the
  engine's "refuse to start on invalid levels" rule could never see a half-written chapter. The wip directory is gone.
- `pnpm --filter @quest/shared levels:validate levels/ch4b-on-call` -> `OK (1 chapter(s), 7 level(s))`; the whole tree -> `OK (6 chapter(s), 75 level(s))`.
  `pnpm format:check` passes (prettier ignores `levels/`, `scenarios/` and `*.yaml`; the check is a `.sh`, so nothing of mine is formatted by it).

## The check
`scripts/check/C4b.sh`: **exit 0, run twice in a row on the final files (204 PASS each)**. One throwaway container only
(`docker run -d --rm --name quest-c4b-redis -p 127.0.0.1:6399:6379 redis:8`, stopped by the trap; I verified none is left). No compose project was started or
touched. The orchestrator's `quest-a04` project was running during my work (my timings were taken beside it, so the machine was not idle).
Full output of the last run is at the end of this file.

## One line per level: the local proof (engine evaluators, each level's own `setup`, real `createLearnerDeps`, one fake Postgres row for p-028)
| level | solution | declared | local verdict | rests on |
|---|---|---|---|---|
| ch4b-01 one celebrity player | 01-reference.js | right | right | quiz, event `load_finished`, traffic (live) |
| | 01-wrong-plain-cache.js | wrong | **right, by design** | the declared `wrong` rests on the **traffic** verifier alone (DEFER). Extra proof: 0.0002 Redis commands per call for the reference, 1.000 for this file (the live bound is 0.2) |
| ch4b-02 one hash with three lakh fields | 02-reference.js | right | right | quiz (live) |
| | 02-wrong-del.js | wrong | wrong | the `redis` check (`cmdstat_unlink:calls=[1-9]` missing), local |
| ch4b-03 a cron runs KEYS | 03-reference.js | right | right | quiz (live) |
| | 03-wrong-keys.js | wrong | wrong | the `redis` check (`notContains cmdstat_keys`), local |
| ch4b-04 memory grows every day | 04-reference.js | right | right | quiz, event `load_finished` (live) |
| | 04-wrong-no-ttl.js | wrong | wrong | behavior `addTtls` (0, not 1000), local |
| | 04-works-but-wrong-sweep-only.js | works_but_wrong | works_but_wrong | the behavior-shaped antipattern on `recordView` (TTL -1), local |
| ch4b-05 everything froze | 05-reference.js | right | right | quizzes, events `redis_busy` and `script_killed` (live: the harness dance) |
| | 05-wrong-lua-loop.js | wrong | wrong | the `redis` check (`cmdstat_eval:` present), local |
| ch4b-06 connections climbing | 06-reference.js | right | right | quiz, event `load_finished`, and the `INFO clients` bound (live, **see the caution below**) |
| | 06-wrong-client-per-call.js | wrong | wrong | behavior (`{ name }` has no `id`), local |
| ch4b-07 the on-call checklist | reference (7 ids) + 7 wrong options | | static | seven quizzes, all live |

**Verdicts that rest on live grading**: every quiz (all of 07; one or two in each of 01 to 06); events `load_finished` (01, 04, 06), `redis_busy` and
`script_killed` (05); the traffic verifier of 01 (`redis_per_request_lte 0.2`, `error_rate_lte 0`, `p99_ms_lte 100`, so the declared verdict of
`01-wrong-plain-cache.js` and the p99 and error bounds for the reference); the `INFO clients` bound of 06. All behavior, antipattern and `redis` verdicts were proven
locally but through `createLearnerDeps` over one shared connection, not through the real runner and a real Postgres (01's `player_stats()` is faked).

How I computed every `expect` value: I ran the fixtures through the engine's `runFixtureSteps` against the throwaway Redis and read the answers back with Redis
itself: `ZCOUNT lb:match:m-901 50 +inf` = 3 and `m-902` = 4 (05); after `04-seed-views.yaml`, a `SCAN` of `view:*` gives 1000 keys, all 1000 with `TTL` -1, and
`EXISTS view:u-000010:m-041` = 0 (04); `HLEN fans:t-01` = 300000 after `02-big-hash.yaml` and 300000 fields in 64 buckets after the reference split (02); a `SCAN`
count of `oncall:user:*` = 500000 after the setup EVAL (03); `HGETALL team:t-01` = `id t-01 name Mumbai Monsoon` and `EXISTS team:t-99` 0 (06).

## Measurements quoted in the levels (all "on this stack", redis 8.10.3 arm64; the check re-measures each one on every run)
| level | quoted | measured |
|---|---|---|
| 02 | `MEMORY USAGE fans:t-01`, fields `u1`..`u300000` each `1` | 15,180,435 bytes (14.5 MiB), identical in four runs; the check allows 5% |
| 02 | `OBJECT ENCODING`, `HLEN`, listpack limit | `hashtable`, 300000, `hash-max-listpack-entries 512` (the 512 is in the digest) |
| 02 | `DEL` of the hash | 8,497 to 12,111 microseconds in nine tries (slow log's figure, threshold set to 0 for the try); about 10 ms |
| 02 | `UNLINK` of the hash | 7 to 30 microseconds in the same nine tries |
| 02 | the split into 64 buckets (FNV-1a of the field name) | 4,649 to 4,716 fields per bucket, each still `hashtable`; 856 to 911 ms in-process |
| 02 | a multiply-by-31 hash on the same names (hint 3) | 1,870 to 7,619 fields per bucket (A-04's 1,261 to 8,306 was on `f1..f300000`) |
| 02, 03, 04 | the setup scripts | 200 to 230 ms (300,000 HSETs), 409 to 431 ms (500,000 SETs; the spec wanted under two seconds), 263 to 302 ms (the 500,000 UNLINKs plus 5,000 SETs) |
| 03 | `KEYS oncall:user:*` over 500,000 keys | 45,446 to 72,189 microseconds (24 calls, eight runs), always over the 10,000 us slow-log threshold; `LATENCY LATEST` lists one `command` event (72 ms in the run quoted); `LATENCY DOCTOR` reports spikes |
| 04 | `MEMORY USAGE` of one view key | 64 bytes, 80 once it has a TTL; `TTL` -1 for no expiry, -2 for a missing key; `INFO keyspace` line format |
| 04 | 60 million views x 64 bytes | 3.84 GB, said in the text to be arithmetic, not a measurement |
| 05 | `PING` sent 1 s after the script started | answers `BUSY Redis is busy running a script. You can only call SCRIPT KILL or SHUTDOWN NOSAVE.` after 4,000 to 4,030 ms (about 5 s after the start); `GET x` then answers BUSY at once |
| 05 | killed `EVAL` | `SCRIPT KILL` -> `OK`; the EVAL's own error `ERR Script killed by user with SCRIPT KILL...`; `PING` -> `PONG`; slow log holds the `eval` at 5,009,668 to 5,164,480 microseconds (eight runs); `INFO commandstats`: `cmdstat_eval ... failed_calls=1`, `cmdstat_ping ... rejected_calls=1` |
| 05 | the app side | quoted from A-04: the route answers 500 after about 2 s while the script runs on; Postgres-only routes keep answering; routes that need Redis fail the same way |
| 06 | `connected_clients` | quoted from A-04: 9 -> 208 under 200 lookups, back to 6 after `docker compose restart app`; idle 6 to 9 **without Redis Insight open**; `maxclients` 10000 (mine); `CLIENT LIST` has `age`, `idle`, `cmd` (mine) |
| 06 | the bound (`connected_clients:([0-9]\|[1-5][0-9])\b`) | 6, 9, 59 pass; 60, 208, 1000 fail (proved in the check). I did **not** measure the idle count on the default compose stack with Redis Insight attached: that is the orchestrator's to confirm; the bound has a margin of 50 |

## Not in the digest (stated in the levels anyway, because they are standard Redis commands; each is flagged "on this stack" or was measured by the check)
- `INFO commandstats` (fields `calls`, `usec`, `usec_per_call`, `rejected_calls`, `failed_calls`) and `CONFIG RESETSTAT`; `INFO stats` `instantaneous_ops_per_sec`;
  `INFO keyspace` line format; `INFO memory` `used_memory_human`; `INFO clients` `connected_clients` and `maxclients`.
- `SLOWLOG GET` / `SLOWLOG RESET`, the default threshold of 10,000 microseconds, "cheap commands do not appear"; a killed script is recorded with its whole run time.
- `LATENCY LATEST` / `LATENCY RESET`, `latency-monitor-threshold`, the `command` event; the output of `LATENCY DOCTOR` and `MEMORY DOCTOR` (the digest only names the tools).
- `CLIENT LIST` and its `age`, `idle`, `cmd` fields.
- `MEMORY USAGE`, `OBJECT ENCODING` as commands; `redis-cli --bigkeys` and `--memkeys` and what they print.
- `UNLINK` (takes the key out of the keyspace at once and frees later) and "a `DEL` of a big key blocks for a time that grows with its size" (only the measured 10 ms is a fact I own).
- `TTL` answers -1 and -2; `EXPIRE key seconds NX`; the `TYPE zset` option of `SCAN`.
- `SHUTDOWN NOSAVE` means "without saving" (the digest only names it); "Redis has no rollbacks" is the digest's, but I apply it to scripts in one explanation.
- `MONITOR` is a cost if left running and `DEBUG` is a debugging command (level 7's last quiz); the digest only shows MONITOR used for short checks.
- node-redis calls used in the references: `hScan` returns `{ cursor, entries }`, `scan` accepts `MATCH`, `COUNT`, `TYPE`, `expire(key, s, 'NX')`, `redis.duplicate()` and `destroy()`.

## Deviations from the spec (all deliberate)
1. **04: the `recordView` TTL check is an antipattern, not a behavior side effect.** The spec asks for both "behavior recordView sideEffect TTL between [1, 86400]" and a
   `works_but_wrong` sweep-only file that must grade `works_but_wrong`; the 2.2 rule resolves it: the behavior checks `EXISTS view:u-000010:m-041`, the behavior-shaped
   antipattern checks the TTL.
2. **04: the fixture first clears every `view:*` key (a SCAN and UNLINK loop in one EVAL), then seeds 1,000.** The harness's 5 s `load_finished` run writes thousands of
   views before verify, so `addTtls("view:*")` would otherwise not return 1000. Level 4's `setup` also unlinks the 500,000 level-3 keys (so `--memkeys` and level 5's
   SCAN are quick) and restores `latency-monitor-threshold` to 0 (level 3 set it to 10; the ch2 lesson was "ops levels must restore config").
3. **05: `notContains: "cmdstat_eval:"` with the colon.** The spec says `cmdstat_eval`; `cmdstat_eval_ro` and `cmdstat_evalsha` begin with it, and any `EVAL_RO` in a check (A-04's
   check-style scripts use them) would trip the plain form. The fixture ends with `CONFIG RESETSTAT` so its own commands never count. No `setup` (the spec has none).
4. **06: a fixture `06-teams.yaml` that the spec does not name** (behavior verifiers need one; it re-writes the eight team hashes and deletes `team:t-99`).
5. **01: the task carries a 12-line cache-aside** for a learner who lost the Chapter 2 file, and the reference stores the **promise** of the read in the memo (a hundred
   requests arriving just after an expiry share one read). My first reference stored the row; the check's per-call proof showed 100 Redis reads at each expiry
   (0.0175 per call), which at a slow 500 requests a second would approach the 0.2 bound (100 reads a second over 500 requests a second is 0.2). With the promise: 0.0002. Hint 3 teaches it.
6. **07 has a short `teach`** (the method, no per-symptom mapping): the schema requires `teach` on a decision level, the spec says "none". It names the instruments, not the
   answers. 07's last quiz is "which of these is safe", single-correct, so one wrong option per quiz holds (the four things not to run are the distractors and the explanation).
7. **02's fixture rebuilds the hash** (the setup only runs at Start): a second Verify, or one after a first try, would otherwise find no `fans:t-01`.
8. 01 has the quiz first, then behavior, event, traffic (traffic runs last anyway).

## What the engine or app made impossible, awkward, or looks broken (not fixed, not mine)
- **06's live verdict for the reference is expected to MISMATCH.** The harness's `load_finished` dance (`POST /api/load/start`, no slot switching, no app restart) runs the
  `oncall-teams-100` traffic against the planted leaky baseline, which leaves about 200 connections open (A-04: 9 -> 208) until the app restarts. `INFO clients` is read after
  that, so `connected_clients` is far over 60 and the `redis` check fails even for the reference. A learner who does the level in order passes (they restart the app after
  fixing, as the task says). Options: the dance activates the level's slots before the run (`POST /api/levels/:id/slots { active: true }`, E-01) for good solutions, or the
  harness restarts the app after the run for this level, or 06 is graded by hand. I did not change the level to dodge it: the check on `INFO clients` is the lesson.
- **Level 4's harness run** also leaves thousands of `view:*` keys: handled by the fixture (deviation 2).
- `docker-compose.yml` does not forward `ONCALL_SPIN_MS` (A-04 said so): the freeze lasts the default 20 s, which level 5's text states ("about twenty seconds if nobody stops
  it"). If the spin were shortened for a test stack, the text would be wrong; it is not wrong today.
- The `INFO clients` idle count with Redis Insight attached was not measured (A-04's 6 to 9 was without it): see the table.
- Level 3 through the app: `GET /app/oncall/users/count` over 500,000 keys was measured by me only at the Redis level (45,446 to 72,189 microseconds server time), not through the app and
  Caddy. A-04 measured 63 to 143 ms through the app for 200,000 keys, so 500,000 should stay far under the learner client's 2 s command timeout; not verified.
- The UI beats (Run traffic button, switch, terminal events) were not exercised by me; I never started the stack. `scripts/check/G-01.sh` has someone else's uncommitted edit
  naming `ch4b-on-call` (E-02 noticed it too); I did not read it for correctness or run it.

## Not verified
- Live grading of anything above (quizzes, events, traffic, 06's bound); the real runner path; the hint and teach texts in the UI.
- `redis_per_request_lte` against the real app's metrics (only the Redis-side ratio was proved); p99 under 100 ms and zero errors for level 1 on a loaded Mac.
- The learner's naive `HSET`-per-field `splitBigKey` timing out through the runner (10.2 s per assertion) is reasoned from the 60 s/10 s rules in P0-09, not run.

## Files
```
levels/ch4b-on-call/chapter.yaml
levels/ch4b-on-call/01-one-celebrity-player.yaml ... 07-the-on-call-checklist.yaml
levels/ch4b-on-call/solutions/{01-reference,01-wrong-plain-cache,02-reference,02-wrong-del,03-reference,03-wrong-keys,04-reference,04-wrong-no-ttl,04-works-but-wrong-sweep-only,05-reference,05-wrong-lua-loop,06-reference,06-wrong-client-per-call}.js
levels/ch4b-on-call/fixtures/{01-cold,02-big-hash,03-reset-stats,04-seed-views,05-two-matches,06-teams}.yaml
scenarios/{celebrity-100,oncall-views-100,oncall-teams-100}.yaml
scripts/check/C4b.sh
docs/handoffs/C4b.md
```

## Full output of `scripts/check/C4b.sh` (exit 0, the second of two consecutive passing runs on the final files)

```

== build @quest/shared and @quest/engine (the evaluators, the scenario parser and the CLI splitter come from the engine)
PASS  shared build
PASS  engine build

== validate levels/ch4b-on-call
PASS  levels:validate: OK (1 chapter(s), 7 level(s))
PASS  7 levels

== chapter.yaml
PASS  chapter id ch4b
PASS  chapter lists exactly 7 levels
PASS  levels listed in the spec's order

== levels
level ch4b-01-one-celebrity-player
PASS    listed in chapter.yaml
PASS    solutions/01-reference.js exists, non-empty
PASS    solutions/01-reference.js is valid JavaScript
PASS    solutions/01-wrong-plain-cache.js exists, non-empty
PASS    solutions/01-wrong-plain-cache.js is valid JavaScript
PASS    fixtures/01-cold.yaml exists, non-empty
PASS    docs link present
PASS    teach is 18 lines
level ch4b-02-one-hash-with-three-lakh-fields
PASS    listed in chapter.yaml
PASS    solutions/02-reference.js exists, non-empty
PASS    solutions/02-reference.js is valid JavaScript
PASS    solutions/02-wrong-del.js exists, non-empty
PASS    solutions/02-wrong-del.js is valid JavaScript
PASS    fixtures/02-big-hash.yaml exists, non-empty
PASS    docs link present
PASS    teach is 24 lines
level ch4b-03-a-cron-runs-keys
PASS    listed in chapter.yaml
PASS    solutions/03-reference.js exists, non-empty
PASS    solutions/03-reference.js is valid JavaScript
PASS    solutions/03-wrong-keys.js exists, non-empty
PASS    solutions/03-wrong-keys.js is valid JavaScript
PASS    fixtures/03-reset-stats.yaml exists, non-empty
PASS    docs link present
PASS    teach is 20 lines
level ch4b-04-memory-grows-every-day
PASS    listed in chapter.yaml
PASS    solutions/04-reference.js exists, non-empty
PASS    solutions/04-reference.js is valid JavaScript
PASS    solutions/04-wrong-no-ttl.js exists, non-empty
PASS    solutions/04-wrong-no-ttl.js is valid JavaScript
PASS    solutions/04-works-but-wrong-sweep-only.js exists, non-empty
PASS    solutions/04-works-but-wrong-sweep-only.js is valid JavaScript
PASS    fixtures/04-seed-views.yaml exists, non-empty
PASS    docs link present
PASS    teach is 18 lines
level ch4b-05-everything-froze
PASS    listed in chapter.yaml
PASS    solutions/05-reference.js exists, non-empty
PASS    solutions/05-reference.js is valid JavaScript
PASS    solutions/05-wrong-lua-loop.js exists, non-empty
PASS    solutions/05-wrong-lua-loop.js is valid JavaScript
PASS    fixtures/05-two-matches.yaml exists, non-empty
PASS    docs link present
PASS    teach is 23 lines
level ch4b-06-connections-climbing
PASS    listed in chapter.yaml
PASS    solutions/06-reference.js exists, non-empty
PASS    solutions/06-reference.js is valid JavaScript
PASS    solutions/06-wrong-client-per-call.js exists, non-empty
PASS    solutions/06-wrong-client-per-call.js is valid JavaScript
PASS    fixtures/06-teams.yaml exists, non-empty
PASS    docs link present
PASS    teach is 22 lines
level ch4b-07-the-on-call-checklist
PASS    listed in chapter.yaml
PASS    docs link present
PASS    teach is 13 lines
PASS  7 level files
PASS  fixtures/01-cold.yaml is used by a level
PASS  fixtures/02-big-hash.yaml is used by a level
PASS  fixtures/03-reset-stats.yaml is used by a level
PASS  fixtures/04-seed-views.yaml is used by a level
PASS  fixtures/05-two-matches.yaml is used by a level
PASS  fixtures/06-teams.yaml is used by a level
PASS  solutions/01-reference.js is declared by a level
PASS  solutions/01-wrong-plain-cache.js is declared by a level
PASS  solutions/02-reference.js is declared by a level
PASS  solutions/02-wrong-del.js is declared by a level
PASS  solutions/03-reference.js is declared by a level
PASS  solutions/03-wrong-keys.js is declared by a level
PASS  solutions/04-reference.js is declared by a level
PASS  solutions/04-works-but-wrong-sweep-only.js is declared by a level
PASS  solutions/04-wrong-no-ttl.js is declared by a level
PASS  solutions/05-reference.js is declared by a level
PASS  solutions/05-wrong-lua-loop.js is declared by a level
PASS  solutions/06-reference.js is declared by a level
PASS  solutions/06-wrong-client-per-call.js is declared by a level

== spec rules, scenarios and solution modules (one node pass over the real parsed levels and the engine's scenario parser)
PASS  chapter ch4b loads with 7 levels
PASS  incident thread has 7 lines (six to eight)
PASS  incident runs 02:05 to 02:20 (02:05 to 02:20)
PASS  incident times are in order
PASS  chapter title is "On call"
PASS  incident speakers are cast slugs or "you" (roommate, you, rival-college, senior)
PASS  Harry Bhaiya is asleep until 02:20 (his only line is the last)
PASS  at most two emoji in the thread (2)
PASS  no denylisted cricketer or franchise in any chapter file
PASS  no AI, vector or LLM content
PASS  every reward is 40 to 70 XP (50, 60, 50, 60, 70, 60, 40)
PASS  every brainstorm has a not-redis option
PASS  every code level has three or more hints
PASS  every wrong solution has a real because
PASS  celebrity-100: 100 connections, 10 s, no warmup, one request GET /app/players/p-028/stats
PASS  oncall-views-100: 100 connections, 8 s, 20,000 users uniform, POST /app/oncall/views { userId: "{user}", matchId: "m-041" }
PASS  oncall-teams-100: 100 connections, 8 s, GET /app/oncall/teams/{team} over t-01 .. t-08
PASS  levels 01, 04 and 06 name their scenarios; no other level has one
PASS  01 code, scenario celebrity-100, verify order quiz,behavior,event,traffic
PASS  01 quiz: hot-key against big-key, slow-command, connection-leak
PASS  01 behavior: p-028 twice leaves a hash, p-999 is null
PASS  01 event custom load_finished celebrity-100, timeoutMs 60000
PASS  01 traffic: baseline false, redis_per_request_lte 0.2, error_rate_lte 0, p99_ms_lte 100
PASS  01 show_me cache_stats []
PASS  01 solutions: reference + the plain Chapter 2 cache
PASS  01 teach names RESP: 3 and clientSideCache; task names INFO commandstats, INFO stats and Run traffic
PASS  01 task carries a cache-aside for a learner who lost the Chapter 2 file
PASS  02 setup: one EVAL building 300,000 fields and clearing the buckets, then CONFIG RESETSTAT; verify order quiz,behavior,redis
PASS  02 behavior: splitBigKey("fans:t-01", 64) -> { fields: 300000, buckets: 64 }
PASS  02 side effects: original gone, 64 buckets sum to 300000
PASS  02 redis: INFO commandstats matches cmdstat_unlink:calls=[1-9]
PASS  02 show_me hash_card fans:t-01:0
PASS  02 task names MEMORY USAGE, OBJECT ENCODING, HLEN and --bigkeys; teach quotes 15,180,435 and the 512 limit
PASS  02 solutions: reference + DEL
PASS  02 fixture rebuilds the hash and ends with CONFIG RESETSTAT
PASS  03 setup: 500,000 keys by one EVAL, SLOWLOG RESET, LATENCY RESET, latency-monitor-threshold 10; verify order quiz,behavior,redis
PASS  03 behavior: countUsers("oncall:user:") -> 500000 after a stats reset
PASS  03 redis: notContains cmdstat_keys, matches cmdstat_scan:calls=[1-9]
PASS  03 task: the curl three times, SLOWLOG GET 5, LATENCY LATEST, LATENCY DOCTOR
PASS  03 show_me cache_stats; solutions: reference + KEYS
PASS  03 fixture: CONFIG RESETSTAT and SLOWLOG RESET
PASS  04 scenario oncall-views-100; verify order quiz,behavior,behavior,antipattern,event
PASS  04 verifies both slots (a bundle: recordView, addTtls)
PASS  04 setup: unlink the level-3 keys, restore latency-monitor-threshold 0, seed 5,000 views with no TTL
PASS  04 recordView behavior only checks the key exists (the TTL bound is the antipattern, the 2.2 rule)
PASS  04 addTtls behavior: ("view:*", 86400) -> 1000, then no view:* key with TTL -1
PASS  04 antipattern: recordView leaves a TTL between 1 and 86400
PASS  04 event load_finished oncall-views-100, timeoutMs 60000
PASS  04 show_me ttl_timer
PASS  04 solutions as bound
PASS  04 task: INFO keyspace, INFO memory, --memkeys
PASS  04 fixture: clears view:* then seeds 1,000 views u-000011 .. u-001010
PASS  05 verify order event,event,quiz,quiz,behavior,redis
PASS  05 events redis_busy and script_killed, timeoutMs 300000
PASS  05 behavior: recomputeBadges() -> badges:fifties m-901 = 3, m-902 = 4
PASS  05 redis: INFO commandstats notContains "cmdstat_eval:" (the colon keeps eval_ro and evalsha out of it)
PASS  05 task says plainly: kill the script before Verify or Start (every check BUSY, counts as an attempt)
PASS  05 a hint repeats the warning
PASS  05 teach: busy-reply-threshold, SCRIPT KILL, SHUTDOWN NOSAVE, the measured 5,164,480 microseconds
PASS  05 task: curl the job, PING, SLOWLOG GET 3, SCRIPT KILL, CONFIG GET busy-reply-threshold
PASS  05 show_me hash_card badges:fifties
PASS  05 solutions: reference + the Lua loop
PASS  05 fixture: DEL badges:fifties, two zsets, CONFIG RESETSTAT last
PASS  06 scenario oncall-teams-100; verify order quiz,behavior,event,redis
PASS  06 setup: the eight team hashes with id and name copied from fiction/teams.json
PASS  06 fixture holds the same eight names
PASS  06 behavior: lookupTeam("t-01") -> { id, name }, t-99 -> null
PASS  06 event load_finished oncall-teams-100, timeoutMs 60000
PASS  06 redis: INFO clients, connected_clients under 60
PASS  06 task: INFO clients, CLIENT LIST, /app/oncall/status, docker compose restart app; teach names duplicate()
PASS  06 show_me cache_stats; solutions: reference + client per call
PASS  07 decision level, seven quizzes, no show_me
PASS  07 every quiz has four options
PASS  07 option ids are unique across the quizzes
PASS  07 reference lists exactly the seven correct ids
PASS  07 exactly one wrong entry per quiz, each naming an incorrect option
PASS  07 interviewer wording on the spike question; the last quiz names KEYS *, MONITOR, FLUSHALL and DEBUG
PASS  01-reference.js: default export is a function
PASS  01-wrong-plain-cache.js: default export is a function
PASS  02-reference.js: default export is a function
PASS  02-wrong-del.js: default export is a function
PASS  03-reference.js: default export is a function
PASS  03-wrong-keys.js: default export is a function
PASS  04-reference.js: exports recordView, addTtls, default export is recordView
PASS  04-works-but-wrong-sweep-only.js: exports recordView, addTtls, default export is recordView
PASS  04-wrong-no-ttl.js: exports recordView, addTtls, default export is recordView
PASS  05-reference.js: default export is a function
PASS  05-wrong-lua-loop.js: default export is a function
PASS  06-reference.js: default export is a function
PASS  06-wrong-client-per-call.js: default export is a function
PASS  static node checks

== local proof: engine evaluators against every solution (one throwaway redis:8 container, fake Postgres)
PASS  throwaway container quest-c4b-redis on 127.0.0.1:6399 (redis 8.10.3)
PASS  ch4b-01-one-celebrity-player solutions/01-reference.js: declared right, evaluators say right (setup 0 ms)
PASS  ch4b-01-one-celebrity-player solutions/01-wrong-plain-cache.js: declared wrong (by a DEFERRED verifier; the local evaluators must see right), evaluators say right (setup 0 ms)
PASS  ch4b-02-one-hash-with-three-lakh-fields solutions/02-reference.js: declared right, evaluators say right (setup 241 ms)
PASS  ch4b-02-one-hash-with-three-lakh-fields solutions/02-wrong-del.js: declared wrong, evaluators say wrong (setup 197 ms)
        how: redis: The original hash should be removed with UNLINK. INFO commandstats shows no unlink call: a DEL of a hash this size holds the server for about 10 ms on this stack. (expected something matching /cmdstat_unlink:calls=[1-9]/, got "# Commandstats\r\ncmdstat_hset:ca
PASS  ch4b-03-a-cron-runs-keys solutions/03-reference.js: declared right, evaluators say right (setup 405 ms)
PASS  ch4b-03-a-cron-runs-keys solutions/03-wrong-keys.js: declared wrong, evaluators say wrong (setup 388 ms)
        how: redis: INFO commandstats still shows the keys command. countUsers must never call KEYS: it walks the whole keyspace in one command. (expected no "cmdstat_keys", got a line reading cmdstat_keys:calls=1,usec=53593,usec_per_call=53593.00,rejected_calls=0,failed_calls=0,
PASS  ch4b-04-memory-grows-every-day solutions/04-reference.js: declared right, evaluators say right (setup 4 ms)
PASS  ch4b-04-memory-grows-every-day solutions/04-wrong-no-ttl.js: declared wrong, evaluators say wrong (setup 3 ms)
        how: behavior oncall.addTtls: There are exactly 1,000 view:* keys with no TTL. addTtls('view:*', 86400) should give each of them one and return 1000. (expected 1000, got 0) | Some view:* keys still have no TTL after addTtls. It must reach every key that matches the pattern, page after page
        how: antipattern oncall.recordView: This passes today, but recordView still writes a view with no expiry, so tomorrow's fans leak all over again: the sweep only emptied the bucket once. Write the TTL in the same SET (EX 86400). (expected between 1 and 86400, got -1)
PASS  ch4b-04-memory-grows-every-day solutions/04-works-but-wrong-sweep-only.js: declared works_but_wrong, evaluators say works_but_wrong (setup 4 ms)
        how: antipattern oncall.recordView: This passes today, but recordView still writes a view with no expiry, so tomorrow's fans leak all over again: the sweep only emptied the bucket once. Write the TTL in the same SET (EX 86400). (expected between 1 and 86400, got -1)
PASS  ch4b-05-everything-froze solutions/05-reference.js: declared right, evaluators say right (setup 0 ms)
PASS  ch4b-05-everything-froze solutions/05-wrong-lua-loop.js: declared wrong, evaluators say wrong (setup 0 ms)
        how: redis: INFO commandstats shows an eval call. recomputeBadges must do its work from JavaScript in small commands: a script holds Redis for as long as it runs, however short the loop looks at two matches. (expected no "cmdstat_eval:", got a line reading cmdstat_eval:ca
PASS  ch4b-06-connections-climbing solutions/06-reference.js: declared right, evaluators say right (setup 1 ms)
PASS  ch4b-06-connections-climbing solutions/06-wrong-client-per-call.js: declared wrong, evaluators say wrong (setup 1 ms)
        how: behavior oncall.lookupTeam: lookupTeam('t-01') should return { id: 't-01', name: 'Mumbai Monsoon' }, read from the hash team:t-01. (expected {"id":"t-01","name":"Mumbai Monsoon"}, got {"name":"Mumbai Monsoon"})
-- ch4b-07-the-on-call-checklist: decision level, checked statically (reference = the correct ids, one wrong option per quiz)

-- extra proofs (every number a level quotes is re-measured here)
PASS  01 Redis commands per call (2.5 s, 100 at a time, one player): reference 0.0002 over 11800 calls (needs at most 0.2), plain Chapter 2 cache 1.000 over 9700 calls (about 1: the live traffic check fails it)
PASS  01 reference: a missing player is null every time and leaves no key; p-028 comes back from Postgres, then from the memo, with the same player_id
PASS  02 the setup (one EVAL, 300,000 HSETs, plus RESETSTAT) took 234 ms (under two seconds)
PASS  02 fans:t-01: MEMORY USAGE 15180435 (the text says 15,180,435; within 5%), OBJECT ENCODING hashtable, HLEN 300000, hash-max-listpack-entries 512
PASS  02 server time for the 300,000-field hash: DEL 9291 us (the text says about 10 ms: 8,497 to 12,111 in the author's nine tries), UNLINK 8 us (the text says 7 to 30 us)
PASS  02 reference split: 930 ms, buckets 4649 to 4716 fields (the text says about 4,700), sum 300000, a bucket is hashtable (the text says still hashtable)
      02 a multiply-by-31 hash on u1..u300000 gives buckets of 1870 to 7619 fields (A-04 measured 1,261 to 8,306 on f1..f300000, a different set of names; hint 3 quotes 1,870 to 7,619 from the author's run)
PASS  03 the setup (500,000 SETs by one EVAL, SLOWLOG RESET, LATENCY RESET, CONFIG SET) took 430 ms (the spec: under two seconds)
PASS  03 three KEYS over 500,000 keys: slow log 50694, 49647, 52204 us (the text says 45,446 to 72,189 over 24 calls; the check needs each over the 10,000 us threshold), LATENCY LATEST events [command], LATENCY DOCTOR reports spikes
PASS  03 the SCAN reference counts 500000 and leaves no keys entry in the slow log
PASS  04 the setup took 265 ms: unlinked the 500,000 level-3 keys (0 left), restored latency-monitor-threshold (0), seeded 5,000 views; INFO keyspace reads "db0:keys=5000,expires=0,avg_ttl=0,subexpiry=0" (the text shows the format db0:keys=<n>,expires=<m>,avg_ttl=<ms>,subexpiry=0)
PASS  04 MEMORY USAGE of one view: 64 bytes without a TTL (the text says 64), 80 with one (the text says 80)
PASS  04 TTL answers -1 for a key with no expiry and -2 for a missing key (the hint says -1 and -2)
PASS  05 freeze: busy-reply-threshold 5000; PING sent 1 s after the script started answered "BUSY Redis is busy running a script. You can only call SCRIP..." after 4002 ms (5004 ms after the start; the text says about four more seconds, about five in all); GET x then answered BUSY at once; SCRIPT KILL OK; the EVAL's own error "ERR Script killed by user with SCRIPT KILL... script: 8c5d67..."; PING PONG after
PASS  05 afterwards: SLOWLOG GET holds the eval for 5010524 us (the text quotes 5,009,668 to 5,164,480 from eight runs, a spin killed at about 5 s), INFO commandstats: "cmdstat_eval:calls=1,usec=5010524,usec_per_call=5010524.00,rejected_ca..." and "cmdstat_ping:calls=1,usec=1,usec_per_call=1.00,rejected_call..."
PASS  05 the Lua-loop wrong file answers 3,4 (correct, as the because says) and shows cmdstat_eval:calls=1 in INFO commandstats
PASS  06 the bound: connected_clients 6, 9 and 59 pass; 60, 208 and 1000 fail
PASS  06 CLIENT LIST lines carry age, idle and cmd; INFO clients has connected_clients 1 here (this proof's own few connections) and maxclients 10000 (the text says 10000)
PASS  06 team hashes exist after the setup
PASS  every solution gets its declared verdict from the engine's evaluators; the extra proofs hold

== which verdicts rest on live grading (the orchestrator's grade.sh through the engine and the runner)
LIVE  every level with a quiz (01 to 07): the harness types the right options for right and works_but_wrong solutions and a wrong one for wrong ones; none of the proof above covers a quiz. Level 07 is all quizzes: the reference is the seven correct ids (checked statically), one wrong option per quiz
LIVE  ch4b-01-one-celebrity-player: event custom load_finished (celebrity-100; the harness starts a 5 s run first) and the traffic verifier (redis_per_request_lte 0.2, error_rate_lte 0, p99_ms_lte 100). The declared verdict of 01-wrong-plain-cache.js (wrong) rests on the traffic verifier alone: the proof above shows the evaluators say right for it and measures about 1 Redis command per call against 0.2 for the reference, but only the live run decides it
LIVE  ch4b-04-memory-grows-every-day: event load_finished (oncall-views-100). The harness's 5 s run happens before verify, leaves thousands of view:* keys, and the fixture clears them first
LIVE  ch4b-05-everything-froze: events redis_busy and script_killed (the harness's dance: POST /app/oncall/badges/recompute, 5.5 s, PING, SCRIPT KILL). The proof above emulates the freeze with a read-only EVAL spin and shows the same BUSY and the same kill
LIVE  ch4b-06-connections-climbing: event load_finished (oncall-teams-100) and the INFO clients bound. CAUTION for the orchestrator: the harness load dance runs the traffic against the planted baseline (it does not switch the learner slot on, and it cannot restart the app), so the baseline leaks about 200 connections and connected_clients is well over 60 when verify reads it: the reference is expected to MISMATCH live unless the app is restarted after the dance or the dance activates the slot first (see the handoff)
LIVE  every behavior, antipattern and redis verdict above is proven here with createLearnerDeps over one shared connection, like the runner child; the real runner path (slots shimmed from the bundle files, the real Postgres for level 01) is the orchestrator's live grading and is not exercised by this check

== owned files
git status --short (this task's paths):
  ?? docs/handoffs/C4b.md
  ?? levels/ch4b-on-call/
  ?? scenarios/celebrity-100.yaml
  ?? scenarios/oncall-teams-100.yaml
  ?? scenarios/oncall-views-100.yaml
  ?? scripts/check/C4b.sh

C4b OK
```
