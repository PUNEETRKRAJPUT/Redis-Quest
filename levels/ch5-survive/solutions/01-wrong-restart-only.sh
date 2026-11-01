#!/usr/bin/env bash
# Wrong: restarts the default `redis`, which saves to disk (RDB 60/1000 plus AOF everysec). It comes back with every key,
# so nothing is lost, the game is never pointed at the crash node, and no redis_target_changed to it ever happens.
set -eu
docker compose restart redis
sleep 5
docker compose exec -T redis redis-cli DBSIZE
