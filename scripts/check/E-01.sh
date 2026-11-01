#!/usr/bin/env bash
# E-01 check: engine, UI and harness plumbing Chapter 3 needs.
#   1. service_scaled: the engine's real emitter fires when `--scale app=2` / `app=1` changes the live instances
#   2. POST /api/levels/:id/slots puts the learner's slot into the app and takes it out again
#   3. the grading harness produces the live events (fake instance, channel PUBLISH during verify) and still grades
#      the example levels exactly as before
#   4. engine and ui unit tests, lint, format
# Runs in its own compose project (quest-e01, .env.e01: ports 3600/6396/5438/5546, ENGINE_DEV=1, no insight) with
# scratch workspace, logs, progress and levels under logs/.e-01-check, so it never touches another project.
# bash 3.2 compatible.
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1

PROJECT=quest-e01
ENV_FILE=.env.e01
CHECK_DIR="$ROOT/logs/.e-01-check"
OVERRIDE="$CHECK_DIR/compose.e01.yaml"
BASE=http://127.0.0.1:3600
SERVICES="redis postgres engine app runner proxy"
FAILED=0

say() { printf '\n== %s\n' "$*"; }
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILED=1; }
dc() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.yml -f "$OVERRIDE" "$@"; }

setvar() { grep -v "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null; printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE.tmp"; mv "$ENV_FILE.tmp" "$ENV_FILE"; }
cp .env.example "$ENV_FILE"
setvar PROXY_PORT 3600
setvar REDIS_PORT 6396
setvar PG_PORT 5438
setvar INSIGHT_PORT 5546
setvar ENGINE_DEV 1

export E01_WORKSPACE="$CHECK_DIR/workspace" E01_LOGS="$CHECK_DIR/logs" E01_PROGRESS="$CHECK_DIR/progress" E01_LEVELS="$CHECK_DIR/levels"

cleanup() {
  say "cleanup"
  if [ -f "$OVERRIDE" ]; then
    dc down -v --remove-orphans >/dev/null 2>&1 && echo "docker compose -p $PROJECT down -v: done"
  fi
  rm -rf "$CHECK_DIR" && echo "removed scratch dir logs/.e-01-check"
}
trap cleanup EXIT

# Tiny JSON helper: `... | pick 'j.slots.active'` prints the value of the JS expression over the parsed stdin
# (undefined or a parse error prints nothing).
PICK_JS="$CHECK_DIR/pick.js"
pick() { node "$PICK_JS" "$1"; }
jpost() { curl -s -m 20 -X POST -H 'content-type: application/json' -d "$2" "$BASE$1"; }
jcode() { curl -s -m 20 -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d "$2" "$BASE$1"; }

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

# wait_scaled INSTANCES PREVIOUS SECONDS: a service_scaled event with that payload is in GET /api/events
wait_scaled() {
  i=0
  while [ $i -lt $(( $3 * 2 )) ]; do
    r="$(curl -s -m 3 "$BASE/api/events" | pick "j.events.filter(e => e.data && e.data.kind === 'service_scaled' && e.data.data && e.data.data.instances === $1 && e.data.data.previous === $2).length > 0")"
    [ "$r" = true ] && return 0
    sleep 0.5; i=$((i + 1))
  done
  return 1
}

# ---- 0. static: build, unit tests, lint, format -------------------------------------------------------------
say "docker, build @quest/shared, @quest/engine, @quest/ui (only the packages this task needs)"
if docker info >/dev/null 2>&1; then pass "docker is running"; else fail "docker is not running"; exit 1; fi
if pnpm --filter @quest/shared build >/dev/null 2>&1; then pass "@quest/shared built"; else fail "@quest/shared build"; exit 1; fi
if pnpm --filter @quest/engine build >/dev/null 2>&1; then pass "@quest/engine built"; else fail "@quest/engine build"; pnpm --filter @quest/engine build 2>&1 | tail -20; exit 1; fi
if pnpm --filter @quest/ui build >/dev/null 2>&1; then pass "@quest/ui built (tsc --noEmit and vite build)"; else fail "@quest/ui build"; pnpm --filter @quest/ui build 2>&1 | tail -20; exit 1; fi
if bash -n scripts/check/E-01.sh && node --check scripts/grade/grade.mjs; then pass "E-01.sh and grade.mjs parse"; else fail "syntax"; exit 1; fi

