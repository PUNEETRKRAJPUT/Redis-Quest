#!/usr/bin/env bash
# A-01 acceptance: app plumbing for Chapter 2 levels 2.7, 2.8, 2.10 (outbox drainer, prefetch slots, session
# destroy slots, fail-fast learner Redis, 429 counting). Own compose project quest-p07 with .env.p07, never the
# default project and never quest-p10. Ends with `docker compose -p quest-p07 down -v`. Bash 3.2.
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

SCRATCH="$ROOT/logs/.a-01-check"
rm -rf "$SCRATCH"
mkdir -p "$SCRATCH/levels" "$SCRATCH/progress" logs workspace
cp -R levels/_examples/example-cli "$SCRATCH/levels/example-cli"
export QUEST_LEVELS_DIR="$SCRATCH/levels"
export QUEST_PROGRESS_DIR="$SCRATCH/progress"
# APP_OUTBOX_ALWAYS reaches the app container through a compose override (docker-compose.yml is not ours).
cat > "$SCRATCH/override.yml" <<'YML'
services:
  app:
    environment:
      APP_OUTBOX_ALWAYS: "1"
YML
DC() { docker compose -p "$PROJECT" --env-file "$ENVF" -f "$ROOT/docker-compose.yml" -f "$SCRATCH/override.yml" "$@"; }

# Learner files this check installs. Never overwrite a real one.
MADE_CH2=""
[ -d "$ROOT/workspace/ch2" ] || MADE_CH2=1
INSTALLED=""
for f in cache prefetch-apply prefetch-bulk; do
  if [ -e "$ROOT/workspace/ch2/$f.js" ]; then
    echo "workspace/ch2/$f.js already exists (a learner file?); refusing to overwrite it. Move it away and re-run."
    exit 1
  fi
done
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/a01.XXXXXX")

