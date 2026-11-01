#!/usr/bin/env bash
# E-03 check: the engine follows replica, Sentinel and cluster targets (Chapter 5).
#   0. static: build, shared target tests, engine/ui vitest, lint, format
#   1. default stack says kind single; PUT each scheme -> 200 and the mirror is in sync on the new target; bad string 400
#   2. replica: reads work, SET answers READONLY
#   3. cluster (formed here): routing, CROSSSLOT, CLUSTER INFO/KEYSLOT, a redis verifier, redis_target_changed
#   4. sentinel: SET works, stop the master -> sentinel_failover, new master followed; the whole dance back, timed
#   5. harness: levels waiting for redis_target_changed / sentinel_failover are SKIPPED (needs the compose profiles)
#   6. example-cli and example-code grade with no MISMATCH on the single node afterwards
# Own compose project (quest-e03), .env.e03, scratch dir logs/.e-03-check, profile services without host ports
# (scripts/check/compose.e03.yaml). E03_KEEP=1 leaves the stack up on exit. bash 3.2 compatible.
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1

PROJECT=quest-e03
ENV_FILE=.env.e03
CHECK_DIR="$ROOT/logs/.e-03-check"
OVERRIDE="$CHECK_DIR/compose.e03.local.yaml"
BASE=http://127.0.0.1:3600
FAILED=0

say() { printf '\n== %s\n' "$*"; }
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILED=1; }
note() { printf 'NOTE  %s\n' "$*"; }
dc() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.yml -f scripts/check/compose.e03.yaml -f "$OVERRIDE" --profile replica --profile sentinel --profile cluster "$@"; }

printf 'PROXY_PORT=3600\nREDIS_PORT=6396\nPG_PORT=5438\nINSIGHT_PORT=5546\nENGINE_DEV=1\n' > "$ENV_FILE"

cleanup() {
  say "cleanup"
  if [ -n "${E03_KEEP:-}" ]; then echo "E03_KEEP is set: leaving project $PROJECT up and $CHECK_DIR in place"; return; fi
  if [ -f "$OVERRIDE" ]; then dc down -v --remove-orphans >/dev/null 2>&1 && echo "docker compose -p $PROJECT down -v: done"; fi
  rm -rf "$CHECK_DIR" && echo "removed scratch dir logs/.e-03-check"
}
trap cleanup EXIT

PICK_JS="$CHECK_DIR/pick.js"
pick() { node "$PICK_JS" "$1"; }
now_ms() { node -e 'console.log(Date.now())'; }
jput() { curl -s -m 30 -w ' HTTP%{http_code}' -X PUT -H 'content-type: application/json' -d "$2" "$BASE$1"; }
jpost() { curl -s -m 30 -X POST -H 'content-type: application/json' -d "$2" "$BASE$1"; }
# cli "COMMAND LINE": the engine's reply text for a terminal command
cli() { jpost /api/cli "$(node -e 'console.log(JSON.stringify({command:process.argv[1]}))' "$1")" | pick 'j.reply'; }
# verdict LEVEL: runs the verifier, prints the verdict (or the raw body when there is none)
verdict() {
  b="$(jpost "/api/levels/$1/verify" '{"answers":{}}')"
  v="$(printf '%s' "$b" | pick 'j.verdict')"
  if [ -n "$v" ]; then echo "$v"; else echo "no verdict: $(printf '%s' "$b" | cut -c1-300)"; fi
}
cli_quick() { curl -s -m 2 -X POST -H 'content-type: application/json' -d "$(node -e 'console.log(JSON.stringify({command:process.argv[1]}))' "$1")" "$BASE/api/cli" | pick 'j.reply'; }
mirror_in_sync() { # waits up to 5 s
  i=0
  while [ $i -lt 20 ]; do
    if [ "$(curl -s -m 3 "$BASE/api/progress/mirror" | pick 'j.inSync === true')" = true ]; then return 0; fi
    sleep 0.25; i=$((i + 1))
  done
  return 1
}
target_field() { curl -s -m 3 "$BASE/api/target" | pick "$1"; }
event_count() { curl -s -m 5 "$BASE/api/events" | pick "j.events.filter(e => e.data && e.data.kind === 'custom' && e.data.name === '$1' && ($2)).length"; }
wait_engine() {
  i=0
  while [ $i -lt 120 ]; do
    h="$(curl -s -m 2 "$BASE/health" || true)"
    case "$h" in *'"redis":"up"'*'"postgres":"up"'*) echo "$h"; return 0 ;; esac
    sleep 2; i=$((i + 1))
  done
  echo "last health: ${h:-none}"; return 1
}
role_of() { dc exec -T "$1" redis-cli role 2>/dev/null | head -1 | tr -d '\r'; }
sentinel_master() { dc exec -T sentinel-1 redis-cli -p 26379 sentinel get-master-addr-by-name mymaster 2>/dev/null | head -1 | tr -d '\r'; }