say "engine vitest (scale emitter on a fake clock, slots route, 409 while verifying)"
if out="$(pnpm --filter @quest/engine test 2>&1)"; then pass "engine tests: $(printf '%s\n' "$out" | grep -E 'Tests ' | tail -1)"; else fail "engine tests"; printf '%s\n' "$out" | tail -40; fi
say "ui vitest (the Run my code in the app switch)"
if out="$(pnpm --filter @quest/ui test 2>&1)"; then pass "ui tests: $(printf '%s\n' "$out" | grep -E 'Tests ' | tail -1)"; else fail "ui tests"; printf '%s\n' "$out" | tail -40; fi
say "pnpm -r lint, pnpm format:check"
# A-02 edits app/ and engine/src/verify/slots.ts at the same time as this task. A lint or format problem that is only in
# app/ is theirs: it is printed as a NOTE and does not fail this check (it fails as soon as anything else is involved).
if out="$(pnpm -r --no-bail lint 2>&1)"; then
  pass "pnpm -r lint"
else
  bad="$(printf '%s\n' "$out" | grep -E '^[^ ]+ lint: Failed' | grep -v '^app lint: Failed')"
  if printf '%s\n' "$out" | grep -q '^app lint: Failed' && [ -z "$bad" ]; then
    printf 'NOTE  pnpm -r lint: only app/ fails (A-02 is mid-edit there); every other package is clean\n'
    printf '%s\n' "$out" | grep -E '^app lint:' | head -8 | sed 's/^/      /'
  else
    fail "pnpm -r lint"; printf '%s\n' "$out" | tail -30
  fi
fi
if out="$(pnpm format:check 2>&1)"; then
  pass "pnpm format:check"
else
  badfiles="$(printf '%s\n' "$out" | grep '^\[warn\] ' | grep -v '^\[warn\] Code style' | grep -v '^\[warn\] app/')"
  if [ -z "$badfiles" ] && printf '%s\n' "$out" | grep -q '^\[warn\] app/'; then
    printf 'NOTE  pnpm format:check: only app/ files differ (A-02 is mid-edit there)\n'
    printf '%s\n' "$out" | grep '^\[warn\] app/' | sed 's/^/      /'
  else
    fail "pnpm format:check"; printf '%s\n' "$out" | tail -15
  fi
fi

# ---- scratch levels ------------------------------------------------------------------------------------------
say "scratch levels: levels/_examples/example-cli, example-code and a scratch chapter (scratch-e01, three levels)"
rm -rf "$CHECK_DIR"
mkdir -p "$E01_WORKSPACE" "$E01_LOGS" "$E01_PROGRESS" "$E01_LEVELS/scratch-e01/solutions" "$E01_LEVELS/scratch-e01/fixtures"
for d in example-cli example-code; do cp -R "levels/_examples/$d" "$E01_LEVELS/"; done
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
S="$E01_LEVELS/scratch-e01"
cat > "$S/chapter.yaml" <<'EOF'
id: scratch-e01
title: "Scratch: E-01 check"
incident:
  - from: you
    time: "10:00"
    text: "scratch chapter for the E-01 check; never shipped"
levels:
  - scratch-e01-01-two-instances
  - scratch-e01-02-score-channel
  - scratch-e01-03-explicit-message
EOF
cat > "$S/fixtures/reset.yaml" <<'EOF'
steps:
  - cmd: [DEL, "cache:player:p-028"]
EOF
# 01: an ops level that waits for the app to scale to 2
cat > "$S/01-two-instances.yaml" <<'EOF'
id: scratch-e01-01-two-instances
chapter: scratch-e01
title: "Two instances"
mode: ops
story: |
  Scratch level: the game waits for a second app instance.
