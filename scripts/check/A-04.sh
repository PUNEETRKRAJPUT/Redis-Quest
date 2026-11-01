#!/usr/bin/env bash
# A-04 acceptance: the app side of Chapter 4b "On call". The planted faults must reproduce first (KEYS in a cron,
# views without a TTL, a Lua loop that freezes Redis, a client per request), then the reference repairs, activated
# through PUT /api/slots, must fix them. Own compose project quest-a04 with .env.a04 (PROXY 3900, REDIS 6388,
# PG 5441, INSIGHT 5549); never the default project and never another quest-* project. Ends with
# `docker compose -p quest-a04 down -v`. Bash 3.2.
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

PROJECT=quest-a04
ENVF=.env.a04
FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
note() { printf 'NOTE  %s\n' "$1"; }
info() { printf '      %s\n' "$1"; }
section() { printf '\n== %s\n' "$1"; }

if [ ! -f "$ENVF" ]; then
  printf '# A-04 check only (gitignored): isolated compose project quest-a04 on its own host ports.\nPROXY_PORT=3900\nREDIS_PORT=6388\nPG_PORT=5441\nINSIGHT_PORT=5549\n' > "$ENVF"
fi
PROXY_PORT=$(sed -n 's/^PROXY_PORT=//p' "$ENVF")
REDIS_PORT=$(sed -n 's/^REDIS_PORT=//p' "$ENVF")
PG_PORT=$(sed -n 's/^PG_PORT=//p' "$ENVF")
BASE="http://127.0.0.1:${PROXY_PORT:-3900}"

SCRATCH="$ROOT/logs/.a-04-check"
rm -rf "$SCRATCH"
mkdir -p "$SCRATCH/levels" "$SCRATCH/progress" logs workspace
cp -R levels/_examples/example-cli "$SCRATCH/levels/example-cli"
export QUEST_LEVELS_DIR="$SCRATCH/levels"
export QUEST_PROGRESS_DIR="$SCRATCH/progress"
DC() { docker compose -p "$PROJECT" --env-file "$ENVF" -f "$ROOT/docker-compose.yml" "$@"; }

# Learner files this check installs under workspace/ch4b (slot file names from app/src/slots/registry.ts).
# Never overwrite a real one.
SLOT_FILES="count-users record-view add-ttls recompute-badges lookup-team split-big-key"
MADE_CH4B=""
[ -d "$ROOT/workspace/ch4b" ] || MADE_CH4B=1
INSTALLED=""
for f in $SLOT_FILES; do
  if [ -e "$ROOT/workspace/ch4b/$f.js" ]; then
    echo "workspace/ch4b/$f.js already exists (a learner file?); refusing to overwrite it. Move it away and re-run."
    exit 1
  fi
done
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/a04.XXXXXX")

finish() {
  section "cleanup"
  DC down -v --remove-orphans >/dev/null 2>&1 && echo "docker compose -p $PROJECT down -v: done"
  for f in $INSTALLED; do rm -f "$ROOT/workspace/ch4b/$f.js" && echo "removed workspace/ch4b/$f.js"; done
  if [ -n "$MADE_CH4B" ]; then rmdir "$ROOT/workspace/ch4b" 2>/dev/null && echo "removed empty workspace/ch4b"; fi
  rm -rf "$SCRATCH" "$TMPD"
  if [ "$FAILED" -eq 0 ]; then printf '\nA-04 OK\n'; exit 0; fi
  printf '\nA-04 FAILED\n'; exit 1
}
trap finish EXIT
die() { bad "$1"; exit 1; }

