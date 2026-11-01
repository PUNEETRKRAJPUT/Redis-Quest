#!/usr/bin/env bash
# Wrong: restarting the app adds no copy.
set -eu
API="${QUEST_API:-${API:-http://localhost:3000}}"
docker compose restart app
sleep 10