brainstorm:
  prompt: "Traffic doubled. What do you reach for?"
  options:
    - id: more-instances
      label: "Run a second app instance"
      is_reasonable: true
    - id: not-redis
      label: "Not Redis: a bigger machine"
      is_reasonable: true
teach: |
  `docker compose up -d --scale app=2` starts a second instance of the app.
task: |
  Scale the app to two instances.
verify:
  - type: event
    kind: service_scaled
    match: { service: app, instances: 2 }
    timeoutMs: 20000
    message: "The game has not seen the app scale to 2 instances."
reward:
  xp: 10
solutions:
  reference: solutions/01-reference.redis
  wrong:
    - path: solutions/01-wrong.redis
      expect: wrong
      because: "Nothing scaled; the harness produces no scale event for a wrong solution."
EOF
printf 'PING\n' > "$S/solutions/01-reference.redis"
printf 'GET game:nothing\n' > "$S/solutions/01-wrong.redis"
# 02: a code level, behavior plus a channel_message event
cat > "$S/02-score-channel.yaml" <<'EOF'
id: scratch-e01-02-score-channel
chapter: scratch-e01
title: "Score channel"
mode: code
story: |
  Scratch level: cache the stats and announce them on a channel.
brainstorm:
  prompt: "How do other parts of the app hear about a change?"
  options:
    - id: pubsub
      label: "PUBLISH on a channel"
      is_reasonable: true
    - id: not-redis
      label: "Not Redis: poll Postgres"
      is_reasonable: true
teach: |
  `PUBLISH channel message` reaches every client currently subscribed to the channel.
task: |
  Fill in `getPlayerStats` in `workspace/ch2/cache.js`: store the hash, then publish on `score:match:test`.
verify:
  - type: behavior
    slot: cache.getPlayerStats
    fixtures: fixtures/reset.yaml
    assertions:
      - call: { args: ["p-028"] }
        sideEffect:
          - cmd: [TYPE, "cache:player:p-028"]
            equals: hash
            message: "cache:player:p-028 should be a hash."
  - type: event
    kind: channel_message
    match: { channel: "score:match:test" }
    timeoutMs: 20000
    message: "Nothing was published on score:match:test."
reward:
  xp: 10
solutions:
  reference: solutions/02-reference.js
  wrong:
    - path: solutions/02-wrong-no-publish.js
      expect: wrong
      because: "Never publishes, and the harness only publishes for good solutions."
EOF
cat > "$S/solutions/02-reference.js" <<'EOF'
export default async function getPlayerStats({ redis }, playerId) {
  const key = `cache:player:${playerId}`;
  await redis.hSet(key, { id: String(playerId), runs: '1' });
  await redis.expire(key, 30);
  await redis.publish('score:match:test', JSON.stringify({ playerId }));
  return { id: playerId };
}
EOF
cat > "$S/solutions/02-wrong-no-publish.js" <<'EOF'
export default async function getPlayerStats({ redis }, playerId) {
  const key = `cache:player:${playerId}`;
  await redis.hSet(key, { id: String(playerId), runs: '1' });
  await redis.expire(key, 30);
  return { id: playerId };
}
EOF
# 03: the verifier carries match.message, so the harness must publish exactly that
cat > "$S/03-explicit-message.yaml" <<'EOF'
id: scratch-e01-03-explicit-message
chapter: scratch-e01
title: "Explicit message"
mode: code
story: |
  Scratch level: the channel check wants one exact message.
brainstorm:
  prompt: "Who sends the message here?"
  options:
    - id: pubsub
      label: "A publisher outside your function"
      is_reasonable: true
    - id: not-redis
      label: "Not Redis: a webhook"
      is_reasonable: true
teach: |
  The verifier only matches the exact message it was told to expect.
task: |
  Fill in `getPlayerStats` in `workspace/ch2/cache.js`: store the hash.
