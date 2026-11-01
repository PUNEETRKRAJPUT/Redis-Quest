#!/usr/bin/env bash
# Reference: a real second copy of the app, then back to one (the event has been seen by then).
# E05_EVIDENCE (set by scripts/check/E-05.sh) receives which compose project this ran against and what it saw.
set -eu
API="${QUEST_API:-${API:-http://localhost:3000}}"
docker compose up -d --scale app=2 app
sleep 10
if [ -n "${E05_EVIDENCE:-}" ]; then
  {
    echo "project=${COMPOSE_PROJECT_NAME:-none}"
    docker compose ps --format '{{.Project}} {{.Service}} {{.Name}}' app
  } > "$E05_EVIDENCE"
fi
docker compose up -d --scale app=1 app
