#!/usr/bin/env bash
# Wrong: -v also removes named volumes, including redis-data.
set -eu
docker compose down -v
docker compose up -d
