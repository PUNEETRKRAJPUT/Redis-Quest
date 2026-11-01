# E-03: the engine follows replica, sentinel and cluster targets (Chapter 5)

**Goal.** Chapter 5 moves the game's Redis from the single node to a node without persistence, to a replica,
to a Sentinel-managed pair and to a six-node cluster. The engine must connect to each kind of target for its
own mirror, the in-browser terminal and the verifier's checks, tell the learner which target they are on, let
them switch from the page, and report a Sentinel failover as an event.

**Depends on.** nothing (A-05 makes the app and runner follow the same targets in parallel; it consumes the
helper you write first, so write it first).

**Files owned.**
- `packages/shared/src/learner/target.ts` (new) and its export from `packages/shared/src/learner/index.ts`,
  `packages/shared/src/learner/__tests__/target.test.ts` (new). **Write this file first and keep its exported
  signatures exactly as below; A-05 starts coding against them within the hour.**
- `engine/src/` except `engine/src/verify/slots.ts`; `engine/test/`
- `ui/src/`, `ui/test/`
- `scripts/grade/grade.mjs`, `docs/grading.md`, `levels/README.md` (field tables only)
- `scripts/check/E-03.sh`, `scripts/check/compose.e03.yaml` (an override that removes the published host ports of
  the profile services, so two checks can run profiles at once), `.env.e03` (gitignored:
  `PROXY_PORT=3600 REDIS_PORT=6396 PG_PORT=5438 INSIGHT_PORT=5546 ENGINE_DEV=1`)
- `docs/handoffs/E-03.md`

**Must not touch.** `app/`, `runner/`, `packages/shared/src/learner/deps.ts` and the other learner files (A-05),
`engine/src/verify/slots.ts`, `levels/` (apart from `levels/README.md`), `scenarios/`, `docker-compose.yml`,
`docker/`, other checks, `docs/BUILD.md`. Compose project `quest-e03` only.

**Interfaces to honour.** `engine/src/redis.ts` (`RedisManager`: main and cli clients, `send`, `onUp`,
`connect(url)`, events `redis_disconnect`/`redis_reconnect`), `PUT /api/target` in `server.ts`, the mirror
restore on `onUp`, `engine/src/cli.ts` (`runCli`), `engine/src/verify/redis-checks.ts` (`send`), the digest
(replication, sentinel, cluster, node-redis guide: `createCluster({ rootNodes })`, `createSentinel({ name,
sentinelRootNodes })`, no URL form for sentinel), `docker-compose.yml` profiles (service names `redis`,
`redis-nopersist`, `redis-replica`, `sentinel-1..3`, `redis-c1..c6`; the sentinel config names the master
`mymaster` on `redis:6379`; cluster nodes announce their hostnames).

**Target strings** (the one format every service parses):
- `redis://host:port[/db]` (as today; `rediss://` too)
- `sentinel://<masterName>@host1:port1,host2:port2,host3:port3`
- `cluster://host1:port1,host2:port2[,...]`

**Work.**

1. **`target.ts`** exports:
   ```ts
   export type TargetKind = 'single' | 'sentinel' | 'cluster';
   export interface ParsedTarget { kind: TargetKind; url: string; masterName?: string; nodes: { host: string; port: number }[]; }
   export function parseTarget(url: string): ParsedTarget;           // throws TargetError on a bad string
   export function describeTarget(t: ParsedTarget): string;          // "single node redis:6379" / "sentinel mymaster via 3 sentinels" / "cluster, 3 root nodes"
   export interface TargetClientOptions { disableOfflineQueue?: boolean; connectTimeoutMs?: number; reconnectStrategy?: (retries: number) => number | Error; RESP?: 2 | 3; clientSideCache?: unknown; name?: string; }
   export function createTargetClient(t: ParsedTarget, opts?: TargetClientOptions): TargetClient; // NOT connected
   export type TargetClient = ReturnType<typeof createClient> | ReturnType<typeof createCluster> | ReturnType<typeof createSentinel>;
   export function isCluster(c: unknown): boolean; export function isSentinel(c: unknown): boolean;
   ```
   `createTargetClient` passes the options through to `createClient` / `createSentinel` (`nodeClientOptions`
   and `sentinelClientOptions`) / `createCluster` (`defaults`). State in the handoff which options each kind
   honours in this node-redis (5.12) and which it ignores. Unit tests for parsing and `describeTarget`.
2. **RedisManager** builds `main` and `cli` through the helper for every kind. Cluster: `send(argv)` must route a
   raw command; use the command's first key when `COMMAND INFO` (which the engine already fetches for the
   allowlist check) gives key positions, else a random node; cluster-wide keyless commands (`INFO`, `DBSIZE`,
   `CLUSTER INFO`, `CLUSTER NODES`, `PING`, `CONFIG GET`) go to one node and the handoff says which. `MOVED`/`ASK`
   handled by the client where it can; where a raw command still gets `MOVED`, surface it as the error reply
   (it is a lesson, not a crash). Sentinel: commands go to the current master; after a failover the client
   follows (node-redis sentinel does) and the engine emits `level.event custom sentinel_failover
   { masterName, from: "host:port", to: "host:port" }` (watch the sentinel client's topology events, or poll
   `SENTINEL get-master-addr-by-name` on the root sentinels every 2 s and compare). On every successful
   `PUT /api/target` emit `custom redis_target_changed { from, to, kind }`. `GET /api/target` answers
   `{ redisUrl, kind, description, state, master?: "host:port", nodes?: n }`. `PUT /api/target` accepts the
   three schemes (400 `invalid_url` otherwise) and keeps persisting into progress as today. The mirror restore on
   `onUp` must work on each kind (the `game:*` keys are single keys; on cluster they land on their slots).
