#!/usr/bin/env bash
# Wrong: restarting the app does not add a copy. There is still one instance, so the game never sees two, and the
# limiter still counts in one process's memory.
set -u

scripts/hit.sh 30
docker compose restart app
sleep 10
scripts/hit.sh 30 u-000011
