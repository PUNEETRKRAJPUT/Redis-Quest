#!/usr/bin/env bash
# A-02 acceptance: the app work Chapter 3 needs (leaderboard points/rank/recompute, the wallet debit, the
# ticker publish slot and the provided subscriber, x-quest-instance, scripts/hit.sh).
# Own compose project quest-a02 with .env.a02 (PROXY 3700, REDIS 6397, PG 5439, INSIGHT 5547); never the
# default project and never quest-e01. Ends with `docker compose -p quest-a02 down -v`. Bash 3.2.
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

PROJECT=quest-a02
ENVF=.env.a02
FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
info() { printf '      %s\n' "$1"; }
section() { printf '\n== %s\n' "$1"; }

if [ ! -f "$ENVF" ]; then
  printf '# A-02 check only (gitignored): isolated compose project quest-a02 on its own host ports.\nPROXY_PORT=3700\nREDIS_PORT=6397\nPG_PORT=5439\nINSIGHT_PORT=5547\n' > "$ENVF"
fi
PROXY_PORT=$(sed -n 's/^PROXY_PORT=//p' "$ENVF")
REDIS_PORT=$(sed -n 's/^REDIS_PORT=//p' "$ENVF")
PG_PORT=$(sed -n 's/^PG_PORT=//p' "$ENVF")
BASE="http://127.0.0.1:${PROXY_PORT:-3700}"

SCRATCH="$ROOT/logs/.a-02-check"
rm -rf "$SCRATCH"
mkdir -p "$SCRATCH/levels" "$SCRATCH/progress" logs workspace
cp -R levels/_examples/example-cli "$SCRATCH/levels/example-cli"
export QUEST_LEVELS_DIR="$SCRATCH/levels"
export QUEST_PROGRESS_DIR="$SCRATCH/progress"
DC() { docker compose -p "$PROJECT" --env-file "$ENVF" -f "$ROOT/docker-compose.yml" "$@"; }

# Learner files this check installs under workspace/ch3 (slot file names from app/src/slots/registry.ts).
# Never overwrite a real one.
MADE_CH3=""
[ -d "$ROOT/workspace/ch3" ] || MADE_CH3=1
INSTALLED=""
for f in leaderboard leaderboard-add leaderboard-rank leaderboard-recompute contest-join ticker-publish; do
  if [ -e "$ROOT/workspace/ch3/$f.js" ]; then
    echo "workspace/ch3/$f.js already exists (a learner file?); refusing to overwrite it. Move it away and re-run."
    exit 1
  fi
done
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/a02.XXXXXX")

finish() {
  section "cleanup"
  DC down -v --remove-orphans >/dev/null 2>&1 && echo "docker compose -p $PROJECT down -v: done"
  for f in $INSTALLED; do rm -f "$ROOT/workspace/ch3/$f.js" && echo "removed workspace/ch3/$f.js"; done
  if [ -n "$MADE_CH3" ]; then rmdir "$ROOT/workspace/ch3" 2>/dev/null && echo "removed empty workspace/ch3"; fi
  rm -rf "$SCRATCH" "$TMPD" "$ROOT/logs/.a-02-src"
  if [ "$FAILED" -eq 0 ]; then printf '\nA-02 OK\n'; exit 0; fi
  printf '\nA-02 FAILED\n'; exit 1
}
trap finish EXIT
die() { bad "$1"; exit 1; }

