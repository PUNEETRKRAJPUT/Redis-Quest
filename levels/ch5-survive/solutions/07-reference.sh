#!/usr/bin/env bash
# Reference: the whole level as commands, in the order the task gives them. Graded by hand (the level waits for
# redis_target_changed); run from the repo folder on your Mac with the stack up and the game pointed at redis://redis:6379.
set -eu
API="${API:-http://localhost:3000}"
put_target() { curl -fsS -X PUT "$API/api/target" -H 'content-type: application/json' -d "{\"redisUrl\":\"$1\"}"; echo; }

# 1. the second box (redis-server --replicaof redis 6379)
docker compose --profile replica up -d redis-replica
sleep 5
# 2. on the master: one replica attached, then a write
docker compose exec -T redis redis-cli INFO replication | grep -E 'role|connected_slaves|slave0'
docker compose exec -T redis redis-cli SET score:final 30
# 3. point the game at the replica (the Terminal panel's select): a read works, a write is READONLY
put_target redis://redis-replica:6379
sleep 2
docker compose exec -T redis-replica redis-cli GET score:final                      # "30"
docker compose exec -T redis-replica redis-cli SET score:final 31                   # READONLY You can't write against a read only replica.
docker compose exec -T redis-replica redis-cli INFO replication | grep -E 'role|master_host|master_link_status'
# 4. the way back, then WAIT and the replica settings
put_target redis://redis:6379
docker compose exec -T redis redis-cli WAIT 1 1000                                  # (integer) 1
docker compose exec -T redis redis-cli CONFIG GET min-replicas-to-write
docker compose exec -T redis redis-cli CONFIG GET min-replicas-max-lag
# 5. press Verify in the page, with the target back on redis://redis:6379 and redis-replica still running