3. **CLI on each kind.** The terminal keeps working: on cluster, a `MSET a 1 b 2` style cross-slot command shows
   `CROSSSLOT ...` as the error line; `CLUSTER KEYSLOT`, `CLUSTER NODES`, `CLUSTER INFO` work; on a read-only
   replica a `SET` shows `READONLY ...`. The prompt text (`GET /api/target` `description`) tells the learner where
   they are.
4. **UI target switcher.** In the Terminal panel header (next to the prompt), a select `data-testid="target-select"`
   with presets: "Single node (redis:6379)" → `redis://redis:6379`; "No persistence (redis-nopersist)" →
   `redis://redis-nopersist:6379`; "Replica, read-only (redis-replica)" → `redis://redis-replica:6379`; "Sentinel
   (mymaster via sentinel-1..3)" → `sentinel://mymaster@sentinel-1:26379,sentinel-2:26379,sentinel-3:26379`;
   "Cluster (redis-c1..c3)" → `cluster://redis-c1:6379,redis-c2:6379,redis-c3:6379`; plus "Custom…" with a text
   input. Choosing one calls `PUT /api/target`; the header shows `description` and the up/down dot; a connect
   failure shows the engine's message and keeps the old selection. One line under it: "The app and the runner
   follow within about two seconds." Unit test as E-01's switch.
5. **Harness.** Levels whose event verifiers name `redis_target_changed` or `sentinel_failover` need the compose
   profiles and a hand on the Docker side, so the harness records their solutions as
   `SKIPPED (needs the compose profiles: graded by hand)` and completes the level, like outage levels. Document
   in `docs/grading.md`.
6. **README.** Field table lines for the two new event names (custom events, documented like `ticker_gap`).

**Acceptance check.** `scripts/check/E-03.sh` (bash 3.2, project `quest-e03`, `.env.e03`, the ports override,
scratch levels/progress, no insight, `--profile replica --profile sentinel --profile cluster` services up, cluster
formed inside the check with `docker compose -p quest-e03 exec -T redis-c1 redis-cli --cluster create redis-c1:6379
redis-c2:6379 redis-c3:6379 redis-c4:6379 redis-c5:6379 redis-c6:6379 --cluster-replicas 1 --cluster-yes` (state
what worked; `cluster_state:ok` within 15 s), `down -v` on exit):
- shared vitest (target tests), engine vitest, ui vitest, lints, format;
- `GET /api/target` on the default stack says `kind: single`; `PUT` with each of the three schemes → 200 and the
  engine's mirror is present on the new target (`GET /api/progress/mirror` in sync) within 5 s; a bad string → 400;
- replica: `PUT redis://redis-replica:6379` → `GET game:progress` style read works through the CLI and `SET x 1`
  shows `READONLY`; back to single;
- cluster: `PUT cluster://...` → CLI `SET {u:1}:a 1`, `GET {u:1}:a`, `MSET {u:1}:b 1 {u:1}:c 2` → OK, `MSET a 1 b 2`
  → `CROSSSLOT`, `CLUSTER INFO` contains `cluster_state:ok`, `CLUSTER KEYSLOT {u:1}:a` answers an integer; a
  `redis` verifier check through a scratch level passes on the cluster (`GET {u:1}:a equals "1"`); the mirror
  restore worked (progress mirror in sync); `redis_target_changed { kind: cluster }` in `GET /api/events`;
- sentinel: `PUT sentinel://mymaster@...` → CLI `SET` works; `docker compose -p quest-e03 stop redis` → within 20 s
  `sentinel_failover` appears in events with `to` = `redis-replica:6379`, the CLI `SET` works again on the new
  master, `GET /api/target` shows the new master; `start redis` → it rejoins as a replica (`INFO replication` through
  the CLI: `role:slave` on the old node is not reachable through the sentinel master; instead check
  `SENTINEL replicas mymaster` through `docker compose exec sentinel-1 redis-cli -p 26379` lists `redis:6379`);
  then back to `redis://redis-replica:6379`? No: finish by switching to `redis://redis:6379` **only after** making
  `redis` master again (`docker compose stop redis-replica`, wait for failover back, `start redis-replica`) and
  state exactly how long each step took, because the content author will write that dance into the level;
- harness: a scratch level with `event custom redis_target_changed` is reported `SKIPPED (needs the compose
  profiles: graded by hand)`;
- `example-cli` and `example-code` grade with no MISMATCH on the single node after all of the above;
- exit 0, print each thing verified.

**Handoff complete when.** the check passes; `docs/handoffs/E-03.md` has the target format, the helper's options
table per kind, routing rules on cluster, the event payloads, the exact failover timeline you measured, the UI
control, and the check output.

**Model.** sonnet