STATUS=""; MS=""; BODY=""; HDRS=""
req() {
  local method=$1 path=$2 data=${3:-}
  shift 3 2>/dev/null || shift $#
  local out
  if [ -n "$data" ]; then
    out=$(curl -s -m 60 -X "$method" -o "$TMPD/body" -D "$TMPD/hdrs" -w '%{http_code} %{time_total}' -H 'content-type: application/json' --data "$data" "$@" "$BASE$path")
  else
    out=$(curl -s -m 60 -X "$method" -o "$TMPD/body" -D "$TMPD/hdrs" -w '%{http_code} %{time_total}' "$@" "$BASE$path")
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
expect_slot() { if [ "$(hdr x-quest-slots)" = "$1" ]; then ok "x-quest-slots: $1"; else bad "x-quest-slots: want $1, got $(hdr x-quest-slots)"; fi; }
wait_until() { # wait_until LABEL SECONDS CMD... : retry CMD every 0.25 s
  local secs=$2 i=0; shift 2
  while [ $i -lt $((secs * 4)) ]; do
    if "$@"; then return 0; fi
    i=$((i + 1)); sleep 0.25
  done
  return 1
}
now_ms() { perl -MTime::HiRes=time -e 'printf "%d\n", time() * 1000'; }
PSQL() { DC exec -T postgres psql -U quest -d quest -v ON_ERROR_STOP=1 -tA -c "$1"; }
RCLI() { DC exec -T redis redis-cli "$@" 2>&1 | tr -d '\r'; }
clients_now() { RCLI INFO clients | sed -n 's/^connected_clients://p'; }
set_slots() { req PUT /api/slots "$1"; [ "$STATUS" = "200" ]; }
slot_loaded() { req GET /app/slots; [ "$(js "$BODY" "j.slots.find(s=>s.name===\"$1\").state")" = "loaded" ]; }
install_fixture() { # install_fixture NAME (the fixture and the workspace file share the name)
  mkdir -p "$ROOT/workspace/ch4b"
  cp "app/test/fixtures/$1.js" "$ROOT/workspace/ch4b/$1.js" && INSTALLED="$INSTALLED $1"
}
activate() { # activate "slot.a slot.b ..." : PUT /api/slots, then wait for each slot to load in the app
  local list="" s
  for s in $1; do list="$list\"$s\","; done
  set_slots "{\"active\":[${list%,}]}" || { bad "PUT /api/slots [$1]"; return 1; }
  for s in $1; do wait_until slot 20 slot_loaded "$s" || { bad "slot $s never loaded: $BODY"; return 1; }; done
  ok "active and loaded: $1"
}
post_json() { # post_json PATH JSON : print only the HTTP status
  curl -s -m 60 -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data "$2" "$BASE$1"
}

section "docker"
docker info >/dev/null 2>&1 && ok "docker is running" || die "docker is not running"

section "install, build, lint (build retried: other agents may be mid-edit)"
pnpm install --frozen-lockfile >/dev/null 2>&1 && ok "pnpm install --frozen-lockfile" || die "pnpm install --frozen-lockfile"
built=""
for attempt in 1 2 3; do
  if pnpm -r build >"$TMPD/build.log" 2>&1; then built=1; echo "pnpm -r build: ok"; break; fi
  echo "pnpm -r build attempt $attempt failed:"; grep -E 'error|ERR' "$TMPD/build.log" | head -5
  if pnpm --filter @quest/shared --filter @quest/app build >"$TMPD/build2.log" 2>&1; then built=1; echo "built @quest/shared and @quest/app only (the full build is blocked by files this task does not own)"; break; fi
  sleep 20
done
[ -n "$built" ] && ok "build" || die "build"
pnpm --filter @quest/app lint >"$TMPD/lint.log" 2>&1 && ok "app lint" || { tail -20 "$TMPD/lint.log"; bad "app lint"; }

section "docker compose -p $PROJECT up -d redis postgres"
DC up -d redis postgres >"$TMPD/up0.log" 2>&1 && ok "redis and postgres started" || { tail -8 "$TMPD/up0.log"; die "compose up redis postgres"; }
pg_seeded() { [ "$(PSQL "SELECT count(*) FROM matches" 2>/dev/null)" = "60" ]; }
wait_until seed 240 pg_seeded && ok "postgres seeded (60 matches)" || die "postgres never finished loading the seed"
RCLI FLUSHALL >/dev/null

section "quality gates: format, engine slot table, app vitest (own redis and postgres: ports $REDIS_PORT / $PG_PORT)"
pnpm exec prettier --check app engine/src/verify/slots.ts >"$TMPD/fmt-own.log" 2>&1 && ok "prettier --check on app/ and engine/src/verify/slots.ts" || { head -20 "$TMPD/fmt-own.log"; bad "prettier --check on own files"; }
if pnpm format:check >"$TMPD/fmt.log" 2>&1; then
  ok "pnpm format:check (whole repo)"
else
  OFFENDERS=$(grep -E '^\[warn\] [^ ]+$' "$TMPD/fmt.log" | sed 's/^\[warn\] //')
  THEIRS=""; OURS=""
  for f in $OFFENDERS; do
    case "$f" in
      engine/src/verify/slots.ts) OURS="$OURS $f";;
      engine/*|packages/*|ui/*|scripts/grade/*|scripts/check/E-02.sh|levels/*) THEIRS="$THEIRS $f";;
      *) OURS="$OURS $f";;
    esac
  done
  if [ -z "$OURS" ]; then
    ok "pnpm format:check: the only unformatted files are E-02's in-flight files:$THEIRS"
  else
    bad "pnpm format:check fails on files that are not E-02's:$OURS"
  fi
fi
export REDIS_URL="redis://127.0.0.1:${REDIS_PORT}"
export DATABASE_URL="postgres://quest:quest@127.0.0.1:${PG_PORT}/quest"
if pnpm --filter @quest/engine exec vitest run test/verify-slots.test.ts >"$TMPD/engine-slots.log" 2>&1; then
  ok "engine verify-slots test: $(grep -E '^ +Tests ' "$TMPD/engine-slots.log" | sed 's/^ *//')"
else
  tail -30 "$TMPD/engine-slots.log"; bad "engine verify-slots test (the engine slot table disagrees with the app registry)"
fi
if pnpm --filter @quest/app test >"$TMPD/test.log" 2>&1; then
  ok "app vitest: $(grep -E '^ +Tests ' "$TMPD/test.log" | sed 's/^ *//')"
else
  tail -60 "$TMPD/test.log"; bad "app vitest"
fi
unset REDIS_URL DATABASE_URL
RCLI SCRIPT KILL >/dev/null
RCLI FLUSHALL >/dev/null

section "measured facts (this redis: $(RCLI INFO server | sed -n 's/^redis_version://p'); re-measured on every run)"
info "slowlog-log-slower-than: $(RCLI CONFIG GET slowlog-log-slower-than | tail -1) us; busy-reply-threshold: $(RCLI CONFIG GET busy-reply-threshold | tail -1) ms"
# redis.call('TIME') inside a script: is it the wall clock or frozen at the script's start?
TIME_OUT=$(RCLI EVAL "local a = redis.call('TIME') local x = 0 for i = 1, 2000000 do x = x + 1 end local b = redis.call('TIME') return a[1] .. '.' .. a[2] .. ' ' .. b[1] .. '.' .. b[2]" 0)
set -- $TIME_OUT
if [ "$1" = "$2" ] && [ -n "$1" ]; then
  ok "redis.call('TIME') is FROZEN inside a script (before and after a 2,000,000-iteration loop: $1 vs $2), so a loop that waits on TIME never ends; the check's Lua loop uses os.clock()"
else
  bad "redis.call('TIME') changed inside a script ($TIME_OUT): the frozen-time finding no longer holds, revisit the Lua loop"
fi
t0=$(now_ms)
SPIN_OUT=$(RCLI EVAL "local s = os.clock() while (os.clock() - s) * 1000 < tonumber(ARGV[1]) do end return 'done'" 0 1500)
t1=$(now_ms)
if [ "$SPIN_OUT" = "done" ] && [ $((t1 - t0)) -ge 1400 ] && [ $((t1 - t0)) -le 3500 ]; then
  ok "an os.clock() loop of 1500 ms ends by itself: $((t1 - t0)) ms wall (docker exec included)"
else
  bad "os.clock() spin of 1500 ms: got '$SPIN_OUT' after $((t1 - t0)) ms"
fi
# What the EVAL itself answers after SCRIPT KILL (the app cannot show it: its 2 s command timeout fires first).
( RCLI EVAL "local s = os.clock() while (os.clock() - s) * 1000 < tonumber(ARGV[1]) do end return 'done'" 0 20000 > "$TMPD/eval.out" ) &
EVAL_PID=$!
sleep 0.3
KPING=$(RCLI PING)
KOUT=$(RCLI SCRIPT KILL)
wait $EVAL_PID
case "$KPING" in BUSY*) ok "a plain PING during a 20 s read-only EVAL answers BUSY (after the 5 s busy-reply-threshold)";; *) bad "PING during the EVAL: $KPING";; esac
case "$KOUT" in OK*) ok "SCRIPT KILL answers OK";; *) bad "SCRIPT KILL answered: $KOUT";; esac
if grep -q 'Script killed' "$TMPD/eval.out"; then ok "the killed EVAL's own error: $(head -c 200 "$TMPD/eval.out")"; else bad "the killed EVAL answered: $(head -c 200 "$TMPD/eval.out")"; fi
# 200,000 keys seeded by one EVAL, KEYS timing and SLOWLOG
RCLI EVAL "for i = 1, 200000 do redis.call('SET', 'oncall:user:' .. i, 'x') end return 1" 0 >/dev/null
RCLI SLOWLOG RESET >/dev/null
t0=$(now_ms)
KEYS_N=$(RCLI KEYS 'oncall:user:*' | wc -l | tr -d ' ')
t1=$(now_ms)
info "KEYS oncall:user:* over 200,000 keys: $KEYS_N keys returned, $((t1 - t0)) ms wall at the host (includes docker exec and printing 200,000 lines)"
if [ "$KEYS_N" = "200000" ]; then ok "KEYS returned all 200000 keys"; else bad "KEYS returned $KEYS_N keys"; fi
SLOW_ENTRIES=$(RCLI SLOWLOG GET 5)
if printf '%s\n' "$SLOW_ENTRIES" | grep -qi '^keys$'; then
  ok "SLOWLOG GET shows the KEYS entry, server-side duration $(printf '%s\n' "$SLOW_ENTRIES" | awk 'NR==3{print}') us"