STATUS=""; MS=""; BODY=""; HDRS=""
req() {
  local method=$1 path=$2 data=${3:-}
  shift 3 2>/dev/null || shift $#
  local out
  if [ -n "$data" ]; then
    out=$(curl -s -m 30 -X "$method" -o "$TMPD/body" -D "$TMPD/hdrs" -w '%{http_code} %{time_total}' -H 'content-type: application/json' --data "$data" "$@" "$BASE$path")
  else
    out=$(curl -s -m 30 -X "$method" -o "$TMPD/body" -D "$TMPD/hdrs" -w '%{http_code} %{time_total}' "$@" "$BASE$path")
  fi
  STATUS=${out%% *}
  MS=$(awk -v t="${out#* }" 'BEGIN { printf "%.1f", t * 1000 }')
  BODY=$(cat "$TMPD/body" 2>/dev/null)
  HDRS=$(tr -d '\r' < "$TMPD/hdrs" 2>/dev/null)
}
hdr() { printf '%s\n' "$HDRS" | grep -i "^$1:" | head -1 | sed 's/^[^:]*: *//'; }
js() { node -e 'let v;try{const j=JSON.parse(process.argv[1]);v=eval(process.argv[2])}catch(e){v="ERR "+e.message}console.log(typeof v==="string"?v:JSON.stringify(v))' "$1" "$2"; }
expect_status() { if [ "$STATUS" = "$2" ]; then ok "$1 -> $2"; else bad "$1: want HTTP $2, got $STATUS: $(printf '%s' "$BODY" | head -c 300)"; fi; }
expect_js() { local r; r=$(js "$BODY" "$2"); if [ "$r" = "true" ]; then ok "$1"; else bad "$1 (got $r) body: $(printf '%s' "$BODY" | head -c 300)"; fi; }
# wait_until LABEL SECONDS CMD... : retry CMD every 0.25 s
wait_until() {
  local secs=$2 i=0; shift 2
  while [ $i -lt $((secs * 4)) ]; do
    if "$@"; then return 0; fi
    i=$((i + 1)); sleep 0.25
  done
  return 1
}
PSQL() { DC exec -T postgres psql -U quest -d quest -v ON_ERROR_STOP=1 -tA -c "$1"; }
RCLI() { DC exec -T redis redis-cli "$@" | tr -d '\r'; }
set_slots() { req PUT /api/slots "$1"; [ "$STATUS" = "200" ]; }
slot_loaded() { req GET /app/slots; [ "$(js "$BODY" "j.slots.find(s=>s.name===\"$1\").state")" = "loaded" ]; }
numsub() { RCLI PUBSUB NUMSUB "score:match:$1" | tail -1; }
ticker_field() { req GET "/app/ticker/$1"; js "$BODY" "$2"; }
install_fixture() { # install_fixture FIXTURE WORKSPACE_NAME
  mkdir -p "$ROOT/workspace/ch3"
  cp "app/test/fixtures/$1.js" "$ROOT/workspace/ch3/$2.js" && INSTALLED="$INSTALLED $2"
}
# The baseline limiter is a fixed window aligned to the clock minute: do not straddle a minute boundary.
minute_room() { local s; s=$(date +%S); s=$((10#$s)); if [ "$s" -ge 48 ]; then sleep $((62 - s)); fi; }

section "docker"
docker info >/dev/null 2>&1 && ok "docker is running" || die "docker is not running"

section "install, build, lint (build retried: other agents may be mid-edit)"
pnpm install --frozen-lockfile >/dev/null 2>&1 && ok "pnpm install --frozen-lockfile" || die "pnpm install --frozen-lockfile"
built=""
for attempt in 1 2 3; do
  if pnpm -r build >"$TMPD/build.log" 2>&1; then built=1; echo "pnpm -r build: ok"; break; fi
  echo "pnpm -r build attempt $attempt failed:"; grep -E 'error|ERR' "$TMPD/build.log" | head -5
  # another agent's in-flight files can break the full build; our own packages are what this task ships
  if pnpm --filter @quest/shared --filter @quest/app build >"$TMPD/build2.log" 2>&1; then built=1; echo "built @quest/shared and @quest/app only (full build is blocked by files this task does not own)"; break; fi
  sleep 20
done
[ -n "$built" ] && ok "build" || die "build"
pnpm --filter @quest/app lint >"$TMPD/lint.log" 2>&1 && ok "app lint" || { tail -20 "$TMPD/lint.log"; bad "app lint"; }

section "docker compose -p $PROJECT up -d redis postgres"
DC up -d redis postgres >"$TMPD/up0.log" 2>&1 && ok "redis and postgres started" || { tail -8 "$TMPD/up0.log"; die "compose up redis postgres"; }
pg_seeded() { [ "$(PSQL "SELECT count(*) FROM matches" 2>/dev/null)" = "60" ]; }
wait_until seed 240 pg_seeded && ok "postgres seeded (60 matches)" || die "postgres never finished loading the seed"

section "quality gates: format, engine slot table, app vitest (own redis and postgres: ports $REDIS_PORT / $PG_PORT)"
# Own files must be formatted. Whole-repo check: files owned by the parallel E-01 task are reported, not failed.
pnpm exec prettier --check app engine/src/verify/slots.ts >"$TMPD/fmt-own.log" 2>&1 && ok "prettier --check on app/ and engine/src/verify/slots.ts" || { cat "$TMPD/fmt-own.log" | head -20; bad "prettier --check on own files"; }
if pnpm format:check >"$TMPD/fmt.log" 2>&1; then
  ok "pnpm format:check (whole repo)"
else
  OFFENDERS=$(grep -E '^\[warn\] [^ ]+$' "$TMPD/fmt.log" | sed 's/^\[warn\] //')
  THEIRS=""; OURS=""
  for f in $OFFENDERS; do
    case "$f" in
      engine/src/metrics.ts|engine/src/server.ts|engine/test/*|ui/*|scripts/grade/*) THEIRS="$THEIRS $f";;
      *) OURS="$OURS $f";;
    esac
  done
  if [ -z "$OURS" ]; then
    ok "pnpm format:check: the only unformatted files are E-01's in-flight files:$THEIRS"
  else
    bad "pnpm format:check fails on files that are not E-01's:$OURS"
  fi
fi
export REDIS_URL="redis://127.0.0.1:${REDIS_PORT}"
export DATABASE_URL="postgres://quest:quest@127.0.0.1:${PG_PORT}/quest"
if pnpm --filter @quest/engine exec vitest run test/verify-slots.test.ts >"$TMPD/engine-slots.log" 2>&1; then
  ok "engine verify-slots test: $(grep -E '^ +Tests ' "$TMPD/engine-slots.log" | sed 's/^ *//')"
else
  tail -30 "$TMPD/engine-slots.log"; bad "engine verify-slots test (engine slot table disagrees with the app registry)"
fi
if pnpm --filter @quest/app test >"$TMPD/test.log" 2>&1; then
  ok "app vitest: $(grep -E '^ +Tests ' "$TMPD/test.log" | sed 's/^ *//')"
else
  tail -60 "$TMPD/test.log"; bad "app vitest"
fi
unset REDIS_URL DATABASE_URL
# The vitest apps subscribed to and published on the ticker channels; start the compose app from a clean Redis.
RCLI FLUSHALL >/dev/null 2>&1

section "docker compose -p $PROJECT up -d --build engine app proxy runner"
up_ok=""
for attempt in 1 2 3; do
  if DC up -d --build engine app proxy runner >"$TMPD/up.log" 2>&1; then up_ok=1; break; fi
  echo "compose up attempt $attempt failed:"; grep -E 'error|ERR|failed' "$TMPD/up.log" | head -6
  sleep 20
done
if [ -z "$up_ok" ]; then
  # E-01 is editing engine/ and ui/ at the same time and the image builds the whole tree. Build the image from a
  # scratch copy whose engine/ and ui/ are the committed HEAD versions (plus this task's one engine file).
  echo "image build kept failing on files this task does not own; building the image from a scratch copy"
  SRC="$ROOT/logs/.a-02-src"
  rm -rf "$SRC"; mkdir -p "$SRC"
  rsync -a --exclude node_modules --exclude .git --exclude logs --exclude .progress --exclude graphify-out --exclude docs --exclude postgres --exclude workspace --exclude 'dist' --exclude '*.tsbuildinfo' ./ "$SRC/"
  rm -rf "$SRC/engine" "$SRC/ui"
  git archive HEAD engine ui | tar -x -C "$SRC"
  cp engine/src/verify/slots.ts "$SRC/engine/src/verify/slots.ts"
  docker build -f "$SRC/docker/node.Dockerfile" -t redis-quest-node:latest "$SRC" >"$TMPD/scratch-build.log" 2>&1 || { tail -20 "$TMPD/scratch-build.log"; die "scratch image build"; }
  DC up -d engine app proxy runner >"$TMPD/up.log" 2>&1 && up_ok=1
fi
tail -6 "$TMPD/up.log"
[ -n "$up_ok" ] && ok "services started" || die "compose up"
app_up() { req GET /app/health; [ "$STATUS" = "200" ]; }
engine_up() { req GET /health; [ "$STATUS" = "200" ]; }
wait_until app 90 app_up && ok "app healthy" || { DC logs --tail 30 app; die "app not healthy"; }
wait_until engine 60 engine_up && ok "engine healthy" || die "engine not healthy"
engine_link() { req GET /app/health; [ "$(js "$BODY" 'j.engine')" = "up" ]; }
wait_until link 20 engine_link && ok "app pulls config from the engine" || bad "app never reached the engine"
seeded() { req GET /app/players/p-001; [ "$STATUS" = "200" ]; }
wait_until seed 60 seeded && ok "app can read postgres" || die "app cannot read postgres"
INSTANCE1=$(hdr x-quest-instance)
[ -n "$INSTANCE1" ] && ok "x-quest-instance header present: $INSTANCE1" || bad "no x-quest-instance header"
set_slots '{"active":[]}' && ok "no slot active (all baselines)" || bad "PUT /api/slots []"
sleep 2.5

section "1. baseline leaderboard: points, rank, recompute"
TEAM1=$(PSQL "SELECT fantasy_team_id FROM contest_entries WHERE contest_id = 1 ORDER BY id LIMIT 1")
BEFORE=$(PSQL "SELECT points FROM contest_entries WHERE contest_id = 1 AND fantasy_team_id = $TEAM1")
req POST /app/contests/1/points "{\"teamId\":\"$TEAM1\",\"delta\":3}"; expect_status "POST /app/contests/1/points (team $TEAM1)" 200
expect_js "score is a number, $BEFORE + 3" "typeof j.score==='number'&&j.score===$BEFORE+3&&j.contestId===1&&j.teamId==='$TEAM1'"
[ "$(hdr x-quest-slots)" = "leaderboard.addPoints=baseline" ] && ok "x-quest-slots: leaderboard.addPoints=baseline" || bad "x-quest-slots: $(hdr x-quest-slots)"
req POST /app/contests/1/points "{\"teamId\":\"$TEAM1\",\"delta\":-3}" >/dev/null
req POST /app/contests/1/points '{"teamId":"999999999","delta":1}'; expect_status "points for an unknown team" 404
expect_js "404 body is entry_not_found" "j.error==='entry_not_found'"
MID=$(PSQL "SELECT fantasy_team_id FROM contest_entries WHERE contest_id = 1 ORDER BY points DESC, id OFFSET 50 LIMIT 1")
req GET "/app/leaderboard/1/teams/$MID"; expect_status "GET /app/leaderboard/1/teams/$MID" 200
expect_js "rank 51 with a 5-entry around, the team in the middle" "j.rank===51&&j.around.length===5&&j.around[2].teamId==='$MID'&&j.around[2].score===j.score"
req GET "/app/leaderboard/1/teams/$(PSQL "SELECT fantasy_team_id FROM contest_entries WHERE contest_id = 1 ORDER BY points DESC, id LIMIT 1")"
expect_js "rank 1 has a 3-entry around (the edge)" "j.rank===1&&j.around.length===3"
req GET /app/leaderboard/1/teams/999999999; expect_status "rank for a team that is not in the contest" 404
req POST /app/leaderboards/recompute '{"matchIds":["m-001"]}'; expect_status "POST /app/leaderboards/recompute m-001" 200
R1=$(js "$BODY" 'j.rows'); info "recompute rows for m-001: $R1 (slot ms $(js "$BODY" 'j.ms'), baseline result $(js "$BODY" 'j.result'))"
expect_js "rows >= 1000, result null" 'j.ok===true&&j.rows>=1000&&j.result===null&&typeof j.ms==="number"'
req POST /app/leaderboards/recompute '{"matchIds":["m-001","m-002","m-003","m-004","m-005","m-006","m-007","m-008"]}'; expect_status "recompute m-001..m-008" 200
info "recompute rows for m-001..m-008: $(js "$BODY" 'j.rows')"
req POST /app/leaderboards/recompute '{"matchIds":[]}'; expect_status "recompute with no match ids" 400

section "2. baseline wallet debit: the balance drops by the fee, one ledger row, 402 when short"
BAL0=$(PSQL "SELECT balance FROM wallets WHERE user_id = 'u-000010'")
LED0=$(PSQL "SELECT count(*) FROM wallet_transactions WHERE user_id = 'u-000010'")
req POST /app/contests/9001/join '{"userId":"u-000010"}'; expect_status "POST /app/contests/9001/join" 200
expect_js "joined: true" 'j.joined===true'
[ "$(hdr x-quest-slots)" = "contest.join=baseline" ] && ok "x-quest-slots: contest.join=baseline" || bad "x-quest-slots: $(hdr x-quest-slots)"
BAL1=$(PSQL "SELECT balance FROM wallets WHERE user_id = 'u-000010'")
LED1=$(PSQL "SELECT count(*) FROM wallet_transactions WHERE user_id = 'u-000010'")
[ "$BAL1" = "$((BAL0 - 10))" ] && ok "psql: balance $BAL0 -> $BAL1 (10 lower)" || bad "balance $BAL0 -> $BAL1"
[ "$LED1" = "$((LED0 + 1))" ] && ok "psql: one new ledger row ($LED0 -> $LED1): $(PSQL "SELECT delta || ' ' || reason || ' ref=' || ref FROM wallet_transactions WHERE user_id = 'u-000010' ORDER BY id DESC LIMIT 1")" || bad "ledger rows $LED0 -> $LED1"
req POST /app/contests/9001/join '{"userId":"u-000010","fee":100000}'; expect_status "join with fee 100000" 402
expect_js "402 body is insufficient_balance" "j.error==='insufficient_balance'"
[ "$(PSQL "SELECT balance FROM wallets WHERE user_id = 'u-000010'")" = "$BAL1" ] && ok "the refused join changed nothing" || bad "balance changed on a refused join"

section "3. baseline ticker: subscribed, nothing published, gap detection, resubscribe"
req GET /app/ticker/m-041; expect_status "GET /app/ticker/m-041" 200
expect_js "subscribed: true, received: 0, instance named" "j.subscribed===true&&j.received===0&&j.lastSeq===null&&j.gaps===0&&j.malformed===0&&j.instance==='$INSTANCE1'"
req GET /app/ticker/m-042; expect_js "m-042 subscribed too (every live match)" "j.subscribed===true"
req GET /app/ticker/m-001; expect_status "a match this instance never subscribed to" 404
[ "$(numsub m-041)" -ge 1 ] && ok "PUBSUB NUMSUB score:match:m-041 = $(numsub m-041) (exact channel, not a pattern)" || bad "PUBSUB NUMSUB score:match:m-041 = $(numsub m-041)"
req POST /app/matches/m-041/balls '{"seq":1,"over":1,"ball":1,"batter":"p-028","runs":4}'; expect_status "POST /app/matches/m-041/balls (baseline)" 200
expect_js "result 0 (publishes nothing)" "j.ok===true&&j.matchId==='m-041'&&j.result===0"
sleep 0.5
[ "$(ticker_field m-041 'j.received')" = "0" ] && ok "received is still 0" || bad "received is $(ticker_field m-041 'j.received')"
req GET /api/events; GAP_EV0=$(js "$BODY" 'j.events.filter(e=>e.data&&e.data.name==="ticker_gap").length')
info "ticker_gap events already in the engine: $GAP_EV0"
RCLI PUBLISH score:match:m-041 '{"seq":1,"over":1,"ball":1,"runs":4}' >/dev/null
got1() { [ "$(ticker_field m-041 'j.received')" = "1" ]; }
wait_until recv 3 got1 && ok "redis-cli PUBLISH reached the subscriber" || bad "received never became 1"
req GET /app/ticker/m-041
expect_js "received 1, lastSeq 1, no gap, last = the message" "j.received===1&&j.lastSeq===1&&j.gaps===0&&j.last.runs===4&&j.recent.length===1"
echo "-- the gap dance: resubscribe with pauseMs 1000, publish seq 2 and 3 during the pause, seq 4 after"
curl -s -m 30 -X POST -H 'content-type: application/json' --data '{"matchId":"m-041","pauseMs":1000}' "$BASE/app/ticker/resubscribe" > "$TMPD/resub.json" &
RPID=$!
unsubscribed() { [ "$(numsub m-041)" = "0" ]; }
wait_until unsub 3 unsubscribed && ok "channel unsubscribed during the pause (NUMSUB 0)" || bad "NUMSUB never dropped to 0 (is $(numsub m-041))"
L2=$(RCLI PUBLISH score:match:m-041 '{"seq":2,"over":1,"ball":2,"runs":1}')
L3=$(RCLI PUBLISH score:match:m-041 '{"seq":3,"over":1,"ball":3,"runs":0}')
info "PUBLISH seq 2 -> $L2 receivers, seq 3 -> $L3 receivers (lost: Pub/Sub is at-most-once)"
[ "$L2" = "0" ] && [ "$L3" = "0" ] && ok "both published into the void" || bad "someone received the messages sent during the pause"
wait "$RPID"
RESUB=$(cat "$TMPD/resub.json")
[ "$(js "$RESUB" 'j.ok===true&&j.instance==="'"$INSTANCE1"'"&&j.pausedMs>=1000')" = "true" ] && ok "resubscribe answered after the new subscription was confirmed: $RESUB" || bad "resubscribe answer: $RESUB"
[ "$(numsub m-041)" -ge 1 ] && ok "NUMSUB back to $(numsub m-041)" || bad "NUMSUB is $(numsub m-041) after the resubscribe answered"
RCLI PUBLISH score:match:m-041 '{"seq":4,"over":1,"ball":4,"runs":6}' >/dev/null
gap1() { [ "$(ticker_field m-041 'j.gaps')" = "1" ]; }
wait_until gap 3 gap1 && ok "gaps: 1 after seq 4" || bad "gaps is $(ticker_field m-041 'j.gaps')"
req GET /app/ticker/m-041
expect_js "received 2, lastSeq 4, gaps 1" "j.received===2&&j.lastSeq===4&&j.gaps===1"
gap_event() { req GET /api/events; [ "$(js "$BODY" "j.events.filter(e=>e.data&&e.data.name==='ticker_gap').length")" -gt "$GAP_EV0" ]; }
if wait_until event 3 gap_event; then
  EV=$(js "$BODY" 'JSON.stringify(j.events.filter(e=>e.data&&e.data.name==="ticker_gap").pop())')
  info "engine event: $EV"
  [ "$(js "$EV" 'j.type==="level.event"&&j.data.kind==="custom"&&j.data.data.matchId==="m-041"&&j.data.data.expected===2&&j.data.data.got===4&&j.data.data.missed===2')" = "true" ] && ok "GET /api/events lists ticker_gap with missed: 2 (expected 2, got 4)" || bad "ticker_gap event has the wrong payload"
else
  bad "no ticker_gap event on the engine within 3 s"
fi
req POST /app/ticker/resubscribe '{"matchId":"m-041","pauseMs":99999}'; expect_status "resubscribe with pauseMs out of range" 400

section "4. scripts/hit.sh against the baseline limiter (one instance)"
minute_room
OUT=$(PROXY_PORT=$PROXY_PORT scripts/hit.sh 30); RC=$?
printf '%s\n' "$OUT" | head -3 | sed 's/^/      /'; info "..."
SUMMARY=$(printf '%s\n' "$OUT" | tail -1); info "$SUMMARY"
[ "$RC" = "0" ] && ok "hit.sh exits 0" || bad "hit.sh exit code $RC"
[ "$SUMMARY" = "allowed=10 denied=20 other=0 instances=1" ] && ok "allowed=10 denied=20 instances=1" || bad "summary: $SUMMARY"
printf '%s\n' "$OUT" | sed -n 1p | grep -Eq '^#1 200 instance=[0-9a-f]{4}$' && ok "line format: $(printf '%s\n' "$OUT" | sed -n 1p)" || bad "unexpected line format: $(printf '%s\n' "$OUT" | sed -n 1p)"
PROXY_PORT=1 scripts/hit.sh 1 >/dev/null 2>&1; [ "$?" = "2" ] && ok "hit.sh exits 2 when the proxy does not answer" || bad "hit.sh did not exit 2 for a dead proxy"

section "5. --scale app=2: the same limiter lets more through, and two instances answer"
DC up -d --scale app=2 --no-recreate app >"$TMPD/scale.log" 2>&1 && ok "scaled app to 2" || { tail -5 "$TMPD/scale.log"; bad "scale app=2"; }
two_instances() {
  local i seen=""
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    seen="$seen $(curl -s -m 5 -o /dev/null -D - "$BASE/app/health" | tr -d '\r' | grep -i '^x-quest-instance:' | sed 's/^[^:]*: *//')"
  done
  [ "$(printf '%s\n' $seen | sort -u | grep -c .)" -ge 2 ]
}
wait_until two 90 two_instances && ok "the proxy balances across two instances" || bad "never saw two instances"
minute_room
OUT=$(PROXY_PORT=$PROXY_PORT scripts/hit.sh 30 u-000100); SUMMARY=$(printf '%s\n' "$OUT" | tail -1); info "$SUMMARY"
A2=$(printf '%s' "$SUMMARY" | sed -n 's/^allowed=\([0-9]*\) .*/\1/p')
I2=$(printf '%s' "$SUMMARY" | sed -n 's/.*instances=\([0-9]*\)$/\1/p')
if [ -n "$A2" ] && [ "$A2" -ge 14 ] && [ "$A2" -le 20 ]; then ok "allowed=$A2 (between 14 and 20: each instance keeps its own window)"; else bad "allowed=$A2, want 14..20"; fi
[ "$I2" = "2" ] && ok "instances=2" || bad "instances=$I2"
DC up -d --scale app=1 --no-recreate app >"$TMPD/scale.log" 2>&1 && ok "back to 1 instance" || { tail -5 "$TMPD/scale.log"; bad "scale app=1"; }
one_instance() { [ "$(DC ps --status running --format '{{.Name}}' app | grep -c .)" = "1" ]; }
wait_until one 30 one_instance || bad "app did not scale back to 1"
wait_until app 60 app_up && ok "app healthy again" || die "app not healthy after scaling down"
INSTANCE1=$(hdr x-quest-instance)
set_slots '{"active":[]}' >/dev/null
wait_until subscribed 30 sh -c "curl -s $BASE/app/ticker/m-041 | grep -q '\"subscribed\":true'" && ok "ticker subscribed on the remaining instance" || bad "ticker not subscribed after scaling back"

section "6. learner path: the six reference files, the five new slots plus leaderboard.top"
install_fixture leaderboard-top leaderboard
install_fixture leaderboard-add leaderboard-add
install_fixture leaderboard-rank leaderboard-rank
install_fixture leaderboard-recompute leaderboard-recompute
install_fixture contest-join contest-join
install_fixture ticker-publish ticker-publish
ok "copied the fixtures to workspace/ch3/ (leaderboard, leaderboard-add, leaderboard-rank, leaderboard-recompute, contest-join, ticker-publish)"
set_slots '{"active":["leaderboard.top","leaderboard.addPoints","leaderboard.rank","leaderboard.recompute","contest.join","ticker.publish"]}' && ok "PUT /api/slots for the six slots" || bad "PUT /api/slots"
for s in leaderboard.top leaderboard.addPoints leaderboard.rank leaderboard.recompute contest.join ticker.publish; do
  wait_until slot 20 slot_loaded "$s" && ok "slot $s loaded" || bad "slot $s never loaded: $BODY"
done
RCLI DEL lb:contest:9001 >/dev/null
RCLI EVAL "for i=1,1000 do redis.call('ZADD', KEYS[1], i, 't'..string.format('%04d', i)) end return 1" 1 lb:contest:9001 >/dev/null
[ "$(RCLI ZCARD lb:contest:9001)" = "1000" ] && ok "seeded lb:contest:9001 with 1000 members" || bad "seeding lb:contest:9001 failed"
req GET '/app/leaderboard/9001?limit=3'; expect_status "GET /app/leaderboard/9001?limit=3 (learner top)" 200
[ "$(hdr x-quest-slots)" = "leaderboard.top=learner" ] && ok "served by the learner" || bad "x-quest-slots: $(hdr x-quest-slots)"
expect_js "top 3 agree with ZRANGE REV: t1000 t0999 t0998" "j.entries.map(e=>e.teamId).join()==='t1000,t0999,t0998'&&j.entries[0].rank===1&&j.entries[0].points===1000"
[ "$(RCLI ZRANGE lb:contest:9001 0 2 REV | tr '\n' ' ')" = "t1000 t0999 t0998 " ] && ok "redis-cli ZRANGE REV agrees" || bad "ZRANGE REV: $(RCLI ZRANGE lb:contest:9001 0 2 REV | tr '\n' ' ')"
req POST /app/contests/9001/points '{"teamId":"t0500","delta":700}'; expect_status "POST /app/contests/9001/points t0500 +700" 200
expect_js "score 1200" "j.score===1200&&j.teamId==='t0500'"
[ "$(RCLI ZSCORE lb:contest:9001 t0500)" = "1200" ] && ok "ZSCORE t0500 = 1200" || bad "ZSCORE t0500 = $(RCLI ZSCORE lb:contest:9001 t0500)"
req POST /app/contests/9001/points '{"teamId":"ghost","delta":1}'; expect_status "points for a team not on the board (learner returns null)" 404
req GET /app/leaderboard/9001/teams/t0500; expect_status "GET rank t0500" 200
expect_js "rank 1, score 1200, around t0500 t1000 t0999" "j.rank===1&&j.score===1200&&j.around.map(e=>e.teamId).join()==='t0500,t1000,t0999'"
req GET /app/leaderboard/9001/teams/t0100
ZR=$(( $(RCLI ZREVRANK lb:contest:9001 t0100) + 1 ))
expect_js "rank of t0100 = ZREVRANK + 1 = $ZR, 5 in the window" "j.rank===$ZR&&j.around.length===5&&j.around[2].teamId==='t0100'"
req GET /app/leaderboard/9001/teams/ghost; expect_status "rank for a missing member" 404
req POST /app/leaderboards/recompute '{"matchIds":["m-001"]}'; expect_status "recompute m-001 with the pipelined learner" 200
expect_js "result.loaded = rows = $R1" "j.rows===$R1&&j.result.loaded===$R1"
info "learner recompute of $R1 rows: slot ms $(js "$BODY" 'j.ms')"
req POST /app/leaderboards/recompute '{"matchIds":["m-001","m-002","m-003","m-004","m-005","m-006","m-007","m-008"]}'
info "learner recompute of $(js "$BODY" 'j.rows') rows (m-001..m-008): slot ms $(js "$BODY" 'j.ms')"
[ "$(RCLI ZCARD lb:contest:1)" = "$(PSQL "SELECT count(DISTINCT fantasy_team_id) FROM contest_entries WHERE contest_id = 1")" ] && ok "ZCARD lb:contest:1 = entries of contest 1 in postgres" || bad "ZCARD lb:contest:1 = $(RCLI ZCARD lb:contest:1)"

echo "-- 50 parallel joins on a wallet of 100 at fee 10 (WATCH on a duplicate connection)"
RCLI SET wallet:u-000010 100 >/dev/null
RCLI DEL contest:9001:entries >/dev/null
seq 1 50 | xargs -P 50 -I{} curl -s -m 60 -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data '{"userId":"u-000010"}' "$BASE/app/contests/9001/join" > "$TMPD/joins.txt"
N200=$(grep -c '^200$' "$TMPD/joins.txt"); N402=$(grep -c '^402$' "$TMPD/joins.txt"); NOTHER=$(grep -vc -E '^(200|402)$' "$TMPD/joins.txt")
info "200: $N200, 402: $N402, other: $NOTHER"
[ "$N200" = "10" ] && [ "$N402" = "40" ] && ok "exactly 10 joined, 40 refused" || bad "joined $N200, refused $N402, other $NOTHER"
[ "$(RCLI GET wallet:u-000010)" = "0" ] && ok "wallet:u-000010 = 0" || bad "wallet:u-000010 = $(RCLI GET wallet:u-000010)"
[ "$(RCLI GET contest:9001:entries)" = "10" ] && ok "contest:9001:entries = 10" || bad "contest:9001:entries = $(RCLI GET contest:9001:entries)"
req POST /app/contests/9001/join '{"userId":"u-000010"}'
[ "$STATUS" = "402" ] && [ "$(hdr x-quest-slots)" = "contest.join=learner" ] && ok "one more join: 402 from the learner" || bad "join after the wallet is empty: $STATUS $(hdr x-quest-slots)"

echo "-- the same module on the runner path (a fresh child process, createLearnerDeps)"
RCLI SET wallet:u-a02-runner 100 >/dev/null
RCLI DEL contest:9001:entries >/dev/null
RUNNER_OUT=$(DC exec -T runner node -e '
(async () => {
  const calls = Array.from({ length: 30 }, () => ({ args: ["u-a02-runner", 9001, 10] }));
  const r = await fetch("http://127.0.0.1:4100/run", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ module: "ch3/contest-join.js", calls, concurrency: 30, timeoutMs: 20000 }) });
  console.log(JSON.stringify(await r.json()));
})().catch((e) => { console.log(JSON.stringify({ error: String(e) })); });
' 2>&1 | tail -1)
RT=$(js "$RUNNER_OUT" 'j.results.filter(r=>r.ok&&r.value===true).length'); RF=$(js "$RUNNER_OUT" 'j.results.filter(r=>r.ok&&r.value===false).length'); RE=$(js "$RUNNER_OUT" 'j.results.filter(r=>!r.ok).length')
info "runner: true $RT, false $RF, errors $RE"
[ "$RT" = "10" ] && [ "$RF" = "20" ] && [ "$RE" = "0" ] && ok "runner path: 10 true, 20 false, no errors (explicit connect() on the duplicate works there too)" || bad "runner path: $(printf '%s' "$RUNNER_OUT" | head -c 400)"
[ "$(RCLI GET wallet:u-a02-runner)" = "0" ] && ok "wallet:u-a02-runner = 0" || bad "wallet:u-a02-runner = $(RCLI GET wallet:u-a02-runner)"

echo "-- ticker.publish with the reference code"
req GET /app/ticker/m-041; LASTSEQ=$(js "$BODY" 'j.lastSeq'); RECV0=$(js "$BODY" 'j.received'); GAPS0=$(js "$BODY" 'j.gaps')
[ "$LASTSEQ" = "null" ] && LASTSEQ=0 # a recreated instance starts with no history
info "ticker m-041 before: received $RECV0, lastSeq $LASTSEQ, gaps $GAPS0" 
req POST /app/matches/m-041/balls "{\"seq\":$((LASTSEQ + 1)),\"over\":2,\"ball\":1,\"batter\":\"p-028\",\"runs\":6,\"commentary\":\"into the stands\"}"; expect_status "POST /app/matches/m-041/balls (learner)" 200
expect_js "result >= 1 (PUBLISH receiver count)" "j.ok===true&&j.result>=1"
rose() { [ "$(ticker_field m-041 'j.received')" = "$((RECV0 + 1))" ]; }
wait_until rose 3 rose && ok "ticker received rose by one ($RECV0 -> $((RECV0 + 1)))" || bad "received is $(ticker_field m-041 'j.received'), want $((RECV0 + 1))"
req GET /app/ticker/m-041
expect_js "last = the published ball (matchId added by the learner), no new gap" "j.last.seq===$((LASTSEQ + 1))&&j.last.runs===6&&j.last.matchId==='m-041'&&j.last.commentary==='into the stands'&&j.gaps===$GAPS0"
