#!/usr/bin/env bash
# E-02 check: engine, schema, UI and harness pieces Chapter 4b (on call) needs.
#   1. traffic on demand: POST /api/load/start, status, stop, load_started / load_finished events, 409 against a verify
#   2. a long read-only EVAL against the real Redis: the terminal's PING answers BUSY after busy-reply-threshold, the
#      engine stays usable, SCRIPT KILL answers OK, and redis_busy / script_killed appear
#   3. redis_per_request_lte (a scratch code level, two learner files) and notContains (a scratch cli level) graded
#      right and wrong through the engine; the harness's load_finished and script_killed rules
#   4. example-cli and example-code grade with no MISMATCH (regression for levels without the new keys and events)
#   5. engine, shared and ui vitest, pnpm -r lint, pnpm format:check
# Runs in its own compose project (quest-e02, .env.e02: ports 3600/6396/5438/5546, ENGINE_DEV=1, no insight) with
# scratch workspace, logs, progress and levels under logs/.e-02-check, so it never touches another project.
# E02_KEEP=1 leaves the stack up on exit (for debugging this script only). bash 3.2 compatible.
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1

PROJECT=quest-e02
ENV_FILE=.env.e02
CHECK_DIR="$ROOT/logs/.e-02-check"
OVERRIDE="$CHECK_DIR/compose.e02.yaml"
BASE=http://127.0.0.1:3600
SERVICES="redis postgres engine app runner proxy"
FAILED=0

say() { printf '\n== %s\n' "$*"; }
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILED=1; }
note() { printf 'NOTE  %s\n' "$*"; }
dc() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.yml -f "$OVERRIDE" "$@"; }

setvar() { grep -v "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null; printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE.tmp"; mv "$ENV_FILE.tmp" "$ENV_FILE"; }
cp .env.example "$ENV_FILE"
setvar PROXY_PORT 3600
setvar REDIS_PORT 6396
setvar PG_PORT 5438
setvar INSIGHT_PORT 5546
setvar ENGINE_DEV 1

export E02_WORKSPACE="$CHECK_DIR/workspace" E02_LOGS="$CHECK_DIR/logs" E02_PROGRESS="$CHECK_DIR/progress" E02_LEVELS="$CHECK_DIR/levels"

EVAL_PID=""
cleanup() {
  say "cleanup"
  if [ -n "$EVAL_PID" ]; then kill "$EVAL_PID" 2>/dev/null; fi
  if [ -n "${E02_KEEP:-}" ]; then
    echo "E02_KEEP is set: leaving project $PROJECT up and $CHECK_DIR in place"
    return
  fi
  if [ -f "$OVERRIDE" ]; then
    dc down -v --remove-orphans >/dev/null 2>&1 && echo "docker compose -p $PROJECT down -v: done"
  fi
  rm -rf "$CHECK_DIR" && echo "removed scratch dir logs/.e-02-check"
}
trap cleanup EXIT

# Tiny JSON helper: `... | pick 'j.slots.active'` prints the value of the JS expression over the parsed stdin
# (undefined or a parse error prints nothing).
PICK_JS="$CHECK_DIR/pick.js"
pick() { node "$PICK_JS" "$1"; }
now_ms() { node -e 'console.log(Date.now())'; }
jpost() { curl -s -m 30 -X POST -H 'content-type: application/json' -d "$2" "$BASE$1"; }
jcode() { curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d "$2" "$BASE$1"; }

wait_engine() {
  i=0
  while [ $i -lt 120 ]; do
    h="$(curl -s -m 2 "$BASE/health" || true)"
    case "$h" in *'"redis":"up"'*'"postgres":"up"'*) echo "$h"; return 0 ;; esac
    sleep 2; i=$((i + 1))
  done
  echo "last health: ${h:-none}"
  return 1
}

# event_count NAME SCENARIO: how many custom events with that name (and data.scenario, when given) the ring holds
event_count() {
  curl -s -m 5 "$BASE/api/events" | pick "j.events.filter(e => e.data && e.data.kind === 'custom' && e.data.name === '$1' && ('$2' === '' || (e.data.data && e.data.data.scenario === '$2'))).length"
}

# wait_not_running SECONDS: polls /api/load/status until running is false; prints the seconds waited
wait_not_running() {
  i=0
  while [ $i -lt $(( $1 * 4 )) ]; do
    r="$(curl -s -m 3 "$BASE/api/load/status" | pick 'j.running')"
    if [ "$r" = false ]; then echo $(( i / 4 )); return 0; fi
    sleep 0.25; i=$((i + 1))
  done
  return 1
}

