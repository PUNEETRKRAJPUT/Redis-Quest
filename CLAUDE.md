# Redis Quest: conventions for every agent and session

Read in this order before doing anything: `docs/BUILD.md` (the task board), `.claude-session-cache.md`
(where the last session stopped), then the spec for your task in `docs/specs/`. `docs/PLAN.md` is the
full design; read the sections your spec points to, not the whole thing.

## What this is
A local, story-driven Redis learning game for backend SDE1s. Fully local: Docker Compose on the
learner's Mac, nothing hosted. Fictional cricket league. No AI, vector or LLM content anywhere.

## Hard constraints
- **macOS on Apple Silicon only, 16 GB RAM minimum.** Every image `platform: linux/arm64`. Never
  `linux/amd64`. Scripts run under macOS: `#!/usr/bin/env bash` compatible with bash 3.2, or POSIX sh;
  BSD `sed -i ''`, no GNU-only flags, no associative arrays.
- **Ports (host side, all bound to 127.0.0.1):** 3000 proxy, 5540 insight, 6379 redis, 5432 postgres,
  6380 replica, 26379-26381 sentinels, 7100-7105 cluster. Never 5000, 7000 (AirPlay), 8080, 8001.
- **Memory:** every compose service has `mem_limit`. Budget in PLAN.md section 2.
- **No Docker socket** in any container. The engine never controls Docker; it instructs and detects.
- **Stack:** Node 22 (`node:22-bookworm-slim`), TypeScript, pnpm workspace, Fastify, node-redis v5
  (`redis` package), `pg`, autocannon, Caddy, React + Vite, xterm.js, Monaco. Learner files in
  `workspace/` are plain JavaScript ES modules exporting one function that receives `{ redis, db, log }`.
- **Reserved Redis key prefix:** `game:*` belongs to the engine. Levels use their own prefixes.
- **Images:** `redis:8`, `redis/redisinsight:latest`, `postgres:16`, `caddy:2-alpine`.
- **Secrets:** none. Local credentials live only in `docker-compose.yml` and `.env.example`.

## How work happens (one task = one spec = one check = one handoff = one commit)
1. Your task has a spec at `docs/specs/<id>-<slug>.md`. It lists the files you own. Do not touch files
   outside that list; if you must, stop and say so in your handoff instead.
2. Build it. Make `scripts/check/<id>.sh` pass on this Mac (`chmod +x`, exit 0 on success, print
   what it verified). Run it yourself before you hand off, and paste the output in the handoff.
3. Write `docs/handoffs/<id>.md`: what you did, what you verified (commands and results), what you
   did not do, what surprised you, what the next agent must know. Always, even on a clean finish.
4. Do **not** edit `docs/BUILD.md` status columns and do **not** commit. The orchestrating session
   runs your check, reads your handoff, commits, and flips the board.
5. Never invent a Redis fact. If it is not in `docs/redis-docs-digest.md` or the official docs, say
   "not verified" in the handoff.

## Commits (orchestrator only)
One commit per task on `main` (small project, trunk-based). Message: `<task id>: <what>` in the
imperative, body if useful, and end with:
`Co-Authored-By: puneets-hermes-agent <puneets-hermes-agent@users.noreply.github.com>`

## Style
TypeScript strict. No default exports except where a framework requires one. Small modules. Tests
with `node:test` or vitest, whichever the spec names. Comments say why, not what.