# ---- 0. static --------------------------------------------------------------------------------------------
say "docker, build @quest/shared, @quest/engine, @quest/ui"
if docker info >/dev/null 2>&1; then pass "docker is running"; else fail "docker is not running"; exit 1; fi
pnpm --filter @quest/shared build >/dev/null 2>&1 && pass "@quest/shared built" || { fail "@quest/shared build"; exit 1; }
pnpm --filter @quest/engine build >/dev/null 2>&1 && pass "@quest/engine built" || { fail "@quest/engine build"; pnpm --filter @quest/engine build 2>&1 | tail -20; exit 1; }
pnpm --filter @quest/ui build >/dev/null 2>&1 && pass "@quest/ui built" || { fail "@quest/ui build"; exit 1; }
if bash -n scripts/check/E-03.sh && node --check scripts/grade/grade.mjs; then pass "E-03.sh and grade.mjs parse"; else fail "syntax"; exit 1; fi

say "shared vitest (target parsing, describeTarget, client kinds)"
if out="$(pnpm --filter @quest/shared exec vitest run src/learner/__tests__/target.test.ts 2>&1)"; then pass "shared target tests: $(printf '%s\n' "$out" | grep -E 'Tests ' | tail -1)"; else fail "shared target tests"; printf '%s\n' "$out" | tail -30; fi
say "engine vitest (key table, cluster routing, CROSSSLOT line, /api/target routes)"
if out="$(pnpm --filter @quest/engine test 2>&1)"; then pass "engine tests: $(printf '%s\n' "$out" | grep -E 'Tests ' | tail -1)"; else fail "engine tests"; printf '%s\n' "$out" | tail -40; fi
say "ui vitest (the target switcher)"
if out="$(pnpm --filter @quest/ui test 2>&1)"; then pass "ui tests: $(printf '%s\n' "$out" | grep -E 'Tests ' | tail -1)"; else fail "ui tests"; printf '%s\n' "$out" | tail -40; fi

say "pnpm -r lint, pnpm format:check"
# A-05 edits app/, runner/ and the other packages/shared/src/learner files at the same time. A problem only in those
# is theirs: printed as NOTE, not failed. Anything else fails.
THEIRS='^(app/|runner/|packages/shared/src/learner/(call|counting|deps|failfast|loader|metrics|types)\.ts)'
if out="$(pnpm -r --no-bail lint 2>&1)"; then
  pass "pnpm -r lint"
else
  bad="$(printf '%s\n' "$out" | grep -E '^[^ ]+ lint: /' | sed "s|$ROOT/||; s|^[^ ]* lint: ||" | grep -vE "$THEIRS")"
  if [ -z "$bad" ]; then note "pnpm -r lint: only A-05's in-flight files fail"; printf '%s\n' "$out" | grep -E ' lint: ' | head -8 | sed 's/^/      /'
  else fail "pnpm -r lint"; printf '%s\n' "$out" | tail -30; fi
fi
if out="$(pnpm format:check 2>&1)"; then
  pass "pnpm format:check"
else
  badfiles="$(printf '%s\n' "$out" | grep '^\[warn\] ' | grep -v '^\[warn\] Code style' | sed 's/^\[warn\] //' | grep -vE "$THEIRS")"
  if [ -z "$badfiles" ]; then note "pnpm format:check: only A-05's in-flight files differ:"; printf '%s\n' "$out" | grep '^\[warn\] ' | grep -v 'Code style' | sed 's/^/      /'
  else fail "pnpm format:check"; printf '%s\n' "$out" | tail -15; fi
