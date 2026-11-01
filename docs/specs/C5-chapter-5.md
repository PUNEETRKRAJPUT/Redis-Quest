# C5: Chapter 5, "Survive and scale" (14 levels)

> **Binding facts.** `docs/handoffs/E-03.md` (target strings, the switcher, cluster routing, the
> `redis_target_changed` and `sentinel_failover` events and payloads, the measured failover timeline and the
> restore dance) and `docs/handoffs/A-05.md` (what the app and runner do on each target kind, the exact
> `READONLY` and `CROSSSLOT` texts, `deps.redisCached` and what it does not count) are binding; both exist before
> you start. Also `docs/handoffs/E-01.md`, `E-02.md`, `P0-09.md`, `docs/grading.md`, `levels/README.md`.
> Reply shapes as before (maps flattened; `equals` on lists; `contains`, `notContains`, `oneOf`, `matches`).
>
> Measured by E-03 and A-05 (quote as "on this stack"): events are `redis_target_changed { from, to, kind }` and
> `sentinel_failover { masterName, from, to }` (match them with `match: { name: ..., kind: cluster }` or
> `match: { name: ..., to: "redis://redis-replica:6379" }`); failover timeline after `docker compose stop redis`:
> engine down at 3.5 s, terminal `SET` works again at 6.6 s, the event at 7.3 s, `/api/target` shows
> `redis-replica:6379` at 7.5 s; the app's learner `SET` works again at about 7.7 s. `docker compose start redis`
> rejoins as a replica in about 11 s. **Failback:** wait at least 10 s after the rejoin before `docker compose stop
> redis-replica`, or Sentinel aborts with `no-good-slave` and retries 20 s later; the failback event came 7.7 s after
> the stop; then `docker compose start redis-replica`. On the cluster the engine routes keyless commands
> (`DBSIZE`, `KEYS`, `INFO`, `CLUSTER INFO`) to the master that owns slot 0, so a cluster level's fixtures and
> checks must name keys (no `KEYS`-based cleanup) and must keep every key of one check in one hash tag. Neither the
> cluster client nor the Sentinel client has `watch` (Chapter 3's join fails there with `conn.watch is not a
> function`; on Sentinel `redis.use(fn)` leases a connection): the hash-tag join reference is one Lua script with both
> keys in `KEYS[]` (`app/test/fixtures/contest-join-cluster.js`), and level 09's wrong solution is Chapter 3's file,
> which fails on the cluster before it ever reaches `CROSSSLOT`; say that in its `because`. Exact texts: replica `READONLY You can't write against a read only
> replica.`; cross-slot `CROSSSLOT Keys in request don't hash to the same slot`; a MULTI over two slots on different
> masters answers `MOVED <slot> <host>:6379` instead. `PUBLISH` on a cluster reports receivers per node (0 is normal).
> `deps.redisCached` works on all three kinds; its calls are not counted in `redisCommands`; `INFO commandstats`
> `cmdstat_hgetall` is the server-side truth (A-05: 2 server reads for 3 calls, the write invalidated the entry).

**Goal.** The final: Redis restarts mid-match and every point is gone, then one box is not enough, then the
rival finds the port. Persistence (RDB, AOF, both, backups), memory napkin math, client-side caching, a replica,
Sentinel failover, the cluster migration with its broken multi-key operations, ACLs, the doctors, managed Redis,
the production checklist earned over five chapters, and a blank rebuild where the learner chooses and configures.

**Depends on.** E-03, A-05 (merged), C4b (tone).

**Files owned.** `levels/ch5-survive/` (canonical directory name; `id: ch5`), `scripts/check/C5.sh`,
`docs/handoffs/C5.md`. Reuse `scenarios/celebrity-100.yaml` (no new scenarios unless a level needs one; then
own it and say so).

**Must not touch.** engine, app, runner, ui, packages, docker files, other chapters, other scripts.

**Source of truth.** `docs/redis-docs-digest.md` sections: persistence, replication, sentinel, cluster
(scaling), memory-optimization, ACL, admin (doctors, `CLIENT PAUSE`, zero-downtime order), client-side caching,
eviction, the node-redis guide, the FAQ (memory figures, if present: quote only what the digest holds). The
cast and tone of Chapters 3 to 4b. Measurements on this stack are allowed and labelled; no invented numbers.

**The chapter.** `title: "Survive and scale"`, incident thread (the final, 19:00 to 19:30): the roommate
restarted Redis "to fix a warning" and forty thousand teams' points vanished; Harry Bhaiya wants a second box
and then a third; Mukul found port 6379 from the hostel wifi.

**Targets** (E-03's strings, picked from the Terminal panel's target select or sent to `PUT /api/target`):
single `redis://redis:6379`, crash `redis://redis-nopersist:6379`, replica `redis://redis-replica:6379`,
sentinel `sentinel://mymaster@sentinel-1:26379,sentinel-2:26379,sentinel-3:26379`, cluster
`cluster://redis-c1:6379,redis-c2:6379,redis-c3:6379`. Profiles start from the learner's terminal:
`docker compose --profile crash up -d redis-nopersist`, `--profile replica up -d redis-replica`,
`--profile sentinel up -d sentinel-1 sentinel-2 sentinel-3`, `--profile cluster up -d redis-c1 redis-c2 redis-c3
redis-c4 redis-c5 redis-c6`. **Every level that leaves the single node ends with the way back** (the exact
commands, from E-03's measured dance for Sentinel), and says what happens to the game's save (the progress
file is the truth; the `game:*` mirror is rebuilt on every connect).

**Hand-graded levels.** Levels whose verify has `redis_target_changed` or `sentinel_failover` (01, 07, 08, 09)
are skipped by the harness and graded by the orchestrator on the default stack with the profiles; give those
levels `.sh` references that are the exact command list, and `redis` checks that are true only on the right target.

**Levels.** Files `01` to `14`.

| file | id | mode | binding |
|---|---|---|---|
| 01 | `ch5-01-the-crash` | ops | Task: start the crash profile, switch the target to `redis://redis-nopersist:6379`, "play an over" (`XADD match:final:balls * over 1 ball 1 runs 4` six times, `SET score:final 24`), confirm with `XLEN`, then `docker compose kill redis-nopersist` and `docker compose --profile crash up -d redis-nopersist`; back in the terminal `XLEN match:final:balls` is 0 and `GET score:final` is nil. Brainstorm what should have happened. Verify: `event custom redis_target_changed` `match: { kind: single }` with `timeoutMs: 120000` (or the exact `to` field E-03 defined), `event redis_disconnect`, `event redis_reconnect` (`timeoutMs: 300000`), `redis` `EXISTS match:final:balls` equals 0 (true on the restarted crash node; on the default node the key never existed either, so pair it with the events), `quiz` why (no `save`, no AOF). Ends with: switch back to `redis://redis:6379`. Solutions: `01-reference.sh`, `01-wrong-restart-only.sh` (restarts the single node, which persists: nothing is lost, no disconnect of the crash node... declare and explain). show_me `stream_log` `["match:final:balls"]`. |
| 02 | `ch5-02-snapshots` | cli | On the crash node again (task says so; the checks are target-agnostic): `CONFIG SET save "60 1000"`, `SET score:final 24`, `BGSAVE`, `LASTSAVE`, `INFO persistence` (`rdb_last_bgsave_status`, `rdb_changes_since_last_save`), `CONFIG GET dir` and `docker compose exec redis-nopersist ls -l /data` to see `dump.rdb`; kill and up again: `GET score:final` is back. Verify: `redis` `CONFIG GET save` `contains` `60 1000`; `INFO persistence` `matches` `rdb_last_bgsave_status:ok`; `LASTSAVE` `gte: 1` (or `matches` a digit); `quiz` what RDB can lose and the fork cost (digest). Solutions: reference `.redis`; `02-wrong-save-off.redis` (`CONFIG SET save ""`). show_me `kv_card` `["score:final"]`. |
| 03 | `ch5-03-the-log` | cli | `CONFIG SET appendonly yes` on the live server first (digest: enable by `CONFIG SET` before touching the file), `CONFIG GET appendfsync` (everysec), `BGREWRITEAOF`, `INFO persistence` `aof_enabled:1`, `aof_rewrite_in_progress`; then in their terminal `docker compose exec redis redis-benchmark -t set -n 20000 -q` with `appendfsync everysec` and again after `CONFIG SET appendfsync always`, and back to `everysec`. Quote your own measured numbers "on this stack". Verify: `redis` `CONFIG GET appendonly` `equals: [appendonly, yes]`; `INFO persistence` `matches` `aof_enabled:1`; `CONFIG GET appendfsync` `equals: [appendfsync, everysec]`; `quiz` always vs everysec vs no (digest). Solutions: reference; `03-wrong-fsync-no.redis` (leaves `appendfsync no`). |
| 04 | `ch5-04-both-and-backups` | decision | Quizzes from the persistence digest: both for Postgres-like safety; RDB alone when minutes of loss are fine; AOF alone discouraged; RDB files are safe to copy while running; an AOF copy during a rewrite can be invalid (set `auto-aof-rewrite-percentage 0`, check `aof_rewrite_in_progress`); on restart with both, AOF is used. One wrong per quiz. |
| 05 | `ch5-05-how-big-is-it-really` | cli | `setup` writes `player:p-028` as a 12-field hash (fixed values) and `big:hash` with 600 fields (one `EVAL`), `CONFIG RESETSTAT`. Task: `MEMORY USAGE player:p-028`, `OBJECT ENCODING player:p-028` (listpack: under `hash-max-listpack-entries 512`), `OBJECT ENCODING big:hash` (hashtable), `MEMORY USAGE big:hash`, `CONFIG GET hash-max-listpack-entries`, `UNLINK big:hash`; the napkin: bytes per player × 50,000,000. Verify: `answer` with `expected.cmd: [MEMORY, USAGE, player:p-028]` and `transform: number` (the learner types the bytes they saw; the harness types the live reply); `redis` `OBJECT ENCODING player:p-028` equals `listpack`; `EXISTS big:hash` equals 0; `INFO commandstats` `matches` `cmdstat_unlink`; `quiz` the memory-optimization facts (encodings convert past the limits; provision for peak; the "hash trick") and the digest's FAQ figures only if the digest states them (check; otherwise do not quote numbers). Solutions: reference; `05-wrong-del.redis` (`DEL`). show_me `hash_card` `["player:p-028"]`. |
| 06 | `ch5-06-the-celebrity-again` | code | `scenario: celebrity-100`. Slot `cache.getPlayerStats` built on `deps.redisCached` (A-05: a long-lived RESP3 client with client-side caching; its calls are not counted as Redis commands because a hit never reaches the server): cache-aside as in Chapter 2 but every Redis read through `deps.redisCached`, writes through `deps.redis`. Teach from the client-side caching digest: tracking, invalidation on write, the cache is flushed on disconnect, node-redis ≥ 5.1 and `RESP: 3`, which commands are never cached. Fixture clears `cache:player:p-028`. Verify: `behavior` (two calls return the player; the hash exists; TTL set); `traffic` `celebrity-100`, `baseline: false`, `redis_per_request_lte: 0.05`, `error_rate_lte: 0`, `p99_ms_lte: 100`; `quiz` what invalidates and what a disconnect does; the task tells them to confirm on the server with `CONFIG RESETSTAT`, run traffic, `INFO commandstats` (`cmdstat_hgetall` calls stay tiny). Solutions: reference; `06-wrong-plain-client.js` (Chapter 2's cache through `deps.redis`: one command per request). show_me `cache_stats` `[]`. |
| 07 | `ch5-07-a-second-box` | ops | Start the replica profile. On the single node: `INFO replication` (`connected_slaves:1`, `slave0:...`), `SET score:final 30`; switch the target to `redis://redis-replica:6379`: `GET score:final` (replicated), `SET score:final 31` → the `READONLY` error (A-05's exact text), `INFO replication` (`role:slave`, `master_link_status:up`); back on the master: `WAIT 1 1000` and the digest's point that it is not consistency; `CONFIG GET min-replicas-to-write`. The trap, as a quiz: a master without persistence that auto-restarts empties its replicas. Verify: `event custom redis_target_changed` `match: { to: "redis://redis-replica:6379" }` (or E-03's field) `timeoutMs: 120000`; `redis` `INFO replication` `matches` `connected_slaves:[1-9]` (true on the master with the replica attached: the level ends back on the master); `quiz`. Ends with the way back (target single; the replica may stay up for 08). Solutions: `07-reference.sh`, `07-wrong-no-replica.sh` (never starts the profile). |
| 08 | `ch5-08-who-decides-who-is-master` | ops | Sentinels up (replica still up). Switch the target to the sentinel string; `INFO replication` shows `role:master` on `redis`; `docker compose exec sentinel-1 redis-cli -p 26379 SENTINEL get-master-addr-by-name mymaster`; then `docker compose stop redis`; within E-03's measured time the game shows the failover (event), the terminal's `SET score:final 32` works on the new master, `/app/target` says the new master; `SENTINEL masters` shows it; `docker compose start redis` and watch it rejoin as a replica (`SENTINEL replicas mymaster`). The way back, exactly as E-03 measured: `docker compose stop redis-replica` → failover back to `redis` → `docker compose start redis-replica` → target `redis://redis:6379`. Verify: `event custom sentinel_failover` `timeoutMs: 300000`; `quiz` quorum vs majority, at least three sentinels, Docker/NAT caveat (digest); `redis` `INFO replication` `matches` `role:master` (through whichever master is current). Solutions: `08-reference.sh`, `08-wrong-one-sentinel.sh` (starts one sentinel: quorum 2 can never be reached; no failover; `because` says so). |
| 09 | `ch5-09-the-cluster-migration` | code | Cluster profile up; from the terminal `docker compose exec redis-c1 redis-cli --cluster create redis-c1:6379 redis-c2:6379 redis-c3:6379 redis-c4:6379 redis-c5:6379 redis-c6:6379 --cluster-replicas 1 --cluster-yes` (E-03's exact working command); switch the target to the cluster string; in the game terminal `CLUSTER INFO` (`cluster_state:ok`), `CLUSTER KEYSLOT wallet:u-000010`, `CLUSTER KEYSLOT contest:9001:entries` (different), `MSET a 1 b 2` → `CROSSSLOT` (A-05's text), `MSET {u:1}:a 1 {u:1}:b 2` → OK; then the code: `contest.join` as in Chapter 3 fails on the cluster because its MULTI touches two slots (the task has them run the Chapter 3 file first and read the error); fix with hash tags: `{wallet:<userId>}` and `{wallet:<userId>}:joins:<contestId>` (the per-contest count becomes a per-user record, and the teach says what that costs and how a contest-wide count is derived: a second step, not the same transaction). `SPUBLISH`/`SSUBSCRIBE` named for the ticker. Fixture: `SET {wallet:u-000010} 100`, `DEL {wallet:u-000010}:joins:9001`. Verify: `event custom redis_target_changed` `match: { kind: cluster }` `timeoutMs: 120000`; `redis` `CLUSTER INFO` `contains` `cluster_state:ok`; `behavior` concurrency 50 repeat 50 `join("u-000010", 9001, 10)` → `expectCount { value: true, equals: 10 }`, sideEffects `GET {wallet:u-000010}` `"0"`, `GET {wallet:u-000010}:joins:9001` `"10"` (all keys in one slot, so the engine's cluster checks route them); `quiz` slots, hash tags, what breaks (multi-key, Lua across slots, MULTI, pub/sub semantics). Ends with the way back: target single; `docker compose --profile cluster stop`. Solutions: reference (hash-tag join on a duplicate with WATCH as in 3.9, or the Lua form with both keys in `KEYS[]`); `09-wrong-two-slots.js` (Chapter 3's file: `CROSSSLOT`). show_me `kv_card` `["{wallet:u-000010}"]`. |
| 10 | `ch5-10-port-6379-is-on-the-internet` | cli | Back on the single node. `CONFIG GET protected-mode`, `CONFIG GET bind`; `ACL LIST` (the default user is `on nopass ~* &* +@all`: digest); `ACL SETUSER worker on >hostelpass ~queue:* +@read +@write -@dangerous`; `AUTH worker hostelpass` in the game terminal, `FLUSHALL` → `NOPERM`, `SET queue:x 1` → OK, `SET other 1` → `NOPERM`; `AUTH default anything` to come back (the default user has no password, so any value is accepted: measure); `ACL GETUSER worker`. Verify: `redis` `ACL GETUSER worker` (allowlisted? check `packages/shared/src/levels/commands.ts`; if not, `allowWrite: true` with the reason that it reads) `contains` `~queue:*` or `matches`; `ACL LIST` `contains` `user worker on`; `quiz` on requirepass vs ACL, never on the public internet, rules left to right, Redis 8 categories. The harness's `.redis` reference includes the `AUTH` lines in order and ends authenticated as default. Solutions: reference; `10-wrong-all-commands.redis` (`+@all`, no `-@dangerous`: the `FLUSHALL` NOPERM never happens; grade through `ACL GETUSER worker` not containing `-@dangerous`: use `notContains` on the flattened reply, test it). |
| 11 | `ch5-11-the-doctors` | cli | `CONFIG SET latency-monitor-threshold 100`, `LATENCY DOCTOR`, `MEMORY DOCTOR`, `SLOWLOG GET 5`, `CLIENT PAUSE 2000 WRITE` then a `SET` that waits, `CLIENT UNPAUSE`; teach the admin page's zero-downtime switch order (replica, sync, `CLIENT PAUSE`, `REPLICAOF NO ONE`). Verify: `redis` `CONFIG GET latency-monitor-threshold` `equals: [latency-monitor-threshold, "100"]`; `quiz` the order and what `CLIENT PAUSE WRITE` does. Solutions: reference; `11-wrong-threshold-off.redis` (sets it to 0). |
| 12 | `ch5-12-managed-redis` | decision | What changes when the company buys it: no `CONFIG SET`, persistence and failover chosen for you, cluster as a checkbox, cost per GB; what stays yours: the key design, TTL discipline, no `KEYS`, idempotency, one shared client. Reasoned model answers, not cited facts; no vendor names. |
| 13 | `ch5-13-the-production-checklist` | decision | The checklist earned over the chapters, one quiz per group: every key has a TTL or a reason; the key scheme; `SCAN` not `KEYS`; `UNLINK` for big keys; locks expire and are released with a token; idempotency keys on money; alerts on memory, evictions, latency, `lag` and `pending`; persistence chosen on purpose; a replica and a failover story; Redis never public; one shared client, `duplicate()` for blocking and subscribe. |
| 14 | `ch5-14-blank-rebuild` | cli | A fresh box (the single node) and a budget: choose and set `CONFIG SET save "300 10"`, `appendonly yes`, `appendfsync everysec`, `maxmemory-policy noeviction` (sessions live here) and `latency-monitor-threshold 100`, and justify each in a quiz; the task gives the constraints (a minute of loss is acceptable, writes must never silently vanish, sessions and the cache share the box tonight). Verify: `redis` checks for each value (`CONFIG GET save` `contains` `300 10`; `appendonly` yes; `appendfsync` everysec; `maxmemory-policy` noeviction; threshold 100); `quiz` justifications. After the level the task restores `save "60 1000"` (the stack's default) so later checks are untouched, and the harness's reset does not cover `save`: put `CONFIG SET save "60 1000"` as the last line of the reference and note it. Solutions: reference; `14-wrong-allkeys-lru.redis` (evicts sessions). |

Every level: story (the final's voice, short), brainstorm with `not-redis`, teach from the digest with your
measurements labelled, task with exact commands and the way back, hints, show_me, docs links, reward XP 40 to 80,
every wrong solution with a `because`. For the hand-graded levels write in the handoff the exact order the
orchestrator should play them in and what to observe.

**Check.** `scripts/check/C5.sh` in the shape of `scripts/check/C4b.sh`: validate with 14 levels; chapter order;
solutions and fixtures; the local proof with the engine's evaluators against every `redis`, `behavior` and
`antipattern` verifier of every solution on the throwaway `redis:8` (persistence `CONFIG SET`s, ACL, `MEMORY`,
`OBJECT ENCODING`, `CLIENT PAUSE` all exist there), printing DEFER for the four hand-graded levels' events and for
traffic and quizzes. Exit 0, print each thing verified.

**Handoff.** `docs/handoffs/C5.md`: one line per level, the measurements quoted, the "not in the digest" list,
the hand-grading script for 01, 07, 08, 09, and the check output.

**Model.** sonnet