# ---- 0. static: build, unit tests, lint, format -------------------------------------------------------------
say "docker, build @quest/shared, @quest/engine, @quest/ui (only the packages this task needs)"
if docker info >/dev/null 2>&1; then pass "docker is running"; else fail "docker is not running"; exit 1; fi
if pnpm --filter @quest/shared build >/dev/null 2>&1; then pass "@quest/shared built"; else fail "@quest/shared build"; exit 1; fi
if pnpm --filter @quest/engine build >/dev/null 2>&1; then pass "@quest/engine built"; else fail "@quest/engine build"; pnpm --filter @quest/engine build 2>&1 | tail -20; exit 1; fi
if pnpm --filter @quest/ui build >/dev/null 2>&1; then pass "@quest/ui built (tsc --noEmit and vite build)"; else fail "@quest/ui build"; pnpm --filter @quest/ui build 2>&1 | tail -20; exit 1; fi
if bash -n scripts/check/E-02.sh && node --check scripts/grade/grade.mjs; then pass "E-02.sh and grade.mjs parse"; else fail "syntax"; exit 1; fi

say "shared vitest (notContains, redis_per_request_lte, redis_calls_ratio_lte in the schema)"
if out="$(pnpm --filter @quest/shared test 2>&1)"; then pass "shared tests: $(printf '%s\n' "$out" | grep -E 'Tests ' | tail -1)"; else fail "shared tests"; printf '%s\n' "$out" | tail -40; fi
say "engine vitest (on-demand load, routes, BUSY and script_killed events, notContains, Redis-per-request grading)"
if out="$(pnpm --filter @quest/engine test 2>&1)"; then pass "engine tests: $(printf '%s\n' "$out" | grep -E 'Tests ' | tail -1)"; else fail "engine tests"; printf '%s\n' "$out" | tail -40; fi
say "ui vitest (the Run traffic button)"
if out="$(pnpm --filter @quest/ui test 2>&1)"; then pass "ui tests: $(printf '%s\n' "$out" | grep -E 'Tests ' | tail -1)"; else fail "ui tests"; printf '%s\n' "$out" | tail -40; fi
say "pnpm -r lint, pnpm format:check"
# A-04 edits app/ and engine/src/verify/slots.ts at the same time as this task. A lint or format problem that is only in
# those files is theirs: it is printed as a NOTE and does not fail this check (it fails as soon as anything else is involved).
THEIRS='^(app/|engine/src/verify/slots\.ts)'
if out="$(pnpm -r --no-bail lint 2>&1)"; then
  pass "pnpm -r lint"
else
  bad="$(printf '%s\n' "$out" | grep -E '^[^ ]+ lint: Failed' | grep -v '^app lint: Failed')"
  if printf '%s\n' "$out" | grep -q '^app lint: Failed' && [ -z "$bad" ]; then
    note "pnpm -r lint: only app/ fails (A-04 is mid-edit there); every other package is clean"
    printf '%s\n' "$out" | grep -E '^app lint:' | head -8 | sed 's/^/      /'
  else
    fail "pnpm -r lint"; printf '%s\n' "$out" | tail -30
  fi
fi
if out="$(pnpm format:check 2>&1)"; then
  pass "pnpm format:check"
else
  badfiles="$(printf '%s\n' "$out" | grep '^\[warn\] ' | grep -v '^\[warn\] Code style' | sed 's/^\[warn\] //' | grep -vE "$THEIRS")"
  if [ -z "$badfiles" ]; then
    note "pnpm format:check: only A-04's in-flight files differ (not formatted by this task):"
    printf '%s\n' "$out" | grep '^\[warn\] ' | grep -v '^\[warn\] Code style' | sed 's/^/      /'
  else
    fail "pnpm format:check"; printf '%s\n' "$out" | tail -15
  fi
fi

# ---- scratch levels ------------------------------------------------------------------------------------------
say "scratch levels: levels/_examples/example-cli, example-code and a scratch chapter (scratch-e02, four levels)"
rm -rf "$CHECK_DIR"
mkdir -p "$E02_WORKSPACE" "$E02_LOGS" "$E02_PROGRESS" "$E02_LEVELS/scratch-e02/solutions" "$E02_LEVELS/scratch-e02/fixtures"
for d in example-cli example-code; do cp -R "levels/_examples/$d" "$E02_LEVELS/"; done
cat > "$PICK_JS" <<'EOF'
let s = '';
process.stdin.on('data', (d) => (s += d)).on('end', () => {
  let j = null;
  try { j = JSON.parse(s); } catch (e) { j = null; }
  let r;
  try { r = eval(process.argv[2]); } catch (e) { r = undefined; }
  if (r !== undefined) console.log(typeof r === 'object' ? JSON.stringify(r) : r);
});
EOF
S="$E02_LEVELS/scratch-e02"
cat > "$S/chapter.yaml" <<'EOF'
id: scratch-e02
title: "Scratch: E-02 check"
incident:
  - from: you
    time: "10:00"
    text: "scratch chapter for the E-02 check; never shipped"
