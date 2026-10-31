#!/usr/bin/env bash
# Wrong: -v also removes the named volumes, including Redis's data directory.
set -eu
docker compose down -v
./scripts/start