else
  bad "SLOWLOG GET 5 has no keys entry: $SLOW_ENTRIES"
fi
RCLI FLUSHALL >/dev/null
# the big hash: 300,000 fields f<i> -> v<i>
RCLI EVAL "for i = 1, 300000 do redis.call('HSET', KEYS[1], 'f' .. i, 'v' .. i) end return 1" 1 oncall:big >/dev/null
BIG_LEN=$(RCLI HLEN oncall:big); BIG_ENC=$(RCLI OBJECT ENCODING oncall:big); BIG_MEM=$(RCLI MEMORY USAGE oncall:big)
if [ "$BIG_LEN" = "300000" ]; then ok "300,000-field hash (fields f1..f300000, values v1..v300000): MEMORY USAGE $BIG_MEM bytes ($((BIG_MEM / 1048576)) MiB), OBJECT ENCODING $BIG_ENC"; else bad "big hash has $BIG_LEN fields"; fi
RCLI FLUSHALL >/dev/null

section "docker compose -p $PROJECT up -d --build engine app proxy runner"
up_ok=""
for attempt in 1 2 3 4 5; do
  if DC up -d --build engine app proxy runner >"$TMPD/up.log" 2>&1; then up_ok=1; break; fi
  echo "compose up attempt $attempt failed:"; grep -E 'error|ERR|failed' "$TMPD/up.log" | head -6
  sleep 30
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
wait_until seed 60 seeded && ok "app can read postgres" || die "app cannot read postgres"
set_slots '{"active":[]}' && ok "no slot active (all baselines)" || bad "PUT /api/slots []"
sleep 2.5
req GET /app/slots
if [ "$(js "$BODY" 'j.slots.filter(s=>s.name.startsWith("oncall.")).map(s=>s.file).sort().join(" ")')" = "ch4b/add-ttls.js ch4b/count-users.js ch4b/lookup-team.js ch4b/recompute-badges.js ch4b/record-view.js ch4b/split-big-key.js" ]; then
  ok "/app/slots lists the six oncall slots with their ch4b files"
