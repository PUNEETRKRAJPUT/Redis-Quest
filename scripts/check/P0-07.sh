#!/usr/bin/env bash
# P0-07 acceptance: the app skeleton (baseline routes, slot registry, target/slot config pull, metrics push,
# scaling). Runs in its own compose project (quest-p07, .env.p07 ports) so it never touches the default
# project other agents use; it only ever stops what it started, with `down -v` on quest-p07. Bash 3.2.
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

PROJECT=quest-p07
ENVF=.env.p07
FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
info() { printf '      %s\n' "$1"; }
section() { printf '\n== %s\n' "$1"; }

if [ ! -f "$ENVF" ]; then
  printf '# P0-07 check only (gitignored): isolated compose project quest-p07 on its own host ports.\nPROXY_PORT=3100\nREDIS_PORT=6391\nPG_PORT=5433\nINSIGHT_PORT=5541\n' > "$ENVF"
fi
PROXY_PORT=$(sed -n 's/^PROXY_PORT=//p' "$ENVF")
BASE="http://127.0.0.1:${PROXY_PORT:-3100}"
DC() { docker compose -p "$PROJECT" --env-file "$ENVF" "$@"; }

# Scratch levels and progress for this project's engine: the real .progress/ belongs to the default
# project, and levels/ may be mid-edit by another agent (a broken level makes every /api route 503).
SCRATCH="$ROOT/logs/.p0-07-check"
rm -rf "$SCRATCH"
mkdir -p "$SCRATCH/levels" "$SCRATCH/progress" logs workspace postgres/init
cp -R levels/_examples/example-cli "$SCRATCH/levels/example-cli"
export QUEST_LEVELS_DIR="$SCRATCH/levels"
export QUEST_PROGRESS_DIR="$SCRATCH/progress"

# The learner file this check installs. Never overwrite a real one.
CACHE_FILE="$ROOT/workspace/ch2/cache.js"
MADE_CH2=""
[ -d "$ROOT/workspace/ch2" ] || MADE_CH2=1
if [ -e "$CACHE_FILE" ]; then
  echo "workspace/ch2/cache.js already exists (a learner file?); refusing to overwrite it. Move it away and re-run."
  exit 1
fi
INSTALLED=""
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/p07.XXXXXX")

finish() {
  section "cleanup"
  DC down -v --remove-orphans >/dev/null 2>&1 && echo "docker compose -p $PROJECT down -v: done"
  if [ -n "$INSTALLED" ]; then rm -f "$CACHE_FILE" && echo "removed workspace/ch2/cache.js"; fi
  if [ -n "$MADE_CH2" ]; then rmdir "$ROOT/workspace/ch2" 2>/dev/null && echo "removed empty workspace/ch2"; fi
  rm -rf "$SCRATCH" "$TMPD"
  if [ "$FAILED" -eq 0 ]; then printf '\nP0-07 OK\n'; exit 0; fi
  printf '\nP0-07 FAILED\n'; exit 1
}
trap finish EXIT
die() { bad "$1"; exit 1; }