finish() {
  section "cleanup"
  DC unpause redis >/dev/null 2>&1
  DC down -v --remove-orphans >/dev/null 2>&1 && echo "docker compose -p $PROJECT down -v: done"
  for f in $INSTALLED; do rm -f "$ROOT/workspace/ch2/$f.js" && echo "removed workspace/ch2/$f.js"; done
  if [ -n "$MADE_CH2" ]; then rmdir "$ROOT/workspace/ch2" 2>/dev/null && echo "removed empty workspace/ch2"; fi
  rm -rf "$SCRATCH" "$TMPD"
  if [ "$FAILED" -eq 0 ]; then printf '\nA-01 OK\n'; exit 0; fi
  printf '\nA-01 FAILED\n'; exit 1
}
trap finish EXIT
die() { bad "$1"; exit 1; }

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
now_ms() { node -e 'console.log(Date.now())'; }
slot_loaded() { req GET /app/slots; [ "$(js "$BODY" "j.slots.find(s=>s.name===\"$1\").state")" = "loaded" ]; }
set_slots() { req PUT /api/slots "$1"; [ "$STATUS" = "200" ]; }
cache_keys() { RCLI --scan --pattern 'cache:match:*' | grep -c . ; }
clear_cache_keys() { local k keys; keys=$(RCLI --scan --pattern 'cache:match:*'); for k in $keys; do RCLI DEL "$k" >/dev/null; done; }

section "docker"
docker info >/dev/null 2>&1 && ok "docker is running" || die "docker is not running"

section "install, build, lint (build retried: other agents may be mid-edit)"
pnpm install --frozen-lockfile >/dev/null 2>&1 && ok "pnpm install --frozen-lockfile" || die "pnpm install --frozen-lockfile"
built=""
for attempt in 1 2 3; do
  if pnpm -r build >"$TMPD/build.log" 2>&1; then built=1; break; fi
  echo "pnpm -r build attempt $attempt failed:"; grep -E 'error|ERR' "$TMPD/build.log" | head -5
  # another agent's in-flight files can break the full build; our own packages are what this task ships
  if pnpm --filter @quest/shared --filter @quest/app build >"$TMPD/build2.log" 2>&1; then built=1; echo "built @quest/shared and @quest/app only"; break; fi
  sleep 20
done
[ -n "$built" ] && ok "build" || die "build"
pnpm --filter @quest/app lint >"$TMPD/lint.log" 2>&1 && ok "app lint" || { tail -20 "$TMPD/lint.log"; bad "app lint"; }

section "docker compose -p $PROJECT up -d --build redis postgres engine app proxy (APP_OUTBOX_ALWAYS=1)"
up_ok=""
for attempt in 1 2 3; do
  if DC up -d --build redis postgres engine app proxy >"$TMPD/up.log" 2>&1; then up_ok=1; break; fi
  echo "compose up attempt $attempt failed:"; tail -8 "$TMPD/up.log"
  sleep 20
done
tail -6 "$TMPD/up.log"
[ -n "$up_ok" ] && ok "services started" || die "compose up"
app_up() { req GET /app/health; [ "$STATUS" = "200" ]; }
engine_up() { req GET /health; [ "$STATUS" = "200" ]; }
wait_until app 90 app_up && ok "app healthy" || { DC logs --tail 30 app; die "app not healthy"; }
wait_until engine 60 engine_up && ok "engine healthy" || die "engine not healthy"
engine_link() { req GET /app/health; [ "$(js "$BODY" 'j.engine')" = "up" ]; }
wait_until link 20 engine_link && ok "app pulls config from the engine" || bad "app never reached the engine"
seeded() { req GET /app/players/p-001; [ "$STATUS" = "200" ]; }
wait_until seed 180 seeded && ok "postgres seeded and reachable from the app" || die "postgres never became queryable"
[ "$(DC exec -T app printenv APP_OUTBOX_ALWAYS | tr -d '\r')" = "1" ] && ok "app container has APP_OUTBOX_ALWAYS=1" || bad "APP_OUTBOX_ALWAYS not set in the app container"

section "app vitest (registry, recorder with denied, failFast unit tests, existing suite)"
if pnpm --filter @quest/app test >"$TMPD/test.log" 2>&1; then
  ok "app vitest: $(grep -E '^ +Tests ' "$TMPD/test.log" | sed 's/^ *//')"
else
  tail -40 "$TMPD/test.log"; bad "app vitest"
fi

section "1. outbox drainer: a players UPDATE becomes one legacydb:changes entry within 3 s"
set_slots '{"active":[]}' && ok "no slot active (drainer runs on APP_OUTBOX_ALWAYS alone)" || bad "PUT /api/slots []"
sleep 3 # let rows written by the vitest run drain first
LEN_BEFORE=$(RCLI XLEN legacydb:changes)
PSQL "UPDATE players SET name = name WHERE id = 'p-001'" >/dev/null
T0=$(now_ms)
len_up() { [ "$(RCLI XLEN legacydb:changes)" -ge $((LEN_BEFORE + 1)) ]; }
if wait_until stream 3 len_up; then ok "entry appeared in $(( $(now_ms) - T0 )) ms (XLEN $LEN_BEFORE -> $(RCLI XLEN legacydb:changes))"; else bad "no entry on legacydb:changes within 3 s"; fi
LAST=$(RCLI XREVRANGE legacydb:changes + - COUNT 1 | tr '\n' ' ')
info "last entry: $(printf '%s' "$LAST" | cut -c1-200)"
case "$LAST" in *"aggregate players aggregate_id p-001 op update payload "*) ok "entry fields: aggregate=players aggregate_id=p-001 op=update payload=<json>";; *) bad "unexpected entry: $LAST";; esac
sleep 1.5
[ "$(RCLI XLEN legacydb:changes)" -eq "$(( LEN_BEFORE + 1 ))" ] && ok "exactly one entry for one row (no duplicate publish)" || bad "XLEN is $(RCLI XLEN legacydb:changes), want $((LEN_BEFORE + 1))"
[ "$(PSQL "SELECT count(*) FROM outbox WHERE published_at IS NULL")" = "0" ] && ok "outbox has no unpublished rows" || bad "unpublished outbox rows remain"

section "2. prefetch.applyChange: an UPDATE on matches changes cache:match:<id> within 2 s"
mkdir -p "$ROOT/workspace/ch2"
cp app/test/fixtures/prefetch-apply.js "$ROOT/workspace/ch2/prefetch-apply.js" && INSTALLED="$INSTALLED prefetch-apply" && ok "copied prefetch-apply.js to workspace/ch2/"
set_slots '{"active":["prefetch.applyChange"]}' && ok "PUT /api/slots [prefetch.applyChange]" || bad "PUT /api/slots"
wait_until slot 15 slot_loaded prefetch.applyChange && ok "applyChange slot loaded" || bad "applyChange slot never loaded: $BODY"
sleep 2 # the consumer starts reading from the stream tail once the slot is active
venue_is() { [ "$(RCLI HGET cache:match:m-043 venue)" = "$1" ]; }
wait_for_venue() { venue_is "$WANT"; }
for n in 1 2; do
  WANT="Check Ground $n"
  PSQL "UPDATE matches SET venue = '$WANT' WHERE id = 'm-043'" >/dev/null
  T0=$(now_ms)
  if wait_until venue 2 wait_for_venue; then ok "update $n: cache:match:m-043 venue = '$WANT' after $(( $(now_ms) - T0 )) ms"; else bad "update $n: hash still has venue '$(RCLI HGET cache:match:m-043 venue)' after 2 s"; fi