levels:
  - scratch-e02-01-redis-budget
  - scratch-e02-02-run-the-traffic
  - scratch-e02-03-commandstats-clean
  - scratch-e02-04-kill-the-script
EOF
cat > "$S/fixtures/reset.yaml" <<'EOF'
steps:
  - cmd: [DEL, "cache:player:p-028", "cache:player:p-101", "cache:player:p-151"]
EOF
# 01: a code level graded by Redis calls per request (absolute, no baseline)
cat > "$S/01-redis-budget.yaml" <<'EOF'
id: scratch-e02-01-redis-budget
chapter: scratch-e02
title: "Redis budget"
mode: code
story: |
  Scratch level: the stats page may not spend more than half a Redis command per request.
scenario: toss-time-100
brainstorm:
  prompt: "The same three players, read thousands of times. Where can the copy live?"
  options:
    - id: in-process
      label: "In the app's own memory"
      is_reasonable: true
    - id: redis
      label: "In Redis"
      is_reasonable: true
    - id: not-redis
      label: "Not Redis: more Postgres replicas"
      is_reasonable: true
teach: |
  Every Redis command is a network round trip; a cache in process memory costs none.
task: |
  Fill in `getPlayerStats` in `workspace/ch2/cache.js`: at most 0.5 Redis commands per request under load.
verify:
  - type: behavior
    slot: cache.getPlayerStats
    fixtures: fixtures/reset.yaml
    assertions:
      - call: { args: ["p-028"] }
        sideEffect:
          - cmd: [EXISTS, "game:scratch:nothing"]
            equals: 0
            message: "unexpected key."
  - type: traffic
    scenario: toss-time-100
    baseline: false
    assertions:
      redis_per_request_lte: 0.5
    message: "The page spends too many Redis commands per request."
reward:
  xp: 10
solutions:
  reference: solutions/01-reference.js
  wrong:
    - path: solutions/01-wrong-redis-each-time.js
      expect: wrong
      because: "One Redis read per request is about 1 command per request, over the 0.5 budget."
EOF
cat > "$S/solutions/01-reference.js" <<'EOF'
// Memoises in process: after the first miss per player, no Redis command at all.
const memo = new Map();
export default async function getPlayerStats({ db }, playerId) {
  if (memo.has(playerId)) return memo.get(playerId);
  const { rows } = await db.query('SELECT * FROM player_stats($1)', [playerId]);
  const row = rows[0];
  if (!row) return null;
  memo.set(playerId, row);
  return row;
}
EOF
cat > "$S/solutions/01-wrong-redis-each-time.js" <<'EOF'
// A correct cache-aside that reads Redis on every request.
export default async function getPlayerStats({ redis, db }, playerId) {
  const key = `cache:player:${playerId}`;
  const cached = await redis.hGetAll(key);
  if (Object.keys(cached).length > 0) return cached;
  const { rows } = await db.query('SELECT * FROM player_stats($1)', [playerId]);
  const row = rows[0];
  if (!row) return null;
  const fields = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v)]));
  await redis.multi().hSet(key, fields).expire(key, 30).exec();
  return fields;
}
EOF
# 02: a cli level that waits for the learner to have run the traffic
cat > "$S/02-run-the-traffic.yaml" <<'EOF'
id: scratch-e02-02-run-the-traffic
chapter: scratch-e02
title: "Run the traffic"
mode: cli
story: |
  Scratch level: the game waits for you to put the app under traffic.
brainstorm:
  prompt: "How do you make a slow command show up in SLOWLOG?"
  options:
    - id: traffic
      label: "Put the app under load and look while it runs"
      is_reasonable: true
    - id: not-redis
      label: "Not Redis: read the Postgres logs"
      is_reasonable: true
teach: |
  The "Run traffic" button runs the level's scenario for ten seconds.
task: |
  Run the traffic, then look at the slowlog.
verify:
  - type: event
    kind: custom
    match: { name: load_finished, scenario: toss-time-100 }
    timeoutMs: 20000
    message: "The game has not seen you run the toss-time-100 traffic."
reward:
  xp: 10
solutions:
  reference: solutions/02-reference.redis
  wrong:
    - path: solutions/02-wrong.redis
      expect: wrong
      because: "Never ran the traffic; the harness produces no load_finished for a wrong solution."
EOF
printf 'SLOWLOG GET 5\n' > "$S/solutions/02-reference.redis"
printf 'GET game:nothing\n' > "$S/solutions/02-wrong.redis"
# 03: notContains and the negative-lookahead form on a multi-line INFO reply
cat > "$S/03-commandstats-clean.yaml" <<'EOF'
id: scratch-e02-03-commandstats-clean
chapter: scratch-e02
title: "Command stats clean"
mode: cli
story: |
  Scratch level: after your fix, KEYS must not show up in the command stats.