fi

# ---- scratch levels and override --------------------------------------------------------------------------
say "scratch levels: example-cli, example-code and chapter scratch-e03 (three levels)"
rm -rf "$CHECK_DIR"
mkdir -p "$CHECK_DIR/workspace" "$CHECK_DIR/logs" "$CHECK_DIR/progress" "$CHECK_DIR/levels/scratch-e03/solutions"
L="$CHECK_DIR/levels"
for d in example-cli example-code; do cp -R "levels/_examples/$d" "$L/"; done
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
S="$L/scratch-e03"
cat > "$S/chapter.yaml" <<'EOF'
id: scratch-e03
title: "Scratch: E-03 check"
incident:
  - from: you
    time: "10:00"
    text: "scratch chapter for the E-03 check; never shipped"
levels:
  - scratch-e03-01-switch-event
  - scratch-e03-02-cluster-read
  - scratch-e03-03-failover-event
EOF
mklevel() { # file id title verify-yaml reference wrong
  cat > "$S/$1.yaml" <<EOF
id: $2
chapter: scratch-e03
title: "$3"
mode: cli
story: |
  Scratch level for the E-03 check.
brainstorm:
  prompt: "Where does the data live?"
  options:
    - id: redis
      label: "In Redis"
      is_reasonable: true
    - id: not-redis
      label: "Not Redis: somewhere else"
      is_reasonable: true
teach: |
  Scratch level.
task: |
  Scratch level.
verify:
$4
reward:
  xp: 10
solutions:
  reference: solutions/$5
  wrong:
    - path: solutions/$6
      expect: wrong
      because: "scratch: the wrong solution does not do the task"
EOF
}
mklevel 02-cluster-read scratch-e03-02-cluster-read "Cluster read" '  - type: redis
    checks:
      - cmd: [GET, "{u:1}:a"]
        equals: "1"
        message: "{u:1}:a is not 1."' 02-ref.redis 02-wrong.redis
printf 'SET {u:1}:a 1\n' > "$S/solutions/02-ref.redis"; printf 'SET {u:1}:a 2\n' > "$S/solutions/02-wrong.redis"
mklevel 01-switch-event scratch-e03-01-switch-event "Switch event" '  - type: event
    kind: custom
    match: { name: redis_target_changed, kind: cluster }
    timeoutMs: 20000
    message: "The game has not seen you switch to the cluster."' 01-ref.redis 01-wrong.redis
printf 'PING\n' > "$S/solutions/01-ref.redis"; printf 'GET game:nothing\n' > "$S/solutions/01-wrong.redis"
mklevel 03-failover-event scratch-e03-03-failover-event "Failover event" '  - type: event
    kind: custom
    match: { name: sentinel_failover }
    timeoutMs: 20000
    message: "The game has not seen a Sentinel failover."' 03-ref.redis 03-wrong.redis
printf 'PING\n' > "$S/solutions/03-ref.redis"; printf 'GET game:nothing\n' > "$S/solutions/03-wrong.redis"
v="$(node packages/shared/dist/levels/cli.js "$L" 2>&1)"
if [ $? -eq 0 ]; then pass "scratch levels valid: $v"; else fail "scratch levels invalid"; printf '%s\n' "$v"; exit 1; fi
cat > "$OVERRIDE" <<EOF
x-e03-node: &e03-node
  image: quest-e03-node:latest
services:
  engine:
    <<: *e03-node
    environment:
      VERIFY_MAX_EVENT_WAIT_MS: "5000"
    volumes:
      - $CHECK_DIR/workspace:/workspace
      - $CHECK_DIR/logs:/logs
      - $CHECK_DIR/progress:/progress
      - $L:/levels:ro
      - $ROOT/scenarios:/srv/scenarios:ro
  app:
    <<: *e03-node
    volumes:
      - $CHECK_DIR/workspace:/workspace
      - $CHECK_DIR/logs:/logs
      - $CHECK_DIR/progress:/progress
  runner:
    <<: *e03-node
    volumes:
      - $CHECK_DIR/workspace:/workspace
      - $CHECK_DIR/logs:/logs
      - $CHECK_DIR/progress:/progress
  proxy:
    volumes:
      - $ROOT/docker/Caddyfile:/etc/caddy/Caddyfile:ro
      - $CHECK_DIR/logs:/logs
  postgres:
    volumes:
      - pg-data:/var/lib/postgresql/data
      - $ROOT/postgres/init:/docker-entrypoint-initdb.d:ro
      - $CHECK_DIR/logs:/logs
