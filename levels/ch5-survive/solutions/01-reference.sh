#!/usr/bin/env bash
# Reference: the whole level as commands, in the order the task gives them. Graded by hand (the level waits for
# redis_target_changed and for a real outage); run it from the repo folder on your Mac with the stack up.
set -eu
API="${QUEST_API:-${API:-http://localhost:3000}}"
put_target() { curl -fsS -X PUT "$API/api/target" -H 'content-type: application/json' -d "{\"redisUrl\":\"$1\"}"; echo; }

# 1. the Redis that does not save
docker compose --profile crash up -d redis-nopersist
# 2. point the game at it (what the Terminal panel's select does)
put_target redis://redis-nopersist:6379
sleep 2
# 3. play an over: six fours and the score. redis-cli straight into the node does exactly what the game's terminal does.
for ball in 1 2 3 4 5 6; do
  docker compose exec -T redis-nopersist redis-cli XADD match:final:balls '*' over 1 ball "$ball" runs 4
done
docker compose exec -T redis-nopersist redis-cli SET score:final 24
docker compose exec -T redis-nopersist redis-cli XLEN match:final:balls
docker compose exec -T redis-nopersist redis-cli GET score:final
# nothing is saved and nothing is going to be: no save point, no log
docker compose exec -T redis-nopersist redis-cli INFO persistence | grep -E 'aof_enabled|rdb_changes_since_last_save'
# 4. crash it the way the roommate did, and bring it back
docker compose kill redis-nopersist
docker compose --profile crash up -d redis-nopersist
sleep 5
# 5. the over and the score are gone
docker compose exec -T redis-nopersist redis-cli XLEN match:final:balls     # (integer) 0
docker compose exec -T redis-nopersist redis-cli GET score:final            # (nil)
# 6. press Verify in the page now, while the game is still pointed at the crash node
# 7. the way back
put_target redis://redis:6379