brainstorm:
  prompt: "How do you start counting from zero again?"
  options:
    - id: resetstat
      label: "CONFIG RESETSTAT"
      is_reasonable: true
    - id: not-redis
      label: "Not Redis: restart the container"
      is_reasonable: true
teach: |
  `INFO commandstats` counts every command since the last reset.
task: |
  Reset the stats so cmdstat_keys is gone.
verify:
  - type: redis
    checks:
      - cmd: [INFO, commandstats]
        notContains: cmdstat_keys
        message: "KEYS still shows up in INFO commandstats."
      - cmd: [INFO, commandstats]
        matches: "^(?![\\s\\S]*cmdstat_keys)"
        message: "KEYS still shows up (negative lookahead form)."
reward:
  xp: 10
solutions:
  reference: solutions/03-reference.redis
  wrong:
    - path: solutions/03-wrong-keys.redis
      expect: wrong
      because: "KEYS runs, so cmdstat_keys is in INFO commandstats."
EOF
printf 'KEYS scratch:e02:*\nCONFIG RESETSTAT\nPING\n' > "$S/solutions/03-reference.redis"
printf 'KEYS scratch:e02:*\n' > "$S/solutions/03-wrong-keys.redis"
# 04: an ops level that waits for BUSY and for the kill (the harness runs A-04's blocking route)
cat > "$S/04-kill-the-script.yaml" <<'EOF'
id: scratch-e02-04-kill-the-script
chapter: scratch-e02
title: "Kill the script"
mode: ops
story: |
  Scratch level: a script holds Redis; find it and kill it.
brainstorm:
  prompt: "Redis answers BUSY to everything. What can still get through?"
  options:
    - id: script-kill
      label: "SCRIPT KILL"
      is_reasonable: true
    - id: not-redis
      label: "Not Redis: restart the machine"
      is_reasonable: true
teach: |
  While a script runs past busy-reply-threshold, only SCRIPT KILL (or FUNCTION KILL) and SHUTDOWN NOSAVE are allowed.
task: |
  Kill the script.
verify:
  - type: event
    kind: custom
    match: { name: redis_busy }
    timeoutMs: 20000
    message: "The game has not seen Redis go BUSY."
  - type: event
    kind: custom
    match: { name: script_killed }
    timeoutMs: 20000
    message: "The game has not seen you kill the script."
reward:
  xp: 10
solutions:
  reference: solutions/04-reference.redis
  wrong:
    - path: solutions/04-wrong.redis
      expect: wrong
      because: "Nothing blocked and nothing was killed; the harness produces no events for a wrong solution."
EOF
printf 'PING\n' > "$S/solutions/04-reference.redis"
printf 'GET game:nothing\n' > "$S/solutions/04-wrong.redis"
v="$(node packages/shared/dist/levels/cli.js "$E02_LEVELS" 2>&1)"
if [ $? -eq 0 ]; then pass "scratch levels valid: $v"; else fail "scratch levels invalid"; printf '%s\n' "$v"; exit 1; fi

# ---- compose override ----------------------------------------------------------------------------------------
cat > "$OVERRIDE" <<EOF
# Generated by scripts/check/E-02.sh (project quest-e02): own image tag, scratch workspace, logs, progress, levels.
x-e02-node: &e02-node
  image: quest-e02-node:latest

services:
  engine:
    <<: *e02-node
    environment:
      # Event waits are capped so wrong solutions that wait for an event grade in seconds, not minutes.
      VERIFY_MAX_EVENT_WAIT_MS: "5000"
    volumes:
      - $E02_WORKSPACE:/workspace
      - $E02_LOGS:/logs
      - $E02_PROGRESS:/progress
      - $E02_LEVELS:/levels:ro
      - $ROOT/scenarios:/srv/scenarios:ro
  app:
    <<: *e02-node
    volumes:
      - $E02_WORKSPACE:/workspace
      - $E02_LOGS:/logs
      - $E02_PROGRESS:/progress
  runner:
    <<: *e02-node
    volumes:
      - $E02_WORKSPACE:/workspace
      - $E02_LOGS:/logs
      - $E02_PROGRESS:/progress
  proxy:
    volumes:
      - $ROOT/docker/Caddyfile:/etc/caddy/Caddyfile:ro
      - $E02_LOGS:/logs
  postgres:
    volumes:
      - pg-data:/var/lib/postgresql/data
      - $ROOT/postgres/init:/docker-entrypoint-initdb.d:ro
      - $E02_LOGS:/logs
EOF

say "docker compose -p $PROJECT build (image quest-e02-node, retried), up -d $SERVICES"
dc down -v --remove-orphans >/dev/null 2>&1
n=0
until dc build engine >"$CHECK_DIR/build.log" 2>&1; do
  n=$((n + 1))
  if [ $n -ge 3 ]; then fail "docker build failed 3 times"; tail -30 "$CHECK_DIR/build.log"; exit 1; fi
  echo "build attempt $n failed, retrying"; tail -5 "$CHECK_DIR/build.log"; sleep 10