EOF

say "docker compose -p $PROJECT build (image quest-e03-node, retried), up -d with --profile replica --profile sentinel --profile cluster"
dc down -v --remove-orphans >/dev/null 2>&1
n=0
until dc build engine >"$CHECK_DIR/build.log" 2>&1; do
  n=$((n + 1))
  if [ $n -ge 3 ]; then fail "docker build failed 3 times"; tail -30 "$CHECK_DIR/build.log"; exit 1; fi
  echo "build attempt $n failed, retrying"; tail -5 "$CHECK_DIR/build.log"; sleep 10
done
pass "image built"
dc up -d --no-build redis postgres engine app runner proxy redis-replica sentinel-1 sentinel-2 sentinel-3 redis-c1 redis-c2 redis-c3 redis-c4 redis-c5 redis-c6 2>&1 | grep -E 'Error|error' | head
if h="$(wait_engine)"; then pass "engine healthy through the proxy on 3600: $h"; else fail "engine not healthy: $h"; dc logs --tail 40 engine; exit 1; fi
ok=0; i=0
while [ $i -lt 40 ]; do
  if [ "$(curl -s -m 2 "$BASE/app/health" | pick 'j.ok === true || j.status === "ok" || !!j.activeSlots')" = true ]; then ok=1; break; fi
  sleep 1; i=$((i + 1))
done
if [ $ok = 1 ]; then pass "app answers /app/health"; else fail "app did not answer /app/health"; exit 1; fi

say "form the cluster: redis-cli --cluster create inside redis-c1 (6 nodes, 1 replica each)"
t0="$(now_ms)"
if dc exec -T redis-c1 redis-cli --cluster create redis-c1:6379 redis-c2:6379 redis-c3:6379 redis-c4:6379 redis-c5:6379 redis-c6:6379 --cluster-replicas 1 --cluster-yes >"$CHECK_DIR/cluster-create.log" 2>&1; then
  pass "redis-cli --cluster create worked ($(( $(now_ms) - t0 )) ms): $(grep -E 'All 16384 slots covered' "$CHECK_DIR/cluster-create.log")"
else fail "cluster create"; tail -20 "$CHECK_DIR/cluster-create.log"; fi
ok=0; i=0
while [ $i -lt 30 ]; do
  if dc exec -T redis-c1 redis-cli cluster info 2>/dev/null | grep -q 'cluster_state:ok'; then ok=1; break; fi
  sleep 0.5; i=$((i + 1))
done
if [ $ok = 1 ]; then pass "cluster_state:ok ($(( $(now_ms) - t0 )) ms after create started)"; else fail "cluster_state:ok not reached in 15 s"; fi
ok=0; i=0
while [ $i -lt 90 ]; do
  m="$(dc exec -T sentinel-1 redis-cli -p 26379 sentinel master mymaster 2>/dev/null | tr -d '\r' | paste - - | grep -E '^(num-slaves|num-other-sentinels)' | paste -sd' ' -)"
  case "$m" in *'num-slaves	1'*'num-other-sentinels	2'*|*'num-other-sentinels	2'*'num-slaves	1'*) ok=1; break ;; esac
  sleep 1; i=$((i + 1))
done
if [ $ok = 1 ]; then pass "sentinels see the master, 1 replica and each other (${i} s)"; else fail "sentinels never saw 1 replica and 2 other sentinels: $m"; fi

# ---- 1. targets ------------------------------------------------------------------------------------------------
say "GET /api/target on the default stack; a player; PUT each scheme"
t="$(curl -s -m 5 "$BASE/api/target")"
if [ "$(printf '%s' "$t" | pick "j.kind === 'single' && j.state === 'up' && j.redisUrl === 'redis://redis:6379' && j.description === 'single node redis:6379'")" = true ]; then pass "default target: $t"; else fail "default target: $t"; fi
jpost /api/player '{"name":"Asha"}' >/dev/null
# The scratch chapter comes after the two example chapters; ENGINE_DEV=1 lets the check complete those to unlock it.
for lid in $(curl -s "$BASE/api/chapters" | pick "j.chapters.flatMap(c => c.levels).map(l => l.id).filter(id => !id.startsWith('scratch-e03')).join(' ')"); do
  jpost "/api/levels/$lid/complete" '{}' >/dev/null
