#!/usr/bin/env bash
# Reference: the whole level as commands, in the order the task gives them, with E-03's measured waits. Graded by hand (the level
# waits for sentinel_failover); run from the repo folder on your Mac with the stack up, redis-replica running (level 7) and the
# game pointed at redis://redis:6379. About a minute and a half.
set -eu
API="${API:-http://localhost:3000}"
SENTINEL_URL='sentinel://mymaster@sentinel-1:26379,sentinel-2:26379,sentinel-3:26379'
put_target() { curl -fsS -X PUT "$API/api/target" -H 'content-type: application/json' -d "{\"redisUrl\":\"$1\"}"; echo; }
ask() { docker compose exec -T sentinel-1 redis-cli -p 26379 "$@"; }

# 1. three Sentinels, then ask one who the master is
docker compose --profile sentinel up -d sentinel-1 sentinel-2 sentinel-3
sleep 5
ask SENTINEL get-master-addr-by-name mymaster          # redis 6379
ask SENTINEL replicas mymaster | head -4
# 2. point the game at the Sentinels; write
put_target "$SENTINEL_URL"
sleep 2
curl -fsS "$API/api/target"; echo
curl -fsS -X POST "$API/api/cli" -H 'content-type: application/json' -d '{"command":"SET score:final 31"}' || true; echo
# 3. kill the master; the game's event arrives about 7 seconds later (E-03: 7.3 s)
docker compose stop redis
sleep 12
curl -fsS "$API/api/target"; echo                      # master redis-replica:6379
curl -fsS "$API/app/target"; echo
curl -fsS -X POST "$API/api/cli" -H 'content-type: application/json' -d '{"command":"SET score:final 32"}' || true; echo
ask SENTINEL get-master-addr-by-name mymaster          # redis-replica 6379
ask SENTINEL masters | head -12
# 4. the old master comes back as a replica (about 11 s: E-03 10.8 s)
docker compose start redis
sleep 14
docker compose exec -T redis redis-cli INFO replication | grep -E 'role|master_host|master_link_status'
ask SENTINEL replicas mymaster | grep -A1 -E '^name$' | head -6
# 5. the way back: let Sentinel settle at least 10 s, stop the new master, start it again as a replica, point the game home
sleep 12
docker compose stop redis-replica
sleep 12
ask SENTINEL get-master-addr-by-name mymaster          # redis 6379
docker compose start redis-replica
put_target redis://redis:6379
# 6. press Verify in the page (redis_failover seen, the target is a master), then
# 7. docker compose --profile sentinel stop sentinel-1 sentinel-2 sentinel-3 ; docker compose --profile replica stop redis-replica