verify:
  - type: behavior
    slot: cache.getPlayerStats
    fixtures: fixtures/reset.yaml
    assertions:
      - call: { args: ["p-028"] }
        sideEffect:
          - cmd: [TYPE, "cache:player:p-028"]
            equals: hash
            message: "cache:player:p-028 should be a hash."
  - type: event
    kind: channel_message
    match: { channel: "score:match:test3", message: '{"seq":7}' }
    timeoutMs: 20000
    message: "The exact message was not published on score:match:test3."
reward:
  xp: 10
solutions:
  reference: solutions/03-reference.js
  wrong:
    - path: solutions/03-wrong-no-hash.js
      expect: wrong
      because: "Stores nothing, so the behavior check fails."
EOF
cat > "$S/solutions/03-reference.js" <<'EOF'
export default async function getPlayerStats({ redis }, playerId) {
  const key = `cache:player:${playerId}`;
  await redis.hSet(key, { id: String(playerId), runs: '1' });
  await redis.expire(key, 30);
  return { id: playerId };
}
EOF
cat > "$S/solutions/03-wrong-no-hash.js" <<'EOF'
export default async function getPlayerStats(_deps, playerId) {
  return { id: playerId };
}
EOF
v="$(node packages/shared/dist/levels/cli.js "$E01_LEVELS" 2>&1)"
if [ $? -eq 0 ]; then pass "scratch levels valid: $v"; else fail "scratch levels invalid"; printf '%s\n' "$v"; exit 1; fi

# ---- compose override ----------------------------------------------------------------------------------------
cat > "$OVERRIDE" <<EOF
# Generated by scripts/check/E-01.sh (project quest-e01): own image tag, scratch workspace, logs, progress, levels.
x-e01-node: &e01-node
  image: quest-e01-node:latest

services:
  engine:
    <<: *e01-node
    environment:
      # Event waits are capped so wrong solutions that wait for an event grade in seconds, not minutes.
      VERIFY_MAX_EVENT_WAIT_MS: "5000"
    volumes:
      - $E01_WORKSPACE:/workspace
      - $E01_LOGS:/logs
      - $E01_PROGRESS:/progress
      - $E01_LEVELS:/levels:ro
      - $ROOT/scenarios:/srv/scenarios:ro
  app:
    <<: *e01-node
    volumes:
      - $E01_WORKSPACE:/workspace
      - $E01_LOGS:/logs
      - $E01_PROGRESS:/progress
  runner:
    <<: *e01-node
    volumes:
      - $E01_WORKSPACE:/workspace
      - $E01_LOGS:/logs
      - $E01_PROGRESS:/progress
  proxy:
    volumes:
      - $ROOT/docker/Caddyfile:/etc/caddy/Caddyfile:ro
      - $E01_LOGS:/logs
  postgres:
    volumes:
      - pg-data:/var/lib/postgresql/data
      - $ROOT/postgres/init:/docker-entrypoint-initdb.d:ro
      - $E01_LOGS:/logs
EOF

say "docker compose -p $PROJECT build (image quest-e01-node, retried), up -d --scale app=2 $SERVICES"
dc down -v --remove-orphans >/dev/null 2>&1
n=0
until dc build engine >"$CHECK_DIR/build.log" 2>&1; do
  n=$((n + 1))
  if [ $n -ge 3 ]; then fail "docker build failed 3 times"; tail -30 "$CHECK_DIR/build.log"; exit 1; fi
  echo "build attempt $n failed, retrying"; tail -5 "$CHECK_DIR/build.log"; sleep 10
done
pass "image built"
# shellcheck disable=SC2086
if dc up -d --no-build --scale app=2 $SERVICES 2>&1 | grep -vE '^ *#|^$' | tail -12; then :; fi
if h="$(wait_engine)"; then pass "engine healthy through the proxy on 3600: $h"; else fail "engine not healthy: $h"; dc logs --tail 40 engine; exit 1; fi
case "$h" in *'"levels":"ok"'*) pass "engine loaded the levels" ;; *) fail "engine reports levels invalid: $h"; exit 1 ;; esac

