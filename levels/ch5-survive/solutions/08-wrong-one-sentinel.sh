#!/usr/bin/env bash
# Wrong: only one Sentinel is started. sentinel.conf says quorum 2, so one Sentinel can never agree "the master is down" with anybody:
# no failover, the game never sees sentinel_failover, and the master stays dead until it is started again by hand.
set -eu
API="${QUEST_API:-${API:-http://localhost:3000}}"
docker compose --profile sentinel up -d sentinel-1
sleep 5
curl -sS -X PUT "$API/api/target" -H 'content-type: application/json' \
  -d '{"redisUrl":"sentinel://mymaster@sentinel-1:26379,sentinel-2:26379,sentinel-3:26379"}' || echo "(the switch was refused: the game could not reach a Sentinel)"; echo
docker compose stop redis
sleep 20
docker compose exec -T sentinel-1 redis-cli -p 26379 SENTINEL get-master-addr-by-name mymaster   # still redis 6379: nobody was elected
docker compose start redis
