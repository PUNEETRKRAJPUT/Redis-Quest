# G-03: no check may act on the default compose project

## Why
`docker-compose.yml` names its project `redis-quest`. That is the stack a learner plays on. Five platform checks
from Phase 0 (`P0-01`, `P0-02`, `P0-06`, `P0-08`, `P0-11`) called `docker compose` bare. They were written when
the only stack on the machine was the developer's own throwaway one. `scripts/check/all.sh` and
`scripts/check/ci-local.sh` run every `P*.sh`, so the documented "full local run" would, on a machine where
somebody also plays the game:

- stop and remove the player's containers (`P0-02`, `P0-11`: `docker compose down`),
- run the app and runner unit tests against the player's Redis and Postgres (`P0-01`), which write and delete
  keys and rows,
- recreate the player's engine with scratch directories (`P0-06`),
- delete the player's Redis Insight volume (`P0-11`: `docker volume rm redis-quest_insight-data`).

On 2026-11-19 this happened for real: `P0-01` was run while the owner's game was up. It stopped his Redis and
Postgres four times and left one test key and six outbox rows behind (found by timestamp and removed; the save
file and every game key were intact).

## What to build
1. `scripts/check/lib/isolate.sh`: `quest_isolate <id> <proxy> <redis> <postgres> <insight>` gives a check its
   own compose project (`quest-<id>`), host ports, image tag, logs, workspace and progress directories by
   exporting `COMPOSE_PROJECT_NAME`, `COMPOSE_FILE` and `COMPOSE_ENV_FILES`, so even bare calls are isolated.
   It asks Compose which project and ports a bare call would use and exits 99 unless they are its own.
   `quest_isolate_down` removes the project, its volumes and its scratch tree.
2. `scripts/check/compose.isolated.yml`: the override the helper adds (own image tag for the Node services, logs
   and mounts in the scratch tree).
3. The five checks call `quest_isolate` before their first compose call and stop reading `.env`, `./logs`,
   `./workspace`, `./.progress` and the image tag `redis-quest-node:latest`.
4. `scripts/check/G-03.sh` (Docker-free, runs in CI): fails when any `scripts/check/*.sh` has a state-changing
   compose call at a command position that is neither scoped with `-p` nor preceded by `quest_isolate`.

## Verify
`scripts/check/G-03.sh` passes on the tree and fails on each of the five original scripts. Each converted check
passes while another compose project named `redis-quest` is running, and that project's containers have the
same ids and start times before and after.