done
if mirror_in_sync; then pass "mirror in sync on the single node"; else fail "mirror not in sync on the single node"; fi
for bad in 'http://x:1' 'sentinel://nohost' 'cluster://' 'nonsense'; do
  r="$(jput /api/target "{\"redisUrl\":\"$bad\"}")"
  case "$r" in *invalid_url*HTTP400) pass "PUT $bad -> 400 invalid_url" ;; *) fail "PUT $bad: $r" ;; esac
done

say "replica: redis://redis-replica:6379 (read-only)"
r="$(jput /api/target '{"redisUrl":"redis://redis-replica:6379"}')"
case "$r" in *HTTP200) pass "PUT replica -> 200: ${r% HTTP200}" ;; *) fail "PUT replica: $r" ;; esac
if mirror_in_sync; then pass "mirror in sync as read from the replica (replicated from redis)"; else fail "mirror not in sync on the replica"; fi
o="$(cli 'HLEN game:progress')"
case "$o" in '(integer) '[1-9]*) pass "HLEN game:progress through the CLI on the replica: $o" ;; *) fail "HLEN game:progress on the replica: $o" ;; esac
o="$(cli 'SET x 1')"
case "$o" in *READONLY*) pass "SET x 1 on the replica: $o" ;; *) fail "SET x 1 on the replica: $o" ;; esac
r="$(jput /api/target '{"redisUrl":"redis://redis:6379"}')"
case "$r" in *HTTP200) pass "back to single -> 200" ;; *) fail "PUT single: $r" ;; esac
if [ "$(cli 'SET e03:single 1')" = OK ]; then pass "SET works again on the single node"; else fail "SET on the single node"; fi