else
  bad "/app/slots oncall rows: $(js "$BODY" 'j.slots.filter(s=>s.name.startsWith("oncall.")).map(s=>s.name+" "+s.file)')"
fi

section "1. fault: KEYS in a cron (countUsers baseline)"
RCLI EVAL "for i = 1, 200000 do redis.call('SET', 'oncall:user:' .. i, 'x') end return 1" 0 >/dev/null
SEEDED=$(RCLI EVAL "return #redis.call('KEYS', 'oncall:user:*')" 0)
[ "$SEEDED" = "200000" ] && ok "200,000 keys seeded by one EVAL (SET oncall:user:<i> x); DBSIZE $(RCLI DBSIZE) includes the engine's game:* keys" || bad "seed: $SEEDED oncall:user:* keys"
RCLI SLOWLOG RESET >/dev/null
for i in 1 2 3; do
  req GET "/app/oncall/users/count?prefix=oncall:user:"
  expect_status "GET /app/oncall/users/count (call $i)" 200
  expect_js "count is 200000 (took $MS ms)" 'j.count === 200000 && j.prefix === "oncall:user:"'
done
expect_slot "oncall.countUsers=baseline"
SLOW=$(RCLI SLOWLOG GET 10)
if printf '%s\n' "$SLOW" | grep -qi '^keys$'; then
  ok "SLOWLOG GET shows keys entries ($(printf '%s\n' "$SLOW" | grep -ci '^keys$') of the last 10)"