done
pass "image built"
# shellcheck disable=SC2086
if dc up -d --no-build $SERVICES 2>&1 | grep -vE '^ *#|^$' | tail -12; then :; fi
if h="$(wait_engine)"; then pass "engine healthy through the proxy on 3600: $h"; else fail "engine not healthy: $h"; dc logs --tail 40 engine; exit 1; fi
case "$h" in *'"levels":"ok"'*) pass "engine loaded the levels" ;; *) fail "engine reports levels invalid: $h"; exit 1 ;; esac
ok=0; i=0
while [ $i -lt 40 ]; do
  if [ "$(curl -s -m 2 "$BASE/app/health" | pick 'j.ok === true || j.status === "ok" || !!j.activeSlots')" = true ]; then ok=1; break; fi
  sleep 1; i=$((i + 1))
done
if [ $ok = 1 ]; then pass "app answers /app/health"; else fail "app did not answer /app/health"; dc logs --tail 30 app; exit 1; fi

# ---- 1. traffic on demand -------------------------------------------------------------------------------------
say "POST /api/load/start, GET /api/load/status, POST /api/load/stop"
st="$(curl -s -m 5 "$BASE/api/load/status")"
if [ "$(printf '%s' "$st" | pick 'j.running === false && j.last === null && j.scenario === null')" = true ]; then pass "status before any run: $st"; else fail "status before any run: $st"; fi
if [ "$(jcode /api/load/start '{"scenario":"toss-time-100","durationSec":31}')" = 400 ]; then pass "durationSec 31 is 400"; else fail "durationSec 31 should be 400"; fi
if [ "$(jcode /api/load/start '{"scenario":"no-such-scenario","durationSec":5}')" = 400 ]; then pass "an unknown scenario is 400"; else fail "unknown scenario should be 400"; fi
resp="$(curl -s -m 30 -w ' HTTP%{http_code}' -X POST -H 'content-type: application/json' -d '{"scenario":"toss-time-100","durationSec":5}' "$BASE/api/load/start")"
case "$resp" in
  *HTTP202) pass "POST /api/load/start toss-time-100 5 s -> 202: ${resp% HTTP202}" ;;
  *) fail "POST /api/load/start: $resp" ;;
esac
if [ "$(printf '%s' "${resp% HTTP202}" | pick "j.scenario === 'toss-time-100' && j.durationSec === 5 && j.connections > 0 && Date.parse(j.endsAt) - Date.parse(j.startedAt) === 5000")" = true ]; then pass "202 body has scenario, durationSec 5, connections, startedAt and endsAt 5 s later"; else fail "202 body shape"; fi
st="$(curl -s -m 5 "$BASE/api/load/status")"
if [ "$(printf '%s' "$st" | pick "j.running === true && j.scenario === 'toss-time-100'")" = true ]; then pass "status shows the run: $st"; else fail "status while running: $st"; fi
if [ "$(jcode /api/load/start '{"scenario":"toss-time-100","durationSec":5}')" = 409 ]; then pass "a second start while running is 409"; else fail "second start should be 409"; fi
if w="$(wait_not_running 20)"; then pass "status goes to running:false after the run (~${w} s of polling)"; else fail "the 5 s run did not finish within 20 s"; fi
st="$(curl -s -m 5 "$BASE/api/load/status")"
if [ "$(printf '%s' "$st" | pick 'j.last && j.last.requests > 0 && j.last.rps > 0 && typeof j.last.p99Ms === "number" && typeof j.last.errors === "number" && typeof j.last.status5xx === "number"')" = true ]; then pass "last run has numbers: $(printf '%s' "$st" | pick 'JSON.stringify(j.last)')"; else fail "status.last: $st"; fi
if [ "$(event_count load_started toss-time-100)" = 1 ]; then pass "GET /api/events has load_started for toss-time-100"; else fail "load_started count: $(event_count load_started toss-time-100)"; fi
if [ "$(event_count load_finished toss-time-100)" = 1 ]; then pass "GET /api/events has load_finished for toss-time-100"; else fail "load_finished count: $(event_count load_finished toss-time-100)"; fi
curl -s -m 5 "$BASE/api/events" | pick "j.events.filter(e => e.data && e.data.name === 'load_finished').map(e => JSON.stringify(e.data)).join(' | ')" | sed 's/^/      payload: /'
if [ "$(ls "$E02_PROGRESS/baselines" 2>/dev/null | wc -l | tr -d ' ')" = 0 ]; then pass "no baseline was recorded or touched"; else fail "baselines dir is not empty: $(ls "$E02_PROGRESS/baselines")"; fi