# ---- helpers ---------------------------------------------------------------------------------------
# req METHOD PATH [JSON BODY] [extra curl args...] -> sets STATUS, MS (milliseconds), BODY, HDRS
STATUS=""; MS=""; BODY=""; HDRS=""
req() {
  local method=$1 path=$2 data=${3:-}
  shift 3 2>/dev/null || shift $#
  local out
  if [ -n "$data" ]; then
    out=$(curl -s -m 20 -X "$method" -o "$TMPD/body" -D "$TMPD/hdrs" -w '%{http_code} %{time_total}' -H 'content-type: application/json' --data "$data" "$@" "$BASE$path")
  else
    out=$(curl -s -m 20 -X "$method" -o "$TMPD/body" -D "$TMPD/hdrs" -w '%{http_code} %{time_total}' "$@" "$BASE$path")
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
# wait_until LABEL SECONDS CMD... : retry CMD every 0.5 s
wait_until() {
  local label=$1 secs=$2 i=0; shift 2
  while [ $i -lt $((secs * 2)) ]; do
    if "$@"; then return 0; fi
    i=$((i + 1)); sleep 0.5
  done
  return 1
}

section "docker"
docker info >/dev/null 2>&1 && ok "docker is running" || die "docker is not running"

section "install, build, lint (build retried: other agents may be mid-edit)"
pnpm install --frozen-lockfile >/dev/null 2>&1 && ok "pnpm install --frozen-lockfile" || die "pnpm install --frozen-lockfile"
built=""
for attempt in 1 2 3; do
  if pnpm -r build >"$TMPD/build.log" 2>&1; then built=1; break; fi
  echo "build attempt $attempt failed:"; grep -E 'error|ERR' "$TMPD/build.log" | head -5
  sleep 20
done
[ -n "$built" ] && ok "pnpm -r build" || die "pnpm -r build"
pnpm --filter @quest/app lint >"$TMPD/lint.log" 2>&1 && ok "app lint" || { tail -20 "$TMPD/lint.log"; bad "app lint"; }

section "docker compose -p $PROJECT --env-file $ENVF up -d --build redis postgres engine app proxy"
up_ok=""
for attempt in 1 2 3; do
  if DC up -d --build redis postgres engine app proxy >"$TMPD/up.log" 2>&1; then up_ok=1; break; fi
  echo "compose up attempt $attempt failed:"; tail -8 "$TMPD/up.log"
  sleep 20
done
tail -8 "$TMPD/up.log"
[ -n "$up_ok" ] && ok "services started" || die "compose up"

app_up() { req GET /app/health; [ "$STATUS" = "200" ]; }
engine_up() { req GET /health; [ "$STATUS" = "200" ]; }
wait_until "app" 90 app_up && ok "GET /app/health through the proxy on $PROXY_PORT" || { DC logs --tail 30 app; die "app not healthy"; }
expect_js "health: ok, service app, instance, target, activeSlots" 'j.ok===true&&j.service==="app"&&typeof j.instance==="string"&&j.target.redisUrl==="redis://redis:6379"&&Array.isArray(j.activeSlots)'
info "$BODY"
wait_until "engine" 60 engine_up && ok "engine GET /health through the proxy" || { DC logs --tail 30 engine; die "engine not healthy"; }
engine_link() { req GET /app/health; [ "$(js "$BODY" 'j.engine')" = "up" ]; }
wait_until "engine link" 20 engine_link && ok "app pulls config from the engine (engine: up, configEtag $(js "$BODY" 'j.configEtag'))" || bad "app never reached the engine"

# Compose reports postgres healthy while its init-time server (socket only) is still loading the seed; the
# real server comes up after that. Wait until the app can run a real query.
seeded() { req GET /app/players/p-001; [ "$STATUS" = "200" ]; }
wait_until "seed" 180 seeded && ok "postgres seeded and reachable from the app" || die "postgres never became queryable: $BODY"

section "app vitest (real node app process, stub engine, quest-p07 redis + postgres)"
if pnpm --filter @quest/app test >"$TMPD/test.log" 2>&1; then
  ok "app vitest: $(grep -E '^ +Tests ' "$TMPD/test.log" | sed 's/^ *//')"
else
  tail -40 "$TMPD/test.log"; bad "app vitest"
fi

section "baseline routes (seed ids from docs/handoffs/P0-04.md)"
req PUT /api/slots '{"active":[]}'; expect_status "PUT /api/slots [] (start clean)" 200
req GET /app/players/p-028; expect_status "GET /app/players/p-028" 200
expect_js "player row" 'j.id==="p-028"&&j.team_id==="t-02"'
req GET /app/players/p-028/stats; expect_status "GET /app/players/p-028/stats" 200
expect_js "player_stats row: 24 columns in order, numerics as strings" 'Object.keys(j).join()==="player_id,name,team_id,role,matches_played,innings_batted,runs,balls_faced,fours,sixes,dismissals,batting_avg,strike_rate,balls_bowled,runs_conceded,wickets,economy,selected_count,selected_pct,captain_pct,last5_selected_pct,last5_points,avg_team_points,last5_avg_team_points"&&typeof j.selected_pct==="string"'
[ "$(hdr x-quest-slots)" = "cache.getPlayerStats=baseline" ] && ok "x-quest-slots: cache.getPlayerStats=baseline" || bad "x-quest-slots header: $(hdr x-quest-slots)"
req GET /app/players/p-999/stats; expect_status "GET /app/players/p-999/stats (unknown)" 404
expect_js "404 body is { error: player_not_found }" 'JSON.stringify(j)==="{\"error\":\"player_not_found\"}"'
req POST /app/players/p-028/stats/refresh ''; expect_status "POST /app/players/p-028/stats/refresh" 200
req GET /app/fixtures; expect_status "GET /app/fixtures" 200
expect_js "fixtures: live m-041, m-042 present, no completed match" 'const ids=j.fixtures.map(f=>f.id);ids.includes("m-041")&&ids.includes("m-042")&&!ids.includes("m-001")&&j.fixtures.every(f=>f.status!=="completed")'
req POST /app/login '{"userId":"u-000010"}'; expect_status "POST /app/login u-000010" 200
SID_COOKIE=$(hdr set-cookie | sed 's/;.*//')
case "$SID_COOKIE" in sid=*) ok "Set-Cookie sid";; *) bad "no sid cookie";; esac
req GET /app/me '' -H "cookie: $SID_COOKIE"; expect_status "GET /app/me with cookie" 200
expect_js "me.userId is u-000010" 'j.userId==="u-000010"'
req GET /app/me; expect_status "GET /app/me without cookie" 401
req GET '/app/leaderboard/1?limit=10'; expect_status "GET /app/leaderboard/1?limit=10" 200
expect_js "10 entries, ranked, points descending" 'j.entries.length===10&&j.entries.every((e,i)=>e.rank===i+1&&(i===0||j.entries[i-1].points>=e.points))'
req GET /app/leaderboard/62; expect_status "GET /app/leaderboard/62" 200
req GET /app/limits/ping '' -H 'x-user-id: u-020000'; expect_status "GET /app/limits/ping (x-user-id u-020000)" 200
req POST /app/register '{"id":"u-p07-check","name":"Check Student","college_id":"c-02","hostel_id":"h-c-02-1"}'; expect_status "POST /app/register" 201
req POST /app/register '{"id":"u-p07-check","name":"Check Student","college_id":"c-02","hostel_id":"h-c-02-1"}'; expect_status "POST /app/register again" 409