else
  bad "no keys entry in SLOWLOG: $SLOW"
fi
req GET "/app/oncall/users/count?prefix=game:x"; expect_status "prefix game:x refused" 400
req GET "/app/oncall/users/count"; expect_status "missing prefix refused" 400

section "2. fault: page views written without a TTL (recordView baseline)"
i=0
while [ $i -lt 50 ]; do
  s=$(post_json /app/oncall/views "{\"userId\":\"chk-$i\",\"matchId\":\"m-001\"}")
  [ "$s" = "200" ] || { bad "POST /app/oncall/views $i -> $s"; break; }
  i=$((i + 1))
done
VIEWS=$(RCLI EVAL "return #redis.call('KEYS', 'view:chk-*')" 0)
NOTTL=$(RCLI EVAL "local n = 0 for _, k in ipairs(redis.call('KEYS', 'view:chk-*')) do if redis.call('TTL', k) == -1 then n = n + 1 end end return n" 0)
[ "$VIEWS" = "50" ] && ok "50 views -> 50 view:chk-* keys" || bad "view keys: $VIEWS"
[ "$NOTTL" = "50" ] && ok "all 50 have TTL -1 (no expiry: memory grows every day)" || bad "keys without TTL: $NOTTL"
info "sample: $(RCLI GET view:chk-0:m-001)"

section "3. fault: a Lua loop that freezes Redis (recomputeBadges baseline, ONCALL_SPIN_MS default 20000)"
LOGMARK=$(date +%s)
T0=$(now_ms)
( curl -s -m 60 -X POST -o "$TMPD/rb.body" -w '%{http_code} %{time_total}' "$BASE/app/oncall/badges/recompute" > "$TMPD/rb.meta" ) &
RB_PID=$!
sleep 0.4
# This PING is only answered once Redis starts replying BUSY (busy-reply-threshold, 5 s) or the script ends.
PING_OUT=$(RCLI PING)
T_BUSY=$(( $(now_ms) - T0 ))
case "$PING_OUT" in
  BUSY*) if [ "$T_BUSY" -le 7000 ]; then ok "PING answers BUSY $T_BUSY ms after the route was called (within 7 s): $PING_OUT"; else bad "BUSY after $T_BUSY ms (more than 7 s)"; fi;;
  *) bad "PING did not answer BUSY after $T_BUSY ms: $PING_OUT";;
esac
# what the app's other routes do while Redis is stalled (the route itself has answered at ~2 s by now)
req GET /app/players/p-001
info "during the freeze: GET /app/players/p-001 (Postgres only): HTTP $STATUS in $MS ms"
[ "$STATUS" = "200" ] && ok "a baseline route that never touches Redis keeps answering during the freeze" || bad "GET /app/players/p-001 during the freeze: $STATUS"
req GET /app/health
info "during the freeze: GET /app/health: HTTP $STATUS in $MS ms, redis: $(js "$BODY" 'j.redis')"
req GET "/app/oncall/users/count?prefix=oncall:user:"
info "during the freeze: GET /app/oncall/users/count (KEYS through the learner client): HTTP $STATUS in $MS ms: $(printf '%s' "$BODY" | head -c 200)"
KILL_OUT=$(RCLI SCRIPT KILL)
case "$KILL_OUT" in
  OK*) ok "redis-cli SCRIPT KILL answers OK (the loop is read-only, so it is killable)";;
  *) bad "SCRIPT KILL answered: $KILL_OUT";;