# stop ends a 20 s run early
t0="$(now_ms)"
if [ "$(jcode /api/load/start '{"scenario":"toss-time-100","durationSec":20}')" = 202 ]; then pass "20 s run started"; else fail "20 s run did not start"; fi
sleep 2
stopresp="$(jpost /api/load/stop '{}')"
t1="$(now_ms)"
if [ "$(printf '%s' "$stopresp" | pick 'j.stopped === true')" = true ]; then pass "POST /api/load/stop -> $stopresp"; else fail "stop: $stopresp"; fi
el=$(( t1 - t0 ))
if [ "$el" -lt 9000 ] && [ "$(curl -s -m 3 "$BASE/api/load/status" | pick 'j.running')" = false ]; then pass "the run ended ${el} ms after it started (of 20 000), status running:false"; else fail "stop did not end the run early (${el} ms)"; fi
if [ "$(event_count load_finished toss-time-100)" = 2 ]; then pass "load_finished fired for the stopped run too"; else fail "load_finished count after stop: $(event_count load_finished toss-time-100)"; fi
if [ "$(jpost /api/load/stop '{}' | pick 'j.stopped')" = false ]; then pass "stop with nothing running -> stopped:false"; else fail "stop with nothing running"; fi

# verify during a run is 409
say "verify during a traffic run answers 409 verify_in_progress"
CODE_ID=example-code-01-cache-aside
if [ "$(jcode /api/player '{"name":"E02"}')" = 201 ]; then pass "player created"; else fail "POST /api/player"; fi
for lid in $(curl -s "$BASE/api/chapters" | pick "j.chapters.flatMap(c => c.levels.map(l => l.id)).filter((id, i, a) => i < a.indexOf('$CODE_ID')).join(' ')"); do
  jcode "/api/levels/$lid/complete" '{}' >/dev/null
done
if [ "$(jcode "/api/levels/$CODE_ID/start" '{}')" = 200 ]; then pass "$CODE_ID started"; else fail "start $CODE_ID"; fi
jcode /api/load/start '{"scenario":"toss-time-100","durationSec":20}' >/dev/null
v="$(curl -s -m 20 -w ' HTTP%{http_code}' -X POST -H 'content-type: application/json' -d '{"answers":{}}' "$BASE/api/levels/$CODE_ID/verify")"
case "$v" in
  *HTTP409) if [ "$(printf '%s' "${v% HTTP409}" | pick "j.error === 'verify_in_progress' && /traffic run/.test(j.message)")" = true ]; then pass "verify during a run -> 409: ${v% HTTP409}"; else fail "409 body: $v"; fi ;;
  *) fail "verify during a run should be 409: $v" ;;
esac
jpost /api/load/stop '{}' >/dev/null
wait_not_running 10 >/dev/null
if [ "$(jcode /api/load/start '{"scenario":"toss-time-100","durationSec":1}')" = 202 ]; then pass "the guard is free again after stop"; else fail "start after stop"; fi
wait_not_running 15 >/dev/null

# ---- 2. a long script holds Redis ------------------------------------------------------------------------------
say "20 s read-only EVAL through redis-cli: PING in the terminal, the engine, SCRIPT KILL"
LUA="local t0=redis.call('TIME') local s=tonumber(t0[1])*1000+math.floor(tonumber(t0[2])/1000) while true do local t=redis.call('TIME') if tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)-s>=20000 then break end end return 'done'"
T_SCRIPT="$(now_ms)"
dc exec -T redis redis-cli EVAL "$LUA" 0 > "$CHECK_DIR/evalloop.out" 2>&1 &
EVAL_PID=$!
sleep 1
T_PING="$(now_ms)"
r="$(curl -s -m 20 -X POST -H 'content-type: application/json' -d '{"command":"PING"}' "$BASE/api/cli")"
T_PONG="$(now_ms)"
since_script=$(( T_PONG - T_SCRIPT )); since_ping=$(( T_PONG - T_PING ))
case "$r" in
  *'"type":"error"'*'(error) BUSY'*|*'(error) BUSY'*'"type":"error"'*)
    if [ "$since_script" -le 7500 ]; then pass "PING in the terminal -> BUSY ${since_script} ms after the script started (${since_ping} ms after the PING): $r"; else fail "PING answered BUSY but only after ${since_script} ms"; fi ;;
  *) fail "PING during the script did not answer BUSY (took ${since_ping} ms): $r" ;;
