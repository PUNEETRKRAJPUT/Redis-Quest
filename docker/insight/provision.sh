#!/bin/sh
# P0-11: provision Redis Insight (runs inside curlimages/curl, POSIX sh, no jq, no Node).
# 1) wait for health  2) accept first-run agreements  3) add the "Redis Quest" database once.
set -eu

INSIGHT="${INSIGHT_URL:-http://insight:5540}"
DB_NAME="Redis Quest"
DB_HOST="${QUEST_REDIS_HOST:-redis}"
DB_PORT="${QUEST_REDIS_PORT:-6379}"
JSON='Content-Type: application/json'

say() { printf 'insight-init: %s\n' "$1"; }

say "waiting for $INSIGHT/api/health/"
i=0
until curl -sf "$INSIGHT/api/health/" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 90 ]; then say "insight never became healthy"; exit 1; fi
  sleep 2
done

# Agreements. eula=true is what the UI's first-run dialog posts when the learner ticks the box.
# analytics and notifications stay off: no usage data leaves the learner's Mac.
settings="$(curl -sf "$INSIGHT/api/settings")"
case "$settings" in
  *'"eula":true'*) say "agreements already accepted" ;;
  *)
    curl -sf -X PATCH "$INSIGHT/api/settings" -H "$JSON" \
      -d '{"agreements":{"eula":true,"analytics":false,"notifications":false,"encryption":false}}' >/dev/null
    say "agreements accepted"
    ;;
esac

# Idempotent: the list is checked by exact name, so a re-run never creates a duplicate.
dbs="$(curl -sf "$INSIGHT/api/databases")"
case "$dbs" in
  *"\"name\":\"$DB_NAME\""*) say "database '$DB_NAME' already present" ;;
  *)
    curl -sf -X POST "$INSIGHT/api/databases" -H "$JSON" \
      -d "{\"name\":\"$DB_NAME\",\"host\":\"$DB_HOST\",\"port\":$DB_PORT}" >/dev/null
    say "database '$DB_NAME' added ($DB_HOST:$DB_PORT)"
    ;;
esac