done
[ "$(RCLI HGET cache:match:m-043 status)" = "scheduled" ] && ok "hash carries the full row (status scheduled, from the payload)" || bad "hash status: $(RCLI HGET cache:match:m-043 status)"
req GET /app/slots; [ "$(js "$BODY" 'j.slots.find(s=>s.name==="prefetch.applyChange").state')" = "loaded" ] && ok "slot still loaded, no learner errors" || bad "slot state changed"
grep -q 'learner code in slot prefetch.applyChange failed' logs/app/app.log && bad "applyChange failed in app.log" || ok "no applyChange failure in app.log"

section "3. prefetch.bulkLoad: activation loads cache:match:* for every match"
cp app/test/fixtures/prefetch-bulk.js "$ROOT/workspace/ch2/prefetch-bulk.js" && INSTALLED="$INSTALLED prefetch-bulk" && ok "copied prefetch-bulk.js to workspace/ch2/"
set_slots '{"active":[]}' >/dev/null
sleep 2.5
clear_cache_keys
[ "$(cache_keys)" = "0" ] && ok "cache:match:* cleared" || bad "could not clear cache:match:*"
MATCHES=$(PSQL "SELECT count(*) FROM matches")
set_slots '{"active":["prefetch.bulkLoad"]}' && ok "PUT /api/slots [prefetch.bulkLoad]" || bad "PUT /api/slots"
all_loaded() { [ "$(cache_keys)" = "$MATCHES" ]; }
if wait_until bulk 10 all_loaded; then ok "cache:match:* keys = matches count ($MATCHES) after activation"; else bad "cache:match:* keys $(cache_keys), matches $MATCHES"; fi
[ "$(RCLI HGET cache:match:m-001 home_team_name | wc -c | tr -d ' ')" -gt 1 ] && ok "hash has the joined team name (m-001 home_team_name: $(RCLI HGET cache:match:m-001 home_team_name))" || bad "no home_team_name on cache:match:m-001"
clear_cache_keys
req POST /app/prefetch/reload ''; expect_status "POST /app/prefetch/reload" 200
expect_js "reload reports rows = matches count" "j.ok===true&&j.rows===$MATCHES"
[ "$(cache_keys)" = "$MATCHES" ] && ok "reload refilled all $MATCHES keys" || bad "after reload: $(cache_keys) keys"
clear_cache_keys

section "4. sessions: login, me, logout, me 401, logout-all"
set_slots '{"active":[]}' >/dev/null
sleep 2.5
req POST /app/login '{"userId":"u-000010"}'; expect_status "POST /app/login" 200
COOKIE=$(hdr set-cookie | sed 's/;.*//')
req GET /app/me '' -H "cookie: $COOKIE"; expect_status "GET /app/me with the cookie" 200
req POST /app/logout '' -H "cookie: $COOKIE"; expect_status "POST /app/logout" 200
[ "$(hdr x-quest-slots)" = "session.destroy=baseline" ] && ok "x-quest-slots: session.destroy=baseline" || bad "x-quest-slots: $(hdr x-quest-slots)"
printf '%s\n' "$HDRS" | grep -i '^set-cookie: sid=;' | grep -qi 'max-age=0' && ok "logout clears the cookie" || bad "logout did not clear the cookie"
req GET /app/me '' -H "cookie: $COOKIE"; expect_status "GET /app/me after logout" 401
req POST /app/logout ''; expect_status "POST /app/logout without a cookie" 401
req POST /app/login '{"userId":"u-000010"}'; C1=$(hdr set-cookie | sed 's/;.*//')
req POST /app/login '{"userId":"u-000010"}'; C2=$(hdr set-cookie | sed 's/;.*//')
req POST /app/login '{"userId":"u-000100"}'; C3=$(hdr set-cookie | sed 's/;.*//')
req POST /app/logout-all '{"userId":"u-000010"}'; expect_status "POST /app/logout-all u-000010" 200
expect_js "logout-all destroyed 2 sessions" 'j.ok===true&&j.result.destroyed===2'
req GET /app/me '' -H "cookie: $C1"; expect_status "first session after logout-all" 401
req GET /app/me '' -H "cookie: $C2"; expect_status "second session after logout-all" 401
req GET /app/me '' -H "cookie: $C3"; expect_status "another user's session survives" 200
req POST /app/logout-all '{}'; expect_status "POST /app/logout-all without userId" 400

section "5. fail-fast learner Redis (level 2.10): the learner path fails in under 3 s, the baseline path keeps serving"
cp app/test/fixtures/cache-aside.js "$ROOT/workspace/ch2/cache.js" && INSTALLED="$INSTALLED cache" && ok "copied the reference cache-aside learner to workspace/ch2/cache.js"
set_slots '{"active":["cache.getPlayerStats"]}' && ok "PUT /api/slots [cache.getPlayerStats]" || bad "PUT /api/slots"
wait_until slot 15 slot_loaded cache.getPlayerStats && ok "cache slot loaded" || bad "cache slot never loaded"
req GET /app/players/p-028/stats; expect_status "p-028 stats with Redis up (learner, fills the cache)" 200
[ "$(hdr x-quest-slots)" = "cache.getPlayerStats=learner" ] && ok "served by the learner" || bad "x-quest-slots: $(hdr x-quest-slots)"