esac
sleep 0.5
if [ "$(event_count redis_busy '')" -ge 1 ] && [ "$(curl -s -m 5 "$BASE/api/events" | pick "j.events.some(e => e.data && e.data.name === 'redis_busy' && e.data.data && e.data.data.command === 'PING')")" = true ]; then pass "redis_busy { command: PING } is in GET /api/events"; else fail "no redis_busy event"; fi
# What the engine itself does while the script runs (observed, reported, not asserted beyond "answers").
for probe in "GET /health" "GET /api/chapters" "GET /api/progress"; do
  p0="$(now_ms)"; code="$(curl -s -m 12 -o /dev/null -w '%{http_code}' "$BASE${probe#GET }")"; p1="$(now_ms)"
  echo "      observed: $probe -> $code in $(( p1 - p0 )) ms (script running)"
done
p0="$(now_ms)"; r="$(curl -s -m 12 -X POST -H 'content-type: application/json' -d '{"command":"GET some:key"}' "$BASE/api/cli")"; p1="$(now_ms)"
echo "      observed: a second terminal command (GET some:key) -> $r in $(( p1 - p0 )) ms"
p0="$(now_ms)"; hv="$(curl -s -m 12 "$BASE/health")"; p1="$(now_ms)"
echo "      observed: /health body during the script: $hv"
if kill -0 "$EVAL_PID" 2>/dev/null; then pass "the EVAL loop is still running (about $(( ($(now_ms) - T_SCRIPT) / 1000 )) s in)"; else fail "the EVAL loop ended before SCRIPT KILL"; fi
k="$(curl -s -m 20 -X POST -H 'content-type: application/json' -d '{"command":"SCRIPT KILL"}' "$BASE/api/cli")"
case "$k" in
  *'"reply":"OK"'*'"type":"status"'*|*'"type":"status"'*'"reply":"OK"'*) pass "SCRIPT KILL through /api/cli -> $k" ;;
  *) fail "SCRIPT KILL did not answer OK: $k" ;;
esac
sleep 0.5
if [ "$(curl -s -m 5 "$BASE/api/events" | pick "j.events.some(e => e.data && e.data.name === 'script_killed' && e.data.data && e.data.data.command === 'SCRIPT KILL')")" = true ]; then pass "script_killed { command: SCRIPT KILL } is in GET /api/events"; else fail "no script_killed event"; fi
i=0; while [ $i -lt 20 ] && kill -0 "$EVAL_PID" 2>/dev/null; do sleep 0.5; i=$((i + 1)); done
if kill -0 "$EVAL_PID" 2>/dev/null; then fail "redis-cli EVAL still running 10 s after SCRIPT KILL"; else pass "redis-cli's EVAL ended after the kill: $(tr -d '\r' < "$CHECK_DIR/evalloop.out" | head -2 | tr '\n' ' ')"; fi
EVAL_PID=""
p="$(curl -s -m 8 -X POST -H 'content-type: application/json' -d '{"command":"PING"}' "$BASE/api/cli")"
case "$p" in *PONG*) pass "PING answers PONG again: $p" ;; *) fail "PING after the kill: $p" ;; esac
hv="$(curl -s -m 5 "$BASE/health")"
case "$hv" in *'"redis":"up"'*) pass "engine health after the kill: $hv" ;; *) fail "engine health after the kill: $hv" ;; esac

# ---- 3. grading harness: scratch chapter -------------------------------------------------------------------------
say "grade scratch-e02: redis_per_request_lte, load_finished dance, notContains, script_killed dance"
scripts/grade/grade.sh --engine "$BASE" --json "$CHECK_DIR/scratch.json" "$E02_LEVELS/scratch-e02" 2>&1 | tee "$CHECK_DIR/scratch.out" | grep -vE '^ *[0-9]+s +\.\.\.' | tail -50
rc=${PIPESTATUS[0]}
rowinfo() { # level-suffix solution-substring -> "RESULT declared=.. engine=.."
  node -e "
const j = JSON.parse(require('fs').readFileSync('$CHECK_DIR/scratch.json', 'utf8'));
const r = j.rows.find((x) => x.level.endsWith('$1') && x.solution.includes('$2'));
console.log(r ? r.result + ' declared=' + r.declared + ' engine=' + r.engine : 'missing');
"
}
rowcheck() { # level-suffix solution-substring declared engine
  r="$(rowinfo "$1" "$2")"
  case "$r" in
    "PASS declared=$3 engine=$4") pass "$1 $2: $r" ;;
    *) fail "$1 $2: expected PASS declared=$3 engine=$4, got: $r" ;;
  esac
}
feedback() { # level-suffix solution-substring -> all check messages, joined
  node -e "
const j = JSON.parse(require('fs').readFileSync('$CHECK_DIR/scratch.json', 'utf8'));
const r = j.rows.find((x) => x.level.endsWith('$1') && x.solution.includes('$2'));
console.log(r ? r.feedback.map((f) => '[' + f.tag + '] ' + f.message).join(' || ') : 'missing');
"
}
rowcheck 01-redis-budget 01-reference right right
rowcheck 01-redis-budget 01-wrong-redis-each-time wrong wrong
fb="$(feedback 01-redis-budget 01-wrong-redis-each-time)"
case "$fb" in
  *"The page spends too many Redis commands per request. ("*"Redis calls per request ("*"commands over"*"needs at most 0.5)"*) pass "wrong file's feedback: $(printf '%s' "$fb" | tr '\n' ' ' | cut -c1-260)" ;;
  *) fail "wrong file's feedback is not the Redis-per-request text: $fb" ;;