esac
wait $RB_PID
RB_STATUS=$(cut -d' ' -f1 "$TMPD/rb.meta"); RB_SECS=$(cut -d' ' -f2 "$TMPD/rb.meta")
RB_BODY=$(cat "$TMPD/rb.body")
RB_MS=$(awk -v t="$RB_SECS" 'BEGIN { printf "%.0f", t * 1000 }')
if [ "$RB_STATUS" = "500" ]; then
  case "$RB_BODY" in
    *"Script killed"*|*"killed by user"*) ok "the route returned 500 with the kill error after $RB_MS ms: $RB_BODY";;
    *"got no reply within"*) ok "the route returned 500 after $RB_MS ms with the learner-client TIMEOUT, not the kill error (the 2 s command timeout fires first): $RB_BODY";;
    *"call exceeded"*) ok "the route returned 500 with the slot timeout after $RB_MS ms: $RB_BODY";;
    *) bad "the route returned 500 with an unexpected body after $RB_MS ms: $RB_BODY";;
  esac
else
  bad "POST /app/oncall/badges/recompute: want 500, got $RB_STATUS after $RB_MS ms: $RB_BODY"
fi
[ "$(RCLI PING)" = "PONG" ] && ok "Redis answers PING again after the kill" || bad "Redis does not answer PING after the kill"
SINCE=$(( $(date +%s) - LOGMARK + 5 ))
DC logs --no-log-prefix --since "${SINCE}s" app >"$TMPD/app-during.log" 2>&1
info "app log lines during and after the freeze, by level and message (ticker and outbox workers included):"
grep -o '"level":[0-9]*.*"msg":"[^"]*"' "$TMPD/app-during.log" | sed 's/"level":\([0-9]*\).*"msg":"\([^"]*\)"/level \1 \2/' | sort | uniq -c | sort -rn | head -10 | while read -r line; do info "  $line"; done
info "app 'unhandled' lines: $(grep -ci 'unhandled' "$TMPD/app-during.log")"
req GET "/app/oncall/users/count?prefix=oncall:user:"
expect_status "the app recovers: count route works again after the kill" 200

section "4. fault: a client per request, never closed (lookupTeam baseline)"
i=1
while [ $i -le 8 ]; do RCLI HSET "team:t-0$i" id "t-0$i" name "Check Team $i" >/dev/null; i=$((i + 1)); done
req GET /app/oncall/teams/t-01
expect_status "GET /app/oncall/teams/t-01" 200
expect_js "team t-01 is { id, name }" 'j.id === "t-01" && j.name === "Check Team 1"'
expect_slot "oncall.lookupTeam=baseline"
req GET /app/oncall/teams/t-nope; expect_status "unknown team" 404
req GET /app/oncall/status
info "before the load: connected_clients $(clients_now); status: $BODY"
cat > "$TMPD/sampler.mjs" <<'NODE'
import { createRequire } from 'node:module';
const require = createRequire(`${process.env.ROOT}/app/package.json`);
const { createClient } = require('redis');
const r = createClient({ url: process.env.REDIS_URL });
await r.connect();
const until = Date.now() + 90_000; // safety stop; the check normally ends the sampler with a stop file
const { existsSync } = await import('node:fs');
const rows = [];
let last = -1;
while (Date.now() < until && !existsSync(process.env.STOP_FILE)) {
  const m = (await r.info('clients')).match(/connected_clients:(\d+)/);
  const n = Number(m[1]);
  if (n !== last) { rows.push(`${Date.now()} ${n}`); last = n; }
  await new Promise((x) => setTimeout(x, 20));
}
console.log(rows.join('\n'));
await r.close();
NODE
ROOT="$ROOT" REDIS_URL="redis://127.0.0.1:${REDIS_PORT}" STOP_FILE="$TMPD/sampler.stop" node "$TMPD/sampler.mjs" > "$TMPD/samples.txt" 2>&1 &
SAMPLER_PID=$!
sleep 1
BASE_CLIENTS=$(clients_now)
LOAD_T0=$(now_ms)
seq 1 200 | xargs -P 100 -I{} curl -s -m 30 -o /dev/null -w '%{http_code}\n' "$BASE/app/oncall/teams/t-01" > "$TMPD/load.codes"
LOAD_T1=$(now_ms)
sleep 0.5
touch "$TMPD/sampler.stop"
wait $SAMPLER_PID
AFTER_CLIENTS=$(clients_now)
OKS=$(grep -c '^200$' "$TMPD/load.codes")
info "200 requests, 100 in parallel: $OKS answered 200, total $((LOAD_T1 - LOAD_T0)) ms"
RISE=$((AFTER_CLIENTS - BASE_CLIENTS))
if [ "$RISE" -ge 100 ]; then ok "connected_clients rose by $RISE ($BASE_CLIENTS -> $AFTER_CLIENTS)"; else bad "connected_clients rose by only $RISE ($BASE_CLIENTS -> $AFTER_CLIENTS)"; fi
node -e '
const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => l.split(" ").map(Number));
const t0 = Number(process.argv[2]), base = Number(process.argv[3]);
const at = (n) => { const r = rows.find((x) => x[1] >= base + n); return r ? r[0] - t0 : "never"; };
const peak = Math.max(...rows.map((r) => r[1]));
console.log("      sampler (every 20 ms): first +50 after " + at(50) + " ms, +100 after " + at(100) + " ms, +150 after " + at(150) + " ms, peak " + peak + " (relative to the first request)");
' "$TMPD/samples.txt" "$LOAD_T0" "$BASE_CLIENTS"
req GET /app/oncall/status
expect_js "/app/oncall/status reports the leak (>= 100)" 'j.leakedClients >= 100'
info "status: $BODY"
DC restart app >"$TMPD/restart.log" 2>&1 && ok "docker compose restart app" || bad "restart app: $(tail -3 "$TMPD/restart.log")"
wait_until app 60 app_up && ok "app healthy again" || { DC logs --tail 20 app; die "app did not come back"; }
sleep 1
AFTER_RESTART=$(clients_now)
if [ "$AFTER_RESTART" -le $((BASE_CLIENTS + 3)) ]; then ok "connected_clients dropped back to $AFTER_RESTART after the restart (was $AFTER_CLIENTS)"; else bad "connected_clients still $AFTER_RESTART after the restart"; fi
req GET /app/oncall/status
expect_js "leakedClients is 0 after the restart" 'j.leakedClients === 0'

