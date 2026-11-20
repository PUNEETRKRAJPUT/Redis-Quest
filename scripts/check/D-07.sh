#!/usr/bin/env bash
# D-07 acceptance: the Economy League. WRITTEN BUT NOT RUN when the task was built (docs/specs/_days-common.md).
# Starts ONE throwaway redis:8 container (quest-d07-redis, 127.0.0.1:6397) and, later, the built engine as a plain Node
# process on a free port with scratch directories. Never touches a compose project, so it needs no isolate.sh.
# Proves: (1) every house entry scores exactly par (scripts/league/score.mjs), (2) every hole can be beaten: one shorter
# entry per hole, kept in this file, passes its checks in fewer commands than par, (3) scoring leaves database 0 alone,
# (4) a failing entry fails the script, (5) the engine routes answer the same scores. Bash 3.2.
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

NAME=quest-d07-redis
RPORT=6397
URL="redis://127.0.0.1:$RPORT"
FAILED=0
ENGINE_PID=""
SCRATCH=""
ok()   { printf 'PASS  %s\n' "$1"; }
bad()  { printf 'FAIL  %s\n' "$1"; FAILED=1; }
info() { printf '      %s\n' "$1"; }
section() { printf '\n== %s\n' "$1"; }

cleanup() {
  [ -n "$ENGINE_PID" ] && kill "$ENGINE_PID" 2>/dev/null
  docker rm -f "$NAME" >/dev/null 2>&1
  [ -n "$SCRATCH" ] && rm -rf "$SCRATCH"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

rcli() { docker exec "$NAME" redis-cli "$@"; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }

section "setup"
docker rm -f "$NAME" >/dev/null 2>&1
if ! docker run -d --name "$NAME" --platform linux/arm64 -p 127.0.0.1:$RPORT:6379 redis:8 >/dev/null; then
  bad "could not start $NAME"; exit 1
fi
i=0; until rcli ping 2>/dev/null | grep -q PONG; do i=$((i+1)); [ $i -gt 40 ] && { bad "redis did not start"; exit 1; }; sleep 0.5; done
info "$(rcli --version)"
pnpm --silent --filter @quest/shared build && pnpm --silent --filter @quest/engine build || { bad "build failed"; exit 1; }
ok "shared and engine built"
SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/quest-d07.XXXXXX")

# A key in database 0 stands for the player's own data: nothing below may change it.
rcli -n 0 set canary alive >/dev/null
rcli -n 0 set game:canary alive >/dev/null
DB0_BEFORE=$(rcli -n 0 dbsize | tr -d '\r')

section "1. every house entry scores exactly par"
if OUT=$(REDIS_URL="$URL" node scripts/league/score.mjs 2>&1); then ok "score.mjs exit 0"; else printf '%s\n' "$OUT" | tail -30; bad "score.mjs failed on the committed entries"; fi
printf '%s\n' "$OUT" | sed 's/^/      /'
HOLES=$(ls -d golf/holes/*/ | wc -l | tr -d ' ')
TABLES=$(printf '%s\n' "$OUT" | grep -c '^## ')
[ "$HOLES" -ge 6 ] && [ "$TABLES" = "$HOLES" ] && ok "$TABLES tables for $HOLES holes (at least six)" || bad "holes=$HOLES tables=$TABLES"
for h in 01-kit-room 02-player-card 03-season-table 04-bench-to-xi 05-match-feed 06-flash-sale; do
  printf '%s\n' "$OUT" | grep -q "^## $h:" && ok "table for $h" || bad "no table for $h"
done
printf '%s\n' "$OUT" | grep -q 'FAIL' && bad "a FAIL line in the output" || ok "no FAIL line"

section "2. every hole can be beaten (the shorter entries from docs/handoffs/D-07.md)"
cp -R golf "$SCRATCH/golf"
w() { printf '%s\n' "$2" > "$SCRATCH/golf/holes/$1/entries/shorty.redis"; }
w 01-kit-room 'MSET kit:bat 12 kit:ball 30 kit:pads 8 kit:gloves 10 kit:helmet 6'
w 02-player-card 'HSET player:7 name "Meera Rao" team "Hostel Hawks" runs 412 wickets 9'
w 03-season-table 'ZUNIONSTORE lb:all 2 lb:north lb:south'
printf 'SUNIONSTORE squad:xi squad:xi squad:bench\nDEL squad:bench\n' > "$SCRATCH/golf/holes/04-bench-to-xi/entries/shorty.redis"
printf 'LPUSH feed:latest e6 e7 e8\nLTRIM feed:latest 0 4\n' > "$SCRATCH/golf/holes/05-match-feed/entries/shorty.redis"
printf 'SET deal:1 live EX 60\nSET deal:2 live EX 60\nSET deal:3 live EX 60\nSET deal:4 live EX 60\n' > "$SCRATCH/golf/holes/06-flash-sale/entries/shorty.redis"
if OUT2=$(GOLF_DIR="$SCRATCH/golf" REDIS_URL="$URL" node scripts/league/score.mjs 2>&1); then ok "score.mjs exit 0 with a shorter entry in every hole"; else printf '%s\n' "$OUT2" | tail -30; bad "a shorter entry failed"; fi
for h in 01-kit-room 02-player-card 03-season-table 04-bench-to-xi 05-match-feed 06-flash-sale; do
  # the first table row is rank 1: it must be shorty, and its commands column must be under par
  PAR=$(printf '%s\n' "$OUT2" | sed -n "s/^## $h: .*(par \([0-9]*\))$/\1/p")
  ROW=$(printf '%s\n' "$OUT2" | awk -v h="$h:" '$1=="##" && $2==h {on=1} on && /^\| 1 \|/ {print; exit}')
  WHO=$(printf '%s\n' "$ROW" | awk -F'|' '{gsub(/ /,"",$3); print $3}')
  CMDS=$(printf '%s\n' "$ROW" | awk -F'|' '{gsub(/ /,"",$4); print $4}')
  if [ "$WHO" = shorty ] && [ -n "$PAR" ] && [ "$CMDS" -lt "$PAR" ]; then ok "$h: shorty takes $CMDS commands, par is $PAR"; else bad "$h: rank 1 is '$WHO' with '$CMDS' commands, par '$PAR'"; fi
done

section "3. database 0 is untouched, the scratch database is left empty"
[ "$(rcli -n 0 get canary | tr -d '\r')" = alive ] && ok "canary in database 0 intact" || bad "canary changed"
[ "$(rcli -n 0 get game:canary | tr -d '\r')" = alive ] && ok "game:canary in database 0 intact" || bad "game:canary changed"
[ "$(rcli -n 0 dbsize | tr -d '\r')" = "$DB0_BEFORE" ] && ok "database 0 holds the same number of keys ($DB0_BEFORE)" || bad "database 0 changed size"
[ "$(rcli -n 7 dbsize | tr -d '\r')" = 0 ] && ok "database 7 is empty after scoring" || bad "database 7 not empty"

section "4. a bad entry fails the script, with a positioned message"
cp -R golf "$SCRATCH/golf-bad"
printf 'SET kit:bat 21\n' > "$SCRATCH/golf-bad/holes/01-kit-room/entries/wrongo.redis"
printf 'EVAL "return 1" 0\n' > "$SCRATCH/golf-bad/holes/02-player-card/entries/sneaky.redis"
GOLF_DIR="$SCRATCH/golf-bad" REDIS_URL="$URL" node scripts/league/score.mjs >"$SCRATCH/bad.out" 2>&1; RC=$?
[ "$RC" = 1 ] && ok "exit 1" || bad "exit $RC, wanted 1"
grep -q 'FAIL 01-kit-room wrongo: ' "$SCRATCH/bad.out" && ok "wrongo: no score, named" || bad "no FAIL line for wrongo"
grep -q 'sneaky.redis:1:1 (root): EVAL is not allowed' "$SCRATCH/bad.out" && ok "sneaky: EVAL refused at line 1 column 1" || bad "no positioned EVAL refusal"
REDIS_URL="cluster://127.0.0.1:7100" node scripts/league/score.mjs >/dev/null 2>&1; [ "$?" = 2 ] && ok "a cluster URL is refused (exit 2)" || bad "cluster URL not refused"
LEAGUE_DB=0 REDIS_URL="$URL" node scripts/league/score.mjs >/dev/null 2>&1; [ "$?" = 2 ] && ok "LEAGUE_DB=0 is refused (exit 2)" || bad "database 0 not refused"

section "5. the engine routes"
mkdir -p "$SCRATCH/levels" "$SCRATCH/progress" "$SCRATCH/workspace" "$SCRATCH/logs"
cp -R levels/_examples/example-code "$SCRATCH/levels/example-code"
PORT=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
case "$PORT" in 3000|3100|3400|6394|5436) bad "picked a forbidden port $PORT"; exit 1;; esac
BASE="http://127.0.0.1:$PORT"
PORT=$PORT REDIS_URL="$URL" DATABASE_URL="postgres://nobody@127.0.0.1:1/x" GOLF_DIR="$SCRATCH/golf" \
  LOG_DIR="$SCRATCH/logs" PROGRESS_DIR="$SCRATCH/progress" WORKSPACE_DIR="$SCRATCH/workspace" \
  LEVELS_DIR="$SCRATCH/levels" UI_DIST_DIR="$SCRATCH/ui" \
  node engine/dist/main.js >"$SCRATCH/engine.log" 2>&1 &
ENGINE_PID=$!
i=0; until curl -fsS "$BASE/health" >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 60 ] && { bad "engine did not listen"; tail -20 "$SCRATCH/engine.log"; exit 1; }; sleep 0.5; done
curl -fsS "$BASE/api/league" >"$SCRATCH/league.json" || bad "GET /api/league failed"
[ "$(json 'j.scored' <"$SCRATCH/league.json")" = true ] && ok "GET /api/league: scored" || bad "GET /api/league not scored: $(head -c 300 "$SCRATCH/league.json")"
[ "$(json 'j.holes.length' <"$SCRATCH/league.json")" = 6 ] && ok "six holes" || bad "hole count"
[ "$(json 'j.holes[0].entries[0].handle' <"$SCRATCH/league.json")" = shorty ] && ok "board: shorty ranks first in hole 01" || bad "board order"
CODE=$(curl -s -o "$SCRATCH/s.json" -w '%{http_code}' -X POST -H 'content-type: application/json' \
  -d '{"hole":"01-kit-room","entry":"MSET kit:bat 12 kit:ball 30 kit:pads 8 kit:gloves 10 kit:helmet 6"}' "$BASE/api/league/score")
[ "$CODE" = 200 ] && [ "$(json 'j.result.commands + ":" + j.result.underPar' <"$SCRATCH/s.json")" = "1:4" ] && ok "POST score: 1 command, 4 under par" || bad "POST score: $CODE $(head -c 300 "$SCRATCH/s.json")"
[ "$(json 'j.rank.position + ":" + j.rank.tiedWith.join(",")' <"$SCRATCH/s.json")" = "1:shorty" ] && ok "it would tie with shorty for first" || bad "rank: $(head -c 300 "$SCRATCH/s.json")"
CODE=$(curl -s -o "$SCRATCH/s2.json" -w '%{http_code}' -X POST -H 'content-type: application/json' \
  -d '{"hole":"01-kit-room","entry":"SELECT 0\nFLUSHDB"}' "$BASE/api/league/score")
[ "$CODE" = 400 ] && ok "SELECT and FLUSHDB are refused with 400" || bad "refusal: $CODE $(head -c 300 "$SCRATCH/s2.json")"
[ "$(rcli -n 0 get canary | tr -d '\r')" = alive ] && ok "canary still intact after the route scored" || bad "canary changed after the routes"

if [ "$FAILED" = 0 ]; then printf '\nD-07 OK\n'; else printf '\nD-07 FAILED\n'; fi
exit "$FAILED"
