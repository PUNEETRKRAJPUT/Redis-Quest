# CF: the Finale, "The architect" (7 levels)

> **Binding facts.** `docs/handoffs/E-04.md` (the `interview.pool` form, `blank_start`, the draw rule, the pool
> level payload, the follow-up questions, the portfolio route and the `portfolio_written` event, the harness
> rules) is binding and exists before you start. Also `docs/handoffs/F-12.md`, `E-01.md`, `E-02.md`, `E-03.md`,
> `docs/grading.md`, `levels/README.md`. Pool levels have **no `verify` and no `solutions`** of their own; every
> other level follows the usual rules. E-04 as built: a pool level's `task` is still required by the schema but
> never shown (write one placeholder line such as "The interviewer picks when you start."); `blank_start` defaults
> to true for pool levels; the payload takes `task`, `show_me`, `docs`, `scenario` and `slots` from the draw and the
> verifiers are the draw's followed by the entry's questions; the draw is `sha256(player.id:level id)` over the
> entries not yet drawn by that player; backups are `<file>.before-<pool level id>`; the portfolio route is
> `POST /api/portfolio/write` (event `portfolio_written { bytes, levels, passed }`) and the UI button is on "What you
> built" ("Write my story").

**Goal.** Placement season. Three mock interviews, each a blank-file rebuild of a use case the interviewer picks
from the nine the learner has built, with follow-up questions in the interviewer's voice; the gauntlet of
fifteen problem statements where the answer is a structure, a pattern or "not Redis"; the neighbours; a pull
request with planted mistakes; and the learner's own story, written by the game from their save and workspace.

**Depends on.** E-04 (merged), C5 (tone).

**Files owned.** `levels/finale/` (canonical directory name; `id: finale`, `title: "The architect"`),
`scripts/check/CF.sh`, `docs/handoffs/CF.md`.

**Must not touch.** engine, app, runner, ui, packages, docker files, scenarios, other chapters, other scripts.

**Source of truth.** The digest for every Redis fact; the nine earlier levels for the pool (their ids, keys and
what they verify); `fiction/cast.json` (an alumni interviewer appears in Chapter 2's interview level: reuse that
voice; no new real names); `levels/ch2-everyone-showed-up/11-interview-cache-aside.yaml` for the interview tone.
The gauntlet and the neighbours are reasoned model answers: say so in the levels, name the docs page where one
exists, and never present a judgement as a docs fact.

**The chapter.** `id: finale`, incident thread (a Monday morning, 09:00 to 09:30): Harry Bhaiya has set up the
interview loop with the alumni network; Teja is pacing; the interviewer opens a laptop; Mukul, now interning at
the same company, is on the panel.

**Levels.** Files `01` to `07`.

