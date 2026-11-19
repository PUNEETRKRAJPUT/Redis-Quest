#!/usr/bin/env bash
# Sourced by check scripts that drive Docker Compose. Bash 3.2 compatible.
#
# docker-compose.yml names its project `redis-quest`. A bare `docker compose ...` therefore acts on the stack a
# learner plays on: their containers, their Redis and Postgres data, their save. A check must never do that.
# (On 2026-11-19 an older check did: it stopped a player's Redis and Postgres and ran unit tests against them.)
#
#   . scripts/check/lib/isolate.sh
#   quest_isolate p01 3610 6410 5450 5560      # id, then host ports: proxy redis postgres insight
#
# After that call every `docker compose` in the script, bare ones included, targets the compose project
# `quest-<id>` with its own host ports, image tag, logs, workspace and progress directories: the project name, the
# compose files and the env file are exported as COMPOSE_PROJECT_NAME, COMPOSE_FILE and COMPOSE_ENV_FILES, which
# Compose reads on every call. The function refuses to continue if Compose would still resolve another project.
#
# It exports for the script's own use:
#   QUEST_CHECK_PROJECT   quest-<id>
#   QUEST_CHECK_ENV_FILE  the env file (also exported as ENV_FILE, which scripts/preflight.sh reads)
#   QUEST_CHECK_SCRATCH   scratch tree: logs/ progress/ workspace/
#   QUEST_CHECK_IMAGE     image tag for the Node services of this project
#   QUEST_CHECK_PROXY_PORT QUEST_CHECK_REDIS_PORT QUEST_CHECK_PG_PORT QUEST_CHECK_INSIGHT_PORT
# and defines quest_isolate_down, which removes the project, its volumes and its scratch tree.

quest_isolate() {
  if [ "$#" -ne 5 ]; then
    echo "quest_isolate: usage: quest_isolate <id> <proxy_port> <redis_port> <pg_port> <insight_port>" >&2
    exit 99
  fi
  _qi_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)" || exit 99
  _qi_id="$(printf '%s' "$1" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9-')"
  if [ -z "$_qi_id" ]; then echo "quest_isolate: empty id" >&2; exit 99; fi

  QUEST_CHECK_PROJECT="quest-$_qi_id"
  QUEST_CHECK_SCRATCH="$_qi_root/scripts/check/.scratch/$_qi_id"
  QUEST_CHECK_ENV_FILE="$_qi_root/.env.$_qi_id"
  QUEST_CHECK_IMAGE="quest-$_qi_id-node:latest"
  QUEST_CHECK_PROXY_PORT="$2"; QUEST_CHECK_REDIS_PORT="$3"; QUEST_CHECK_PG_PORT="$4"; QUEST_CHECK_INSIGHT_PORT="$5"

  rm -rf "$QUEST_CHECK_SCRATCH"
  mkdir -p "$QUEST_CHECK_SCRATCH/logs" "$QUEST_CHECK_SCRATCH/progress" "$QUEST_CHECK_SCRATCH/workspace"
  if [ -d "$_qi_root/workspace" ]; then cp -R "$_qi_root/workspace/." "$QUEST_CHECK_SCRATCH/workspace/"; fi

  {
    echo "# Written by scripts/check/lib/isolate.sh for compose project $QUEST_CHECK_PROJECT. Safe to delete."
    echo "PROXY_PORT=$QUEST_CHECK_PROXY_PORT"
    echo "REDIS_PORT=$QUEST_CHECK_REDIS_PORT"
    echo "PG_PORT=$QUEST_CHECK_PG_PORT"
    echo "INSIGHT_PORT=$QUEST_CHECK_INSIGHT_PORT"
    echo "QUEST_PROGRESS_DIR=$QUEST_CHECK_SCRATCH/progress"
    echo "QUEST_WORKSPACE_DIR=$QUEST_CHECK_SCRATCH/workspace"
    echo "QUEST_CHECK_LOGS=$QUEST_CHECK_SCRATCH/logs"
    echo "QUEST_CHECK_IMAGE=$QUEST_CHECK_IMAGE"
  } > "$QUEST_CHECK_ENV_FILE"

  COMPOSE_PROJECT_NAME="$QUEST_CHECK_PROJECT"
  COMPOSE_FILE="$_qi_root/docker-compose.yml:$_qi_root/scripts/check/compose.isolated.yml"
  COMPOSE_ENV_FILES="$QUEST_CHECK_ENV_FILE"
  ENV_FILE="$QUEST_CHECK_ENV_FILE"
  export COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_ENV_FILES ENV_FILE
  export QUEST_CHECK_PROJECT QUEST_CHECK_SCRATCH QUEST_CHECK_ENV_FILE QUEST_CHECK_IMAGE
  export QUEST_CHECK_PROXY_PORT QUEST_CHECK_REDIS_PORT QUEST_CHECK_PG_PORT QUEST_CHECK_INSIGHT_PORT
  # A stray value from the caller's shell would beat the env file; these four must come from it.
  unset PROXY_PORT REDIS_PORT PG_PORT INSIGHT_PORT

  # Fail closed: ask Compose itself which project and which host ports a bare call would use.
  _qi_seen="$(docker compose config --format json 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const c = JSON.parse(s);
        const port = (svc) => String((((c.services || {})[svc] || {}).ports || [{}])[0].published || "");
        process.stdout.write([c.name, port("proxy"), port("redis"), port("postgres")].join(" "));
      } catch { process.stdout.write("unreadable"); }
    });')"
  _qi_want="$QUEST_CHECK_PROJECT $QUEST_CHECK_PROXY_PORT $QUEST_CHECK_REDIS_PORT $QUEST_CHECK_PG_PORT"
  if [ "$_qi_seen" != "$_qi_want" ] || [ "$QUEST_CHECK_PROJECT" = "redis-quest" ]; then
    echo "quest_isolate: REFUSING TO RUN. Compose resolves \"$_qi_seen\", expected \"$_qi_want\"." >&2
    echo "quest_isolate: a check must never act on the default project (a learner's own game)." >&2
    exit 99
  fi
  echo "isolated: compose project $QUEST_CHECK_PROJECT, ports proxy=$QUEST_CHECK_PROXY_PORT redis=$QUEST_CHECK_REDIS_PORT postgres=$QUEST_CHECK_PG_PORT insight=$QUEST_CHECK_INSIGHT_PORT, image $QUEST_CHECK_IMAGE"
}

# Removes the isolated project (containers, volumes, network), its scratch tree and its env file. The image tag is
# kept on purpose: the next run reuses its layers.
quest_isolate_down() {
  if [ -z "${QUEST_CHECK_PROJECT:-}" ] || [ "$QUEST_CHECK_PROJECT" = "redis-quest" ]; then return 0; fi
  docker compose --profile crash --profile replica --profile sentinel --profile cluster down -v --remove-orphans >/dev/null 2>&1
  rm -rf "$QUEST_CHECK_SCRATCH"
  rm -f "$QUEST_CHECK_ENV_FILE"
  echo "docker compose -p $QUEST_CHECK_PROJECT down -v: done"
}
