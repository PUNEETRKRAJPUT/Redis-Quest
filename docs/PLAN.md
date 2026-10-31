# Redis learning game: plan (draft 1)

Working title: **Redis Quest** (placeholder, rename freely).

One line: a backend engineer with basic JavaScript clones a repo, runs one command, and plays a story-driven game in their browser. Every level makes them do something real against a Redis running on their own machine. By the end they have built the backend of the game they were playing, and they can judge when Redis fits a problem and when it does not.

Everything runs on the learner's machine. Nothing is hosted by us. Progress lives in their own Redis.

---

## 1. Who it is for, and what "done" means

**Learner:** knows variables, functions, objects, arrays, `async/await` in JavaScript. Has never used Redis. May never have used Docker. Not an AI/LLM audience: no vectors, no embeddings, no semantic caching anywhere in the game.

**Platform (decided): macOS on Apple Silicon only, 16 GB RAM minimum.** No Intel Mac, no Windows, no Linux in v1. Every image is pulled for `linux/arm64`, every script is written for the macOS userland (zsh, BSD tools), and the memory budget below assumes Docker Desktop has 8 GB. Other platforms are a later decision, not a silent maybe.

**Prerequisites they install themselves** (Chapter 0 walks them through it and verifies each one):

- Xcode Command Line Tools (gives `git`); the first `git` call on a fresh Mac prompts for it
- Docker Desktop for Mac, Apple Silicon build, 4.30 or newer, with 8 GB memory assigned in Settings → Resources
- A code editor (VS Code recommended, not required: the game has a built-in editor)
- Node is **not** required on the host. Homebrew is **not** required. All code runs inside containers.

**Mastery outcome.** When they finish, they can, without looking anything up:

1. Name the right Redis data structure for a problem and the commands that implement it, including the ones that look right but are wrong (list for a leaderboard, KEYS in production, pub/sub for anything that must not be lost).
2. Explain the complexity and memory cost of what they chose, and spot big keys and hot keys.
3. Implement the canonical patterns: cache-aside with invalidation and stampede protection, session store, rate limiting (fixed and sliding window), leaderboards, pub/sub, streams with consumer groups, job queues, distributed locks and their limits, atomic operations with MULTI/WATCH and Lua.
4. Operate a single instance honestly: persistence trade-offs, eviction, maxmemory, ACLs, SLOWLOG, and how to lose data on purpose and on accident.
5. Explain replication, Sentinel, and Cluster well enough to choose between them and know the multi-key and hash-slot constraints.
6. Say "Redis is wrong here" and give the reason.
7. **Interview-ready on the nine official backend use cases.** Given a blank file and a whiteboard, rebuild any of these from memory in under 20 minutes, with the trade-offs: rate limiting (token bucket), session storage, cache-aside, prefetch cache with a CDC sync worker, leaderboards, pub/sub messaging, streaming with consumer groups, job queue with at-least-once delivery and visibility-timeout reclaim, time series dashboard. These are the use cases Redis itself documents (redis.io, Develop, Use cases); the four AI ones on that list (recommendation engine, feature store, semantic cache, memory layer) are deliberately out of scope.

---

## 2. Architecture (all local)

```
learner's laptop (macOS, Apple Silicon, 16 GB)
├── browser  →  http://localhost:3000   (the game UI and the fantasy-cricket app, through the proxy)
│            →  http://localhost:5540   (Redis Insight, the "see it" window)
└── docker compose (Docker Desktop, linux/arm64 images only, 8 GB assigned)
    ├── proxy      Caddy on :3000. /app/* → app (scalable). Everything else → engine (single)
    ├── engine     Node 22 + TypeScript. The game: levels, verifiers, progress, snapshots, in-browser
    │              Redis CLI, load generator (autocannon + scenarios), log tail. Exactly one instance
    ├── app        Node 22 + TypeScript. The pre-built fantasy-cricket backend the learner extends.
    │              Loads the learner's workspace/ files into "slots"; baseline (slow) path when a slot
    │              is empty. This is what traffic hits and what `--scale app=2` multiplies
    ├── runner     executes learner functions directly for `behavior` verifiers; isolated so a crash
    │              or infinite loop never takes the engine or the app down
    ├── redis      official `redis:8` (arm64). JSON, Search, time series, probabilistic types built in.
    │              Bound to 127.0.0.1:6379 on the host, data volume on /data, maxmemory 512mb
    ├── insight    `redis/redisinsight` on 127.0.0.1:5540, pre-connected to `redis` via its API
    ├── postgres   official `postgres:16` (arm64) on 127.0.0.1:5432. Real schema, fictional seed,
    │              deliberately slow hot queries, outbox table for CDC
    └── profiles   started by the learner by hand when a chapter calls for them:
                   crash      redis-nopersist (ch5.1)
                   replica    redis-replica on 6380 (ch5.7)
                   sentinel   sentinel-1..3 on 26379..26381 (ch5.8)
                   cluster    redis-c1..c6 on 7100..7105 (ch5.9; 7000 is taken by AirPlay on macOS)
```

**Why engine and app are separate services.** Chapter 3's "you are not alone" moment needs two instances of the thing the learner's code runs in. If the game engine scaled too, level state, WebSocket sessions and snapshots would split across instances and break. So the engine is one container and the app is the scalable one. The proxy makes this invisible on port 3000.

**How the learner's code gets into the app.** Each code level names a *slot* (`cache.getPlayerStats`, `ratelimit.allow`, `queue.claim`). The app has a baseline implementation for every slot (the slow or naive path the incident is about). When `workspace/chNN/<slot>.js` exists and loads cleanly, the app uses it; the engine tells the app which slots are active for the current level. Files are watched with polling (bind mounts on macOS do not deliver reliable change events). The runner imports the same files for direct `behavior` tests. Learner files are plain JavaScript ES modules exporting one function that receives its dependencies (`{ redis, db, log }`) so they never write connection code, except in level 1.16 where that is the lesson.

**Memory budget (Docker Desktop at 8 GB).** engine 512 MB · app 512 MB per instance · runner 512 MB · redis 512 MB `maxmemory` + overhead · postgres 1 GB (`shared_buffers` 256 MB) · insight 512 MB · caddy 64 MB. Chapter 5 profiles add: replica 256 MB, sentinels 3 × 64 MB, cluster 6 × 192 MB. Everything carries a `mem_limit`. Load generation runs 50 to 200 concurrent connections for 10 to 20 seconds; "40,000 users" is a data size, never a concurrency number. Preflight refuses to start if Docker has under 6 GB.

**Ports used (all bound to 127.0.0.1).** 3000 proxy · 5540 insight · 6379 redis · 5432 postgres · 6380 replica · 26379–26381 sentinels · 7100–7105 cluster. Avoided on purpose: 5000 and 7000 (AirPlay Receiver on macOS), 8080 (too common), 8001 (old Stack habit). Preflight checks every one with `lsof -nP -iTCP:<port> -sTCP:LISTEN` and names the process holding it, since a Homebrew `redis` or `postgresql` service is the usual culprit.

**Load generation (how "40,000 students at toss time" happens on one laptop)**

