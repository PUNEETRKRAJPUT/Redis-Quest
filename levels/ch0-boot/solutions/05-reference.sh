#!/usr/bin/env bash
# Reference: the containers go away, the volume stays, and start brings everything back.
set -eu
docker compose down
./scripts/start