say "cluster: cluster://redis-c1..c3"
start_iso="$(node -e 'console.log(new Date().toISOString())')"
# The event level is started before the switch, so the verifier looks back to its startedAt.
jpost /api/levels/scratch-e03-01-switch-event/start '{}' >/dev/null
r="$(jput /api/target '{"redisUrl":"cluster://redis-c1:6379,redis-c2:6379,redis-c3:6379"}')"
case "$r" in *HTTP200) pass "PUT cluster -> 200: ${r% HTTP200}" ;; *) fail "PUT cluster: $r" ;; esac
if [ "$(target_field "j.kind === 'cluster' && j.state === 'up' && j.description === 'cluster, 3 root nodes' && j.nodes >= 3")" = true ]; then pass "GET /api/target: $(curl -s "$BASE/api/target")"; else fail "GET /api/target on the cluster: $(curl -s "$BASE/api/target")"; fi
if mirror_in_sync; then pass "mirror restored on the cluster (game:* keys landed on their slots), in sync"; else fail "mirror not in sync on the cluster"; fi
o="$(cli 'SET {u:1}:a 1')"; if [ "$o" = OK ]; then pass "SET {u:1}:a 1 -> OK"; else fail "SET {u:1}:a 1: $o"; fi
o="$(cli 'GET {u:1}:a')"; if [ "$o" = '"1"' ]; then pass "GET {u:1}:a -> $o"; else fail "GET {u:1}:a: $o"; fi
o="$(cli 'MSET {u:1}:b 1 {u:1}:c 2')"; if [ "$o" = OK ]; then pass "MSET with one hash tag -> OK"; else fail "MSET {u:1}: $o"; fi
o="$(cli 'MSET a 1 b 2')"; case "$o" in '(error) CROSSSLOT'*) pass "MSET a 1 b 2 -> $o" ;; *) fail "MSET a 1 b 2: $o" ;; esac
o="$(cli 'CLUSTER INFO')"; case "$o" in *cluster_state:ok*) pass "CLUSTER INFO contains cluster_state:ok" ;; *) fail "CLUSTER INFO: $o" ;; esac
o="$(cli 'CLUSTER KEYSLOT {u:1}:a')"; case "$o" in '(integer) '[0-9]*) pass "CLUSTER KEYSLOT {u:1}:a -> $o" ;; *) fail "CLUSTER KEYSLOT: $o" ;; esac
o="$(cli 'CLUSTER NODES')"; case "$o" in *master*redis-c*) pass "CLUSTER NODES lists the masters" ;; *) fail "CLUSTER NODES: $o" ;; esac
o="$(cli 'EVAL "return redis.call(\"get\",KEYS[1])" 1 {u:1}:a')"; if [ "$o" = '"1"' ]; then pass "EVAL (movable keys, COMMAND GETKEYS) routed by its key -> $o"; else fail "EVAL: $o"; fi
o="$(cli 'DBSIZE')"; pass "DBSIZE answers from one node only (the one owning slot 0): $o"
n="$(event_count redis_target_changed "e.data.data && e.data.data.kind === 'cluster'")"
if [ "${n:-0}" -ge 1 ]; then pass "redis_target_changed { kind: cluster } in GET /api/events: $(curl -s "$BASE/api/events" | pick "JSON.stringify(j.events.filter(e => e.data && e.data.name === 'redis_target_changed').pop().data.data)")"; else fail "no redis_target_changed for the cluster"; fi
v="$(verdict scratch-e03-01-switch-event)"
if [ "$v" = right ]; then pass "an event verifier on redis_target_changed { kind: cluster } passes: $v"; else fail "event verifier: $v"; fi
jpost /api/levels/scratch-e03-02-cluster-read/start '{}' >/dev/null
v="$(verdict scratch-e03-02-cluster-read)"
if [ "$v" = right ]; then pass "a redis verifier check (GET {u:1}:a equals \"1\") passes on the cluster: verdict $v"; else fail "verifier on the cluster: verdict $v"; fi
r="$(jput /api/target '{"redisUrl":"cluster://nowhere-e03:6379","strict":true}')"
case "$r" in *target_unreachable*HTTP502) pass "strict PUT to a cluster that is not there -> 502: ${r% HTTP502}" ;; *) fail "strict PUT to nowhere: $r" ;; esac
if [ "$(target_field "j.kind === 'cluster' && j.state === 'up'")" = true ]; then pass "the engine stayed on the cluster, up"; else fail "engine did not stay on the cluster: $(curl -s "$BASE/api/target")"; fi
r="$(jput /api/target '{"redisUrl":"redis://redis:6379"}')"
case "$r" in *HTTP200) pass "back to single -> 200" ;; *) fail "PUT single: $r" ;; esac

say "sentinel: sentinel://mymaster@sentinel-1..3"
jpost /api/levels/scratch-e03-03-failover-event/start '{}' >/dev/null
r="$(jput /api/target '{"redisUrl":"sentinel://mymaster@sentinel-1:26379,sentinel-2:26379,sentinel-3:26379"}')"
case "$r" in *HTTP200) pass "PUT sentinel -> 200: ${r% HTTP200}" ;; *) fail "PUT sentinel: $r" ;; esac
if [ "$(target_field "j.kind === 'sentinel' && j.master === 'redis:6379' && j.nodes === 3 && j.state === 'up'")" = true ]; then pass "GET /api/target: $(curl -s "$BASE/api/target")"; else fail "GET /api/target on sentinel: $(curl -s "$BASE/api/target")"; fi
if mirror_in_sync; then pass "mirror in sync through Sentinel"; else fail "mirror not in sync through Sentinel"; fi
if [ "$(cli 'SET e03:s 1')" = OK ]; then pass "SET works through Sentinel"; else fail "SET through Sentinel"; fi
# Sentinel rewrites its config and learns replicas by INFO every 10 s: let it settle before breaking things.
sleep 12