- **autocannon** is the load engine. It runs inside the `engine` container, hits the app through the proxy (`http://proxy:3000/app/...`), and reports p50, p99, requests per second, non-2xx counts and timeouts. Those numbers are what the `traffic` verifier grades and what the impact log records.
- **A scenario layer on top** turns raw hits into believable players: which endpoints in which mix (read leaderboard 60%, read player stats 30%, edit team 10%), how many distinct users, how skewed (a Zipf distribution so one celebrity player becomes the hot key), how many connections, for how long. Scenarios are YAML, referenced by level id. Chapter 2 runs a hundred users; Chapter 4 runs tens of thousands. Caps and a low-power mode keep an 8 GB laptop alive.
- **Chaos spikes** are the same scenarios on a button: "toss in 10 seconds" sends the spike, and the learner watches their own p99 and their own logs.
- **redis-benchmark** (ships in the image) is used for Redis-level napkin math: ops per second on their machine, pipelined versus not.
- **A live logs panel** in the UI tails `app`, `runner` and `postgres` output next to `SLOWLOG GET` and `INFO stats` deltas, so "see it break in your logs" is literal, not a metaphor. The engine never touches the Docker socket, so every service writes its log to a shared `./logs/` volume (pino files for Node, `logging_collector` for Postgres, Caddy's access log) and the engine tails those files. Redis Insight's profiler covers the command-level view.

**The legacy database (why it is real Postgres, not a stub)**

- The slowness must be real or the lesson is fake. The stats page joins users, fantasy teams, players, matches and a ball-by-ball table with a deliberately missing index. Under a hundred users it is already a few hundred milliseconds on an M-series Mac; the exact figure is measured in the build, not assumed. There is also an optional latency knob to simulate "the DB is in another region", used in exactly one level and labelled as artificial.
- **Seeded on first start** from SQL in the image's init directory: users (tens of thousands), teams, players, a season of matches, ball-by-ball events, fantasy teams, contests, contest entries, wallet transactions. **Fictional league, teams and player names (decided).** A short fiction bible (league, eight franchises, about two hundred players, colleges, hostels, the recurring cast) is written before the seed generator, and every name is checked against real cricketers and real franchises.
- **It is the source of truth** for cache-aside (Chapter 2), sessions and user lookup, wallet balance reconciliation (Chapter 3), the "Redis is down, keep serving" drill, and the prefetch cache. For prefetch, change-data-capture is an **outbox table** written by triggers and drained by a worker into a Redis stream. That is the pattern they will meet at work; Debezium is named in the teach panel, not run.
- **Reset is one command** (`docker compose down -v` then `up`), which re-seeds Postgres and wipes Redis. The game's progress snapshot in `./.progress/` survives it, and the restore flow is a lesson.
- Redis-side fixtures for individual levels (fifty users for the SCAN level, a pre-filled stream) come from the level's own `setup` hook, idempotent, under the level's key prefix.

**Design rules**

- **The game never controls Docker.** When a chapter needs a replica or a killed primary, the game shows the exact command, the learner runs it in their own terminal, and the game detects the result by connecting. Running the ops command is part of the lesson, and it keeps the docker socket out of the containers.
- **The learner's code is real files.** `./workspace/chNN/*.js` is bind-mounted into `runner`. The in-browser editor and VS Code edit the same files. They finish with a folder of code they wrote, not a sandbox that evaporates.
- **Progress has one source of truth: `./.progress/progress.json` on the host.** Redis holds a live mirror under a reserved prefix (`game:*`) so the first "aha" in Chapter 0 is finding their own player record with `KEYS game:*` and `HGETALL`, and Insight shows it. When they `FLUSHALL` (they will, it is a level), the mirror vanishes, the game offers to restore it from the file, and tells them that this is exactly what an RDB file is. The file also survives Chapter 5, where the primary Redis is replaced by a no-persistence instance, then a replica pair, then Sentinel, then a cluster. The engine tells the app which Redis target is current; the app never hardcodes one.
- **Scale is simulated honestly.** The `game` service runs bots: fake players that hit the same endpoints the learner builds. Chapter 1 has one player (them). Chapter 2 turns on 100 bots. Chapter 4 runs thousands. The load on their Redis is real; only the players are fake. Bot counts are capped so a 8 GB laptop survives.
- **Every pass has a "show me."** When a verifier passes, the feature they built appears live in the game world, backed by their keys. Build the leaderboard and the leaderboard panel lights up reading from their sorted set. A link opens the same key in RedisInsight.
- **Port conflicts are expected.** Chapter 0 detects a 6379 already in use and lets them pick another port via `.env`.

**Stack (proposed):** TypeScript everywhere except the learner's files, which are plain JavaScript ES modules. Node 22 on `node:22-bookworm-slim` (arm64). Fastify for the engine and the app, the official `redis` Node client (node-redis v5), `pg` for Postgres, autocannon for load, Caddy as the proxy, WebSocket for live events, React + Vite for the UI, xterm.js for the in-browser Redis CLI, Monaco for the code editor. Level content is data (YAML + Markdown), not code, so adding a chapter does not touch the engine.

---

**Draft `docker-compose.yml` (to be validated in build task P0, not yet run).** Shown so the shape is agreed before anyone writes it. Service names are the hostnames containers use for each other.

```yaml
name: redis-quest

x-node: &node
  build: { context: ., dockerfile: docker/node.Dockerfile }
  platform: linux/arm64
  environment: &node-env
    REDIS_URL: redis://redis:6379
    DATABASE_URL: postgres://quest:quest@postgres:5432/quest
    LOG_DIR: /logs
  volumes:
    - ./workspace:/workspace
    - ./logs:/logs
    - ./.progress:/progress
  depends_on:
    redis: { condition: service_healthy }
    postgres: { condition: service_healthy }

services:
  proxy:
    image: caddy:2-alpine
    platform: linux/arm64
    ports: ["127.0.0.1:3000:3000"]
    volumes: ["./docker/Caddyfile:/etc/caddy/Caddyfile:ro", "./logs:/logs"]
    mem_limit: 64m
    depends_on: [engine, app]

  engine:
    <<: *node
    command: ["node", "engine/dist/main.js"]
    environment: { <<: *node-env, APP_URL: "http://proxy:3000/app", RUNNER_URL: "http://runner:4100" }
    mem_limit: 512m

  app:
    <<: *node
    command: ["node", "app/dist/main.js"]
    mem_limit: 512m
    # scaled by the learner in ch3: docker compose up -d --scale app=2

  runner:
    <<: *node
    command: ["node", "runner/dist/main.js"]
    mem_limit: 512m

  redis:
    image: redis:8
    platform: linux/arm64
    command: ["redis-server", "--maxmemory", "512mb", "--save", "", "--appendonly", "no"]   # ch5 turns persistence on
    ports: ["127.0.0.1:6379:6379"]
    volumes: ["redis-data:/data"]
    healthcheck: { test: ["CMD", "redis-cli", "PING"], interval: 2s, timeout: 2s, retries: 15 }
    mem_limit: 768m

  insight:
    image: redis/redisinsight:latest
    platform: linux/arm64
    ports: ["127.0.0.1:5540:5540"]
    volumes: ["insight-data:/data"]
    mem_limit: 512m

  postgres:
    image: postgres:16
    platform: linux/arm64
    environment: { POSTGRES_USER: quest, POSTGRES_PASSWORD: quest, POSTGRES_DB: quest }
    command: ["postgres", "-c", "shared_buffers=256MB", "-c", "logging_collector=on", "-c", "log_directory=/logs/postgres", "-c", "log_min_duration_statement=100"]
    ports: ["127.0.0.1:5432:5432"]
    volumes: ["pg-data:/var/lib/postgresql/data", "./postgres/init:/docker-entrypoint-initdb.d:ro", "./logs:/logs"]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U quest -d quest"], interval: 2s, timeout: 2s, retries: 30 }
    mem_limit: 1g

  # ---- chapter 5 profiles (started by the learner by hand) ----
  redis-nopersist:
    profiles: [crash]
    image: redis:8
    platform: linux/arm64
    command: ["redis-server", "--save", "", "--appendonly", "no"]
    mem_limit: 256m
  redis-replica:
    profiles: [replica]
    image: redis:8
    platform: linux/arm64
    command: ["redis-server", "--replicaof", "redis", "6379", "--replica-announce-ip", "redis-replica"]
    ports: ["127.0.0.1:6380:6379"]
    mem_limit: 256m
  # sentinel-1..3 (profile: sentinel, ports 26379..26381) and redis-c1..c6 (profile: cluster, ports 7100..7105,
  # cluster-announce-hostname set to the service name) follow the same shape; written in task P0.

volumes: { redis-data: {}, pg-data: {}, insight-data: {} }
```

The node Dockerfile is one multi-stage file: `node:22-bookworm-slim`, `corepack enable`, install with pnpm, build the TypeScript, copy `dist/` into a slim runtime stage with only production dependencies. The `start` script runs preflight, then `docker compose up -d --build`, then waits on `http://localhost:3000/health`.

## 3. Repo layout

```
redis-quest/
├── README.md                  three steps: install Docker Desktop, clone, ./start
├── docker-compose.yml         proxy, engine, app, runner, redis, insight, postgres (+ profiles)
├── .env.example               ports, load caps
├── scripts/
│   ├── preflight.sh           macOS checks: arch, Docker Desktop, memory, ports, disk
│   ├── start                  preflight, then docker compose up with the right profiles
│   └── check/                 one acceptance script per build task (see section 9)
├── docs/
│   ├── specs/                 one spec per build task: scope, interfaces, acceptance checks
│   ├── handoffs/              what each agent did, verified, and left open
│   ├── BUILD.md               the task board; the first thing any new session reads
│   └── fiction.md             the fiction bible: league, teams, players, cast
├── logs/                      shared log volume tailed by the engine (gitignored)
├── engine/                    Fastify: levels API, verifier engine, CLI proxy, load generator, log tail, snapshots
├── app/                       Fastify: the pre-built fantasy-cricket backend (routes, db layer, slots, baselines)
├── ui/                        React + Vite: world view, chapter map, terminal, editor, logs, "what you built"
├── runner/                    executes workspace code against redis, returns results/metrics
├── postgres/                  Dockerfile, schema.sql, seed generator, outbox triggers
├── scenarios/                 load scenarios (YAML) used by traffic verifiers and chaos spikes
├── levels/
│   ├── ch0-boot/
│   ├── ch1-keyspace/
│   │   ├── 01-ping.yaml
│   │   ├── 02-strings-gold.yaml
│   │   └── ...
│   └── ch5-survive/
├── workspace/                 the learner's code (scaffolds committed, their edits gitignored)
│   ├── ch2/cache.js
│   └── ...
└── .claude-project.md         architecture and decisions for coding sessions (Puneet's convention)
```

---

## 4. Level format

One file per level. The engine reads it; no code per level unless a verifier needs custom logic.

```yaml
id: ch1-06-leaderboard
chapter: 1
title: "The tavern wants a scoreboard"
mode: cli            # cli | code | ops | decision
story: |             # markdown, 5 to 10 lines, in-world
  ...
teach: |             # markdown: the concept, the commands, one docs link
  ...
task: |              # markdown: exactly what to do, with the key names to use
  Create a sorted set `game:leaderboard` ...
setup:               # idempotent fixtures run before the level starts (Redis commands, SQL, or a script)
  - cmd: [DEL, "game:leaderboard"]
scenario: toss-time-100   # load scenario for traffic verifiers and the live pain panel (optional)
hints:               # revealed one at a time, cost nothing but pride
  - "ZADD takes score before member"
  - ...
verify:
  - type: redis
    checks:
      - cmd: [TYPE, "game:leaderboard"]
        equals: zset
      - cmd: [ZCARD, "game:leaderboard"]
        gte: 5
      - cmd: [ZREVRANK, "game:leaderboard", "{{player.name}}"]
        exists: true
  - type: antipattern     # also check they did not do it the wrong way
    checks:
      - cmd: [EXISTS, "game:leaderboard:list"]
        equals: 0
show_me: leaderboard_panel     # UI component that lights up on pass
reward:
  xp: 50
  badge: "Ranked"
  unlocks: ch1-07-weekly-reset
```

**Modes**

- `cli`: they type Redis commands in the in-browser terminal (or redis-cli / RedisInsight; the verifier only cares about the resulting state).
- `code`: they fill in a function in `workspace/`. The runner calls it. Example: `getPlayer(id)` must return the right data and hit Postgres at most once per id per 60 seconds.
- `ops`: they run a Docker or redis-cli command on the host (kill the primary, change `appendfsync`, add a replica). The game detects the effect.
- `decision`: a short scenario, they choose a structure or choose "not Redis," then write one sentence of reasoning. Auto-graded on the choice, the sentence is shown back to them next to the model answer. Used for the trade-off material that cannot be verified by state.

**Verifier types**

| type | what it does | example |
|---|---|---|
| `redis` | runs read-only commands against their Redis, asserts on replies | TYPE, ZCARD, TTL, OBJECT ENCODING, MEMORY USAGE |
| `antipattern` | same, but asserts the wrong structure is absent | no list where a zset belongs |
| `behavior` | runner calls their function N times with fixtures, asserts outputs and side effects | rate limiter lets 10 of 100 through |
| `traffic` | autocannon runs a named scenario for T seconds, asserts on metrics **relative to the baseline run of the same scenario** so a busy laptop does not fail a correct solution | p99 at least 5× better than baseline, cache hit ratio over 90%, Postgres calls down 90% |
| `event` | waits for something to happen within a window | redis disconnects then reconnects; a message arrives on a channel |
| `quiz` | the decision mode | choice equals expected |

Verifiers are idempotent and read-only against the learner's data, except `traffic`, which writes under a `game:traffic:*` prefix it cleans up.

---

## 4b. Anatomy of a challenge

Every level, in every chapter, follows the same seven beats. The learner only ever touches the Redis part. Everything else is already built and running.

1. **Scenario.** The WhatsApp-style thread: what just happened, who is shouting, what the users see. Two minutes of reading.
2. **What already exists.** A short briefing of the pre-built pieces they can lean on and must not rebuild: "The `/players/:id` endpoint exists. It calls `db.getPlayer(id)`, a Postgres query that takes about 300 ms. 100 bots are hitting it right now. Your Redis client is already connected as `redis`." A live panel shows the current pain (p99, error rate, DB calls per second) so the problem is visible, not described.
3. **Brainstorm.** Before any teaching: "Which Redis structure or pattern would you reach for, and why?" They pick from a list (which always includes "not Redis") and write one line. Nothing is graded yet. The point is to commit to a guess.
4. **Teach.** The concept, the commands, one link to the official docs page, and one worked example that is *not* the answer. Short. The game is not a textbook; the docs are.
5. **Build.** One of:
   - `cli`: run commands in the in-browser terminal.
   - `code`: fill the one stub in `workspace/chNN/<name>.js` marked `// YOUR REDIS CODE HERE`. The function signature, the client, and the surrounding app are given. Hints unlock one at a time; in interview-mode rebuilds they cost XP.
   - `ops`: run the Docker or redis-cli command on the host.
   - `decision`: choose and justify.
6. **Verify.** The verifiers run and return one of three verdicts:
   - **Wrong.** The check fails. The feedback names *what* failed in plain words ("your limiter let 100 of 100 requests through; expected 10") and points at the most likely cause for that symptom. No reference solution yet.
   - **Works, but wrong.** Functionally passes, but an `antipattern` detector fired: a list where a sorted set belongs, `KEYS` on the hot path, a cache with no TTL, a lock with no expiry, a non-atomic check-then-set. The game says so explicitly: "This passes today. Here is how it fails at the IPL final." Then it shows the scale test failing live with their code. This verdict is the most valuable one in the whole game, and interviewers probe exactly here.
   - **Right.** The "show me" panel lights up with the feature running on their keys, and their brainstorm guess from beat 3 is shown next to what they actually built.
7. **The ideal way.** After a pass, or after three failed attempts, or on request: the reference implementation opens side by side with theirs, with the reasoning annotated line by line and the trade-offs listed. They can diff. They can copy it. They can run the scale test against both. For `decision` levels this is the model answer.

Design rules that fall out of this:

- **Reference solutions ship with every level and are tested in CI.** Every verifier is run against the reference (must pass), against each known antipattern implementation (must return "works, but wrong"), and against an empty stub (must return "wrong"). A level cannot merge otherwise.
- **Feedback is written per failure signature, not generic.** Each verifier check carries its own failure message. "Expected zset, got list" is a different sentence from "Expected TTL, got -1".
- **The scaffold is real.** The pre-built app is a normal Fastify service in the repo. A curious learner can read all of it. Nothing is hidden behind magic.
- **Brainstorm guesses are kept.** Their guess history becomes a personal "patterns I reach for" page at the end, which is a surprisingly honest mirror.

## 5. Story, theme, and chapter map

### The learner is Indian, so the story is

The world the learner sees must feel like something they would actually build, not a dungeon. Recommended setting:

**You and your hostel roommate built a fantasy cricket app for your college in a weekend. IPL starts in three weeks. It is about to go very, very wrong, in the best way.**

Why this one:

- It *is* a game, so "you end up with a working game" is literal. The learner is the backend engineer of the game they are playing.
- Every official Redis use case has an obvious, honest place in it (table below). Nothing has to be forced.
- Scale moments are ones every Indian student already feels in their gut: the 7:30 pm toss when everyone edits their team at once, the last over of a chase, the IPL final night, the OTP bill from the SMS vendor, the "server down" screenshots on the college WhatsApp group.
- Money moves (contest entry from a wallet), so atomicity, locks, and idempotency are not academic.
- No real-money gambling in the fiction: contests are for points and bragging rights across hostels and colleges. Keeps it clean.

Alternative if cricket does not land: a canteen pre-order app that spreads from one college canteen to every campus in the city (quick-commerce shape: menus, pin-code serviceability, order queue, live order status, rider location). Same Redis map, slightly less drama on the leaderboard side.

**Recurring cast, so the incidents have faces:** the roommate who does frontend and panics; the senior who runs the college fest and keeps saying "just add more servers"; the hostel warden whose nephew found a bug; the SMS vendor who sends an invoice; the rival college that keeps hitting your API. Each chapter opens with a WhatsApp-style thread of messages that *is* the incident ticket.

**How every level engages the brain, not just the fingers.** Before the "teach" panel unlocks, each level asks the learner to guess: "Which structure would you reach for? Why?" They pick, they write one line, *then* they learn and build. The game shows their guess back to them after. People remember what they predicted wrong far better than what they were told.

### Chapter map with the official use cases placed

| Chapter | Incident (story) | What they build | Redis material | Official use case covered |
|---|---|---|---|---|
| 0. Boot | "Bhai it works on my laptop" | Run the stack, find your own save file in Redis | Docker, PING, KEYS, HGETALL, RedisInsight | |
| 1. The keyspace | Registration opens for your hostel | Profiles, wallet points, team picks, favourite players, a first scoreboard, daily login streak, unique visitor count, stadium map | Strings and INCR, expiry, hashes, lists, sets, sorted sets, bitmaps, HyperLogLog, geo, streams (intro), key naming, SCAN vs KEYS, FLUSHALL and the "save file" restore | |
| 2. Everyone showed up | Toss at 7:30 pm, player stats page takes 4 seconds, Postgres, the legacy DB, is melting | Player stats cache, fixtures preloaded and kept fresh, OTP login sessions | Cache-aside with TTL, invalidation on update, stampede protection, prefetch cache fed by a change-data-capture worker, session store with sliding expiry, maxmemory and eviction policies | Cache-aside, Prefetch cache, Session storage |
| 3. Compete and talk | Rival college scripts are hammering OTP, everyone wants the hostel leaderboard live, the SMS vendor sends a bill | OTP and API rate limiter, live leaderboards per match, per hostel, per college, live score ticker, contest wallet debit | Token bucket rate limiting (and why fixed window is wrong), Lua for atomicity, sorted sets at scale with hash metadata, ZINCRBY, pagination, weekly keys, pub/sub for the ticker and presence, pipelining, MULTI/WATCH for wallet debit, Functions | Rate limiting, Leaderboards, Pub/sub messaging |
| 4. Work in the background | Last over of a chase, points for 40,000 teams must recompute per ball, the pub/sub ticker dropped balls when a worker restarted | Ball-by-ball event stream, points recompute workers, reliable job queue, "last slot in contest" lock, ops dashboard | Streams with consumer groups, XACK, pending entries, XAUTOCLAIM for dead workers, retention and replay; job queue with at-least-once delivery and visibility-timeout reclaim; SET NX PX locks, release with Lua, Redlock and its limits, fencing; keyspace notifications; Bloom filter for username taken; search over JSON for "find a contest"; time series for the live ops graph | Streaming, Job queue, Time series dashboard |
| 5. Survive and scale | IPL final. Redis restarts mid-match and every point is gone. Then: one box is not enough | Persistence that fits, a replica, automatic failover, a cluster | RDB vs AOF, appendfsync, memory: big keys, hot keys, encodings, replication and read replicas, Sentinel failover drill (they kill the primary), Cluster: hash slots, hash tags, multi-key limits, resharding; ACL users; SLOWLOG, LATENCY, what MONITOR costs; client-side caching | |
| Finale. The architect | Placement season | Decision gauntlet plus a timed rebuild of each use case from a blank file | Everything, from memory | All nine |

Geo, HyperLogLog, bitmaps, Bloom, JSON, Search, and time series are covered even though not all are on the official use-case list, because a backend engineer meets them and interviewers ask about them.

### Level by level

Modes: **cli** terminal commands · **code** fill the stub in `workspace/` · **ops** run a command on the host · **decision** choose and justify. "Verify" names the verifier type and the pass condition. Every level also has a brainstorm prompt, hints, a reference solution and at least one known-wrong solution (see 4b). Commands and version notes come from the official docs digest (section 8); anything marked 8.4+ or 8.8+ exists only because the compose file pins `redis:8`, and the teach panel always shows the pre-8 way too, because that is what most companies run.

#### Chapter 0: Boot (5 levels)
| # | Level | Mode | They do | Verify |
|---|---|---|---|---|
| 0.1 | Bhai, it works on my laptop | ops | `scripts/preflight` (Docker running, Compose v2, ports 3000/5540/6379/5432 free), then `docker compose up`. The game opens and shows `INFO server` redis_version | event: UI reached redis |
| 0.2 | Say hello | cli | `PING`, `INFO server`, `DBSIZE` in the in-browser terminal | event: PING seen |
| 0.3 | Find your save file | cli | `KEYS game:*`, `TYPE`, `HGETALL game:player:<id>`; type back the value of one field | quiz: matches the hash |
| 0.4 | The second window | ops | Open Redis Insight on 5540, add the `redis` database, find the same key, read the TTL of `game:welcome:gift` | quiz: TTL within window |
| 0.5 | Roommate ran `down` | ops | `docker compose down` then `up`. Is the save file still there? (Yes: the data volume.) Foreshadows Chapter 5 | event: reconnect + key exists |

#### Chapter 1: The keyspace (16 levels). Incident: registration opens for your hostel
| # | Level | Mode | They do | Verify |
|---|---|---|---|---|
| 1.1 | A name and an OTP | cli | `SET user:1001:name`, `SET otp:1001 483921 EX 120`, `GET`, `TTL`. Key naming `object-type:id` from day one | redis: TTL in (0,120] |
| 1.2 | Points that cannot be lost | cli | `INCR wallet:1001`, `INCRBY`, `DECRBY`. Brainstorm first: why not GET, add, SET? | redis: value, type string; antipattern: none |
| 1.3 | The profile | cli | `HSET user:1001 name college hostel`, `HGET`, `HGETALL`, `HINCRBY user:1001 matches 1`, `HLEN` | redis: fields present |
| 1.4 | Fifty roommates | cli | setup seeds 50 users. `SCAN 0 MATCH user:* COUNT 100` until cursor 0; count them. Teach: `KEYS` blocks the server, debugging only; terminal now warns on `KEYS` | quiz: count |
| 1.5 | The match feed | cli | `LPUSH feed:1001`, `LTRIM feed:1001 0 49`, `LRANGE feed:1001 0 9`, `LLEN` | redis: type list, LLEN ≤ 50 |
| 1.6 | Favourite players | cli | `SADD fav:1001 ...`, `SISMEMBER`, `SCARD`, `SINTER fav:1001 fav:1002` (what you and your roommate both like) | redis: SINTER result |
| 1.7 | The hostel scoreboard | cli | `ZADD lb:hostel:A 120 user:1001`, `ZINCRBY`, `ZRANGE lb:hostel:A 0 9 REV WITHSCORES`, `ZREVRANK`, `ZCARD` | redis: type zset, rank exists; antipattern: no `lb:hostel:A:list` |
| 1.8 | Lobby closes at the toss | cli | `EXPIRE`, `EXPIREAT`, `PERSIST`, `TTL` returns -1 and -2, 1 ms resolution, expiry survives restart | redis: TTL window |
| 1.9 | Login streak | cli | `SETBIT login:1001:2026-11 <day> 1`, `BITCOUNT`, `GETBIT` | redis: bitcount |
| 1.10 | How many people saw the match page | cli | `PFADD visitors:match:42 ...`, `PFCOUNT`, `PFMERGE`; compare `MEMORY USAGE` against a set of the same ids (docs: HLL ≤ 12 KB, 0.81% error) | redis + quiz |
| 1.11 | Where is the watch party | cli | `GEOADD stadiums <lon> <lat> name` (longitude first), `GEOSEARCH stadiums FROMLONLAT ... BYRADIUS 5 km WITHDIST`, `GEODIST` | redis: result count |
| 1.12 | Ball by ball (intro) | cli | `XADD match:42:balls * over 1 ball 1 runs 4`, `XRANGE - +`, `XLEN`, `XREAD BLOCK` | redis: XLEN ≥ 6 |
| 1.13 | The player card | cli | `JSON.SET player:k18 $ '{...}'`, `JSON.GET player:k18 $.stats.avg`, `JSON.NUMINCRBY`, `JSON.ARRAPPEND` | redis: path value |
| 1.14 | Which one would you reach for | decision | Eight scenarios graded against the docs' compare-data-types decision tree, including two where the answer is "a string" and one where it is "not Redis" | quiz |
| 1.15 | Roommate "cleaned up" | cli | Run `FLUSHALL` yourself. Everything is gone, including your progress. Restore from the `.progress` snapshot. Teach: that file is what an RDB is | event: flush + restore |
| 1.16 | First code: register a user | code | `registerUser(u)`: connect with node-redis, `multi().hSet(...).sAdd(...).zAdd(...).exec()`. First look at camelCase commands and the mandatory error handler | behavior |

#### Chapter 2: Everyone showed up (11 levels). Incident: toss at 7:30 pm, stats page takes 4 seconds, Postgres is melting
| # | Level | Mode | They do | Verify |
|---|---|---|---|---|
| 2.1 | Feel it | decision | 100-user scenario runs. Live panel: p99, Postgres queries/s, the slow query. Brainstorm what you would do. No build | quiz |
| 2.2 | Cache-aside v1 | code | `getPlayerStats(id)`: `HGETALL cache:player:{id}`; miss → Postgres → `HSET` + `EXPIRE 30` | traffic: p99 ≥ 5× better than baseline, DB calls −90%; antipattern: `TTL` = −1 → "works, but wrong" |
| 2.3 | Stale is a bug | code | `updatePlayerStats` must `DEL` the cache key after the DB write (docs: "just delete") | behavior: next read fresh; antipattern: writing the cache instead of deleting |
| 2.4 | Stampede at the toss | code | Verifier expires the hot key and fires 500 concurrent reads. Single-flight: Lua `SET lock NX PX`, winner loads, losers poll, release only if token matches | traffic: ≤ 2 DB calls for that key |
| 2.5 | The player who does not exist | code | Bots hammer a bad id. Cache the "not found" sentinel with a short TTL | traffic: DB calls bounded |
| 2.6 | Hit ratio is the number | cli | `INFO stats` → `keyspace_hits`, `keyspace_misses`; compute; `EXISTS` on a missing key counts as a miss | traffic: ratio > 0.9 |
| 2.7 | Fixtures must never miss | code | Prefetch cache: `bulkLoad` pipelined with `multi().execAsPipeline()` (`DEL`+`HSET`+`EXPIRE`), reads only `HGETALL`, no fallback; `applyChange(event)` from the outbox stream | behavior: change applied < 1 s; traffic: zero misses |
| 2.8 | OTP login, properly | code | Session store: `session:{sid}` hash, `HSET`+`EXPIRE` in a MULTI, sliding TTL on read, `DEL` on logout, `SADD user:{id}:sessions` for logout-all. Cookie carries only the opaque id | behavior; antipattern: no TTL or profile data in the cookie |
| 2.9 | The box is full | ops+decision | `CONFIG SET maxmemory 64mb`; watch `evicted_keys` and `noeviction` errors; choose a policy. The trap: sessions and cache in one instance → `volatile-*` or two instances | redis: config; quiz |
| 2.10 | Redis is down, the app is not | ops+code | `docker compose stop redis`. Stats must still serve from Postgres with a timeout; error handler, `connectTimeout`, `disableOfflineQueue`; self-heal on `start` | event + traffic: 0 errors |
| 2.11 | Blank rebuilds | code | Cache-aside, prefetch, session store, from empty files, 20 min each, then follow-up fire | behavior + traffic + quiz |

#### Chapter 3: Compete and talk (13 levels). Incident: rival college scripts hammer OTP, everyone wants the live leaderboard, the SMS vendor sends a bill
| # | Level | Mode | They do | Verify |
|---|---|---|---|---|
| 3.1 | You are not alone | code+ops | Write an in-memory limiter (a Map). Pass. Then `docker compose up --scale game=2 -d`. The same test now lets double through. Nothing in your code changed | traffic before/after |
| 3.2 | Fixed window | code | `INCR` + `EXPIRE` on first hit, `PTTL` for Retry-After. Then the boundary burst test shows 2× through. Kept as a known flaw, not a failure | behavior |
| 3.3 | Token bucket (the official one) | code | Hash `tokens`, `last_refill`; one Lua script via `EVALSHA` with `SCRIPT LOAD` and `NOSCRIPT` fallback; `429` with headers | behavior under 200 concurrent; antipattern: `HMGET` then `HSET` in JS → race fails |
| 3.4 | Sliding window log | code | `ZREMRANGEBYSCORE`, `ZCARD`, `ZADD now uuid`, `EXPIRE window*2`; napkin math on memory per user | behavior + quiz |
| 3.5 | Fail open or fail closed | decision | Redis unreachable: what does the OTP limiter do? Payments endpoint? | quiz |
| 3.6 | The real leaderboard | code | Zset + hash metadata; `ZINCRBY` per ball; top-N `ZRANGE ... REV LIMIT`; `ZREVRANK`; around-me window; 40,000 users | traffic: p99; behavior vs reference; antipattern: list or sort in JS |
| 3.7 | Hostel, college, India | code | Per-window keys with `EXPIRE`, `ZUNIONSTORE` for aggregate boards, `ZREMRANGEBYRANK` to cap, tie-break quiz (lexicographic by member) | behavior |
| 3.8 | Forty thousand updates | code | Recompute points for all users: naive loop vs `multi().execAsPipeline()` in batches of a few thousand. Not atomic, and that is fine here | traffic: time budget |
| 3.9 | Money moves | code | Contest join debits the wallet: `WATCH`/`MULTI`/`EXEC` retry loop with `createClientPool`; 50 parallel joins, balance never negative. Then the Lua version. Then `SET ... IFEQ` and `DELEX` (8.4+) as the modern shortcut | behavior; antipattern: `GET` then `DECRBY` |
| 3.10 | The ticker | code | `PUBLISH score:match:42` per ball; subscriber on `client.duplicate()`; fan out over WebSocket | event |
| 3.11 | Who is online | code | Presence and typing over pub/sub, `PUBSUB NUMSUB`. Then the verifier restarts a subscriber mid-over and counts the gap: at-most-once, demonstrated. Cliffhanger to streams | event |
| 3.12 | Make it a Function | cli+code | Move the token bucket into a library: `FUNCTION LOAD`, `FCALL`; persisted and replicated, unlike `EVAL` | redis + behavior |
| 3.13 | Blank rebuilds | code | Rate limiter, leaderboard, pub/sub | behavior + traffic + quiz |

#### Chapter 4: Work in the background (17 levels). Incident: last over of a chase, 40,000 teams need points per ball, the ticker dropped balls when a worker restarted
| # | Level | Mode | They do | Verify |
|---|---|---|---|---|
| 4.1 | The ball log | code | `XADD match:{id}:balls MAXLEN ~ 10000 * ...`; `XRANGE` replay; `XINFO STREAM` | redis |
| 4.2 | Two workers, every ball once | code | `XGROUP CREATE ... $ MKSTREAM`; two consumers `XREADGROUP GROUP points w1 COUNT 10 BLOCK 2000 STREAMS ... >`; `XACK` | behavior: each ball processed once |
| 4.3 | A worker died | ops+code | Verifier kills w2 mid-batch. `XPENDING`, then `XAUTOCLAIM ... 60000 0-0` from w1 | behavior: nothing lost |
| 4.4 | The poison ball | code | Delivery count ≥ 5 → dead-letter stream, `XACK` the original | behavior |
| 4.5 | Analytics wants it too | code | Second group on the same stream, independent lag; `XINFO GROUPS` → `lag`, `pending`; alert threshold | redis |
| 4.6 | How much history | decision+cli | `XTRIM MINID ~` for 24 h; new group at `$` vs `0-0`; `0` replays your own PEL | quiz + redis |
| 4.7 | The job queue | code | `BLMOVE pending processing RIGHT LEFT`; job hash with `claim_token`, `attempts`; Lua complete/fail that checks the token; reclaimer sweep on visibility timeout; capped history lists | behavior with crash injection; antipattern: `RPOP` → lost on crash |
| 4.8 | Credit the wallet, once | decision+code | At-least-once meets money: idempotency key per job | behavior: double delivery, single credit |
| 4.9 | Later and more important | code | Delayed and priority jobs: zset scored by run-at; `ZRANGE BYSCORE` + `ZREM` made atomic in Lua | behavior |
| 4.10 | Last slot in the contest | code | `SET lock:contest:{id} token NX PX 5000`; release with the compare-and-delete Lua (or `DELEX ... IFEQ`, 8.4+); 500 racers, one winner | behavior |
| 4.11 | The lock expired while you held it | decision | Fencing tokens; Redlock, what it buys and the Kleppmann critique; "is a double-holder ever acceptable here?" | quiz |
| 4.12 | Lobby expired, tell everyone | cli+code | `CONFIG SET notify-keyspace-events Ex`; subscribe `__keyevent@0__:expired`; teach: fires late, fire-and-forget | event |
| 4.13 | Forty thousand sessions expired in one second | code | Expiry storm. Add TTL jitter | redis: TTL spread |
| 4.14 | Is this username taken | code | `BF.RESERVE usernames 0.001 1000000`, `BF.ADD`, `BF.EXISTS`; on "maybe" check Postgres; sizing math (docs: 0.1% ≈ 14.4 bits/item). Cuckoo for "coupon used" because it can delete | redis + quiz |
| 4.15 | Find me a contest | code | `FT.CREATE idx:contest ON JSON PREFIX 1 contest: SCHEMA $.entry NUMERIC $.hostel TAG $.name TEXT`; `FT.SEARCH` with tag + range; `FT.AGGREGATE GROUPBY @hostel REDUCE AVG`; the `[*]` array gotcha | redis |
| 4.16 | The ops wall | code | `TS.CREATE RETENTION LABELS`, `TS.MADD` requests/s and errors, `TS.RANGE ... AGGREGATION avg 3000 ALIGN 0`, `TS.CREATERULE` for 1-min rollups, `TS.MRANGE FILTER`; `TDIGEST` for p99; `TOPK` for trending players | redis |
| 4.17 | Blank rebuilds | code | Streaming, job queue, time series dashboard | behavior + quiz |

#### Chapter 4b: On call (6 levels). Diagnose first, fix second. The code is already written and something is wrong
| # | Scenario | Tools | Pass |
|---|---|---|---|
| 4b.1 | One celebrity player: hot key | `MONITOR` (and what it costs), `INFO commandstats`, Insight profiler | name it, then fix (local cache or client-side caching) |
| 4b.2 | One hash with 2 million fields: big key | `redis-cli --bigkeys`, `MEMORY USAGE`, `OBJECT ENCODING`, `DEBUG OBJECT` | name it, then split and `UNLINK` |
| 4b.3 | A cron runs `KEYS *` | `SLOWLOG GET`, `LATENCY LATEST` | name it, then `SCAN` |
| 4b.4 | Memory grows every day | `INFO memory`, `INFO keyspace` (`expires` count), `--bigkeys` | missing TTLs; fix |
| 4b.5 | Everything froze for 6 seconds | `SLOWLOG`, `SCRIPT KILL`, `busy-reply-threshold` | a Lua loop; fix |
| 4b.6 | Connections climbing | `CLIENT LIST`, `INFO clients` | a client per request; one shared client, `duplicate()` only for blocking and subscribe |

#### Chapter 5: Survive and scale (14 levels). Incident: IPL final. Redis restarts mid-match and every point is gone. Then: one box is not enough
| # | Level | Mode | They do | Verify |
|---|---|---|---|---|
| 5.1 | The crash | ops | Switch to the no-persistence profile, play an over, `docker compose kill redis`, `up`. Everything gone. Brainstorm | event |
| 5.2 | Snapshots | ops+cli | `save 60 1000`, `BGSAVE`, find `dump.rdb` in the volume, kill again, lose the last minute; `INFO persistence` | redis: config; quiz |
| 5.3 | The log | ops+cli | `CONFIG SET appendonly yes` on the live server (order matters); `appendfsync everysec` vs `always`, measured with `redis-benchmark`; `BGREWRITEAOF` | redis: survived kill |
| 5.4 | Both, and backups | decision+ops | Docs guidance: both for Postgres-like safety; copy the RDB safely | quiz |
| 5.5 | How big is it really | cli | `MEMORY USAGE`, `OBJECT ENCODING` listpack→hashtable at `hash-max-listpack-entries 512`; the "hash trick"; docs' numbers: 1M small strings ≈ 85 MB, 1M five-field hashes ≈ 160 MB; `UNLINK` vs `DEL` | quiz |
| 5.6 | The celebrity, again | code | Client-side caching: node-redis `RESP: 3, clientSideCache`; what gets invalidated and when | traffic |
| 5.7 | A second box | ops | Profile `replica`; `REPLICAOF`, `INFO replication`, read a stale value from the replica, `WAIT` and why it is not consistency, `min-replicas-to-write`. The trap from the docs: a master without persistence that auto-restarts wipes its replicas. They do it | event |
| 5.8 | Who decides who is master | ops+code | Three Sentinels, `sentinel monitor mymaster ... 2`, kill the master, watch the failover, app on `createSentinel`; quorum vs majority | event: new master, app recovered |
| 5.9 | Cluster migration capstone | ops+code | Profile `cluster`: `redis-cli --cluster create ... --cluster-replicas 1`; `createCluster`; `CROSSSLOT` errors surface from the verifier; hash tags `{user:1001}`; Lua keys in `KEYS[]`; pub/sub → `SPUBLISH`; `--cluster reshard` | every earlier feature's verifier passes on cluster |
| 5.10 | Port 6379 is on the internet | ops+cli | Rival college found it. Bind to localhost, `requirepass`, `ACL SETUSER worker on >pw ~queue:* +@read +@write -@dangerous`; worker's `FLUSHALL` now `NOPERM` | redis: ACL |
| 5.11 | The doctors | cli | `LATENCY DOCTOR`, `MEMORY DOCTOR`, `SLOWLOG`, `CLIENT PAUSE` for a zero-downtime switch | quiz |
| 5.12 | Managed Redis | decision | What you lose and gain when the company buys it: no `CONFIG SET`, persistence decided for you, cluster as a checkbox, cost per GB | quiz |
| 5.13 | Production checklist | decision | The full checklist, every item earned in an earlier level | quiz |
| 5.14 | Blank rebuild | decision+ops | Given a fresh single node and a budget: choose persistence, replication and failover, justify, configure | redis + quiz |

#### Finale: The architect (5 levels). Placement season
| # | Level | What |
|---|---|---|
| F.1 | Mock interview | Three of the nine use cases drawn at random, blank file, 20 minutes each, follow-up fire after each |
| F.2 | The gauntlet | Fifteen problem statements. Pick the structure or pattern, or say "not Redis", one line of reasoning each, model answers after |
| F.3 | The neighbours | Redis vs Memcached, vs Kafka, vs Postgres `SKIP LOCKED`, vs in-process LRU, vs CDN |
| F.4 | Code review | A PR with planted mistakes. Find them all |
| F.5 | Your story | The game writes the portfolio page from their workspace, impact log and brainstorm history. They push `workspace/` to GitHub |

Roughly 87 levels. Each needs story, teach, task, verifier, reference solution, and at least one wrong solution. That is the real cost of this project; the engine is the smaller half.

### Interview mode (how "by hand in an interview" becomes real)

Building something once inside a guided level is not the same as reproducing it under pressure. So each official use case appears **three times**:

1. **Story build.** Guided, with teach panel, hints, and the "show me" payoff. This is the chapter level.
2. **Blank rebuild.** Later in the same chapter: a new, blank `workspace/` file, a one-paragraph problem statement in interview wording ("Design a rate limiter for an API: 100 requests per user per minute, must be atomic, multiple app servers"), a 20-minute timer, no teach panel. The same `behavior` and `traffic` verifiers grade it. Hints cost XP here.
3. **Follow-up fire.** After the rebuild passes, five quick `decision` prompts in the voice of an interviewer: "What breaks if Redis restarts?", "Two app servers, clock skew, now what?", "A celebrity player: hot key. Fix?", "Why not pub/sub here?" Each answer is auto-checked on choice and shown against a model answer with the reasoning.

The Finale chapter is a **mock interview**: the game draws three of the nine use cases at random, blank file each, timer running, then a decision gauntlet of fifteen real-world problem statements, some of which Redis should *not* solve. Pass mark is strict. The reward is a generated one-page "what I built and why" summary of their own workspace code, which is also a genuinely useful thing to walk into an interview with.

## 6. Build order

1. **Platform.** compose, game server, UI shell, in-browser CLI, level engine, `redis` and `antipattern` verifiers, progress in Redis + snapshot, RedisInsight wiring.
2. **Chapter 0 and Chapter 1.** Content only, all `cli` mode. Ship this.
3. **Playtest with five real beginners.** Watch them, do not help them. Fix Chapter 0 until nobody gets stuck on Docker.
4. **Runner, `behavior` and `traffic` verifiers, autocannon scenarios, Postgres schema and seed, logs panel.** Then Chapter 2 and 3.
5. **Chapter 4, Chapter 5 (compose profiles for replica/sentinel/cluster), blank rebuilds and follow-up fire for all nine use cases, Finale mock interview.**
6. **Polish:** badges, "what you built" panel, docs for writing levels, a contributor guide.

---

## 7. Risks and open decisions

- **Platform: decided, macOS on Apple Silicon with 16 GB.** Docker Desktop memory assignment and port clashes (AirPlay on 5000/7000, Homebrew redis/postgres) are the dropout points now; preflight covers both. Windows and Intel are out of scope for v1.
- **Laptop load.** Bot counts and `traffic` durations need caps and a low-power mode.
- **Image and license.** Which official image carries JSON/Search/Bloom/TimeSeries and RedisInsight, and under what license, is confirmed from the docs digest (section 8 below).
- **Theme and art.** Keep the world minimal (text and simple panels first). The mechanic is the product; art can come later.
- **Real or fictional cricket: decided, fictional.** A fiction bible is written first; names are checked against real cricketers and franchises. The story still says "the final" and feels like IPL night without using the name in product copy.
- **Name.** Placeholder.
- **Where the project lives.** This plan sits in the portfolio repo for now; the game itself should be its own repository from the first commit.
- **Docs drift.** The official docs describe 8.10 features today. Pin the image, state minimum versions in every teach panel, and re-check the use-case pages before writing each chapter.

## 7b. More for an SDE1 who has never seen scale

The persona is a fresh SDE1: has shipped features, has never been on call, has never watched one process become twenty. Redis commands are the easy part. What they lack is the instincts that only come from having been burned. These additions manufacture the burns on a laptop, in order of how much I think they matter.

**Core (build these into the chapters, not as extras)**

1. **"You are not alone" moment (start of Chapter 3).** The game service scales to two instances (`docker compose up --scale game=2`, run by the learner). The in-memory rate limiter they wrote in a warm-up level immediately lets double the traffic through. Nothing in their code changed. This single moment is the whole reason Redis exists for most companies, and most SDE1s have never seen it. Every later pattern (locks, atomic ops, queues, sessions) is taught against two or more app instances from here on.
2. **Resilience drill: Redis is down, the app must not be (Chapter 2 and again in 5).** They stop the redis container. The player stats page must keep serving from the legacy DB, slower but alive, with a timeout and a circuit breaker, and recover on its own when Redis returns. Cache is an accelerator, never a dependency. Verified by `event` plus `traffic`.
3. **On-call chapter: diagnose, do not build (new, between 4 and 5).** Six pre-broken scenarios where the code is already written and something is wrong: a hot key (one celebrity player), a big key (one hash with 2 million fields), a `KEYS *` in a cron, a missing TTL slowly eating memory, a Lua script that blocks for seconds, a client opening a new connection per request. Tools given: `INFO`, `SLOWLOG`, `LATENCY`, `MEMORY USAGE`, `OBJECT ENCODING`, `CLIENT LIST`, `MONITOR` (and what it costs), RedisInsight's profiler. They must name the cause before they may fix it. This is the "Redis latency spiked at 2 am, what do you do?" interview question, and the actual job.
4. **Napkin math levels (scattered, short).** Measure on their own machine, then extrapolate: `MEMORY USAGE` of one player hash times 50 million players; `redis-benchmark` ops per second on their laptop versus what one request needs; a sorted set of 10 million members, fine or not; TTL jitter so 40,000 keys do not expire in the same second (an expiry storm is a Chapter 4 incident). The outcome is a person who can say "that is about 6 GB, one node is fine" in a design review without looking frightened.
5. **Cluster migration capstone (Chapter 5).** Not "learn Cluster" in the abstract: the single-node app they built must move to a 6-node cluster. Multi-key commands break, `MULTI` across slots breaks, pub/sub behaves differently, their leaderboard key needs a hash tag, their Lua touches keys in different slots. They find each break with the verifier and fix it. This is exactly the project an SDE1 gets handed when the company grows, and the learner will have already done it once.
6. **Impact log and portfolio repo.** Every challenge records the metric before and after their change (p99 4,100 ms to 11 ms; DB calls 300/s to 4/s). At the end the game writes a one-page summary of their workspace: what they built, the numbers, the trade-offs they chose. Their `workspace/` is a real fantasy-cricket backend on Redis they can push to GitHub. SDE1s need a portfolio and need to learn to speak in numbers; this gives both.

**Strongly recommended**

7. **Code review levels.** Show a pull request diff that uses Redis badly (five to eight planted issues: no TTL, check-then-set race, `KEYS`, blocking command on the shared connection, no error handling). They must find them. The reverse of building, and the skill they will use every week once they are SDE2.
8. **Client library hygiene (node-redis specifics, woven in).** One connection reused, not one per request. Reconnect strategy. Pub/sub and blocking commands need their own connection. Pipeline versus `MULTI` in the client. Timeouts. Handling `ECONNREFUSED` without crashing. Most production Redis incidents are client-side mistakes, and no course teaches them.
9. **Production checklist badge line.** A running checklist that unlocks item by item across chapters and is shown as a single page at the end: every key has a TTL or a reason not to; key names follow the scheme; no `KEYS`, use `SCAN`; `UNLINK` not `DEL` for big keys; locks always expire; idempotency keys on anything that moves money; alerts on memory, evictions, and latency; Redis never on the public internet. They leave with the list they will be judged by at work.
10. **Security incident (Chapter 5).** The rival college finds port 6379 open on the fest server. Protected mode, `requirepass`, ACL users with least privilege, TLS mention, never public. Relatable and real; open Redis instances remain one of the most common breaches on the internet.
11. **"Redis or something else" decision set (Finale).** Redis versus Memcached, versus Kafka for the event stream, versus Postgres `SKIP LOCKED` for the job queue, versus an in-process LRU for a tiny hot set, versus a CDN for static data. Each a `decision` level with a model answer. "Master" means knowing the neighbours.
12. **Chaos buttons (sandbox, any time after Chapter 2).** A panel: kill Redis, fill memory to `maxmemory`, add 200 ms network latency (`tc` inside the container), partition the replica, set `appendfsync always` and watch throughput drop. They push the button and watch their own game degrade. Learning by breaking, on purpose, with nothing at stake.

**Nice to have**

13. **Explain it to your roommate.** After each chapter, five lines in their own words. Not graded; stored and included in the portfolio summary. Writing the explanation is where understanding gets checked.
14. **Read the docs, on purpose.** One level per chapter where the answer is only in the official docs page and the teach panel just says where to look. The habit of reading the primary source is worth more than any single fact.
15. **Managed Redis awareness.** One short level on what changes when the company moves to a managed service: no `CONFIG SET`, persistence choices made for you, cluster mode as a checkbox, cost per GB. No vendor specifics, just "these exist and here is what you lose and gain."
16. **Revision deck.** The questions they got wrong come back as a short daily drill until they get them right twice. Cheap to build, big effect on retention.

## 8. Facts from the Redis docs that shape the build

Source: the official docs at redis.io/docs/latest, read on 2026-11-01, plus Docker Hub for image tags. Full digest: `redis-docs-digest.md` next to this file. Only facts that change a decision are listed here.

**Packaging**

- **Redis Stack is over.** Redis 8 (May 2025) folded JSON, Search, time series, Bloom, Cuckoo, Count-min, Top-K and t-digest into Redis Open Source; the release notes say all nine components ship in all binary distributions including the Debian and Alpine Docker images. The `redis/redis-stack` images stopped maintenance in December 2025. **Use the official `redis` image, pinned to the 8.x line (`redis:8`, today 8.10.3).** Verify on day one of the build with `MODULE LIST` and `FT._LIST` against the pinned tag; the docs state it but the agent did not run a container.
- **Redis Insight is a separate image**, `redis/redisinsight`, UI on **port 5540** (8001 was the old Stack bundle). Persist with a volume on `/data`, writable by uid 1000. Licence SSPL.
- **The Docker image has protected mode off**, so a published port is open to anyone who can reach the host. Compose binds `127.0.0.1:6379:6379`. Chapter 5.10 deliberately opens it to teach why.
- **Licences:** Redis ≥ 8.0 is tri-licensed RSALv2 / SSPLv1 / AGPLv3. Fine for a local learning tool; worth a line in the README.
- **Windows:** Redis ships no native build; Docker is the path. Matches the plan.
- **Persistence in Docker:** data dir is `/data`; RDB via `--save 60 1000`, AOF via `--appendonly yes`; switching AOF on a live server must be done with `CONFIG SET appendonly yes` first or data can be lost. The 8.0.2+ image fixes `/data` permissions itself.

**Versions that matter for level content**

- Hash field expiry (`HEXPIRE`, `HTTL`) needs 7.4+; `HGETEX`/`HSETEX` 8.0+.
- `SET ... IFEQ` and `DELEX` (compare-and-set / compare-and-delete, the modern safe lock release) need **8.4+**. Teach the Lua release first; it is what interviewers expect.
- `INCREX` (increment + set expiry, built for window counters) is **8.8+**. Mention, do not depend on.
- Streams: `XAUTOCLAIM` 6.2+ (we rely on it); `XACKDEL` 8.2+, `XNACK` 8.8+ (mention only). `BLMOVE` 6.2+ (the job queue depends on it; node-redis v5 removed `brPopLPush`).
- `allkeys-lrm` eviction is 8.6+. The new Arrays type is 8.8+ and out of scope.
- The docs are ahead of most installs (they describe 8.10 features). Every teach panel states the minimum version for what it shows.

**node-redis (v5) facts the code levels depend on**

- Package `redis`; `createClient()`, mandatory `client.on('error')`, `await client.connect()`, `client.close()`. Commands are camelCase (`hSet`, `zAdd`, `json.set`, `ft.search`). Hash values come back as strings.
- Commands issued in one event-loop tick are auto-pipelined; explicit `multi().execAsPipeline()` for batches; `multi().exec()` for transactions. On connection loss the two behave differently (pipeline continues, multi discards).
- `WATCH` is per connection, so on a web server it needs `createClientPool()` and `pool.execute()`, catching `WatchError`. This is a level, not a footnote.
- Subscribers and blocking commands need their own connection: `client.duplicate()`.
- Reconnect is exponential backoff by default; `connectTimeout` defaults to 5 s; the offline queue can replay non-idempotent commands after reconnect, hence `disableOfflineQueue` in the resilience drill.
- Client-side caching needs node-redis ≥ 5.1 and `RESP: 3`; opt-in/broadcast modes are not implemented in node-redis.
- Cluster: `createCluster({rootNodes})`. Sentinel: `createSentinel({name, sentinelRootNodes})`, no URL form.

**Pattern facts the verifiers encode (from the official use-case pages)**

- Rate limiter: the official recommendation is a **token bucket** in a hash via one Lua script; the page's comparison also covers fixed window (2× burst at boundaries), sliding window log (zset, exact, O(n) memory), sliding window counter (two keys sharing a hash tag), leaky bucket. The redis.io tutorial argues sliding window counter is the best default for most APIs. Chapter 3 teaches fixed → token bucket → sliding log, and the quiz asks which to pick.
- Cache-aside: hash per entity with TTL, **delete on write, never update the cache directly**, Lua single-flight lock for stampedes, cache "not found" with a short TTL, lock TTL longer than the worst DB read.
- Prefetch cache: reads never fall back to the primary; a miss is an incident. Bulk load pipelined. CDC via a durable change feed; periodic reconciliation because CDC is eventually consistent and can lose events.
- Session store: hash per session, sliding TTL reset on read, `HSET`+`EXPIRE` in a MULTI, a set per user for logout-all, opaque id in an HttpOnly cookie, an absolute cap in addition to the sliding one.
- Leaderboard: zset per board plus a hash per member, `ZINCRBY`, `ZRANGE REV LIMIT`, `ZREVRANK`, `ZREMRANGEBYRANK` to cap, `ZUNIONSTORE` plus per-window keys for daily/weekly; ties break lexicographically by member.
- Job queue: `BLMOVE pending → processing`, job hash with a per-claim random `claim_token`, Lua complete/fail that checks the token (fencing), reclaimer that moves jobs back after the visibility timeout; at-least-once, so idempotency keys for anything that moves money.
- Pub/sub: at-most-once, offline subscribers lose messages, `PUBLISH` returns the current subscriber count, patterns are evaluated per message, sharded pub/sub on Cluster.
- Streaming: `XADD MAXLEN ~`, `XREADGROUP >`, `XACK`, `XAUTOCLAIM` to self for crashed consumers, replay with an explicit id, `XINFO GROUPS` lag/pending for alerts, dead-letter after N deliveries, one stream = one key = one shard so partition by hash tag, plain `XREAD` has no PEL and cannot ack.
- Time series: key per metric with `LABELS` and `RETENTION`, `TS.MADD`, `TS.RANGE ... AGGREGATION ... ALIGN 0`, `TS.CREATERULE` for rollups, `TS.MRANGE FILTER`.

**Operations facts the ops levels encode**

- Eviction: `maxmemory 0` is unlimited on 64-bit; `noeviction` errors on writes but serves reads; `allkeys-lru` is the docs' default advice; `volatile-*` only works if keys have TTLs; LRU is sampled (`maxmemory-samples`); replication and AOF buffers are not counted, so leave headroom.
- Persistence: docs recommend RDB + AOF for Postgres-like safety, RDB alone if minutes of loss are fine, AOF alone discouraged; `appendfsync everysec` is the default; `fork()` can fail without `vm.overcommit_memory=1`.
- Replication is asynchronous; `WAIT` does not make it consistent; `min-replicas-to-write` bounds the loss window; a master without persistence that auto-restarts empties its replicas.
- Sentinel: at least three, port 26379, quorum decides failure detection but a majority is needed to fail over; Docker/NAT needs care (`replica-announce-ip`).
- Cluster: 16384 slots, CRC16 mod 16384, hash tags `{...}`, multi-key ops only within one slot, bus port +10000, minimum three masters, `redis-cli --cluster create|reshard|check`; Docker port mapping is unsupported, so the cluster profile runs on the compose network and the learner uses `docker compose exec` for `redis-cli`.
- Memory: listpack encodings below `hash-max-listpack-entries 512` / `-value 64` and friends save up to several times the memory; the FAQ's figures (1M small strings ≈ 85 MB, 1M five-field hashes ≈ 160 MB, empty instance ≈ 3 MB) are the napkin-math anchors.
- ACL: the default user is `on nopass ~* &* +@all`; `requirepass` still works; rules apply left to right; Redis 8 adds `@json`, `@search`, `@timeseries`, `@bloom` categories.
- Lua: a script blocks the whole server; `busy-reply-threshold` defaults to 5 s; all keys must be passed in `KEYS[]`; `EVALSHA` can return `NOSCRIPT` after a restart; Functions persist and replicate, scripts do not.
- Keyspace notifications are off by default (`notify-keyspace-events`), fire-and-forget, and `expired` fires when Redis reclaims the key, which can be well after the TTL.

**Docs quirks to handle in teach-panel links**

- Several old URLs redirect: `develop/use/*` pages moved under `develop/using-commands/`, patterns moved to `develop/clients/patterns/`, keyspace notifications under `develop/pubsub/`. Link the canonical URLs.
- Search lives under `develop/ai/search-and-query/` even though we use none of the AI parts.
- The memory-optimization page still says hash fields cannot have a TTL, which has been false since 7.4. Say so when teaching `HEXPIRE`.
- The marketing pages under `redis.io/solutions/` quote vendor benchmarks (hundreds of millions of ops per second, five-nines). Never present those as facts in the game; the technical `develop/use-cases/` pages are the source.


## 9. How it gets built: specs, agents, handoffs, resumability

This is a long build. It is done by many short agent runs, not one long session, so that a session limit, a crash or a day off costs nothing. The rules:

**One task board.** `docs/BUILD.md` lists every task with id, status (`todo` / `in progress` / `blocked` / `done`), owner (which agent run), the spec it follows, and the check that proves it. It is the first file any new session reads, and the last file any agent updates. Nothing is "done" on the board without its check passing.

**One spec per task**, `docs/specs/<id>-<slug>.md`, written before the agent that builds it is spawned. A spec has: goal in two sentences; files it owns (and files it must not touch); interfaces it must honour (types, routes, key prefixes, env names); acceptance checks as commands that exit 0; and what "handoff complete" means. Specs are small enough that an agent can hold one in context with the files it touches.

**One check per task**, `scripts/check/<id>.sh`, executable on the host (macOS) and in CI. `scripts/check/all.sh` runs every check for tasks marked done. A fresh session runs it first to learn what is actually true, instead of trusting the board.

**One handoff per agent run**, `docs/handoffs/<id>.md`: what was done, what was verified and how (command and result), what was not done, what surprised them, and what the next agent should know. Written even when the task is finished cleanly. The orchestrating session reads the handoff, runs the check itself, and only then flips the board.

**Commits per task.** Each finished task is one commit (the atomic-commits convention), message prefixed with the task id, so `git log` is also a build log and a half-done task is never on `main`. Work in progress stays on a branch named after the task.

**Models.** Sonnet 5.5 is the default for every agent run: implementing a spec, writing level content from a chapter brief, porting a check, writing fixtures. Opus is used only for the design-heavy pieces: the slot and target mechanism in the app, the verifier engine, the level-file schema, and the review pass on anything that touches money or correctness semantics. Which runs got Opus is recorded on the board.

**Parallelism.** Tasks that own disjoint files run at the same time (the Postgres schema and the Caddy config, for instance; the fiction bible and the preflight script). Tasks that share a file never run together. The orchestrator decides from the "files it owns" line of each spec.

**Session continuity (Puneet's conventions).** `.claude-project.md` holds the architecture and decisions; `.claude-session-cache.md` holds "currently working on, recent decisions, next steps" and is rewritten by the orchestrator at every board change. A new session after a limit reads `BUILD.md`, runs `check/all.sh`, reads the cache, and continues from the first task that is `in progress` or `todo`.

**Phase 0 before any feature work (the "hit build" tasks):**

| id | task | proves |
|---|---|---|
| P0-01 | Repo skeleton, pnpm workspace, TypeScript base, lint, `BUILD.md`, `.claude-project.md` | `pnpm -r build` passes |
| P0-02 | `docker/node.Dockerfile`, `docker-compose.yml`, `Caddyfile`, `scripts/start`, `scripts/preflight.sh` | `./start` brings every core service healthy on a clean M-series Mac; `redis-cli MODULE LIST` shows search, json, timeseries, bf; Insight reachable on 5540 |
| P0-03 | Fiction bible | `docs/fiction.md` with league, franchises, ~200 players, colleges, hostels, cast; no real names |
| P0-04 | Postgres schema, seed generator, outbox triggers, the deliberately slow query | seed loads under 60 s; stats query measured and recorded |
| P0-05 | Level file schema + loader + validator | invalid level files fail CI with a line number |
| P0-06 | Engine skeleton: health, progress file + Redis mirror, WebSocket, in-browser CLI proxy | play a scripted Chapter 0 from curl |
| P0-07 | App skeleton: baseline routes, slot registry, target switching | `/app/players/:id` serves from Postgres; a workspace file overrides it |
| P0-08 | Runner: load a workspace module, call it with deps, return result + metrics, survive a crash | behavior check on a sample stub |
| P0-09 | Verifier engine: `redis`, `antipattern`, `quiz`, `event`; traffic + behavior wired to runner/autocannon | reference and wrong solutions of a sample level grade correctly |
| P0-10 | UI shell: chapter map, level view with the seven beats, terminal, editor, logs panel, "show me" slot | Chapter 0 playable end to end in the browser |
| P0-11 | Insight auto-provisioning of the `redis` database via its API | fresh start shows the database without manual setup |
| P0-12 | CI: build, lint, level validation, check scripts, Playwright run of Chapter 0 | green on a clean checkout |

Then content tasks per chapter (each chapter is one spec, each level a file, each with reference + wrong solutions), the Chapter 5 profiles, and the finale.