| file | id | mode | binding |
|---|---|---|---|
| 01 | `finale-01-mock-interview-one` | code | `interview: { minutes: 20, hint_xp_cost: 20, blank_start: true, pool: [...] }` with all nine use cases: `ch2-02-cache-aside-v1`, `ch2-07-fixtures-must-never-miss`, `ch2-08-otp-login-properly`, `ch3-03-token-bucket`, `ch3-06-the-real-leaderboard`, `ch3-10-the-ticker`, `ch4-03-a-worker-died`, `ch4-07-the-job-queue`, `ch4-16-the-ops-wall`. Each pool entry carries **three follow-up questions** specific to that pattern, in the interviewer's voice, with correct answers that follow from the levels and the digest (examples: cache-aside: "Redis restarts and comes back empty. What happens to your page?" → it refills from Postgres on the next misses, slower for a while; "Two app servers now." → nothing changes, the cache is shared; "One player is on every screen." → a local memo or client-side caching in front, as in 4b and 5. Token bucket: "Redis is unreachable for ten seconds." → fail closed or open is a product decision; the level's answer from 3.5; "Why Lua and not two commands?" → atomic read-decide-write; "Clocks differ between app servers." → the script takes the time as an argument from the caller; say what that costs). Story: the first interviewer; brainstorm about how to start a blank file; hints pattern-agnostic ("name the keys first", "write the happy path, then the failure"). Reward XP 150, badge. No `teach`, no `verify`, no `solutions`, no `show_me` (E-04 takes them from the draw). |
| 02 | `finale-02-mock-interview-two` | code | same pool, minutes 20, a second interviewer (the draw excludes level 01's use case). |
| 03 | `finale-03-mock-interview-three` | code | same pool, minutes 15, the panel round (Mukul asks the follow-ups). |
| 04 | `finale-04-the-gauntlet` | decision | fifteen quizzes, one problem statement each, four options each: the structure or pattern, or "not Redis" (the `not-redis` option id per quiz, e.g. `q01-not-redis`), one line of model reasoning in `explanation`. At least four statements where the right answer is not Redis (a 200 GB audit log kept for seven years; a report that joins five tables once a night; a 50 MB file; a counter that must never be approximate and is read once a day) and eleven across the chapters' structures and patterns (streak → bitmap, unique visitors → HyperLogLog, "is this coupon used" with deletes → cuckoo, trending players → top-k, nearest stadium → geo, per-ball log replayed by analytics → stream with groups, one winner for the last slot → lock, OTPs per user → token bucket, who is online → pub/sub with presence, leaderboard with ties → zset, hot read of a slow query → cache-aside). Reference lists every correct id; one wrong entry per quiz. |
| 05 | `finale-05-the-neighbours` | decision | six quizzes: Redis vs Memcached (a plain cache with no structures or persistence), vs Kafka for the ball stream (the digest's own comparison: groups are server-side balancing on one key; partitions are N keys; retention), vs Postgres `SKIP LOCKED` for the job queue (one system fewer; at what scale the list queue earns its place), vs an in-process LRU for a tiny hot set (no network hop, per-instance, no invalidation), vs a CDN for static pages, and "when the honest answer is both" (Postgres as the truth, Redis as the accelerator, which the whole game has been). Reasoned model answers, named as reasoning. |
| 06 | `finale-06-the-code-review` | decision | The teach is a pull request: three files in fenced code, written as a hurried teammate would (`workspace/review/cache.js`: cache-aside with no TTL, check-then-set instead of `SET NX`, swallowing every error so a Redis outage returns `null` as "player not found"; `workspace/review/worker.js`: `KEYS user:*` in a loop, a new client per job never closed, `BLPOP` on the shared client, `RPOP` to claim; `workspace/review/lock.js`: a lock acquired with `SET` then `EXPIRE` as two commands, released with plain `DEL`, no token, held across a Postgres call with no bound). Three multi-select quizzes (one per file, `correct` a list): "tick every problem" with 7 to 9 options each of which 4 to 6 are planted (the rest are fine lines described as problems, so guessing fails). Explanations name the level where each mistake was the lesson. Reference lists all correct ids; wrong entries pick one plausible-but-fine option per quiz. |
| 07 | `finale-07-your-story` | ops | Task: press "Write my story" on the What you built page (or `curl -s -X POST localhost:3000/api/portfolio/write`), open `workspace/PORTFOLIO.md`, read it, then make `workspace/` a repository of their own: `cd workspace && git init && git add . && git commit -m "Redis Quest: what I built"` and push it wherever they keep their code (the game cannot see the push and does not grade it). Verify: `event custom portfolio_written` `timeoutMs: 120000`; `quiz` what to say in an interview about it (numbers from the page, trade-offs chosen, which level each came from) with one correct and three weaker framings; `quiz` what not to put in the repository (`.env`, credentials, customer data: the game has none, but the habit). Solutions: `07-reference.sh` (the curl and the git commands), `07-wrong-no-page.sh` (git only, no portfolio: the event never fires). show_me `cache_stats` `[]`. |

Every level: story in the interview-day voice, brainstorm with `not-redis` where it fits (04 to 06 can use a
brainstorm about approach), hints, docs links where a docs page exists, reward XP (pool levels 150, 04 100, 05 60,
06 120, 07 80), every wrong solution or wrong option with a `because` or an explanation that teaches.

**Check.** `scripts/check/CF.sh` in the shape of `scripts/check/C5.sh`: validate `levels/finale` together with
the chapters its pools reference (pass the whole `levels/` tree to `levels:validate`, as F-12 requires for
`rebuild_of` across chapters, and assert 7 finale levels); chapter order; every pool `rebuild_of` is one of the
nine; every pool entry has exactly three questions; the decision levels' reference ids and wrong options are
consistent; 06's quizzes are multi-select with the planted sets; 07's solutions exist and parse; the local proof
has nothing to run for pool levels (say so) and runs the decision levels statically. Exit 0, print each thing
verified.

**Handoff.** `docs/handoffs/CF.md`: the pool table with the nine use cases and their follow-up questions,
the gauntlet's fifteen statements with answers, the planted mistakes per file, and the check output.

**Model.** sonnet
