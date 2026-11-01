#!/usr/bin/env bash
# Wrong: the replica profile is never started. The game's switch to redis://redis-replica:6379 is refused (502 target_unreachable),
# so the game never sees redis_target_changed, and the master reports connected_slaves:0.
set -eu
API="${QUEST_API:-${API:-http://localhost:3000}}"
curl -sS -X PUT "$API/api/target" -H 'content-type: application/json' -d '{"redisUrl":"redis://redis-replica:6379","strict":true}' || true
echo
docker compose exec -T redis redis-cli INFO replication | grep -E 'role|connected_slaves'
