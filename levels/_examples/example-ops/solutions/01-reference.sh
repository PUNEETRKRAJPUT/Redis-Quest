#!/usr/bin/env bash
# Reference: containers go away, the redis-data volume stays.
set -eu
docker compose down
docker compose up -d