echo "-- (a) docker compose stop redis: connection refused path"
DC stop redis >/dev/null 2>&1 && ok "redis stopped"
sleep 1
req GET /app/players/p-028/stats
if [ "$STATUS" = "500" ] && awk -v m="$MS" 'BEGIN { exit !(m < 3000) }'; then ok "learner path: 500 in $MS ms (< 3000)"; else bad "learner path with Redis stopped: HTTP $STATUS in $MS ms: $(printf '%s' "$BODY" | head -c 300)"; fi
info "error the learner sees: $(js "$BODY" 'JSON.stringify({name:j.name,message:j.message})')"
expect_js "500 body is slot_error naming cache.getPlayerStats" 'j.error==="slot_error"&&j.slot==="cache.getPlayerStats"&&typeof j.name==="string"&&j.message.length>0'
[ -n "$(hdr x-quest-slot-error)" ] && ok "x-quest-slot-error: $(hdr x-quest-slot-error)" || bad "no x-quest-slot-error header"
req GET /app/players/p-001; expect_status "baseline route /app/players/p-001 with Redis down (no Redis on that path)" 200
req GET /app/fixtures; expect_status "baseline /app/fixtures with Redis down" 200
req GET /app/health; expect_js "health still ok, redis reported down" 'j.ok===true&&j.redis==="down"'
DC start redis >/dev/null 2>&1 && ok "redis started"
recovered() { req GET /app/players/p-028/stats; [ "$STATUS" = "200" ]; }
T0=$(now_ms)
if wait_until recover 30 recovered; then ok "learner path recovered by itself $(( $(now_ms) - T0 )) ms after start"; else bad "learner path never recovered: $STATUS $BODY"; fi

echo "-- (b) docker compose pause redis: socket open, no reply (the per-command timeout)"
DC pause redis >/dev/null 2>&1 && ok "redis paused"
req GET /app/players/p-028/stats
if [ "$STATUS" = "500" ] && awk -v m="$MS" 'BEGIN { exit !(m < 3000) }'; then ok "learner path: 500 in $MS ms (< 3000, timeout 2000)"; else bad "learner path with Redis paused: HTTP $STATUS in $MS ms: $(printf '%s' "$BODY" | head -c 300)"; fi
info "error the learner sees: $(js "$BODY" 'JSON.stringify({name:j.name,message:j.message})')"
expect_js "timeout error is RedisCommandTimeoutError" 'j.name==="RedisCommandTimeoutError"&&/no reply within 2000 ms/.test(j.message)'
req GET /app/players/p-001; expect_status "baseline route with Redis paused" 200
DC unpause redis >/dev/null 2>&1 && ok "redis unpaused"
T0=$(now_ms)
if wait_until recover 30 recovered; then ok "learner path recovered $(( $(now_ms) - T0 )) ms after unpause"; else bad "learner path never recovered after unpause: $STATUS $BODY"; fi
set_slots '{"active":[]}' >/dev/null

section "6. 429 counting: denied in the pushed metrics"
sleep 2.5
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14; do
  req GET /app/limits/ping '' -H 'x-user-id: u-a01-limit'
  printf '%s ' "$STATUS" >> "$TMPD/limits"
done
info "statuses: $(cat "$TMPD/limits")"
N429=$(tr ' ' '\n' < "$TMPD/limits" | grep -c '^429$')
[ "$N429" = "4" ] && ok "baseline limiter: 10 allowed, 4 x 429" || bad "expected 4 x 429, got $N429"
saw_push() { req GET /app/metrics; [ "$(js "$BODY" 'const r=(j.lastWindow&&j.lastWindow.routes||{})["GET /app/limits/ping"];!!r&&r.denied>0')" = "true" ]; }
if wait_until push 3 saw_push; then ok "pushed window carries denied: $(js "$BODY" 'JSON.stringify(j.lastWindow.routes["GET /app/limits/ping"])')"; else bad "no pushed window with denied > 0 (lastWindow: $(js "$BODY" 'JSON.stringify(j.lastWindow)'))"; fi
sleep 2
req GET /app/metrics
expect_js "running total denied = 4 on GET /app/limits/ping" 'j.totals["GET /app/limits/ping"].denied===4&&j.totals["GET /app/limits/ping"].count===14'
req GET '/api/metrics?seconds=60'; expect_status "engine still accepts the pushes (GET /api/metrics)" 200
expect_js "engine saw the limiter route (extra field ignored)" 'j.routes["GET /app/limits/ping"].count>=14'