section "5. repairs: the six reference fixtures, activated through PUT /api/slots"
for f in $SLOT_FILES; do install_fixture "$f"; done
activate "oncall.countUsers oncall.recordView oncall.addTtls oncall.recomputeBadges oncall.lookupTeam oncall.splitBigKey"

# countUsers via SCAN: same answer, no new keys entry
RCLI SLOWLOG RESET >/dev/null
req GET "/app/oncall/users/count?prefix=oncall:user:"
expect_status "count via SCAN" 200
expect_js "count is still 200000 (took $MS ms)" 'j.count === 200000'
expect_slot "oncall.countUsers=learner"
SLOW=$(RCLI SLOWLOG GET 10)
if printf '%s\n' "$SLOW" | grep -qi '^keys$'; then bad "SLOWLOG has a keys entry after the SCAN repair: $SLOW"; else ok "no keys entry in SLOWLOG after the SCAN repair (SLOWLOG RESET first; $(printf '%s\n' "$SLOW" | grep -c '^[0-9]\{10,\}$') entries of any kind)"; fi

# recordView with EX, then ttl-sweep over the 50 old views
i=0
while [ $i -lt 5 ]; do post_json /app/oncall/views "{\"userId\":\"fix-$i\",\"matchId\":\"m-001\"}" >/dev/null; i=$((i + 1)); done
TTL_NEW=$(RCLI TTL view:fix-0:m-001)
if [ "$TTL_NEW" -gt 0 ] && [ "$TTL_NEW" -le 86400 ]; then ok "a view recorded by the repaired slot carries a TTL ($TTL_NEW s)"; else bad "new view TTL: $TTL_NEW"; fi
req POST /app/oncall/ttl-sweep '{"pattern":"view:*","seconds":3600}'
expect_status "POST /app/oncall/ttl-sweep view:*" 200
expect_js "ttl-sweep gave a TTL to the 50 old views (the 5 new ones already had one)" 'j.expired === 50'
NOTTL=$(RCLI EVAL "local n = 0 for _, k in ipairs(redis.call('KEYS', 'view:*')) do if redis.call('TTL', k) == -1 then n = n + 1 end end return n" 0)
[ "$NOTTL" = "0" ] && ok "0 view:* keys left without a TTL" || bad "$NOTTL view:* keys still without a TTL"
req POST /app/oncall/ttl-sweep '{"pattern":"game:*","seconds":60}'; expect_status "ttl-sweep refuses game:*" 400
req POST /app/oncall/ttl-sweep '{"pattern":"*","seconds":60}'; expect_status "ttl-sweep refuses a bare *" 400