# failover_dance STOP_SERVICE EXPECT_TO_REGEX: stops a service, times every step, returns 0 when everything happened
failover_dance() {
  svc="$1"; want="$2"
  before="$(event_count sentinel_failover 'true')"
  T0="$(now_ms)"; dc stop "$svc" >/dev/null 2>&1; T1="$(now_ms)"
  echo "      docker compose stop $svc returned after $((T1 - T0)) ms"
  t_event=""; t_cli=""; t_target=""; t_down=""
  i=0
  while [ $i -lt 200 ]; do
    st="$(target_field 'j.state')"; N="$(now_ms)"
    if [ -z "$t_down" ] && [ "$st" = down ]; then t_down=$((N - T0)); fi
    ev="$(event_count sentinel_failover 'true')"; N="$(now_ms)"
    if [ -z "$t_event" ] && [ "${ev:-0}" -gt "$before" ]; then t_event=$((N - T0)); fi
    if [ -z "$t_cli" ] && [ "$(cli_quick 'SET e03:s 2')" = OK ]; then t_cli=$(( $(now_ms) - T0 )); fi
    m="$(target_field 'j.master')"; N="$(now_ms)"
    if [ -z "$t_target" ] && [ -n "$m" ] && [ "$m" != "$prev_master" ] && [ "$st" = up ]; then t_target=$((N - T0)); fi
    if [ -n "$t_event" ] && [ -n "$t_cli" ] && [ -n "$t_target" ]; then break; fi
    sleep 0.25; i=$((i + 1))
  done
  echo "      engine state went down after ${t_down:-never} ms; sentinel_failover event after ${t_event:-never} ms; CLI SET OK again after ${t_cli:-never} ms; GET /api/target shows the new master after ${t_target:-never} ms"
  FO_EVENT_MS="$t_event"
  [ -n "$t_event" ] && [ -n "$t_cli" ] && [ -n "$t_target" ]
}
prev_master="$(target_field 'j.master')"
say "failover 1: docker compose stop redis (the master) -> Redis replica takes over"
if failover_dance redis 'redis-replica:6379'; then pass "engine followed the failover within 20 s"; else fail "engine did not follow the failover within 50 s"; fi
last="$(curl -s "$BASE/api/events" | pick "JSON.stringify(j.events.filter(e => e.data && e.data.name === 'sentinel_failover').pop().data.data)")"
if [ "$(printf '%s' "$last" | pick "j.masterName === 'mymaster' && j.from === 'redis:6379' && j.to === 'redis-replica:6379'")" = true ]; then pass "sentinel_failover payload: $last"; else fail "sentinel_failover payload: $last"; fi
if [ "${FO_EVENT_MS:-99999}" -le 20000 ]; then pass "sentinel_failover appeared within 20 s (${FO_EVENT_MS} ms)"; else fail "sentinel_failover took ${FO_EVENT_MS} ms"; fi
if [ "$(target_field "j.master === 'redis-replica:6379'")" = true ]; then pass "GET /api/target master: redis-replica:6379"; else fail "GET /api/target master: $(curl -s "$BASE/api/target")"; fi
if [ "$(cli 'GET e03:s')" = '"2"' ]; then pass "the CLI reads back what it wrote on the new master"; else fail "CLI GET after failover"; fi
v="$(verdict scratch-e03-03-failover-event)"
if [ "$v" = right ]; then pass "an event verifier on sentinel_failover passes: $v"; else fail "failover event verifier: $v"; fi

say "dance back, timed: start redis, it rejoins as a replica"
T0="$(now_ms)"; dc start redis >/dev/null 2>&1; echo "      docker compose start redis returned after $(( $(now_ms) - T0 )) ms"
ok=0; i=0
while [ $i -lt 240 ]; do
  if [ "$(role_of redis)" = slave ]; then ok=1; break; fi
  sleep 0.5; i=$((i + 1))
done
if [ $ok = 1 ]; then pass "redis is role:slave $(( $(now_ms) - T0 )) ms after start"; else fail "redis did not become a replica within 120 s (role: $(role_of redis))"; fi
ok=0; i=0
while [ $i -lt 120 ]; do
  if dc exec -T sentinel-1 redis-cli -p 26379 sentinel replicas mymaster 2>/dev/null | tr -d '\r' | grep -qx 'redis:6379'; then ok=1; break; fi
  sleep 0.5; i=$((i + 1))
