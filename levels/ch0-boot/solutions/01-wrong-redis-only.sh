#!/usr/bin/env bash
# Wrong: only the redis service starts. No engine, no web page, so the game never comes up.
set -eu
docker compose up redis