section "baseline latency of GET /app/players/:id/stats (slow by design, through the proxy)"
MIN=999999
for id in p-028 p-101 p-151 p-028 p-101 p-151; do
  req GET "/app/players/$id/stats"
  printf '      %s  HTTP %s  %s ms\n' "$id" "$STATUS" "$MS"
  MIN=$(awk -v a="$MIN" -v b="$MS" 'BEGIN { print (b < a) ? b : a }')
done
req GET /app/players/p-001/stats; printf '      %s  HTTP %s  %s ms (cold control)\n' p-001 "$STATUS" "$MS"
if awk -v m="$MIN" 'BEGIN { exit !(m > 100) }'; then ok "hot player stats take over 100 ms (fastest of 6: $MIN ms)"; else bad "hot player stats too fast ($MIN ms)"; fi

section "activate cache.getPlayerStats via the engine with a cache-aside learner file"
mkdir -p "$ROOT/workspace/ch2"
cp app/test/fixtures/cache-aside.js "$CACHE_FILE" && INSTALLED=1 && ok "copied app/test/fixtures/cache-aside.js to workspace/ch2/cache.js"
req GET '/api/metrics?seconds=300'; ENGINE_BEFORE=$BODY
req GET /app/metrics; APP_RC_BEFORE=$(js "$BODY" '(j.totals["GET /app/players/:id/stats"]||{redisCommands:0}).redisCommands')
req PUT /api/slots '{"active":["cache.getPlayerStats"]}'; expect_status "PUT /api/slots [cache.getPlayerStats]" 200
slot_loaded() { req GET /app/slots; [ "$(js "$BODY" 'j.slots.find(s=>s.name==="cache.getPlayerStats").state')" = "loaded" ]; }
wait_until "slot" 15 slot_loaded && ok "app applied the config and loaded the learner file (within one poll)" || bad "slot never loaded: $BODY"
req GET /app/health; expect_js "health lists the active slot" 'j.activeSlots.includes("cache.getPlayerStats")'
req GET /app/players/p-151/stats; expect_status "first call p-151 (miss: Postgres, then HSET)" 200
info "first call: $MS ms, $(hdr x-quest-slots)"
[ "$(hdr x-quest-slots)" = "cache.getPlayerStats=learner" ] && ok "served by the learner's code" || bad "x-quest-slots: $(hdr x-quest-slots)"
req GET /app/players/p-151/stats; expect_status "second call p-151 (hit)" 200
SECOND_MS=$MS
expect_js "cached row has the same player" 'j.player_id==="p-151"&&j.name.length>0'
if awk -v m="$SECOND_MS" 'BEGIN { exit !(m < 20) }'; then ok "second call under 20 ms ($SECOND_MS ms)"; else bad "second call took $SECOND_MS ms (want < 20)"; fi
sleep 2.5
req GET /app/metrics; APP_RC_AFTER=$(js "$BODY" '(j.totals["GET /app/players/:id/stats"]||{redisCommands:0}).redisCommands')
req GET '/api/metrics?seconds=300'; ENGINE_AFTER=$BODY
ENGINE_HAS_RC=$(js "$ENGINE_AFTER" 'typeof (j.routes["GET /app/players/:id/stats"]||{}).redisCommands==="number"')
C_BEFORE=$(js "$ENGINE_BEFORE" '(j.routes["GET /app/players/:id/stats"]||{count:0}).count')
C_AFTER=$(js "$ENGINE_AFTER" '(j.routes["GET /app/players/:id/stats"]||{count:0}).count')
if [ "$C_AFTER" -gt "$C_BEFORE" ] 2>/dev/null; then ok "engine GET /api/metrics received the stats route (count $C_BEFORE -> $C_AFTER)"; else bad "engine metrics count did not rise ($C_BEFORE -> $C_AFTER)"; fi
if [ "$ENGINE_HAS_RC" = "true" ]; then
  RC_B=$(js "$ENGINE_BEFORE" '(j.routes["GET /app/players/:id/stats"]||{redisCommands:0}).redisCommands')
  RC_A=$(js "$ENGINE_AFTER" 'j.routes["GET /app/players/:id/stats"].redisCommands')
  if [ "$RC_A" -gt "$RC_B" ] 2>/dev/null; then ok "redisCommands rises in engine GET /api/metrics ($RC_B -> $RC_A)"; else bad "redisCommands did not rise in engine metrics ($RC_B -> $RC_A)"; fi