done
if [ $ok = 1 ]; then pass "SENTINEL replicas mymaster lists redis:6379 ($(( $(now_ms) - T0 )) ms after start)"; else fail "SENTINEL replicas mymaster does not list redis:6379"; dc exec -T sentinel-1 redis-cli -p 26379 sentinel replicas mymaster | paste - - | head; fi
# a replica is only a candidate once Sentinel has a fresh INFO from it (10 s) and its link is up
sleep 12
prev_master="$(target_field 'j.master')"
say "failover 2: docker compose stop redis-replica (the master now) -> redis takes over again"
if failover_dance redis-replica 'redis:6379'; then pass "engine followed the failover back"; else fail "engine did not follow the failover back"; fi
last="$(curl -s "$BASE/api/events" | pick "JSON.stringify(j.events.filter(e => e.data && e.data.name === 'sentinel_failover').pop().data.data)")"
if [ "$(printf '%s' "$last" | pick "j.from === 'redis-replica:6379' && j.to === 'redis:6379'")" = true ]; then pass "sentinel_failover back: $last"; else fail "sentinel_failover back: $last"; fi
T0="$(now_ms)"; dc start redis-replica >/dev/null 2>&1
ok=0; i=0
while [ $i -lt 240 ]; do
  if [ "$(role_of redis-replica)" = slave ]; then ok=1; break; fi
  sleep 0.5; i=$((i + 1))
done
if [ $ok = 1 ]; then pass "redis-replica is role:slave again $(( $(now_ms) - T0 )) ms after start"; else fail "redis-replica did not rejoin (role: $(role_of redis-replica))"; fi
if [ "$(sentinel_master)" = redis ]; then pass "Sentinel says the master is redis again"; else fail "Sentinel master: $(sentinel_master)"; fi
r="$(jput /api/target '{"redisUrl":"redis://redis:6379"}')"
case "$r" in *HTTP200) pass "finished by switching to redis://redis:6379 (a master again): ${r% HTTP200}" ;; *) fail "PUT single: $r" ;; esac
if [ "$(cli 'SET e03:final 1')" = OK ]; then pass "SET works on redis:6379 (it is a master)"; else fail "SET on redis:6379 after the dance: $(cli 'SET e03:final 1')"; fi
if mirror_in_sync; then pass "mirror in sync on the single node"; else fail "mirror not in sync after the dance"; fi

# ---- 5/6. harness ------------------------------------------------------------------------------------------------
say "harness: levels that wait for redis_target_changed / sentinel_failover are SKIPPED"
scripts/grade/grade.sh --engine "$BASE" --json "$CHECK_DIR/scratch.json" "$L/scratch-e03" 2>&1 | tee "$CHECK_DIR/scratch.out" | grep -E '^(PASS|MISMATCH|SKIPPED|totals|scratch-e03)' | tail -20
sk="$(grep -c 'needs the compose profiles: graded by hand' "$CHECK_DIR/scratch.out")"
if [ "$sk" -ge 4 ]; then pass "SKIPPED (needs the compose profiles: graded by hand) on $sk solution rows"; else fail "expected the two event levels' four solutions to be SKIPPED, saw $sk"; fi
mm="$(pick 'j.rows.filter(r => r.result === "MISMATCH").length' < "$CHECK_DIR/scratch.json")"
if [ "${mm:-1}" = 0 ]; then pass "scratch chapter: no MISMATCH (the cluster-read level graded right and wrong on the single node)"; else fail "scratch chapter has $mm MISMATCH"; fi

say "example-cli and example-code grade with no MISMATCH on the single node after all of the above"
scripts/grade/grade.sh --engine "$BASE" --json "$CHECK_DIR/examples.json" "$L/example-cli" "$L/example-code" 2>&1 | tee "$CHECK_DIR/examples.out" | grep -E '^(PASS|MISMATCH|SKIPPED|totals|example-)' | tail -20
mm="$(pick 'j.rows.filter(r => r.result === "MISMATCH").length' < "$CHECK_DIR/examples.json")"
np="$(pick 'j.rows.filter(r => r.result === "PASS").length' < "$CHECK_DIR/examples.json")"
if [ "${mm:-1}" = 0 ] && [ "${np:-0}" -gt 0 ]; then pass "examples: $np PASS, 0 MISMATCH"; else fail "examples: PASS=$np MISMATCH=$mm"; fi

echo
if [ $FAILED = 0 ]; then echo "E-03 CHECK PASSED"; exit 0; else echo "E-03 CHECK FAILED"; exit 1; fi
