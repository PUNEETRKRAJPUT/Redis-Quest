# C4b: Chapter 4b, "On call" (6 diagnose-first levels and a checklist)

> **Binding facts.** `docs/handoffs/A-04.md` (the planted faults, slot table, routes, measurements) and
> `docs/handoffs/E-02.md` (on-demand traffic route and button, `load_finished` / `redis_busy` / `script_killed`
> events, `redis_per_request_lte`, `notContains`, the CLI's behaviour during a long script, harness rules) are
> binding; both exist before you start. Also `docs/handoffs/E-01.md` (switch, events), `docs/handoffs/P0-09.md`,
> `docs/grading.md`, `levels/README.md`. Reply shapes as in C4 (maps flattened; `equals` on lists; `contains`,
> `notContains`, `oneOf`, `matches` on strings).
>
> Measured by A-04 (quote as "on this stack"): the recompute route answers 500 after about 2 s (the learner client's
> timeout) while the script keeps running in Redis; `PING` from the terminal answers `BUSY` at about 5 s; `SCRIPT KILL`
> answers `OK` and the killed `EVAL` ends with `ERR Script killed by user with SCRIPT KILL`; other app routes keep
> answering during the freeze; `connected_clients` went from 9 to 208 under 200 parallel team lookups and back to 6
> after `docker compose restart app`; a 300,000-field hash is 16.1 MiB, encoding `hashtable`; the Lua loop is bounded by
> `os.clock()` (CPU time; `TIME` is frozen inside a script on this server, so do not teach a `TIME`-based deadline).

**Goal.** The chapter that teaches the job, not a command: Redis is slow or full or frozen at 2 am, the code is
already written, and the learner must find out *which* of the classic faults it is before changing anything.
Every level has three beats: observe under traffic with the diagnostic tools, name it (a quiz the level will not
let them skip), then fix it in the slot and prove the symptom is gone. The chapter closes with the on-call checklist.

**Depends on.** E-02, A-04 (both merged), C4 (tone).

**Files owned.** `levels/ch4b-on-call/` (new; `chapter.yaml` with `id: ch4b`, the canonical directory name is
`ch4b-on-call`), `scenarios/celebrity-100.yaml`, `scenarios/oncall-views-100.yaml`, `scenarios/oncall-teams-100.yaml`,
`scripts/check/C4b.sh`, `docs/handoffs/C4b.md`.

**Must not touch.** engine, app, runner, ui, packages, docker files, other chapters, other scripts.

**Source of truth.** `docs/redis-docs-digest.md` (programmability: `busy-reply-threshold` and `SCRIPT KILL`;
memory-optimization: encodings and listpack limits; admin: `LATENCY DOCTOR`, `MEMORY DOCTOR`; client-side caching;
node-redis guide: one shared client, `duplicate()` only for blocking and subscribe; keyspace page for `SCAN` vs
`KEYS`), the cast and tone of Chapters 3 and 4. The diagnostic commands this chapter uses (`INFO commandstats`,
`INFO keyspace`, `INFO clients`, `INFO memory`, `SLOWLOG GET`, `SLOWLOG RESET`, `CLIENT LIST`, `MEMORY USAGE`,
`OBJECT ENCODING`, `HLEN`, `redis-cli --bigkeys`) are standard Redis commands: use them, measure what they print on
this stack, and list everything you state about them that the digest does not under "not in the digest". No invented
numbers; where a level quotes a size or a time, it is one you measured and the text says "on this stack".

**The chapter.** `title: "On call"`, incident thread (02:05 to 02:20): the pager (Teja's phone) goes off during
the semi-final night, Harry Bhaiya is asleep, Mukul is awake, and each level is one page. Story beats are short.

**Keys and routes** (from A-04): `oncall:user:<i>` seeded keys, `view:<userId>:<matchId>`, `badges:fifties`,
`team:<id>` hashes, `fans:t-01` the big hash, `cache:player:p-028`. Routes: `GET /app/oncall/users/count?prefix=`,
`POST /app/oncall/views`, `POST /app/oncall/ttl-sweep`, `POST /app/oncall/badges/recompute`,
`GET /app/oncall/teams/:id`, `POST /app/oncall/split`, `GET /app/oncall/status`. Traffic: the level's `scenario:`
field plus the "Run traffic" button (E-02); `event custom load_finished` with `match: { scenario: <id> }` proves
they ran it.

**Levels.** Files `01` to `07`.

| file | id | mode | binding |
|---|---|---|---|
| 01 | `ch4b-01-one-celebrity-player` | code | `scenario: celebrity-100` (100 connections, 10 s, every request `GET /app/players/p-028/stats`; no warmup). Story: the semi-final's star batter, every phone opens his page. Task: turn on "Run my code in the app" with the Chapter 2 cache in `workspace/ch2/cache.js` (the level's own reference is self-contained: cache-aside plus the fix, so a learner without the file still has a path), press "Run traffic", then in the terminal `INFO commandstats` (the `hgetall` calls climb with every request), `INFO stats` (`instantaneous_ops_per_sec`), and the Metrics panel's redis commands line; name it (quiz: hot key); fix: a short in-process memo in front of Redis for the stats hash (a `Map` keyed by player id with a 1 s expiry, which the teach presents as the local-cache answer the client-side caching page describes, and names node-redis's `clientSideCache` as the built-in form; `RESP: 3` is required for that and the game's client does not enable it, so the memo is the exercise). Fixture `01-cold.yaml` deletes `cache:player:p-028`. Verify: `quiz` name it (hot key; distractors big key, slow command, connection leak); `behavior` on `cache.getPlayerStats` (`p-028` twice → second call returns the same player; sideEffect the hash exists); `traffic` `celebrity-100`, `baseline: false`, `redis_per_request_lte: 0.2`, `error_rate_lte: 0`, `p99_ms_lte: 100`; `event custom load_finished match { scenario: celebrity-100 }` with `timeoutMs: 60000` (they ran the traffic to see the symptom; the harness runs it). show_me `cache_stats` `[]`. Solutions: reference (cache-aside + memo); `01-wrong-plain-cache.js` (Chapter 2's cache: one HGETALL per request, redis per request ≈ 1 → traffic fails); `01-wrong-memo-forever.js` (memo with no expiry → antipattern? not observable in a run; make it `wrong` through a behavior that updates the hash between two calls and expects the second call to notice within... no: declare only the two). |
| 02 | `ch4b-02-one-hash-with-three-lakh-fields` | code | `setup`: one `EVAL` that builds `fans:t-01` with 300,000 fields (`u<i>` → `1`), deletes `fans:t-01:*` buckets (a Lua loop over `KEYS 'fans:t-01:*'`), `CONFIG RESETSTAT`. Task: `MEMORY USAGE fans:t-01`, `OBJECT ENCODING fans:t-01` (hashtable, past `hash-max-listpack-entries 512`: digest), `HLEN`, and from their own terminal `docker compose exec redis redis-cli --bigkeys`; name it; fix: slot `oncall.splitBigKey (deps, key, buckets)` with `HSCAN COUNT 1000`, pipelined `HSET <key>:<n>`, then `UNLINK` (teach `UNLINK` vs `DEL`: UNLINK frees in the background; a big `DEL` blocks; keep the claim to what the digest or your measurement supports). Verify: `quiz` name it; `behavior` `splitBigKey("fans:t-01", 64)` → `expect: { fields: 300000, buckets: 64 }`, sideEffects `EXISTS fans:t-01` 0, `EVAL_RO` summing `HLEN fans:t-01:<0..63>` equals 300000, `OBJECT ENCODING fans:t-01:0` (listpack or hashtable: do not assert, just show in teach); `redis` `INFO commandstats` `matches: cmdstat_unlink:calls=[1-9]`. show_me `hash_card` `["fans:t-01:0"]`. Solutions: reference; `02-wrong-del.js` (same split but `DEL`: the unlink check fails); `02-wrong-hgetall.js` (`HGETALL` the whole hash into memory then writes: works at 300k on this stack, so declare it `works_but_wrong` only if an antipattern can see it: it cannot; drop it, keep two). |
| 03 | `ch4b-03-a-cron-runs-keys` | code | `setup`: one `EVAL` seeding `oncall:user:1..500000` strings (A-04 measured `KEYS` over 200,000 keys at only 18 to 23 ms on this Mac, barely over the 10 ms slowlog threshold; half a million makes the symptom unmistakable; measure the EVAL's own time and keep it under two seconds), `SLOWLOG RESET`, `CONFIG SET latency-monitor-threshold 10`. Task: hit `curl 'localhost:3000/app/oncall/users/count?prefix=oncall:user:'` three times (the "cron"), then `SLOWLOG GET 5` (the `keys` entries and their microseconds), `LATENCY LATEST` (command events), `LATENCY DOCTOR`; name it; fix: slot `oncall.countUsers (deps, prefix)` with `SCAN 0 MATCH <prefix>* COUNT 1000` iterated to cursor 0 (node-redis `scanIterator` is fine). Fixture `03-reset-stats.yaml`: `CONFIG RESETSTAT`, `SLOWLOG RESET`. Verify: `quiz`; `behavior` `countUsers("oncall:user:")` → `expect: 500000`; `redis` `INFO commandstats` `notContains: cmdstat_keys` (the fix never calls KEYS); `redis` `INFO commandstats` `matches: cmdstat_scan:calls=[1-9]`. show_me `cache_stats` `[]`. Solutions: reference; `03-wrong-keys.js` (A-04's baseline: KEYS). |
| 04 | `ch4b-04-memory-grows-every-day` | code | `scenario: oncall-views-100` (100 connections, 8 s, `POST /app/oncall/views` with `{ userId: "{user}", matchId: "m-041" }`, users 20,000 uniform). `setup`: one `EVAL` seeding 5,000 `view:*` keys with no TTL. Task: "Run traffic", then `INFO keyspace` (`keys=` climbing, `expires=` not), `INFO memory` (`used_memory_human`), `docker compose exec redis redis-cli --bigkeys` or `--memkeys`; name it; fix: bundle `oncall.recordView (deps, userId, matchId)` with `SET ... EX 86400` and `oncall.addTtls (deps, pattern, seconds)` (SCAN + pipelined `EXPIRE`, only keys with TTL -1) to repair what is already there. Fixture `04-seed-views.yaml` seeds 1,000 `view:*` keys without TTL and deletes `view:u-000010:m-041`. Verify: `quiz`; `behavior` `recordView("u-000010", "m-041")` sideEffect `TTL view:u-000010:m-041 between [1, 86400]`; `behavior` `addTtls("view:*", 86400)` → `expect: 1001` (the thousand plus the one just written? no: that one has a TTL already, so 1000) → `expect: 1000`, sideEffect `EVAL_RO` counting `view:*` keys whose `TTL` is -1 equals 0; `event custom load_finished match { scenario: oncall-views-100 }` `timeoutMs: 60000`. show_me `ttl_timer` `["view:u-000010:m-041"]`. Solutions: reference bundle; `04-wrong-no-ttl.js` (A-04's baseline recordView plus an addTtls that returns 0); `04-works-but-wrong-sweep-only.js` (repairs old keys but recordView still writes without TTL: the recordView behavior's TTL check must then be an antipattern (healthy TTL) so this grades works_but_wrong; follow the 2.2 rule). |
| 05 | `ch4b-05-everything-froze` | code | Task, in order: (1) `curl -X POST localhost:3000/app/oncall/badges/recompute` in their own terminal (the nightly badge job, as written); (2) in the game terminal, `PING`: it hangs, then answers `BUSY ...` after five seconds (E-02 measured the exact behaviour; quote it); `SLOWLOG GET 3` later shows the `eval`; (3) `SCRIPT KILL`; (4) `CONFIG GET busy-reply-threshold`. Name it. **Kill the script before pressing Verify or Start**: E-02 measured that
while the script runs, `POST /api/levels/:id/start` answers 500 and a verify reports `BUSY` on every check (and counts as an
attempt); the task and the hints must say so plainly. Fix: slot `oncall.recomputeBadges (deps)` that does the work in batches from JavaScript with no `EVAL`: for every `lb:match:*` zset (`SCAN MATCH lb:match:* COUNT 100`), `ZCOUNT key 50 +inf` into `HSET badges:fifties <matchId> <n>`, pipelined. Fixture `05-two-matches.yaml`: `DEL badges:fifties`, two zsets `lb:match:m-901` and `lb:match:m-902` with known scores, `CONFIG RESETSTAT`. Verify: `event custom redis_busy` `timeoutMs: 300000` (sticky since level start); `event custom script_killed` `timeoutMs: 300000`; `quiz` name it and the digest's facts (a script blocks everything; `busy-reply-threshold` 5 s; `SCRIPT KILL` only before a write; `SHUTDOWN NOSAVE` otherwise); `behavior` `recomputeBadges()` sideEffects `HGET badges:fifties m-901` equals the count you seeded, `HGET ... m-902` likewise; `redis` `INFO commandstats` `notContains: cmdstat_eval`. show_me `hash_card` `["badges:fifties"]`. Solutions: reference; `05-wrong-lua-loop.js` (a bounded Lua that still loops over the zsets inside one EVAL: correct result, `cmdstat_eval` present → wrong by the redis check, and the teach says why: it works at two matches and freezes at two thousand); keep the harness's dance in mind (E-02 handoff). |
| 06 | `ch4b-06-connections-climbing` | code | `scenario: oncall-teams-100` (100 connections, 8 s, `GET /app/oncall/teams/{team}`, `team` from `t-01`..`t-08`). `setup` seeds `team:t-01..t-08` hashes (`id`, `name` from `fiction/teams.json`; copy the eight names). Task: "Run traffic", then `INFO clients` (`connected_clients`), `CLIENT LIST` (count the lines, note `cmd=hgetall` and the ages), `curl localhost:3000/app/oncall/status` (the leak count); name it; fix: slot `oncall.lookupTeam (deps, teamId)` using `deps.redis` (teach: one shared client per process, `duplicate()` only for blocking commands and subscriptions, from the node-redis guide in the digest); then `docker compose restart app` to drop the leaked connections, "Run traffic" again, and `INFO clients` stays flat. Verify: `quiz`; `behavior` `lookupTeam("t-01")` → `expect: { id: "t-01", name: "<name>" }`, unknown → `null`; `event custom load_finished match { scenario: oncall-teams-100 }` `timeoutMs: 60000`; `redis` `INFO clients` `matches: "connected_clients:([0-9]|[1-5][0-9])\\b"` (under 60 on this stack after the restart; measure what the stack holds idle: engine, app, runner, insight, the verifier's own connections; set the bound with margin and say the measured idle count in the task). show_me `cache_stats` `[]`. Solutions: reference; `06-wrong-client-per-call.js` (A-04's baseline: a new client per call; grade through the connection bound: the harness's traffic run with the wrong file active? The harness only activates slots during verify's traffic, and this level has none; so the wrong file must fail another way: its `duplicate()`+`connect()` per call through the learner client is closed by the app after the request, so connections do not leak there. Make the wrong file fail honestly: it returns the hash without the `id` field (reads only `name`), so the behavior expect fails; `because` says the real sin is the client per call, which the game's runner cannot leak on purpose). |
| 07 | `ch4b-07-the-on-call-checklist` | decision | Six quizzes mapping a symptom to the first command and the fix, one per level above, in interviewer wording ("Redis latency spiked at 2 am. What do you run first?"), plus one on what not to run on a busy production box (`KEYS *`, `DEBUG`, a long `MONITOR`, `FLUSHALL`). Reference lists every correct id; one wrong per quiz. |

Every level: story (short, the pager voice), brainstorm with a `not-redis` option, teach from the digest and
your measurements (none for 07), task with the exact commands, hints, show_me, docs links, reward XP 40 to 70,
every wrong solution with a `because`. Code levels keep `teach` focused on the diagnosis; the fix is one paragraph.

**Scenarios.** As named above; `celebrity-100` no warmup (the stampede is the point), seeds fixed.

**Check.** `scripts/check/C4b.sh` in the shape of `scripts/check/C4.sh`: validate with 7 levels; chapter order;
solutions, fixtures, bundle exports; the three scenarios parse with the engine's parser; the local proof with the
engine's evaluators against every `redis`, `behavior` and `antipattern` verifier of every solution (the throwaway
`redis:8` container on 6399 as C4; `MEMORY USAGE`, `OBJECT ENCODING`, `SLOWLOG`, `INFO` all exist there), printing
events and traffic as DEFER. Exit 0, print each thing verified.

**Handoff.** `docs/handoffs/C4b.md`: one line per level, measurements quoted in the levels (sizes, times, idle
connection count), the "not in the digest" list, what the engine or app made impossible, and the check output.

**Model.** sonnet
