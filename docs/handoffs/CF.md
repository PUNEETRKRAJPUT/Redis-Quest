# CF handoff: the Finale, "The architect" (7 levels)

## What I did
Seven level files in `levels/finale/` (`id: finale`, title "The architect", thread Monday 09:00 to 09:30), the one solutions directory
(level 07's two shell scripts), `scripts/check/CF.sh` and this file. Nothing else was touched; nothing staged or committed;
`docs/BUILD.md` untouched. `scripts/check/CF.sh` exits 0 (247 PASS, output at the end). No Docker anywhere.

| file | id | mode | what it is |
|---|---|---|---|
| 01 | `finale-01-mock-interview-one` | code, pool | 20 min, hints 20 XP, `blank_start: true`, nine entries x three questions, 150 XP, badge "Mock one" |
| 02 | `finale-02-mock-interview-two` | code, pool | same pool, 20 min, a second interviewer, 150 XP, "Mock two" |
| 03 | `finale-03-mock-interview-three` | code, pool | same options and answers, 15 min, Mukul asks the questions (his voice), 150 XP, "Panel round" |
| 04 | `finale-04-the-gauntlet` | decision | 15 quizzes x 4 options, 100 XP, "Through the gauntlet" |
| 05 | `finale-05-the-neighbours` | decision | 6 quizzes x 4 options, reasoned, 60 XP, "Knows when not to" |
| 06 | `finale-06-the-code-review` | decision | the PR in the teach, 3 multi-select quizzes, 120 XP, "Approved with comments" |
| 07 | `finale-07-your-story` | ops | event `portfolio_written` (120000 ms) + 2 quizzes, 80 XP, "Story told" |

Pool levels carry no `teach`, `verify`, `solutions` or `show_me`; `task` is the placeholder "The interviewer picks when you start."; hints are
pattern-agnostic (three each). The nine pool entries (same order in all three files): `ch2-02-cache-aside-v1`, `ch2-07-fixtures-must-never-miss`,
`ch2-08-otp-login-properly` (the session store), `ch3-03-token-bucket`, `ch3-06-the-real-leaderboard`, `ch3-10-the-ticker`, `ch4-03-a-worker-died`,
`ch4-07-the-job-queue`, `ch4-16-the-ops-wall`. Option ids are prefixed per question (`ca1-...`) so they are unique inside an entry.
The interviewers are unnamed (the alumnus of Chapter 2's interview, a second one from a product company); Mukul is the only cast voice added;
Harry Bhaiya and Teja appear in the thread and story lines.

## The pool: nine use cases, three follow-up questions each (the calm voice of 01 and 02; 03 asks the same in Mukul's)
Source for every answer: the drawn level's task and teach, and the digest; the explanation names the level and the page.

| use case | question | right answer |
|---|---|---|
| cache-aside (2.2) | Redis restarts and comes back empty: what does the page do? | keeps answering; misses refill from Postgres, slower for a while (single-flight of 2.4 softens it) |
| | A second app server joins: what changes? | nothing: the cache is in Redis, so it is shared |
| | One player on every screen: where do you cut the cost? | a short-lived in-process copy, or client-side caching (4b.1, 5.6); not a longer TTL, not a cluster (one key = one slot) |
| prefetch (2.7) | Every `cache:match:*` key is gone: what does getFixtures do? | returns null without asking Postgres: a miss is an incident, not a fallback |
| | The sync worker misses a change for ten minutes: how does it heal? | a periodic reload against Postgres (the reprefetch button); the 1 h TTL is only a safety net |
| | Why does applyChange DEL then write inside one multi? | so a field the new row no longer has cannot linger (multi: no half-written reads, not a lock) |
| session store (2.8) | Phone stolen: log out everywhere | the per-user set: SMEMBERS, DEL each, SREM, one multi (not KEYS, not a flush) |
| | Nobody stays logged in over 8 hours, but expiry slides: what do you add? | an absolute cap: compare `created_at` (already in the hash) on read |
| | Redis restarts: still logged in? | depends on persistence: snapshot plus log keeps them (about a second lost with everysec); none, everyone logs in again |
| token bucket (3.3) | Redis unreachable for ten seconds | a per-limiter decision: weak local limit for OTPs, refuse for the wallet, always log (level 3.5) |
| | Why one Lua script and not two commands? | read, decide, write atomically, or concurrent requests all see a full bucket |
| | App clocks differ: the script takes now from the caller | the bucket inherits each caller's clock error; TIME inside the script gives one clock, at the price of a script that is no longer a function of its arguments |
| leaderboard (3.6) | Two teams on equal points: who is higher? | by member name (lexicographic), not by who got there first |
| | 40,000 teams, a thousand reads a second of the top ten: why cheap? | kept ordered on write; the top ten is a short range read, O(log N + M) |
| | Two servers score the same team at once: why ZINCRBY? | the increment is atomic inside Redis; read-add-ZADD loses an update (1.2) |
| ticker (3.10) | A phone drops for ten seconds mid-over: what does it see? | pub/sub is at-most-once: the balls are gone; the last-ball key catches it up; a complete feed needs a stream |
| | PUBLISH returns 0: what does that tell you? | nobody was subscribed at that moment; steady 0 usually means a typo in the channel |
| | Why does the subscriber get its own connection? | a subscribed connection can only (un)subscribe and PING: `duplicate()` |
| worker died (4.3) | Worker died after adding runs, before XACK: the sweep reprocesses | runs are added twice (at-least-once); make the work idempotent (4.8) |
| | One ball crashes every worker | delivery count from XPENDING; at the limit, dead-letter stream plus XACK on the group (4.4) |
| | Which command shows stuck balls, how long, how many tries? | XPENDING extended (id, consumer, idle ms, delivery count) |
| job queue (4.7) | A worker claims a job and its box dies: where is the job? | in `processing` (BLMOVE moved it atomically); the reclaimer returns it after the visibility timeout |
| | Slow job reclaimed, then both workers finish: what did the token do? | fenced the late complete; did not undo a side effect already caused: needs an idempotency key |
| | Why does claim take its own connection? | BLMOVE holds its connection; `duplicate()` |
| ops wall (4.16) | Three samples a request, all day: what bounds memory? | RETENTION on each series (rolling window), not EXPIRE (deletes the whole series), not KEYS in a cron |
| | Minute buckets change shape as the window slides | `ALIGN 0` anchors the buckets |
| | p99 across all routes without storing every time | a t-digest (TDIGEST.ADD, TDIGEST.QUANTILE 0.99): an estimate in small space |

Checked by the script: all nine in the same order in all three files, exactly three questions each, the correct answer among 3 or 4 options and
in varying positions, levels 01 and 02 identical, level 03 the same options and answers with all 27 questions in Mukul's voice, and the engine's own
`chooseDraw` over the real pools giving 300 sample players three different use cases each (all nine appear as a first pick).

## The gauntlet (04): fifteen statements and their answers
Reasoned model answers; the story, the teach and the explanations say so, and name the docs page where one exists. Every quiz has its own `qNN-not-redis` option.

| # | statement (short) | right answer (id) |
|---|---|---|
| 1 | login streak badge, 2 million users x 365 days | bitmap per user (`q01-bitmap`) |
| 2 | distinct phones on the match page, ten million, within a percent | HyperLogLog (`q02-hll`) |
| 3 | is this coupon still unused: redeemed, restored on cancel, quick no in front of Postgres | cuckoo filter, CF.DEL / CF.ADDNX (`q03-cuckoo`) |
| 4 | the ten names trending now, millions of misspellings, counts approximate | Top-K (`q04-topk`) |
| 5 | grounds within 20 km of the fan, a hundred thousand asks a minute | geo index, GEOSEARCH BYRADIUS (`q05-geo`) |
| 6 | every ball: workers share, analytics replays nightly, none lost | stream with consumer groups (`q06-stream`) |
| 7 | last place in a contest, three steps on Redis keys, exactly one winner | lock key, SET NX PX with a token (`q07-lock`) |
| 8 | ten OTPs per user per minute, no 2x at the boundary, 100 concurrent | token bucket in a Lua script (`q08-bucket`) |
| 9 | "who is watching" strip, live joins and leaves | pub/sub plus a short-TTL key per viewer (`q09-presence`) |
| 10 | rank 40,000 teams, top ten and "you are 14,203rd", stable ties | sorted set (`q10-zset`) |
| 11 | 4 second query, same three players, changes once a match | cache-aside (`q11-aside`) |
| 12 | 200 GB audit log kept seven years | not Redis (`q12-not-redis`) |
| 13 | finance report joining five tables once a night | not Redis (`q13-not-redis`) |
| 14 | a 50 MB video nobody changes | not Redis (`q14-not-redis`) |
| 15 | running total of points issued, must be exact after a power cut, read once a day | not Redis (`q15-not-redis`) |

Wrong entries (one per quiz): `q01-hash`, `q02-set`, `q03-bloom`, `q04-cms`, `q05-hash`, `q06-pubsub`, `q07-get-set`, `q08-fixed`, `q09-stream`,
`q10-topk`, `q11-forever`, `q12-ts`, `q13-hashes`, `q14-string`, `q15-incr`; each has a `because`.

## The neighbours (05): six reasoned answers
Memcached for a plain cache (decide on need and on what you already run; the digest does not describe Memcached, and the explanation says so); Kafka for
the ball stream (the streams page's own comparison: groups balance on one key, partitions are like N keys; the "Redis can replace Kafka" line is named as
vendor-published; nobody measured one key's limit, "measure yours"); Postgres `SKIP LOCKED` for the job queue (one system fewer and transactional enqueue;
the list queue earns its place when job churn competes with the main workload, no universal number); an in-process Map for a tiny hot set (4b.1; no hop,
per instance, no invalidation); a CDN for a page identical for everyone (cheaper first layer, Redis stays for what varies); and "both" (Postgres the truth,
Redis the accelerator). Every explanation contains "Reasoned"; the three about products outside the digest say "not from the docs/digest".

## The code review (06): planted mistakes per file
The teach is the pull request, three fenced files (they parse with `node --check`). Quiz = "tick every problem"; wrong entries are one fine line per quiz.

| file | planted (ids) | where it was the lesson | fine lines (distractors) |
|---|---|---|---|
| `workspace/review/cache.js` (9 options, 5 planted) | `c-no-ttl` no expiry on the hash; `c-check-then-set` lock is `get` then `set`, not `SET NX`; `c-swallow` `catch` returns null so an outage is "no such player"; `c-wrap-pg` the `try` also covers Postgres; `c-no-negative` unknown id caches nothing | 2.2 (and 4b.4); 2.4; 2.10 and 2.5; 2.10; 2.5 | `c-key-name` (scheme is right), `c-hit-test` (HGETALL on a missing key is an empty object; the wrong entry), `c-lock-key` (a separate lock key is right), `c-to-strings` (null to empty string is required) |
| `workspace/review/worker.js` (8 options, 4 planted) | `w-keys` `KEYS user:*` in the loop; `w-client-per-job` a client per job, never closed; `w-blpop-shared` `BLPOP` on the shared client; `w-rpop-claim` `RPOP` to claim | 4b.3; 4b.6; 4.7; 4.7 | `w-payload-hash` (id on the list, fields in a hash is the design), `w-sadd-twice` (a set cannot give a badge twice; the wrong entry), `w-module-client` (one shared client), `w-set-per-user` (small sets are not 4b.2's big hash) |
| `workspace/review/lock.js` (8 options, 4 planted) | `l-set-expire` `SET NX` then a separate `EXPIRE`; `l-constant-value` value always `'1'`; `l-plain-del` released with plain `DEL`; `l-no-timeout` held across a Postgres call with no bound | 4.10; 4.10 and 4.11; 4.10 and 4.11; 4.11 | `l-nx` (NX is right), `l-per-contest` (narrowest lock), `l-read-inside` (reading under the lock is the point; the wrong entry), `l-deps` (shared client through deps) |

The explanation of each quiz names the levels and says why the fine lines are fine (checked). Ticking everything, nothing, or all but one planted id fails
through the engine's `gradeQuiz`; each wrong entry fails both alone and added to the full planted set.

## Level 07
Event `portfolio_written` (`timeoutMs: 120000`); quiz one: what to say about a line of the page (the number it measured, the trade-off chosen, the level,
an honest "on my laptop, not production" label, what you would change at ten times the traffic) against three weaker framings; quiz two: what stays out of
the repository (`.env`, credentials, customer or personal data; the game has none, the habit). `show_me` is `cache_stats` with `keys: []`. Solutions:
`07-reference.sh` (the curl, `head` of the page, `git init` / `add` / `status` / `commit`, the push as a comment) and `07-wrong-no-page.sh` (git only).
The teach describes the page as E-04 builds it (title, per-chapter lines with the measured numbers, interviews, brainstorm lines, workspace, closing section).

## What the engine made impossible or awkward (nothing blocking)
- **Level 07's solutions are `.sh`, as the spec binds, and the grading harness never plays an ops shell without `--run-ops`** (G-01 will print
  `SKIPPED (ops shell)` for both rows). So the `portfolio_written` rule E-04 added is not exercised by G-01 for this level; it needs a hand grading once per
  release (press "Write my story" or the curl, Verify, then the wrong script must fail). `--run-ops` would run `git init` and `git commit` in the real
  `workspace/`, so I did not. E-04's own scratch level used `.redis` files and is graded; if the board wants level 07 graded by G-01, change the two
  solutions to `.redis` files (a `PING` and a `GET`), which is a one-line spec change, not mine to make.
- **No shared pool across levels.** A pool must be written in each level file (YAML has no include), so the 27 questions exist three times (01 and 02
  identical; 03 in Mukul's voice, same options and answers). The check asserts they stay in step.
- A pool level cannot carry its own `show_me`, `docs`, `teach` or `solutions` by design; the pool levels show the drawn level's. Their own hints come first
  and cost 20 XP like the drawn level's.

## Not done / not verified
- The pool levels were not played in a browser or through the harness (no Docker, by instruction): the drawn levels are proven by Chapters 2 to 4's own
  checks and the pool mechanics by E-04's. The draw is exercised here through the engine's `chooseDraw` only.
- The right answers are often the longest option in a question; I varied their positions (checked) but did not equalise lengths.
- Every claim about Memcached, `SKIP LOCKED` and CDNs is reasoning and labelled so; none is in the digest. Numbers in statements ("a few thousand balls
  a minute", "a hundred thousand times a minute") are story numbers and labelled where they matter.

## Surprises
- `ch2-08-otp-login-properly` is the session store, not the OTP limiter; the pool calls it that. `ch4-16-the-ops-wall` is the time-series and t-digest level.
- Mid-task the engine work I was told sat uncommitted was committed by the orchestrator; I never touched it.

## Check output (`scripts/check/CF.sh`, exit 0)
```

== build @quest/shared and @quest/engine (the level loader and the quiz grader come from them)
PASS  shared build
PASS  engine build

== validate the whole tree (the pools reference Chapters 2 to 4, so the finale is validated together with them)
PASS  levels:validate: OK (8 chapter(s), 96 level(s))
PASS  8 chapters and 96 levels
PASS  the finale alone does not validate, as designed (its pools name levels of earlier chapters)

== files and chapter.yaml
PASS  7 level files
PASS  chapter id finale
PASS  chapter lists exactly 7 levels
PASS  levels listed in the spec's order
PASS    finale-01-mock-interview-one is listed in chapter.yaml
PASS    finale-02-mock-interview-two is listed in chapter.yaml
PASS    finale-03-mock-interview-three is listed in chapter.yaml
PASS    finale-04-the-gauntlet is listed in chapter.yaml
PASS    finale-04-the-gauntlet has a docs link
PASS    finale-05-the-neighbours is listed in chapter.yaml
PASS    finale-05-the-neighbours has a docs link
PASS    finale-06-the-code-review is listed in chapter.yaml
PASS    finale-06-the-code-review has a docs link
PASS    finale-07-your-story is listed in chapter.yaml
PASS  solutions/07-reference.sh is declared by a level
PASS  solutions/07-wrong-no-page.sh is declared by a level
PASS  solutions/07-reference.sh exists, non-empty
PASS  solutions/07-reference.sh is valid bash
PASS  solutions/07-wrong-no-page.sh exists, non-empty
PASS  solutions/07-wrong-no-page.sh is valid bash

== the chapter's content, one node pass over the real parsed levels
PASS  chapter finale loads with 7 levels
PASS  chapter title is "The architect"
PASS  incident thread has 8 lines (six to eight)
PASS  thread runs 09:00 to 09:30 (09:00 to 09:30)
PASS  thread times are in order
PASS  thread speakers are cast slugs or "you" (senior, roommate, you, rival-college)
PASS  Harry Bhaiya, Teja and Mukul all speak in the thread
PASS  finale-01-mock-interview-one: a code level with an interview pool
PASS  finale-01-mock-interview-one: 20 minutes
PASS  finale-01-mock-interview-one: hints cost 20 XP, blank_start true
PASS  finale-01-mock-interview-one: a pool, not a rebuild_of
PASS  finale-01-mock-interview-one: the pool is the nine use cases, in the spec's order
PASS  finale-01-mock-interview-one: every entry is an ordinary code level of an earlier chapter
PASS  finale-01-mock-interview-one: exactly three follow-up questions in each of the nine entries
PASS  finale-01-mock-interview-one: each question has 3 or 4 options and one correct answer that is among them
PASS  finale-01-mock-interview-one: every explanation names its level or its docs page
PASS  finale-01-mock-interview-one: the right answer is not always in the same place (positions used: 0,1,2,3)
PASS  finale-01-mock-interview-one: no teach, verify, solutions or show_me (the engine takes them from the draw)
PASS  finale-01-mock-interview-one: reward 150 XP and the badge "Mock one"
PASS  finale-01-mock-interview-one: 3 hints, pattern-agnostic
PASS  finale-01-mock-interview-one: the brainstorm has a not-redis option
PASS  finale-01-mock-interview-one: a one-line placeholder task
PASS  finale-02-mock-interview-two: a code level with an interview pool
PASS  finale-02-mock-interview-two: 20 minutes
PASS  finale-02-mock-interview-two: hints cost 20 XP, blank_start true
PASS  finale-02-mock-interview-two: a pool, not a rebuild_of
PASS  finale-02-mock-interview-two: the pool is the nine use cases, in the spec's order
PASS  finale-02-mock-interview-two: every entry is an ordinary code level of an earlier chapter
PASS  finale-02-mock-interview-two: exactly three follow-up questions in each of the nine entries
PASS  finale-02-mock-interview-two: each question has 3 or 4 options and one correct answer that is among them
PASS  finale-02-mock-interview-two: every explanation names its level or its docs page
PASS  finale-02-mock-interview-two: the right answer is not always in the same place (positions used: 0,1,2,3)
PASS  finale-02-mock-interview-two: no teach, verify, solutions or show_me (the engine takes them from the draw)
PASS  finale-02-mock-interview-two: reward 150 XP and the badge "Mock two"
PASS  finale-02-mock-interview-two: 3 hints, pattern-agnostic
PASS  finale-02-mock-interview-two: the brainstorm has a not-redis option
PASS  finale-02-mock-interview-two: a one-line placeholder task
PASS  finale-03-mock-interview-three: a code level with an interview pool
PASS  finale-03-mock-interview-three: 15 minutes
PASS  finale-03-mock-interview-three: hints cost 20 XP, blank_start true
PASS  finale-03-mock-interview-three: a pool, not a rebuild_of
PASS  finale-03-mock-interview-three: the pool is the nine use cases, in the spec's order
PASS  finale-03-mock-interview-three: every entry is an ordinary code level of an earlier chapter
PASS  finale-03-mock-interview-three: exactly three follow-up questions in each of the nine entries
PASS  finale-03-mock-interview-three: each question has 3 or 4 options and one correct answer that is among them
PASS  finale-03-mock-interview-three: every explanation names its level or its docs page
PASS  finale-03-mock-interview-three: the right answer is not always in the same place (positions used: 0,1,2,3)
PASS  finale-03-mock-interview-three: no teach, verify, solutions or show_me (the engine takes them from the draw)
PASS  finale-03-mock-interview-three: reward 150 XP and the badge "Panel round"
PASS  finale-03-mock-interview-three: 3 hints, pattern-agnostic
PASS  finale-03-mock-interview-three: the brainstorm has a not-redis option
PASS  finale-03-mock-interview-three: a one-line placeholder task
PASS  levels 01 and 02 ask the same questions (the draw never gives the same use case twice)
PASS  level 03 has the same options and answers as 01, in a different voice
PASS  level 03: all 27 questions are asked by Mukul
PASS  levels 01 and 02: none of the questions is in Mukul's voice
PASS  level 03 story: Mukul is on the panel, as an intern
PASS  level 01 story: the alumni interviewer, and where the earlier file goes
PASS  level 02 story: where the earlier file goes
PASS  level 03 story: where the earlier file goes
PASS  cache-aside: Redis restarts empty -> it refills from Postgres, slower for a while
PASS  cache-aside: two app servers -> nothing changes, the cache is shared
PASS  cache-aside: one player on every screen -> a local copy or client-side caching
PASS  token bucket: Redis unreachable -> a per-limiter decision, the answer of level 3.5
PASS  token bucket: why Lua -> atomic read, decide, write
PASS  token bucket: clocks differ -> the script takes time from the caller, and what that costs
PASS  no stray Mukul in the calm pool
PASS  the engine's draw (chooseDraw) over the real pools: 300 sample players each got three different use cases from the nine
PASS  the first interviewer's pick varies between players (9 of the nine seen over 300 players)
PASS  04: a decision level with fifteen quizzes
PASS  04: four options in every quiz
PASS  04: every quiz has its own qNN-not-redis option
PASS  04: one correct answer per quiz
PASS  04: 4 statements whose right answer is not Redis (at least four)
PASS  04: the eleven structure answers are bitmap, HyperLogLog, cuckoo, Top-K, geo, stream with groups, lock, token bucket, pub/sub with presence, sorted set, cache-aside
PASS  04: the last four statements are the not-Redis ones
PASS  04: statement 12 is the 200 GB audit log kept seven years
PASS  04: statement 13 is the report that joins five tables once a night
PASS  04: statement 14 is the 50 MB file
PASS  04: statement 15 is the counter that must be exact and is read once a day
PASS  04: the right answer is not always in the same place (positions 0,1,2,3)
PASS  04: the reference lists every correct id, in order
PASS  04: exactly one wrong entry per quiz
PASS  04: every wrong entry is a wrong option with a teaching because
PASS  04: every explanation names its level, its page, or says it is reasoning
PASS  04: the story and the teach say the answers are reasoned, not docs quotations
PASS  04 graded by the engine: the reference passes all fifteen
PASS  04 graded by the engine: an empty answer fails every quiz
PASS  04 graded by the engine: wrong entry q01-hash fails quiz 1
PASS  04 graded by the engine: wrong entry q02-set fails quiz 2
PASS  04 graded by the engine: wrong entry q03-bloom fails quiz 3
PASS  04 graded by the engine: wrong entry q04-cms fails quiz 4
PASS  04 graded by the engine: wrong entry q05-hash fails quiz 5
PASS  04 graded by the engine: wrong entry q06-pubsub fails quiz 6
PASS  04 graded by the engine: wrong entry q07-get-set fails quiz 7
PASS  04 graded by the engine: wrong entry q08-fixed fails quiz 8
PASS  04 graded by the engine: wrong entry q09-stream fails quiz 9
PASS  04 graded by the engine: wrong entry q10-topk fails quiz 10
PASS  04 graded by the engine: wrong entry q11-forever fails quiz 11
PASS  04 graded by the engine: wrong entry q12-ts fails quiz 12
PASS  04 graded by the engine: wrong entry q13-hashes fails quiz 13
PASS  04 graded by the engine: wrong entry q14-string fails quiz 14
PASS  04 graded by the engine: wrong entry q15-incr fails quiz 15
PASS  05: a decision level with six quizzes
PASS  05: four options and one correct answer in every quiz
PASS  05: the six are Memcached, Kafka, SKIP LOCKED, an in-process Map, a CDN, and both
PASS  05: every explanation says it is reasoning
PASS  05: the Kafka answer uses the digest's own comparison (groups balance on one key, partitions are N keys)
PASS  05: answers about products the docs do not cover say so
PASS  05: the story and teach name the answers as reasoning
PASS  05: the reference lists every correct id
PASS  05: exactly one wrong entry per quiz
PASS  05: the right answer is not always in the same place
PASS  05 graded by the engine: the reference passes all six
PASS  05 graded by the engine: wrong entry n1-redis-always fails quiz 1
PASS  05 graded by the engine: wrong entry n2-redis-forever fails quiz 2
PASS  05 graded by the engine: wrong entry n3-redis-always fails quiz 3
PASS  05 graded by the engine: wrong entry n4-only-map fails quiz 4
PASS  05 graded by the engine: wrong entry n5-cdn-all fails quiz 5
PASS  05 graded by the engine: wrong entry n6-redis-only fails quiz 6
PASS  06: a decision level with three quizzes
PASS  06 quiz 1: the planted set is c-no-ttl, c-check-then-set, c-swallow, c-wrap-pg, c-no-negative
PASS  06 quiz 1: 5 planted mistakes (four to six)
PASS  06 quiz 1: 9 options (seven to nine)
PASS  06 quiz 1: at least three fine lines described as problems
PASS  06 quiz 1: the explanation names the levels where the mistakes were the lesson (2.2, 4b.4, 2.4, 2.10, 2.5, 5.13)
PASS  06 quiz 1: the explanation also says why the fine lines are fine
PASS  06 quiz 1 graded by the engine: the planted set passes
PASS  06 quiz 1 graded by the engine: ticking every option fails
PASS  06 quiz 1 graded by the engine: ticking nothing fails
PASS  06 quiz 1 graded by the engine: missing one planted mistake fails
PASS  06 quiz 2: the planted set is w-keys, w-client-per-job, w-blpop-shared, w-rpop-claim
PASS  06 quiz 2: 4 planted mistakes (four to six)
PASS  06 quiz 2: 8 options (seven to nine)
PASS  06 quiz 2: at least three fine lines described as problems
PASS  06 quiz 2: the explanation names the levels where the mistakes were the lesson (4b.3, 4b.6, 4.7, 5.13, 4b.2)
PASS  06 quiz 2: the explanation also says why the fine lines are fine
PASS  06 quiz 2 graded by the engine: the planted set passes
PASS  06 quiz 2 graded by the engine: ticking every option fails
PASS  06 quiz 2 graded by the engine: ticking nothing fails
PASS  06 quiz 2 graded by the engine: missing one planted mistake fails
PASS  06 quiz 3: the planted set is l-set-expire, l-constant-value, l-plain-del, l-no-timeout
PASS  06 quiz 3: 4 planted mistakes (four to six)
PASS  06 quiz 3: 8 options (seven to nine)
PASS  06 quiz 3: at least three fine lines described as problems
PASS  06 quiz 3: the explanation names the levels where the mistakes were the lesson (4.10, 4.11, 4b.6)
PASS  06 quiz 3: the explanation also says why the fine lines are fine
PASS  06 quiz 3 graded by the engine: the planted set passes
PASS  06 quiz 3 graded by the engine: ticking every option fails
PASS  06 quiz 3 graded by the engine: ticking nothing fails
PASS  06 quiz 3 graded by the engine: missing one planted mistake fails
PASS  06: the reference lists every planted id
PASS  06: one wrong entry per quiz
PASS  06: wrong entry c-hit-test is a fine line of quiz 1
PASS  06 graded by the engine: ticking c-hit-test fails quiz 1
PASS  06: wrong entry w-sadd-twice is a fine line of quiz 2
PASS  06 graded by the engine: ticking w-sadd-twice fails quiz 2
PASS  06: wrong entry l-read-inside is a fine line of quiz 3
PASS  06 graded by the engine: ticking l-read-inside fails quiz 3
PASS  06: the teach holds three fenced JavaScript files
PASS  06: workspace/review/cache.js is shown, in order, with its path as the first comment
PASS  06: workspace/review/cache.js parses as JavaScript
PASS  06: workspace/review/worker.js is shown, in order, with its path as the first comment
PASS  06: workspace/review/worker.js parses as JavaScript
PASS  06: workspace/review/lock.js is shown, in order, with its path as the first comment
PASS  06: workspace/review/lock.js parses as JavaScript
PASS  06 cache.js: the hash is written with no expiry
PASS  06 cache.js: the lock is a get then a set, with no NX
PASS  06 cache.js: one catch returns null and the try covers the Postgres query
PASS  06 cache.js: an unknown id returns null and caches nothing
PASS  06 worker.js: KEYS 'user:*' inside the loop
PASS  06 worker.js: a new client per job, never closed
PASS  06 worker.js: BLPOP on the shared client
PASS  06 worker.js: RPOP to claim
PASS  06 lock.js: SET NX then a separate EXPIRE
PASS  06 lock.js: released with a plain DEL, no token
PASS  06 lock.js: held across a Postgres call with no bound
PASS  07: an ops level
PASS  07: waits for the custom event portfolio_written, 120000 ms
PASS  07: two quizzes, four options and one correct answer each
PASS  07: the right interview framing has the number, the trade-off and the level
PASS  07: the right answer on what not to push names .env, credentials and customer data
PASS  07 graded by the engine: both quizzes pass with the right answers
PASS  07 graded by the engine: a weaker framing fails each quiz
PASS  07: show_me is cache_stats with no keys
PASS  07: reward 80 XP
PASS  07: the task has the button or curl, the git commands, and says the push is not graded
PASS  07: solutions are 07-reference.sh and 07-wrong-no-page.sh (wrong)
PASS  07: the reference makes the page, then runs git init, add and commit
PASS  07: the wrong solution is git only, no portfolio call (the event never fires)
PASS  01-mock-interview-one.yaml: no real cricketer or franchise from the denylist
PASS  01-mock-interview-one.yaml: no bet, stake, payout, cash or IPL
PASS  01-mock-interview-one.yaml: no AI, vector or LLM content
PASS  01-mock-interview-one.yaml: no build task id in learner-facing text
PASS  02-mock-interview-two.yaml: no real cricketer or franchise from the denylist
PASS  02-mock-interview-two.yaml: no bet, stake, payout, cash or IPL
PASS  02-mock-interview-two.yaml: no AI, vector or LLM content
PASS  02-mock-interview-two.yaml: no build task id in learner-facing text
PASS  03-mock-interview-three.yaml: no real cricketer or franchise from the denylist
PASS  03-mock-interview-three.yaml: no bet, stake, payout, cash or IPL
PASS  03-mock-interview-three.yaml: no AI, vector or LLM content
PASS  03-mock-interview-three.yaml: no build task id in learner-facing text
PASS  04-the-gauntlet.yaml: no real cricketer or franchise from the denylist
PASS  04-the-gauntlet.yaml: no bet, stake, payout, cash or IPL
PASS  04-the-gauntlet.yaml: no AI, vector or LLM content
PASS  04-the-gauntlet.yaml: no build task id in learner-facing text
PASS  05-the-neighbours.yaml: no real cricketer or franchise from the denylist
PASS  05-the-neighbours.yaml: no bet, stake, payout, cash or IPL
PASS  05-the-neighbours.yaml: no AI, vector or LLM content
PASS  05-the-neighbours.yaml: no build task id in learner-facing text
PASS  06-the-code-review.yaml: no real cricketer or franchise from the denylist
PASS  06-the-code-review.yaml: no bet, stake, payout, cash or IPL
PASS  06-the-code-review.yaml: no AI, vector or LLM content
PASS  06-the-code-review.yaml: no build task id in learner-facing text
PASS  07-your-story.yaml: no real cricketer or franchise from the denylist
PASS  07-your-story.yaml: no bet, stake, payout, cash or IPL
PASS  07-your-story.yaml: no AI, vector or LLM content
PASS  07-your-story.yaml: no build task id in learner-facing text
PASS  chapter.yaml: no real cricketer or franchise from the denylist
PASS  chapter.yaml: no bet, stake, payout, cash or IPL
PASS  chapter.yaml: no AI, vector or LLM content
PASS  chapter.yaml: no build task id in learner-facing text

== local proof
NOTE  pool levels 01 to 03 have no verifiers or solutions of their own: the engine takes them from the drawn level,
      so there is nothing to run for them here (their nine drawn levels are proven by the checks of Chapters 2 to 4).
NOTE  04 to 06 were graded above through the engine's own quiz grader, statically (no Docker).
NOTE  07's solutions are .sh files: the grading harness skips them unless --run-ops, which would git init the real workspace.
      Level 07 is graded by hand once per release: press 'Write my story' (or the curl), then Verify; then the wrong script must fail.

CF OK
```