# ---- 1. service_scaled from the real emitter -------------------------------------------------------------------
say "service_scaled: real instances, real emitter"
if wait_scaled 2 1 15; then
  pass "--scale app=2: GET /api/events has service_scaled instances 2 (previous 1) within 15 s"
  curl -s -m 3 "$BASE/api/events" | pick "j.events.filter(e => e.data && e.data.kind === 'service_scaled').map(e => JSON.stringify(e.data.data)).join(' | ')" | sed 's/^/      payloads: /'
else
  fail "no service_scaled instances 2 within 15 s of the engine being healthy"
  curl -s -m 3 "$BASE/api/metrics?seconds=10" | pick "j.instances"
  dc ps
fi
dc up -d --no-build --scale app=1 app >/dev/null 2>&1
if wait_scaled 1 2 15; then pass "--scale app=1: service_scaled instances 1 (previous 2) within 15 s"; else fail "no service_scaled instances 1 (previous 2) within 15 s of scaling down"; fi

# ---- 2. POST /api/levels/:id/slots -------------------------------------------------------------------------------
say "Run my code in the app: POST /api/levels/:id/slots"
CODE_ID=example-code-01-cache-aside
SLOT=cache.getPlayerStats
if [ "$(jcode /api/player '{"name":"E01"}')" = 201 ]; then pass "player created"; else fail "POST /api/player"; fi
# unlock: complete every level before CODE_ID in the engine's order (ENGINE_DEV=1)
for lid in $(curl -s "$BASE/api/chapters" | pick "j.chapters.flatMap(c => c.levels.map(l => l.id)).filter((id, i, a) => i < a.indexOf('$CODE_ID')).join(' ')"); do
  jcode "/api/levels/$lid/complete" '{}' >/dev/null
done
if [ "$(jcode "/api/levels/$CODE_ID/start" '{}')" = 200 ]; then pass "$CODE_ID started"; else fail "start $CODE_ID"; fi
lv="$(curl -s "$BASE/api/levels/$CODE_ID")"
if [ "$(printf '%s' "$lv" | pick "j.slots.own[0] === '$SLOT' && j.slots.active === false")" = true ]; then pass "GET /api/levels/:id: slots { own: [$SLOT], active: false }"; else fail "level slots before: $(printf '%s' "$lv" | pick 'j.slots')"; fi
if [ "$(jcode "/api/levels/$CODE_ID/slots" '{"active":"yes"}')" = 400 ]; then pass "a non-boolean body is 400"; else fail "slots with active:\"yes\" should be 400"; fi
if [ "$(jcode "/api/levels/scratch-e01-02-score-channel/slots" '{"active":true}')" = 409 ]; then pass "a locked level answers 409"; else fail "locked level slots should be 409"; fi
resp="$(curl -s -m 20 -w ' HTTP%{http_code}' -X POST -H 'content-type: application/json' -d '{"active":true}' "$BASE/api/levels/$CODE_ID/slots")"
case "$resp" in
  *HTTP200) pass "POST slots {active:true} -> 200: ${resp% HTTP200}" ;;
  *) fail "POST slots {active:true}: $resp" ;;
esac
if [ "$(curl -s "$BASE/api/slots" | pick "j.active.includes('$SLOT')")" = true ]; then pass "GET /api/slots lists $SLOT"; else fail "GET /api/slots: $(curl -s "$BASE/api/slots")"; fi
ok=0; i=0
while [ $i -lt 8 ]; do
  if [ "$(curl -s -m 2 "$BASE/app/health" | pick "j.activeSlots.includes('$SLOT')")" = true ]; then ok=1; break; fi
  sleep 0.5; i=$((i + 1))