# recomputeBadges without EVAL
RCLI ZADD lb:match:m-chk-1 10 a 50 b 71 c >/dev/null
RCLI ZADD lb:match:m-chk-2 100 a >/dev/null
RCLI CONFIG RESETSTAT >/dev/null
req POST /app/oncall/badges/recompute
expect_status "POST /app/oncall/badges/recompute (repaired, took $MS ms)" 200
[ "$(RCLI HGET badges:fifties m-chk-1)" = "2" ] && [ "$(RCLI HGET badges:fifties m-chk-2)" = "1" ] && ok "badges:fifties filled: m-chk-1=2 m-chk-2=1" || bad "badges:fifties: $(RCLI HGETALL badges:fifties | tr '\n' ' ')"
EVALS=$(RCLI INFO commandstats | grep -c '^cmdstat_eval' || true)
[ "$EVALS" = "0" ] && ok "INFO commandstats has no cmdstat_eval after CONFIG RESETSTAT" || bad "cmdstat_eval present: $(RCLI INFO commandstats | grep '^cmdstat_eval')"

# lookupTeam through the shared client
BASE_CLIENTS=$(clients_now)
seq 1 100 | xargs -P 25 -I{} curl -s -m 30 -o /dev/null -w '%{http_code}\n' "$BASE/app/oncall/teams/t-02" > "$TMPD/load2.codes"
AFTER_CLIENTS=$(clients_now)
[ "$(grep -c '^200$' "$TMPD/load2.codes")" = "100" ] && ok "100 lookups answered 200" || bad "lookups: $(sort "$TMPD/load2.codes" | uniq -c | tr '\n' ' ')"
if [ $((AFTER_CLIENTS - BASE_CLIENTS)) -le 3 ]; then ok "lookupTeam via the shared client does not raise connected_clients ($BASE_CLIENTS -> $AFTER_CLIENTS)"; else bad "connected_clients rose $BASE_CLIENTS -> $AFTER_CLIENTS"; fi
req GET /app/oncall/status
expect_js "leakedClients stays 0" 'j.leakedClients === 0'
req GET /app/oncall/teams/t-nope; expect_status "unknown team still 404 on the repaired slot" 404

# splitBigKey
RCLI EVAL "for i = 1, 300000 do redis.call('HSET', KEYS[1], 'f' .. i, 'v' .. i) end return 1" 1 oncall:big >/dev/null
[ "$(RCLI HLEN oncall:big)" = "300000" ] && ok "300,000-field hash oncall:big seeded" || bad "seed: HLEN $(RCLI HLEN oncall:big)"
RCLI CONFIG RESETSTAT >/dev/null
req POST /app/oncall/split '{"key":"oncall:big","buckets":64}'
expect_status "POST /app/oncall/split (64 buckets, took $MS ms)" 200
expect_js "split moved 300000 fields into 64 buckets" 'j.key === "oncall:big" && j.fields === 300000 && j.buckets === 64'
[ "$(RCLI EXISTS oncall:big)" = "0" ] && ok "the original key is gone (EXISTS 0)" || bad "oncall:big still exists"
SUM=$(RCLI EVAL "local t = 0 for n = 0, 63 do t = t + redis.call('HLEN', KEYS[1] .. ':' .. n) end return t" 1 oncall:big)
[ "$SUM" = "300000" ] && ok "the 64 buckets' HLENs sum to 300000" || bad "bucket HLEN sum: $SUM"
info "bucket sizes: min $(RCLI EVAL "local m = 1e9 for n = 0, 63 do local l = redis.call('HLEN', KEYS[1] .. ':' .. n) if l < m then m = l end end return m" 1 oncall:big), max $(RCLI EVAL "local m = 0 for n = 0, 63 do local l = redis.call('HLEN', KEYS[1] .. ':' .. n) if l > m then m = l end end return m" 1 oncall:big); one bucket: $(RCLI OBJECT ENCODING oncall:big:0), $(RCLI MEMORY USAGE oncall:big:0) bytes"
RCLI INFO commandstats | grep -q '^cmdstat_unlink' && ok "INFO commandstats has cmdstat_unlink" || bad "no cmdstat_unlink: $(RCLI INFO commandstats | head -20 | tr '\n' ' ')"
req POST /app/oncall/split '{"key":"game:x","buckets":8}'; expect_status "split refuses game:*" 400
req POST /app/oncall/split '{"key":"oncall:big","buckets":1}'; expect_status "split refuses 1 bucket" 400
