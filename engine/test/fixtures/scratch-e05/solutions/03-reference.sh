#!/usr/bin/env bash
# Reference, like the real ch3-01: a real second copy of the app, left running. The harness puts it back to one after verify.
# E05_EVIDENCE (set by scripts/check/E-05.sh) receives what compose said about the app containers right after the scale.
set -eu
API="${QUEST_API:-${API:-http://localhost:3000}}"
docker compose up -d --scale app=2 app
sleep 10
if [ -n "${E05_EVIDENCE:-}" ]; then
  docker compose ps --format '{{.Project}} {{.Service}} {{.Name}}' app > "$E05_EVIDENCE.stay"
fi