done
if [ $ok = 1 ]; then pass "/app/health shows $SLOT active within 4 s"; else fail "/app/health did not show $SLOT within 4 s: $(curl -s "$BASE/app/health")"; fi
if [ "$(curl -s "$BASE/api/levels/$CODE_ID" | pick 'j.slots.active')" = true ]; then pass "GET /api/levels/:id slots.active is true"; else fail "slots.active should be true"; fi
if [ "$(jcode "/api/levels/$CODE_ID/slots" '{"active":false}')" = 200 ]; then pass "POST slots {active:false} -> 200"; else fail "POST slots {active:false}"; fi
if [ "$(curl -s "$BASE/api/slots" | pick "!j.active.includes('$SLOT')")" = true ]; then pass "GET /api/slots no longer lists $SLOT"; else fail "slot still listed: $(curl -s "$BASE/api/slots")"; fi
if [ "$(curl -s "$BASE/api/levels/$CODE_ID" | pick 'j.slots.active')" = false ]; then pass "GET /api/levels/:id slots.active is false"; else fail "slots.active should be false"; fi
ok=0; i=0
while [ $i -lt 8 ]; do
  if [ "$(curl -s -m 2 "$BASE/app/health" | pick "!j.activeSlots.includes('$SLOT')")" = true ]; then ok=1; break; fi
  sleep 0.5; i=$((i + 1))
done
if [ $ok = 1 ]; then pass "/app/health no longer shows $SLOT within 4 s"; else fail "/app/health still shows $SLOT"; fi

# ---- 3. grading harness: scratch chapter and regression --------------------------------------------------------
say "grade scratch-e01: fake instance for service_scaled, channel PUBLISH during verify, explicit match.message"
scripts/grade/grade.sh --engine "$BASE" --json "$CHECK_DIR/scratch.json" "$E01_LEVELS/scratch-e01" 2>&1 | tee "$CHECK_DIR/scratch.out" | grep -vE '^ *[0-9]+s +\.\.\.' | tail -40
rc=${PIPESTATUS[0]}
if [ "$rc" = 0 ]; then pass "scratch-e01: no MISMATCH"; else fail "scratch-e01: grade exit $rc"; fi
rowcheck() { # level-suffix solution-substring declared engine
  r="$(node -e "
const j = JSON.parse(require('fs').readFileSync('$CHECK_DIR/scratch.json', 'utf8'));
const r = j.rows.find((x) => x.level.endsWith('$1') && x.solution.includes('$2'));
console.log(r ? r.result + ' declared=' + r.declared + ' engine=' + r.engine : 'missing');
")"
  case "$r" in
    "PASS declared=$3 engine=$4") pass "$1 $2: $r" ;;
    *) fail "$1 $2: expected PASS declared=$3 engine=$4, got: $r" ;;
  esac
}
rowcheck 01-two-instances 01-reference right right
rowcheck 01-two-instances 01-wrong wrong wrong
rowcheck 02-score-channel 02-reference right right
rowcheck 02-score-channel 02-wrong-no-publish wrong wrong
rowcheck 03-explicit-message 03-reference right right
rowcheck 03-explicit-message 03-wrong-no-hash wrong wrong
if grep -q "engine emitted service_scaled instances 2" "$CHECK_DIR/scratch.out"; then pass "harness note: the real emitter fired for the fake instance (count 1 to 2 while the real app also pushes)"; else fail "no 'engine emitted service_scaled instances 2' note in the harness output"; fi
if grep -q "harness published .* on score:match:test3" "$CHECK_DIR/scratch.out"; then pass "harness note: it published during the channel check"; else fail "no 'harness published' note"; fi

say "grade the example levels (regression: no behaviour change for levels without the new event kinds)"
scripts/grade/grade.sh --engine "$BASE" --json "$CHECK_DIR/examples.json" "$E01_LEVELS/example-cli" "$E01_LEVELS/example-code" 2>&1 | tee "$CHECK_DIR/examples.out" | grep -E '^(PASS|MISMATCH|SKIPPED|totals|example-)' | tail -30
rc=${PIPESTATUS[0]}
if [ "$rc" = 0 ] && ! grep -q '^MISMATCH' "$CHECK_DIR/examples.out"; then pass "example-cli and example-code: no MISMATCH"; else fail "example levels: grade exit $rc"; fi

if [ $FAILED -eq 0 ]; then echo; echo "E-01 OK"; exit 0; fi
echo; echo "E-01 FAILED"; exit 1
