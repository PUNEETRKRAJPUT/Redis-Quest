#!/usr/bin/env bash
# P0-11 acceptance: Insight comes up with agreements accepted and exactly one "Redis Quest" database.
# Bash 3.2 compatible. Starts from a fresh insight-data volume, leaves the stack down on exit.
set -u
cd "$(dirname "$0")/../.." || exit 1

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }
finish() {
  section "docker compose down"
  docker compose down >/dev/null 2>&1 && echo "stack down"
  if [ "$FAILED" -eq 0 ]; then printf '\nP0-11 OK\n'; exit 0; fi
  printf '\nP0-11 FAILED\n'; exit 1
}

[ -f .env ] || cp .env.example .env
envval() {
  local v
  eval "v=\${$1:-}"
  [ -z "$v" ] && v="$(grep -E "^$1=" .env | tail -n 1 | sed 's/^[^=]*=//')"
  printf '%s' "${v:-$2}"
}
INSIGHT_PORT="$(envval INSIGHT_PORT 5540)"
API="http://127.0.0.1:$INSIGHT_PORT/api"

section "fresh state"
docker compose down >/dev/null 2>&1
# Only this project's insight volume: a first run must work from nothing.
docker volume rm redis-quest_insight-data >/dev/null 2>&1
echo "insight-data volume removed (if it existed)"

section "docker compose up -d redis insight insight-init"
if docker compose up -d redis insight insight-init >/dev/null 2>&1; then ok "services started"; else bad "compose up failed"; finish; fi

section "wait for insight-init to finish"
CID="$(docker compose ps -a -q insight-init)"
STATE=""
i=0
while [ "$i" -lt 90 ]; do
  STATE="$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$CID" 2>/dev/null)"
  case "$STATE" in "exited "*) break ;; esac
  i=$((i + 1)); sleep 2
done
docker compose logs insight-init 2>&1 | sed 's/^/  /'
if [ "$STATE" = "exited 0" ]; then ok "insight-init exited 0"; else bad "insight-init state: '$STATE'"; finish; fi

# count_dbs / has_db read the list endpoint; "connectionType" appears once per database object.
dbs() { curl -sf "$API/databases"; }
count_dbs() { dbs | grep -o '"connectionType"' | wc -l | tr -d ' '; }

section "GET /api/databases lists exactly one database"
LIST="$(dbs)"
echo "  $LIST" | cut -c1-200
N="$(count_dbs)"
if [ "$N" = "1" ]; then ok "exactly 1 database"; else bad "expected 1 database, found $N"; fi
case "$LIST" in *'"name":"Redis Quest"'*) ok 'name is "Redis Quest"' ;; *) bad 'name "Redis Quest" missing' ;; esac
case "$LIST" in *'"host":"redis"'*) ok 'host is redis' ;; *) bad 'host redis missing' ;; esac
case "$LIST" in *'"port":6379'*) ok 'port is 6379' ;; *) bad 'port 6379 missing' ;; esac

section "agreements"
SET="$(curl -sf "$API/settings")"
echo "  $SET"
case "$SET" in *'"eula":true'*) ok "eula accepted" ;; *) bad "eula not accepted" ;; esac

section "connection works (Insight can reach redis)"
ID="$(echo "$LIST" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
if [ -n "$ID" ] && curl -sf "$API/databases/$ID/connect" >/dev/null; then ok "GET /databases/{id}/connect succeeded"; else bad "connect failed"; fi

section "re-run insight-init: still exactly one"
if docker compose run --rm --no-deps insight-init 2>&1 | sed 's/^/  /'; then :; fi
N="$(count_dbs)"
if [ "$N" = "1" ]; then ok "still exactly 1 database after a second run"; else bad "found $N databases after second run"; fi

finish