esac
fb="$(feedback 01-redis-budget 01-reference)"
case "$fb" in
  *"Passed under load:"*"Redis calls per request (0 commands over"*) pass "reference's traffic line: $(printf '%s' "$fb" | grep -o 'Passed under load[^|]*' | head -1 | cut -c1-200)" ;;
  *"Passed under load:"*"Redis calls per request"*) pass "reference's traffic line: $(printf '%s' "$fb" | grep -o 'Passed under load[^|]*' | head -1 | cut -c1-200)" ;;
  *) fail "reference's traffic line: $fb" ;;
esac
rowcheck 02-run-the-traffic 02-reference right right
rowcheck 02-run-the-traffic 02-wrong wrong wrong
if grep -q "load dance: ran toss-time-100 for 5 s" "$CHECK_DIR/scratch.out"; then pass "harness note: it ran the traffic before verify ($(grep -o 'load dance: [^]]*' "$CHECK_DIR/scratch.out" | head -1))"; else fail "no 'load dance' note in the harness output"; fi
rowcheck 03-commandstats-clean 03-reference right right
rowcheck 03-commandstats-clean 03-wrong-keys wrong wrong
fb="$(feedback 03-commandstats-clean 03-wrong-keys)"
case "$fb" in
  *'KEYS still shows up in INFO commandstats. (expected no "cmdstat_keys", got a line reading cmdstat_keys:calls='*) pass "notContains feedback: $(printf '%s' "$fb" | cut -c1-230)" ;;
  *) fail "notContains feedback: $fb" ;;
esac
case "$fb" in
  *'KEYS still shows up (negative lookahead form). (expected something matching /^(?![\s\S]*cmdstat_keys)/'*) pass "the negative-lookahead matches check fails the wrong file too, and passes the reference (row 03-reference passed both checks)" ;;
  *) fail "matches lookahead feedback: $fb" ;;
esac
if grep -q "NOTE script_killed: /app/oncall/badges/recompute not available (A-04 not merged)" "$CHECK_DIR/scratch.out"; then
  note "04-kill-the-script: /app/oncall/badges/recompute is not available (A-04 not merged); the harness printed its NOTE and carried on, so the reference row is a mismatch, which is correct. The rest of the rule is not exercised here."
  r="$(rowinfo 04-kill-the-script 04-reference)"
  case "$r" in "MISMATCH declared=right engine=wrong") pass "04 reference without A-04's route: $r" ;; *) fail "04 reference without A-04's route: $r" ;; esac
  rowcheck 04-kill-the-script 04-wrong wrong wrong
else
  rowcheck 04-kill-the-script 04-reference right right
  rowcheck 04-kill-the-script 04-wrong wrong wrong
  if grep -q "busy dance: /app/oncall/badges/recompute started, PING -> (error) BUSY" "$CHECK_DIR/scratch.out"; then pass "harness note: $(grep -o 'busy dance: [^]]*' "$CHECK_DIR/scratch.out" | head -1)"; else fail "no 'busy dance ... PING -> (error) BUSY' note"; fi
fi
# The grader exits 1 on a mismatch. The only mismatch allowed is the 04 reference while A-04 is not merged.
if [ "$rc" = 0 ]; then pass "scratch-e02: grade exit 0"
elif grep -q "NOTE script_killed: /app/oncall/badges/recompute not available" "$CHECK_DIR/scratch.out" && [ "$(grep -c '^ *[0-9]*s *MISMATCH' "$CHECK_DIR/scratch.out")" = 1 ]; then pass "scratch-e02: grade exit $rc with only the expected 04 mismatch"
else fail "scratch-e02: grade exit $rc"; fi

# ---- 4. regression ------------------------------------------------------------------------------------------------
say "grade the example levels (regression: levels without the new keys and events grade as before)"
scripts/grade/grade.sh --engine "$BASE" --json "$CHECK_DIR/examples.json" "$E02_LEVELS/example-cli" "$E02_LEVELS/example-code" 2>&1 | tee "$CHECK_DIR/examples.out" | grep -E '^(PASS|MISMATCH|SKIPPED|totals|example-)' | tail -30
rc=${PIPESTATUS[0]}
if [ "$rc" = 0 ] && ! grep -q '^MISMATCH' "$CHECK_DIR/examples.out"; then pass "example-cli and example-code: no MISMATCH"; else fail "example levels: grade exit $rc"; fi

if [ $FAILED -eq 0 ]; then echo; echo "E-02 OK"; exit 0; fi
echo; echo "E-02 FAILED"; exit 1