else
  info "NOTE: the engine's GET /api/metrics aggregate keeps only count/errors/p50Ms/p99Ms per route (engine/src/metrics.ts),"
  info "      so redisCommands is not visible there; checking the same pushed numbers at the source (GET /app/metrics)."
  if [ "$APP_RC_AFTER" -gt "$APP_RC_BEFORE" ] 2>/dev/null; then ok "redisCommands rises in the pushed app metrics ($APP_RC_BEFORE -> $APP_RC_AFTER)"; else bad "redisCommands did not rise ($APP_RC_BEFORE -> $APP_RC_AFTER)"; fi
fi

section "replace the learner file with one that throws"
cp app/test/fixtures/cache-throws.js "$CACHE_FILE"
touch "$CACHE_FILE"
throws_now() { req GET /app/players/p-028/stats; [ "$STATUS" = "500" ]; }
wait_until "throwing file" 15 throws_now && ok "GET /app/players/p-028/stats -> 500 after the edit (hot reload)" || bad "never got 500: $STATUS $BODY"
SLOT_ERR=$(hdr x-quest-slot-error)
[ "$SLOT_ERR" = "cache exploded for p-028" ] && ok "x-quest-slot-error: $SLOT_ERR" || bad "x-quest-slot-error header: '$SLOT_ERR'"
expect_js "500 body names the slot" 'j.error==="slot_error"&&j.slot==="cache.getPlayerStats"'
req GET /app/health; expect_status "app still healthy" 200
req GET /app/players/p-001; expect_status "other routes still served" 200
grep -q 'learner code in slot cache.getPlayerStats failed: Error: cache exploded for p-028' logs/app/app.log && ok "error logged to logs/app/app.log" || bad "error not in logs/app/app.log"

section "docker compose -p $PROJECT --env-file $ENVF up -d --scale app=2 app"
DC up -d --scale app=2 app >"$TMPD/scale.log" 2>&1 && ok "scaled app to 2" || { cat "$TMPD/scale.log"; bad "scale"; }
tail -4 "$TMPD/scale.log"
two_running() { [ "$(DC ps --status running -q app | wc -l | tr -d ' ')" = "2" ]; }
wait_until "two app containers" 30 two_running && ok "two app containers running" || bad "app containers: $(DC ps app)"
sleep 3
INSTANCES=""
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  req GET /app/health
  [ "$STATUS" = "200" ] && INSTANCES="$INSTANCES $(js "$BODY" 'j.instance')"
done
DISTINCT=$(printf '%s\n' $INSTANCES | sort -u)
N_DISTINCT=$(printf '%s\n' "$DISTINCT" | grep -c .)
info "instances seen in 20 calls: $(printf '%s\n' $INSTANCES | sort | uniq -c | awk '{printf "%s x%s  ", $2, $1}')"
[ "$N_DISTINCT" -ge 2 ] && ok "/app/health through the proxy shows $N_DISTINCT different instances" || bad "only $N_DISTINCT instance seen through the proxy"
both_in_engine() {
  req GET '/api/metrics?seconds=10'
  local inst
  for inst in $DISTINCT; do
    [ "$(js "$BODY" "j.instances.includes('$inst')")" = "true" ] || return 1
  done
  return 0
}
wait_until "engine instances" 10 both_in_engine && ok "engine GET /api/metrics lists both instances: $(js "$BODY" 'j.instances.join(", ")')" || bad "engine instances: $(js "$BODY" 'j.instances')"
both_slot() { req GET /app/health; [ "$(js "$BODY" 'j.activeSlots.includes("cache.getPlayerStats")')" = "true" ]; }
SAW=0
for i in 1 2 3 4 5 6; do both_slot && SAW=$((SAW + 1)); done
[ "$SAW" = "6" ] && ok "every instance follows the engine's active slots" || bad "an instance did not apply the active slots ($SAW/6)"
