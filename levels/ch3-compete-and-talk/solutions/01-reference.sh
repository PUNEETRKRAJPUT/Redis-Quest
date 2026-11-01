#!/usr/bin/env bash
# Reference for level 1: the limiter is per process, so a second copy of the app doubles what gets through.
# Run from the repo root, after starting the level.
set -u

# 1. One instance: ten allowed, twenty denied.
scripts/hit.sh 30

# 2. A second copy of the app, "for capacity". Nothing in the code changes.
docker compose up -d --scale app=2 app
sleep 10

# 3. A fresh user (the first user's window is still running): about twenty get through, and instances=2.
scripts/hit.sh 30 u-000011

# 4. Leave both copies running for the rest of the chapter.
