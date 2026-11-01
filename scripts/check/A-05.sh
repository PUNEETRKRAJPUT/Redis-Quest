#!/usr/bin/env bash
# A-05 acceptance: the app and the runner follow replica, Sentinel and cluster targets, and deps.redisCached (RESP 3
# client-side cache) behaves as documented. The target is moved with the engine's PUT /api/target (E-03's route when
# it accepts sentinel:// and cluster://; otherwise a small stand-in engine that serves the same /internal/app-config
# contract, and the check says so). Own compose project quest-a05 with .env.a05 (PROXY 3950, REDIS 6387, PG 5442,
# INSIGHT 5550) and scripts/check/compose.a05.yaml (removes the profile services' published host ports); never the
# default project and never another quest-* project. Ends with `docker compose -p quest-a05 down -v`. Bash 3.2.
# A05_KEEP=1 skips the teardown (debugging only).
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

PROJECT=quest-a05
ENVF=.env.a05
FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
note() { printf 'NOTE  %s\n' "$1"; }
info() { printf '      %s\n' "$1"; }
section() { printf '\n== %s\n' "$1"; }

if [ ! -f "$ENVF" ]; then
  printf '# A-05 check only (gitignored): isolated compose project quest-a05 on its own host ports.\nPROXY_PORT=3950\nREDIS_PORT=6387\nPG_PORT=5442\nINSIGHT_PORT=5550\n' > "$ENVF"
fi
PROXY_PORT=$(sed -n 's/^PROXY_PORT=//p' "$ENVF")
REDIS_PORT=$(sed -n 's/^REDIS_PORT=//p' "$ENVF")
PG_PORT=$(sed -n 's/^PG_PORT=//p' "$ENVF")
BASE="http://127.0.0.1:${PROXY_PORT:-3950}"

SCRATCH="$ROOT/logs/.a-05-check"
rm -rf "$SCRATCH"
mkdir -p "$SCRATCH/levels" "$SCRATCH/progress" logs workspace
cp -R levels/_examples/example-cli "$SCRATCH/levels/example-cli"
export QUEST_LEVELS_DIR="$SCRATCH/levels"
export QUEST_PROGRESS_DIR="$SCRATCH/progress"
DC() { docker compose -p "$PROJECT" --env-file "$ENVF" -f "$ROOT/docker-compose.yml" -f "$ROOT/scripts/check/compose.a05.yaml" --profile replica --profile sentinel --profile cluster "$@"; }

URL_SINGLE="redis://redis:6379"
URL_REPLICA="redis://redis-replica:6379"
URL_SENTINEL="sentinel://mymaster@sentinel-1:26379,sentinel-2:26379,sentinel-3:26379"
URL_CLUSTER="cluster://redis-c1:6379,redis-c2:6379,redis-c3:6379"

# Learner files this check installs under workspace/ (slot file names from app/src/slots/registry.ts, plus a05-check/).
# Never overwrite a real one.
SLOT_FILES="ch2/cache.js ch2/invalidate.js ch2/prefetch-apply.js ch3/leaderboard.js ch3/leaderboard-add.js ch3/leaderboard-rank.js ch3/contest-join.js ch3/ticker-publish.js"
MADE_DIRS=""
for d in ch2 ch3 a05-check; do [ -d "$ROOT/workspace/$d" ] || MADE_DIRS="$MADE_DIRS $d"; done
for f in $SLOT_FILES; do
  if [ -e "$ROOT/workspace/$f" ]; then
    echo "workspace/$f already exists (a learner file?); refusing to overwrite it. Move it away and re-run."
    exit 1
  fi
done
if [ -e "$ROOT/workspace/a05-check" ] && [ -n "$(ls -A "$ROOT/workspace/a05-check" 2>/dev/null)" ]; then
  echo "workspace/a05-check is not empty; refusing to reuse it."; exit 1
fi
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/a05.XXXXXX")

finish() {
  section "cleanup"
  if [ -n "${A05_KEEP:-}" ]; then
    echo "A05_KEEP set: leaving project $PROJECT running"
  else
    DC down -v --remove-orphans >/dev/null 2>&1 && echo "docker compose -p $PROJECT down -v: done"
  fi
  for f in $SLOT_FILES; do rm -f "$ROOT/workspace/$f"; done
  rm -rf "$ROOT/workspace/a05-check"
  for d in $MADE_DIRS; do rmdir "$ROOT/workspace/$d" 2>/dev/null; done
  echo "removed the learner files this check installed"
  rm -rf "$SCRATCH" "$TMPD"
  if [ "$FAILED" -eq 0 ]; then printf '\nA-05 OK\n'; exit 0; fi
  printf '\nA-05 FAILED\n'; exit 1
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
RC() { local node=$1; shift; DC exec -T "$node" redis-cli "$@" 2>&1 | tr -d '\r'; }       # redis-cli on one node
RCC() { local node=$1; shift; DC exec -T "$node" redis-cli -c "$@" 2>&1 | tr -d '\r'; }    # ... following MOVED redirects
SENT() { DC exec -T sentinel-1 redis-cli -p 26379 "$@" 2>&1 | tr -d '\r'; }
install_file() { # install_file SRC DEST_REL : copy under workspace/ with a fresh mtime (the app stats the file)
  mkdir -p "$ROOT/workspace/$(dirname "$2")"
  cp "$1" "$ROOT/workspace/$2" && touch "$ROOT/workspace/$2"
}
runner_run() { # runner_run JSON : print the runner's reply as one JSON line with the HTTP status added
  DC exec -T -e "RUN_BODY=$1" runner node -e '
(async () => {
  const r = await fetch("http://127.0.0.1:4100/run", { method: "POST", headers: { "content-type": "application/json" }, body: process.env.RUN_BODY });
  console.log(JSON.stringify({ status: r.status, ...(await r.json()) }));
})().catch((e) => console.log(JSON.stringify({ status: 0, error: String(e) })));
' 2>&1 | tail -1
}
slot_loaded() { req GET /app/slots; [ "$(js "$BODY" "j.slots.find(s=>s.name===\"$1\").state")" = "loaded" ]; }
set_slots() { req PUT /api/slots "$1"; [ "$STATUS" = "200" ]; }
activate() { # activate "slot.a slot.b ..." : PUT /api/slots, then wait for each slot to load in the app
  local list="" s
  for s in $1; do list="$list\"$s\","; done
  set_slots "{\"active\":[${list%,}]}" || { bad "PUT /api/slots [$1]"; return 1; }
  for s in $1; do wait_until slot 25 slot_loaded "$s" || { bad "slot $s never loaded: $BODY"; return 1; }; done
  ok "active and loaded: $1"
}
post_json() { # post_json PATH JSON : print only the HTTP status
  curl -s -m 60 -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data "$2" "$BASE$1"
}

# ---- the learner files the check writes -------------------------------------------------------------------------
mkdir -p "$ROOT/workspace/a05-check"
cat > "$ROOT/workspace/a05-check/setget.js" <<'EOF'
// A-05 check: SET then GET one key on the {a} hash tag, whatever target the deps point at.
export default async function ({ redis }) {
  const set = await redis.set('{a}:1', 'v1');
  const got = await redis.get('{a}:1');
  return { set, got };
}
EOF
cat > "$ROOT/workspace/a05-check/get.js" <<'EOF'
export default async function ({ redis }) {
  return { got: await redis.get('{a}:1') };
}
EOF
cat > "$ROOT/workspace/a05-check/mset-cross.js" <<'EOF'
// Two keys in two slots in one command.
export default async function ({ redis }) {
  return redis.mSet({ a: '1', b: '2' });
}
EOF
cat > "$ROOT/workspace/a05-check/mget-cross.js" <<'EOF'
export default async function ({ redis }) {
  return redis.mGet(['a', 'b']);
}
EOF
cat > "$ROOT/workspace/a05-check/watch-dup.js" <<'EOF'
// The Chapter 3 reference's first move: a duplicate connection, then WATCH on it.
export default async function ({ redis }) {
  const conn = redis.duplicate();
  await conn.connect();
  try {
    await conn.watch('{a}:1');
    return 'watch ok';
  } finally {
    await conn.close().catch(() => undefined);
  }
}
EOF
cat > "$ROOT/workspace/a05-check/cached.js" <<'EOF'
// redisCached: read the same hash twice, write it from ANOTHER connection, read it a third time.
export default async function ({ redis, redisCached }, key) {
  await redis.hSet(key, { runs: '10' });
  const r1 = await redisCached.hGetAll(key);
  const r2 = await redisCached.hGetAll(key);
  const other = redis.duplicate();
  await other.connect();
  await other.hSet(key, { runs: '11' });
  await other.close();
  await new Promise((r) => setTimeout(r, 200));
  const r3 = await redisCached.hGetAll(key);
  return { r1, r2, r3 };
}
EOF
# Slot files. cache.getPlayerStats reads through redisCached; cache.invalidatePlayerStats is the SET/GET probe.
cat > "$TMPD/slot-cache.js" <<'EOF'
export default async function ({ redisCached }, playerId) {
  return redisCached.hGetAll(`cache:a05:player:${playerId}`);
}
EOF
cat > "$TMPD/slot-setget.js" <<'EOF'
export default async function ({ redis }) {
  const set = await redis.set('{a}:1', 'v1');
  const got = await redis.get('{a}:1');
  return { set, got };
}
EOF
cat > "$TMPD/join-multi.js" <<'EOF'
// The single-node join without WATCH: one MULTI over wallet:<u> and contest:<id>:entries (two different slots).
export default async function join({ redis }, userId, contestId, fee) {
  const wallet = `wallet:${userId}`;
  const balance = Number(await redis.get(wallet));
  if (!(balance >= fee)) return false;
  await redis.multi().decrBy(wallet, fee).incr(`contest:${contestId}:entries`).exec();
  return true;
}
EOF

# Sums of one INFO commandstats counter across the nodes that could serve the read.
calls_sum() { # calls_sum CMD NODE... : total cmdstat_<cmd> calls over the nodes
  local cmd=$1 total=0 n v; shift
  for n in "$@"; do
    v=$(RC "$n" INFO commandstats | sed -n "s/^cmdstat_${cmd}:calls=\([0-9]*\).*/\1/p" | head -1)
    total=$((total + ${v:-0}))
  done
  echo "$total"
}

section "docker"
docker info >/dev/null 2>&1 && ok "docker is running" || die "docker is not running"

section "install, build (retried: other agents may be mid-edit)"
pnpm install --frozen-lockfile >/dev/null 2>&1 && ok "pnpm install --frozen-lockfile" || die "pnpm install --frozen-lockfile"
built=""
for attempt in 1 2 3; do
  if pnpm -r build >"$TMPD/build.log" 2>&1; then built=1; echo "pnpm -r build: ok"; break; fi
  echo "pnpm -r build attempt $attempt failed:"; grep -E 'error|ERR' "$TMPD/build.log" | head -5
  if pnpm --filter @quest/shared --filter @quest/app --filter @quest/runner build >"$TMPD/build2.log" 2>&1; then built=1; echo "built @quest/shared, @quest/app and @quest/runner only (the full build is blocked by files this task does not own)"; break; fi
  sleep 20
done
[ -n "$built" ] && ok "build" || die "build"
info "node-redis: $(node -p "require('./packages/shared/node_modules/redis/package.json').version"), node $(node -v)"
for p in shared app runner; do
  pnpm --filter "@quest/$p" lint >"$TMPD/lint-$p.log" 2>&1 && ok "$p lint" || { tail -20 "$TMPD/lint-$p.log"; bad "$p lint"; }
done

section "docker compose -p $PROJECT up -d (redis postgres replica sentinels cluster nodes)"
DC up -d redis postgres redis-replica sentinel-1 sentinel-2 sentinel-3 redis-c1 redis-c2 redis-c3 redis-c4 redis-c5 redis-c6 >"$TMPD/up0.log" 2>&1 && ok "infrastructure containers started" || { tail -8 "$TMPD/up0.log"; die "compose up infrastructure"; }
pg_seeded() { [ "$(PSQL "SELECT count(*) FROM matches" 2>/dev/null)" = "60" ]; }
wait_until seed 240 pg_seeded && ok "postgres seeded (60 matches)" || die "postgres never finished loading the seed"
node_up() { [ "$(RC "$1" PING)" = "PONG" ]; }
for n in redis redis-replica redis-c1 redis-c2 redis-c3 redis-c4 redis-c5 redis-c6; do
  wait_until "$n" 30 node_up "$n" || die "$n does not answer PING"
done
ok "redis, redis-replica and the six cluster nodes answer PING"
CLUSTER_OUT=$(DC exec -T redis-c1 redis-cli --cluster create redis-c1:6379 redis-c2:6379 redis-c3:6379 redis-c4:6379 redis-c5:6379 redis-c6:6379 --cluster-replicas 1 --cluster-yes 2>&1 | tr -d '\r')
cluster_ok() { [ "$(RC redis-c1 CLUSTER INFO | sed -n 's/^cluster_state://p')" = "ok" ] && [ "$(RC redis-c6 CLUSTER INFO | sed -n 's/^cluster_state://p')" = "ok" ]; }
if wait_until cluster 15 cluster_ok; then ok "cluster formed by 'redis-cli --cluster create ... --cluster-replicas 1 --cluster-yes': cluster_state:ok (all 16384 slots covered)"; else printf '%s\n' "$CLUSTER_OUT" | tail -8; die "cluster_state is not ok within 15 s"; fi
sleep 2
CLUSTER_NODES=$(RC redis-c1 CLUSTER NODES)
info "masters: $(printf '%s\n' "$CLUSTER_NODES" | awk '$3 ~ /master/ { split($2, a, ","); printf "%s(%s) ", a[2], $9 }')"
SENT_MASTER=$(SENT SENTINEL get-master-addr-by-name mymaster | tr '\n' ':' | sed 's/:$//')
[ "$SENT_MASTER" = "redis:6379" ] && ok "sentinel master mymaster is redis:6379, replicas: $(SENT SENTINEL replicas mymaster | grep -A1 '^name$' | grep -v -e '^name$' -e '^--$' | tr '\n' ' ')" || bad "sentinel master is $SENT_MASTER"

section "quality gates: format, shared learner tests, app vitest, runner vitest (own redis and postgres: ports $REDIS_PORT / $PG_PORT)"
pnpm exec prettier --check app runner packages/shared/src/learner/deps.ts packages/shared/src/learner/counting.ts packages/shared/src/learner/failfast.ts packages/shared/src/learner/types.ts packages/shared/src/learner/index.ts packages/shared/src/learner/__tests__/kinds.test.ts engine/src/verify/slots.ts >"$TMPD/fmt-own.log" 2>&1 && ok "prettier --check on every file A-05 owns" || { head -20 "$TMPD/fmt-own.log"; bad "prettier --check on own files"; }
if pnpm format:check >"$TMPD/fmt.log" 2>&1; then
  ok "pnpm format:check (whole repo)"
else
  OFFENDERS=$(grep -E '^\[warn\] [^ ]+$' "$TMPD/fmt.log" | sed 's/^\[warn\] //')
  THEIRS=""; OURS=""
  for f in $OFFENDERS; do
    case "$f" in
      engine/src/verify/slots.ts) OURS="$OURS $f";;
      engine/*|ui/*|scripts/grade/*|scripts/check/E-03.sh|packages/shared/src/learner/target.ts|packages/shared/src/learner/__tests__/target.test.ts|levels/*) THEIRS="$THEIRS $f";;
      *) OURS="$OURS $f";;
    esac
  done
  if [ -z "$OURS" ]; then
    ok "pnpm format:check: the only unformatted files are E-03's in-flight files:$THEIRS"
  else
    bad "pnpm format:check fails on files that are not E-03's:$OURS"
  fi
fi
if pnpm --filter @quest/shared exec vitest run src/learner/__tests__/kinds.test.ts >"$TMPD/shared-test.log" 2>&1; then
  ok "shared learner kinds test: $(grep -E '^ +Tests ' "$TMPD/shared-test.log" | sed 's/^ *//')"
else
  tail -30 "$TMPD/shared-test.log"; bad "shared learner kinds test"
fi
export REDIS_URL="redis://127.0.0.1:${REDIS_PORT}"
export DATABASE_URL="postgres://quest:quest@127.0.0.1:${PG_PORT}/quest"
if pnpm --filter @quest/engine exec vitest run test/verify-slots.test.ts >"$TMPD/engine-slots.log" 2>&1; then
  ok "engine verify-slots test: $(grep -E '^ +Tests ' "$TMPD/engine-slots.log" | sed 's/^ *//')"
else
  tail -20 "$TMPD/engine-slots.log"; bad "engine verify-slots test (the engine slot table disagrees with the app registry)"
fi
if pnpm --filter @quest/app test >"$TMPD/app-test.log" 2>&1; then
  ok "app vitest: $(grep -E '^ +Tests ' "$TMPD/app-test.log" | sed 's/^ *//')"
else
  tail -60 "$TMPD/app-test.log"; bad "app vitest"
fi
if pnpm --filter @quest/runner test >"$TMPD/runner-test.log" 2>&1; then
  ok "runner vitest: $(grep -E '^ +Tests ' "$TMPD/runner-test.log" | sed 's/^ *//')"
else
  tail -60 "$TMPD/runner-test.log"; bad "runner vitest"
fi
unset REDIS_URL DATABASE_URL
RC redis FLUSHALL >/dev/null

section "docker compose -p $PROJECT up -d --build engine app proxy runner"
export A05_ENGINE_SH="exec node engine/dist/main.js"
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

section "how the target is moved: the engine's PUT /api/target, or a stand-in when it does not take sentinel:// and cluster:// yet"
req PUT /api/target "{\"redisUrl\":\"$URL_CLUSTER\"}"
if [ "$STATUS" = "200" ]; then
  ENGINE_MODE=real
  ok "the real engine accepts cluster:// (PUT /api/target -> 200): the whole check moves the target through it"
  req PUT /api/target "{\"redisUrl\":\"$URL_SINGLE\"}"
else
  ENGINE_MODE=stub
  note "the real engine answered HTTP $STATUS to PUT /api/target with cluster:// ($(printf '%s' "$BODY" | head -c 120)); E-03 is not merged in this tree"
  note "falling back to a stand-in engine that serves GET /internal/app-config, /internal/metrics, /api/events, PUT /api/target and PUT /api/slots; the app and runner under test are the real ones"
  cat > "$SCRATCH/stub-engine.mjs" <<'NODE'
import http from 'node:http';
import crypto from 'node:crypto';
const state = { redisUrl: process.env.REDIS_URL || 'redis://redis:6379', active: [], events: [] };
const etag = () => crypto.createHash('sha1').update(JSON.stringify([state.redisUrl, state.active, 0])).digest('hex').slice(0, 16);
const read = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } }); });
const send = (res, code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/health') return send(res, 200, { ok: true, service: 'stub-engine' });
  if (req.method === 'GET' && url === '/internal/app-config') {
    const e = etag(); res.setHeader('ETag', `"${e}"`);
    if (req.headers['if-none-match'] === `"${e}"`) { res.statusCode = 304; return res.end(); }
    return send(res, 200, { target: { redisUrl: state.redisUrl }, activeSlots: state.active, dbExtraLatencyMs: 0 });
  }
  if (req.method === 'POST' && url === '/internal/metrics') { await read(req); return send(res, 200, { ok: true }); }
  if (req.method === 'POST' && url === '/api/events') { state.events.push(await read(req)); return send(res, 200, { ok: true }); }
  if (req.method === 'GET' && url === '/api/events') return send(res, 200, state.events);
  if (url === '/api/target') {
    if (req.method === 'GET') return send(res, 200, { redisUrl: state.redisUrl, state: 'up' });
    if (req.method === 'PUT') {
      const b = await read(req);
      if (typeof b.redisUrl !== 'string' || !/^(redis|rediss|sentinel|cluster):\/\//.test(b.redisUrl)) return send(res, 400, { error: 'invalid_url' });
      state.redisUrl = b.redisUrl; return send(res, 200, { redisUrl: state.redisUrl, state: 'up' });
    }
  }
  if (url === '/api/slots') {
    if (req.method === 'GET') return send(res, 200, { active: state.active });
    if (req.method === 'PUT') { const b = await read(req); state.active = Array.isArray(b.active) ? b.active : []; return send(res, 200, { active: state.active }); }
  }
  return send(res, 404, { error: 'not_found' });
}).listen(4200, '0.0.0.0', () => console.log('stub engine listening on 4200'));
NODE
  export A05_ENGINE_SH="exec node /logs/.a-05-check/stub-engine.mjs"
  DC up -d engine >"$TMPD/up-stub.log" 2>&1 && ok "engine service replaced by the stand-in" || { tail -5 "$TMPD/up-stub.log"; die "could not start the stand-in engine"; }
  wait_until engine 40 engine_up && ok "stand-in engine healthy" || die "stand-in engine not healthy"
  wait_until link 30 engine_link && ok "app pulls config from the stand-in" || bad "app never reached the stand-in"
fi
info "ENGINE_MODE=$ENGINE_MODE"
set_slots '{"active":[]}' && ok "no slot active (all baselines)" || bad "PUT /api/slots []"

# ---- helpers that need the stack ---------------------------------------------------------------------------------
app_target_is() { # app_target_is URL : the app follows URL and its shared client is ready
  req GET /app/target
  [ "$(js "$BODY" 'j.redisUrl')" = "$1" ] && [ "$(js "$BODY" 'j.ready')" = "true" ]
}
switch_target() { # switch_target URL KIND LABEL : move the target and wait for the app
  local t0 t1
  t0=$(now_ms)
  req PUT /api/target "{\"redisUrl\":\"$1\"}"
  if [ "$STATUS" != "200" ]; then bad "PUT /api/target $1 -> $STATUS: $(printf '%s' "$BODY" | head -c 200)"; return 1; fi
  if wait_until follow 40 app_target_is "$1"; then
    t1=$(now_ms)
    req GET /app/target
    ok "$3: the app follows ($((t1 - t0)) ms after the PUT): $(printf '%s' "$BODY" | head -c 300)"
  else
    req GET /app/target
    bad "$3: the app did not follow within 40 s: $(printf '%s' "$BODY" | head -c 300)"; return 1
  fi
  expect_js "$3: /app/target kind is $2" "j.kind==='$2'&&typeof j.description==='string'"
  req GET /app/health
  expect_js "$3: /app/health target carries { redisUrl, kind, description } and redis is up" "j.target.redisUrl==='$1'&&j.target.kind==='$2'&&typeof j.target.description==='string'&&j.redis==='up'"
}
runner_setget() { # runner_setget URL LABEL : a learner file through the runner with redisUrl = URL
  local out
  out=$(runner_run "{\"module\":\"a05-check/setget.js\",\"redisUrl\":\"$1\",\"timeoutMs\":15000}")
  if [ "$(js "$out" 'j.status===200&&j.results[0].ok===true&&j.results[0].value.set==="OK"&&j.results[0].value.got==="v1"')" = "true" ]; then
    ok "$2: runner POST /run with redisUrl does SET/GET on {a}:1 -> $(js "$out" 'JSON.stringify(j.results[0].value)') ($(js "$out" 'j.results[0].ms') ms, redisCommands $(js "$out" 'j.metrics.redisCommands'))"
  else
    bad "$2: runner SET/GET: $(printf '%s' "$out" | head -c 400)"
  fi
}
app_setget() { # app_setget LABEL : slot cache.invalidatePlayerStats runs the SET/GET learner file
  req POST /app/players/p-001/stats/refresh
  if [ "$STATUS" = "200" ] && [ "$(js "$BODY" 'j.result.set==="OK"&&j.result.got==="v1"')" = "true" ] && [ "$(hdr x-quest-slots)" = "cache.invalidatePlayerStats=learner" ]; then
    ok "$1: app slot cache.invalidatePlayerStats (learner) does SET/GET on {a}:1 -> $(js "$BODY" 'JSON.stringify(j.result)') ($MS ms)"
  else
    bad "$1: app SET/GET: HTTP $STATUS $(printf '%s' "$BODY" | head -c 300)"
  fi
}
runner_cached() { # runner_cached URL LABEL NODE... : redisCached through the runner; the server sees exactly 2 HGETALL
  local url=$1 label=$2 key out before after; shift 2
  key="cache:a05:runner:$(now_ms)"
  before=$(calls_sum hgetall "$@")
  out=$(runner_run "{\"module\":\"a05-check/cached.js\",\"redisUrl\":\"$url\",\"calls\":[{\"args\":[\"$key\"]}],\"timeoutMs\":15000}")
  after=$(calls_sum hgetall "$@")
  if [ "$(js "$out" 'j.status===200&&j.results[0].ok===true&&j.results[0].value.r1.runs==="10"&&j.results[0].value.r2.runs==="10"&&j.results[0].value.r3.runs==="11"')" = "true" ]; then
    ok "$label: redisCached through the runner returns 10, 10, then 11 after another connection wrote the key"
  else
    bad "$label: redisCached through the runner: $(printf '%s' "$out" | head -c 500)"
  fi
  if [ "$((after - before))" = "2" ]; then
    ok "$label: INFO commandstats cmdstat_hgetall rose by exactly 2 for 3 reads ($before -> $after): the 2nd read never reached the server, the 3rd (after the other connection's HSET invalidated it) did"
  else
    bad "$label: cmdstat_hgetall rose by $((after - before)) for 3 reads ($before -> $after), want 2"
  fi
  info "$label: redisCommands counted for the run: $(js "$out" 'j.metrics.redisCommands') (deps.redis only: hSet, duplicate's hSet; the 3 redisCached reads are not counted)"
  info "$label: run log: $(js "$out" '(j.logs||[]).filter(l=>l.includes("redisCached")).join(" | ")')"
}
app_cached() { # app_cached LABEL WRITER_NODE WRITER_CLI(redis-cli|redis-cli -c) NODE... : the app's shared redisCached across requests
  local label=$1 writer=$2 mode=$3 key="cache:a05:player:p-001" before after
  shift 3
  RCC "$writer" DEL "$key" >/dev/null
  RCC "$writer" HSET "$key" runs 10 name x >/dev/null
  sleep 0.5 # replication to the replica target
  before=$(calls_sum hgetall "$@")
  req GET /app/players/p-001/stats; local s1=$STATUS b1=$BODY
  mid1=$(calls_sum hgetall "$@")
  req GET /app/players/p-001/stats; local s2=$STATUS b2=$BODY
  mid2=$(calls_sum hgetall "$@")
  RCC "$writer" HSET "$key" runs 11 >/dev/null
  sleep 0.4
  req GET /app/players/p-001/stats; local s3=$STATUS b3=$BODY
  after=$(calls_sum hgetall "$@")
  if [ "$s1$s2$s3" = "200200200" ] && [ "$(js "$b1" 'j.runs')" = "10" ] && [ "$(js "$b2" 'j.runs')" = "10" ] && [ "$(js "$b3" 'j.runs')" = "11" ]; then
    ok "$label: three GET /app/players/p-001/stats through redisCached answer runs 10, 10, 11"
  else
    bad "$label: statuses $s1 $s2 $s3, bodies: $b1 | $b2 | $b3"
  fi
  if [ "$((mid1 - before))" = "1" ] && [ "$((mid2 - mid1))" = "0" ] && [ "$((after - mid2))" = "1" ]; then
    ok "$label: cmdstat_hgetall +1 on the first read, +0 on the second (served from the app's memory), +1 on the third (invalidated by the HSET from another connection)"
  else
    bad "$label: cmdstat_hgetall deltas per read: $((mid1 - before)), $((mid2 - mid1)), $((after - mid2)), want 1, 0, 1"
  fi
}
swap_join() { # swap_join SRC : install a contest.join file and wait until the app serves the new version (reload race)
  install_file "$1" ch3/contest-join.js
  sleep 3
  post_json /app/contests/9001/join '{"userId":"u-a05-warm"}' >/dev/null
  sleep 1
}
app_log_lines() { DC logs --no-log-prefix --since "${1}s" app 2>&1; }

section "0. default target: single node"
install_file "$TMPD/slot-cache.js" ch2/cache.js
install_file "$TMPD/slot-setget.js" ch2/invalidate.js
activate "cache.getPlayerStats cache.invalidatePlayerStats"
req GET /app/target
expect_js "GET /app/target on the default stack: single node, ready" "j.kind==='single'&&j.ready===true&&j.redisUrl==='$URL_SINGLE'&&j.description==='single node redis:6379'"
req GET /app/health
expect_js "/app/health target on the default stack" "j.target.kind==='single'&&j.target.redisUrl==='$URL_SINGLE'&&j.redis==='up'"
runner_setget "$URL_SINGLE" "single"
app_setget "single"
runner_cached "$URL_SINGLE" "single" redis
app_cached "single" redis redis-cli redis
LOG=$(app_log_lines 3600)
n=$(printf '%s\n' "$LOG" | grep -c 'redisCached: single node redis:6379; RESP 3, client-side cache on')
[ "$n" = "1" ] && ok "the app logged exactly one 'redisCached: single node redis:6379; RESP 3, client-side cache on (LRU, max 5000 entries, no ttl)' line for the whole run of this target" || bad "redisCached log lines for the single target: $n"

section "1. replica target ($URL_REPLICA): reads work, a learner SET is READONLY"
RC redis SET '{a}:1' v1 >/dev/null
switch_target "$URL_REPLICA" single "replica"
req GET /app/target
expect_js "the replica target is kind single (a replica is a plain node; read-only is the lesson)" "j.kind==='single'&&j.description==='single node redis-replica:6379'"
replica_has() { [ "$(RC redis-replica GET '{a}:1')" = "v1" ]; }
wait_until repl 10 replica_has && ok "{a}:1 replicated to redis-replica" || bad "{a}:1 never reached the replica"
OUT=$(runner_run "{\"module\":\"a05-check/get.js\",\"redisUrl\":\"$URL_REPLICA\"}")
[ "$(js "$OUT" 'j.results[0].ok===true&&j.results[0].value.got==="v1"')" = "true" ] && ok "replica: runner learner GET {a}:1 -> v1 (reads are fine on a replica)" || bad "replica GET through the runner: $OUT"
OUT=$(runner_run "{\"module\":\"a05-check/setget.js\",\"redisUrl\":\"$URL_REPLICA\"}")
RMSG=$(js "$OUT" 'j.results[0].error.message')
case "$RMSG" in
  READONLY*) ok "replica: runner learner SET fails with: $RMSG";;
  *) bad "replica: runner learner SET: $OUT";;
esac
info "replica: runner error name: $(js "$OUT" 'j.results[0].error.name')"
req POST /app/players/p-001/stats/refresh
if [ "$STATUS" = "500" ] && [ "$(js "$BODY" 'j.name')" = "SimpleError" -o "$(js "$BODY" 'j.name')" = "ErrorReply" -o "$(js "$BODY" 'j.name')" = "Error" ]; then
  case "$(js "$BODY" 'j.message')" in
    READONLY*) ok "replica: app learner SET -> HTTP 500, body: $(printf '%s' "$BODY" | head -c 300)";;
    *) bad "replica: app SET: 500 without READONLY: $BODY";;
  esac
else
  bad "replica: app learner SET: HTTP $STATUS $BODY"
fi
info "replica: x-quest-slot-error header: $(hdr x-quest-slot-error)"
req GET /app/health
expect_js "replica: the app is healthy and redis is up (it did not crash or loop)" "j.ok===true&&j.redis==='up'"
# redisCached reads from the replica and is invalidated by the replicated write
app_cached "replica" redis redis-cli redis-replica
# the workers on a read-only target: the outbox XADD fails with READONLY; the app logs it, keeps serving, does not spin
install_file app/test/fixtures/prefetch-apply.js ch2/prefetch-apply.js
activate "cache.getPlayerStats cache.invalidatePlayerStats prefetch.applyChange"
MARK=$(date +%s)
PSQL "UPDATE matches SET venue = 'A05 Replica Ground' WHERE id = 'm-043'" >/dev/null
sleep 6
LOG=$(app_log_lines $(( $(date +%s) - MARK + 2 )))
FAILS=$(printf '%s\n' "$LOG" | grep -c 'outbox drain failed')
info "app log during 6 s on the replica target with an unpublished outbox row: 'outbox drain failed' lines: $FAILS; sample: $(printf '%s\n' "$LOG" | grep 'outbox drain failed' | head -1 | cut -c1-220)"
if [ "$FAILS" -ge 1 ] && [ "$FAILS" -le 2 ]; then ok "the drainer retries every second but logs the READONLY failure once per 10 s ($FAILS line(s) in 6 s)"; else bad "outbox failure log lines in 6 s: $FAILS (want 1 or 2)"; fi
case "$LOG" in *READONLY*) ok "the logged failure names READONLY";; *) bad "no READONLY in the outbox failure line";; esac
req GET /app/health
expect_js "replica: still healthy after the drainer failed" "j.ok===true&&j.redis==='up'"
req GET /app/ticker/m-041
expect_js "replica: the ticker subscriber is subscribed on a replica (pub/sub works on replicas)" "j.subscribed===true"

section "back to the single node: the unpublished outbox row drains"
LEN0=$(RC redis XLEN legacydb:changes)
switch_target "$URL_SINGLE" single "single again"
drained() { [ "$(RC redis XLEN legacydb:changes)" -gt "$LEN0" ]; }
wait_until drain 15 drained && ok "legacydb:changes grew on the single node ($LEN0 -> $(RC redis XLEN legacydb:changes)): the row that could not be published on the replica was published after the switch (at-least-once)" || bad "legacydb:changes did not grow after switching back"
note "the change consumer starts reading at the stream tail after every target switch (by design, A-01), so the entry published right after the switch is not applied; the live end-to-end apply is checked on the cluster and sentinel targets below"

section "2. cluster target ($URL_CLUSTER)"
switch_target "$URL_CLUSTER" cluster "cluster" || true
req GET /app/target
info "cluster: /app/target masters: $(js "$BODY" 'JSON.stringify(j.masters)')"
expect_js "cluster: /app/target lists the three masters it knows" 'Array.isArray(j.masters)&&j.masters.length>=1&&j.description==="cluster, 3 root nodes"'
runner_setget "$URL_CLUSTER" "cluster"
app_setget "cluster"
runner_cached "$URL_CLUSTER" "cluster" redis-c1 redis-c2 redis-c3 redis-c4 redis-c5 redis-c6
app_cached "cluster" redis-c1 "redis-cli -c" redis-c1 redis-c2 redis-c3 redis-c4 redis-c5 redis-c6
echo "-- cross-slot commands reach the learner as ordinary rejections"
OUT=$(runner_run "{\"module\":\"a05-check/mset-cross.js\",\"redisUrl\":\"$URL_CLUSTER\"}")
MSG=$(js "$OUT" 'j.results[0].error.message')
case "$MSG" in CROSSSLOT*) ok "cluster: runner MSET a b -> rejection: $MSG (error name $(js "$OUT" 'j.results[0].error.name'))";; *) bad "cluster MSET a b: $OUT";; esac
OUT=$(runner_run "{\"module\":\"a05-check/mget-cross.js\",\"redisUrl\":\"$URL_CLUSTER\"}")
MSG=$(js "$OUT" 'j.results[0].error.message')
case "$MSG" in CROSSSLOT*) ok "cluster: runner MGET a b -> rejection: $MSG";; *) bad "cluster MGET a b: $OUT";; esac
OUT=$(runner_run "{\"module\":\"a05-check/watch-dup.js\",\"redisUrl\":\"$URL_CLUSTER\"}")
MSG=$(js "$OUT" 'j.results[0].error.message')
info "cluster: redis.duplicate() + connect() + watch() -> $(js "$OUT" 'j.results[0].ok') / $MSG"
case "$MSG" in *"watch is not a function"*) ok "cluster: the cluster client has no WATCH (TypeError: $MSG), so the Chapter 3 WATCH reference cannot run on a cluster";; *) bad "cluster WATCH probe: $OUT";; esac

echo "-- contest.join on the cluster: the single-node WATCH reference, a MULTI over two slots, and the hash-tag rewrite"
install_file app/test/fixtures/contest-join.js ch3/contest-join.js
install_file app/test/fixtures/leaderboard-top.js ch3/leaderboard.js
install_file app/test/fixtures/leaderboard-add.js ch3/leaderboard-add.js
install_file app/test/fixtures/leaderboard-rank.js ch3/leaderboard-rank.js
install_file app/test/fixtures/ticker-publish.js ch3/ticker-publish.js
activate "cache.getPlayerStats cache.invalidatePlayerStats contest.join leaderboard.top leaderboard.addPoints leaderboard.rank ticker.publish prefetch.applyChange"
RCC redis-c1 SET wallet:u-a05 100 >/dev/null
req POST /app/contests/9001/join '{"userId":"u-a05"}'
info "the WATCH reference (contest-join.js, unchanged) on the cluster: HTTP $STATUS, $(printf '%s' "$BODY" | head -c 300)"
if [ "$STATUS" = "500" ] && [ "$(js "$BODY" 'j.slot')" = "contest.join" ]; then ok "reference join on a cluster: HTTP 500 slot_error, message: $(js "$BODY" 'j.message')"; else bad "reference join on a cluster: HTTP $STATUS $BODY"; fi
# pick users whose wallet key sits on the same master as contest:9001:entries but in another slot (CROSSSLOT expected) and on another master (MOVED expected)
owner_of() { # owner_of SLOT : hostname of the master that owns the slot
  printf '%s\n' "$CLUSTER_NODES" | node -e '
    const slot = Number(process.argv[1]); let out = "";
    for (const l of require("fs").readFileSync(0, "utf8").split("\n")) {
      const f = l.split(" "); if (f.length < 9 || !f[2].includes("master")) continue;
      const host = f[1].split(",")[1] || f[1];
      for (const r of f.slice(8)) { const [a, b] = r.split("-").map(Number); if (slot >= a && slot <= (b === undefined ? a : b)) out = host; }
    }
    console.log(out)' "$1"
}
ENTRIES_SLOT=$(RC redis-c1 CLUSTER KEYSLOT contest:9001:entries); ENTRIES_OWNER=$(owner_of "$ENTRIES_SLOT")
info "contest:9001:entries -> slot $ENTRIES_SLOT on $ENTRIES_OWNER"
SAME_USER=""; OTHER_USER=""
i=1
while [ $i -le 300 ] && { [ -z "$SAME_USER" ] || [ -z "$OTHER_USER" ]; }; do
  s=$(RC redis-c1 CLUSTER KEYSLOT "wallet:u-a05-$i"); o=$(owner_of "$s")
  if [ "$o" = "$ENTRIES_OWNER" ] && [ "$s" != "$ENTRIES_SLOT" ] && [ -z "$SAME_USER" ]; then SAME_USER="u-a05-$i"; SAME_SLOT=$s; fi
  if [ "$o" != "$ENTRIES_OWNER" ] && [ -z "$OTHER_USER" ]; then OTHER_USER="u-a05-$i"; OTHER_SLOT=$s; OTHER_OWNER=$o; fi
  i=$((i + 1))
done
info "wallet:$SAME_USER -> slot $SAME_SLOT on $ENTRIES_OWNER (same master, different slot); wallet:$OTHER_USER -> slot $OTHER_SLOT on $OTHER_OWNER (another master)"
swap_join "$TMPD/join-multi.js"
RCC redis-c1 SET "wallet:$SAME_USER" 100 >/dev/null; RCC redis-c1 SET "wallet:$OTHER_USER" 100 >/dev/null
slot_ready_multi() { req POST /app/contests/9001/join "{\"userId\":\"$SAME_USER\"}"; [ "$STATUS" != "200" ] || true; return 0; }
req POST /app/contests/9001/join "{\"userId\":\"$SAME_USER\"}"
SAME_MSG=$(js "$BODY" 'j.message')
info "MULTI over wallet:$SAME_USER and contest:9001:entries (same master, two slots): HTTP $STATUS, message: $SAME_MSG"
case "$SAME_MSG" in CROSSSLOT*) ok "same master, two slots: the join's MULTI fails with: $SAME_MSG";; *) bad "same-master join: HTTP $STATUS $BODY";; esac
req POST /app/contests/9001/join "{\"userId\":\"$OTHER_USER\"}"
OTHER_MSG=$(js "$BODY" 'j.message')
info "MULTI over wallet:$OTHER_USER and contest:9001:entries (two masters): HTTP $STATUS, message: $OTHER_MSG"
case "$OTHER_MSG" in MOVED*|CROSSSLOT*) ok "different masters: the join's MULTI fails with: $OTHER_MSG";; *) bad "other-master join: HTTP $STATUS $BODY";; esac
[ "$STATUS" = "500" ] && [ "$(js "$BODY" 'j.error')" = "slot_error" ] && ok "both arrive as an ordinary slot_error 500 (the learner could catch them)" || bad "status $STATUS"
swap_join app/test/fixtures/contest-join-cluster.js
RCC redis-c1 DEL '{wallet:u-a05}' '{wallet:u-a05}:joins:9001' >/dev/null
RCC redis-c1 SET '{wallet:u-a05}' 100 >/dev/null
req POST /app/contests/9001/join '{"userId":"u-a05"}'
expect_status "hash-tag join (contest-join-cluster.js): first join" 200
[ "$(hdr x-quest-slots)" = "contest.join=learner" ] && ok "x-quest-slots: contest.join=learner" || bad "x-quest-slots: $(hdr x-quest-slots)"
RCC redis-c1 SET '{wallet:u-a05}' 100 >/dev/null; RCC redis-c1 DEL '{wallet:u-a05}:joins:9001' >/dev/null
seq 1 50 | xargs -P 50 -I{} curl -s -m 60 -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data '{"userId":"u-a05"}' "$BASE/app/contests/9001/join" > "$TMPD/joins.txt"
N200=$(grep -c '^200$' "$TMPD/joins.txt"); N402=$(grep -c '^402$' "$TMPD/joins.txt"); NOTHER=$(grep -vc -E '^(200|402)$' "$TMPD/joins.txt")
[ "$N200" = "10" ] && [ "$N402" = "40" ] && ok "50 parallel joins on a wallet of 100 at fee 10 with {wallet:u-a05} hash tags: exactly 10 joined, 40 refused (402)" || bad "joined $N200, refused $N402, other $NOTHER"
[ "$(RCC redis-c1 GET '{wallet:u-a05}')" = "0" ] && [ "$(RCC redis-c1 GET '{wallet:u-a05}:joins:9001')" = "10" ] && ok "{wallet:u-a05} = 0 and {wallet:u-a05}:joins:9001 = 10" || bad "wallet $(RCC redis-c1 GET '{wallet:u-a05}'), joins $(RCC redis-c1 GET '{wallet:u-a05}:joins:9001')"
RUNNER_BODY='{"module":"ch3/contest-join.js","redisUrl":"'"$URL_CLUSTER"'","calls":[{"args":["u-a05",9001,10]},{"args":["u-a05",9001,10]}],"timeoutMs":15000}'
RCC redis-c1 SET '{wallet:u-a05}' 15 >/dev/null
OUT=$(runner_run "$RUNNER_BODY")
[ "$(js "$OUT" 'j.results.map(r=>r.value).join()')" = "true,false" ] && ok "the same file through the runner on the cluster: true then false (wallet 15, fee 10)" || bad "runner hash-tag join: $OUT"

echo "-- leaderboard references on the cluster (one key per command, so every call routes)"
RCC redis-c1 DEL lb:contest:9001 >/dev/null
RCC redis-c1 ZADD lb:contest:9001 100 t1 200 t2 300 t3 400 t4 500 t5 >/dev/null
req GET "/app/leaderboard/9001?limit=3"
if [ "$STATUS" = "200" ] && [ "$(js "$BODY" 'j.entries.map(e=>e.teamId).join()')" = "t5,t4,t3" ]; then ok "leaderboard.top (ZRANGE REV WITHSCORES): 200, t5,t4,t3"; else bad "leaderboard.top on the cluster: HTTP $STATUS $BODY"; fi
req POST /app/contests/9001/points '{"teamId":"t1","delta":250}'
if [ "$STATUS" = "200" ] && [ "$(js "$BODY" 'j.score')" = "350" ]; then ok "leaderboard.addPoints (ZSCORE then ZINCRBY): 200, score 350"; else bad "leaderboard.addPoints on the cluster: HTTP $STATUS $BODY"; fi
req GET /app/leaderboard/9001/teams/t1
if [ "$STATUS" = "200" ] && [ "$(js "$BODY" 'j.rank')" = "3" ]; then ok "leaderboard.rank (ZREVRANK + ZRANGE REV window): 200, rank 3 (500, 400, 350)"; else bad "leaderboard.rank on the cluster: HTTP $STATUS $BODY"; fi
info "all three leaderboard references use one key per command: every command succeeds on the cluster"

echo "-- ticker.publish and the provided subscriber on the cluster (global Pub/Sub, not sharded)"
req GET /app/ticker/m-041
expect_js "ticker subscriber is subscribed on the cluster target" "j.subscribed===true"
RECV0=$(js "$BODY" 'j.received'); LASTSEQ=$(js "$BODY" 'j.lastSeq'); [ "$LASTSEQ" = "null" ] && LASTSEQ=0
req POST /app/matches/m-041/balls "{\"seq\":$((LASTSEQ + 1)),\"over\":3,\"ball\":2,\"batter\":\"p-028\",\"runs\":4}"
expect_status "POST /app/matches/m-041/balls (ticker.publish reference)" 200
PUBRESULT=$(js "$BODY" 'j.result')
info "ticker.publish result (PUBLISH's receiver count) on the cluster: $PUBRESULT"
rose() { req GET /app/ticker/m-041; [ "$(js "$BODY" 'j.received')" = "$((RECV0 + 1))" ]; }
wait_until recv 5 rose && ok "the subscriber received the ball (received $RECV0 -> $((RECV0 + 1))): a plain SUBSCRIBE on a cluster client hears a PUBLISH sent to any node" || bad "ticker received did not rise on the cluster"
if [ "$PUBRESULT" = "0" ]; then ok "PUBLISH answered 0 receivers although one subscriber heard it: on a cluster the count is per node, so '0 = nobody is listening' stops being true"; else note "PUBLISH answered $PUBRESULT on this run (the PUBLISH reached the node the subscriber is on)"; fi

echo "-- the workers on the cluster: outbox XADD, change consumer XREAD BLOCK, applyChange MULTI on one key"
sleep 2
PSQL "UPDATE matches SET venue = 'A05 Cluster Ground' WHERE id = 'm-043'" >/dev/null
T0=$(now_ms)
applied_cluster() { [ "$(RCC redis-c1 HGET cache:match:m-043 venue)" = "A05 Cluster Ground" ]; }
wait_until apply 10 applied_cluster && ok "UPDATE matches -> outbox -> XADD legacydb:changes -> XREAD -> applyChange: cache:match:m-043 venue changed after $(( $(now_ms) - T0 )) ms" || bad "cache:match:m-043 venue is '$(RCC redis-c1 HGET cache:match:m-043 venue)' after 10 s"
[ "$(RCC redis-c1 XLEN legacydb:changes)" -ge 1 ] && ok "legacydb:changes exists on the cluster (XLEN $(RCC redis-c1 XLEN legacydb:changes))" || bad "legacydb:changes is empty on the cluster"
req GET /app/health
expect_js "cluster: the app is healthy" "j.ok===true&&j.redis==='up'"
LOG=$(app_log_lines 3600)
n=$(printf '%s\n' "$LOG" | grep -c 'redisCached: cluster, 3 root nodes; RESP 3, client-side cache on')
[ "$n" = "1" ] && ok "the app logged exactly one 'redisCached: cluster, 3 root nodes; RESP 3, client-side cache on (...)' line" || bad "redisCached log lines for the cluster target: $n"

section "3. sentinel target ($URL_SENTINEL)"
switch_target "$URL_SENTINEL" sentinel "sentinel" || true
req GET /app/target
expect_js "sentinel: /app/target names the master the shared client writes to" "j.master==='redis:6379'&&j.description==='sentinel mymaster via 3 sentinels'"
runner_setget "$URL_SENTINEL" "sentinel"
app_setget "sentinel"
runner_cached "$URL_SENTINEL" "sentinel" redis redis-replica
app_cached "sentinel" redis redis-cli redis redis-replica
OUT=$(runner_run "{\"module\":\"a05-check/watch-dup.js\",\"redisUrl\":\"$URL_SENTINEL\"}")
info "sentinel: redis.duplicate() + connect() + watch() -> ok=$(js "$OUT" 'j.results[0].ok') $(js "$OUT" 'j.results[0].error.message')"
case "$(js "$OUT" 'j.results[0].error.message')" in *"watch is not a function"*) ok "sentinel: duplicate() works (the deps hand out a fresh Sentinel client; node-redis has none), but a Sentinel client has no WATCH either (use redis.use(fn) to lease a connection)";; *) bad "sentinel duplicate/WATCH probe: $OUT";; esac
OUT=$(runner_run "{\"module\":\"a05-check/mset-cross.js\",\"redisUrl\":\"$URL_SENTINEL\"}")
[ "$(js "$OUT" 'j.results[0].ok')" = "true" ] && ok "sentinel: MSET a b (two slots) just works: Sentinel fronts one master, there are no slots" || bad "sentinel MSET: $OUT"
activate "cache.getPlayerStats cache.invalidatePlayerStats contest.join leaderboard.top leaderboard.addPoints leaderboard.rank ticker.publish prefetch.applyChange"
swap_join app/test/fixtures/contest-join.js
RC redis SET wallet:u-a05 100 >/dev/null
seq 1 50 | xargs -P 50 -I{} curl -s -m 60 -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data '{"userId":"u-a05"}' "$BASE/app/contests/9001/join" > "$TMPD/joins.txt"
N200=$(grep -c '^200$' "$TMPD/joins.txt"); N402=$(grep -c '^402$' "$TMPD/joins.txt"); NOTHER=$(grep -vc -E '^(200|402)$' "$TMPD/joins.txt")
info "sentinel: the single-node WATCH reference on 50 parallel joins: 200 x $N200, 402 x $N402, other x $NOTHER"
[ "$NOTHER" = "50" ] && ok "the WATCH reference does not run on a Sentinel target either (all 50 fail; see the watch probe above)" || note "WATCH reference results on Sentinel: $N200 joined, $N402 refused, $NOTHER other"
swap_join app/test/fixtures/contest-join-cluster.js
RC redis SET '{wallet:u-a05}' 100 >/dev/null; RC redis DEL '{wallet:u-a05}:joins:9001' >/dev/null
seq 1 50 | xargs -P 50 -I{} curl -s -m 60 -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data '{"userId":"u-a05"}' "$BASE/app/contests/9001/join" > "$TMPD/joins.txt"
N200=$(grep -c '^200$' "$TMPD/joins.txt"); N402=$(grep -c '^402$' "$TMPD/joins.txt")
if [ "$N200" = "10" ] && [ "$N402" = "40" ]; then ok "the Lua join (contest-join-cluster.js) on Sentinel: exactly 10 joined, 40 refused"; else bad "Sentinel Lua join: joined $N200, refused $N402, other codes: $(grep -v -E '^(200|402)$' "$TMPD/joins.txt" | sort | uniq -c | tr '\n' ' '); app log: $(app_log_lines 60 | grep -E 'slot contest.join failed|"level":(40|50)' | tail -3 | cut -c1-300 | tr '\n' '|')"; fi
req GET /app/ticker/m-041
expect_js "sentinel: the ticker subscriber is subscribed" "j.subscribed===true"
RECV0=$(js "$BODY" 'j.received'); LASTSEQ=$(js "$BODY" 'j.lastSeq'); [ "$LASTSEQ" = "null" ] && LASTSEQ=0
req POST /app/matches/m-041/balls "{\"seq\":$((LASTSEQ + 1)),\"over\":3,\"ball\":3,\"batter\":\"p-028\",\"runs\":1}"
expect_status "sentinel: POST /app/matches/m-041/balls" 200
info "sentinel: ticker.publish result: $(js "$BODY" 'j.result')"
wait_until recv 5 rose && ok "sentinel: the subscriber received the ball (received $RECV0 -> $((RECV0 + 1)))" || bad "sentinel: ticker received did not rise"
sleep 2
PSQL "UPDATE matches SET venue = 'A05 Sentinel Ground' WHERE id = 'm-043'" >/dev/null
applied_sentinel() { [ "$(RC redis HGET cache:match:m-043 venue)" = "A05 Sentinel Ground" ]; }
wait_until apply 10 applied_sentinel && ok "sentinel: outbox -> XADD -> XREAD -> applyChange: cache:match:m-043 venue changed" || bad "sentinel: cache:match:m-043 venue is '$(RC redis HGET cache:match:m-043 venue)'"
LOG=$(app_log_lines 3600)
n=$(printf '%s\n' "$LOG" | grep -c 'redisCached: sentinel mymaster via 3 sentinels; RESP 3, client-side cache on')
[ "$n" = "1" ] && ok "the app logged exactly one 'redisCached: sentinel mymaster via 3 sentinels; RESP 3, client-side cache on (...)' line" || bad "redisCached log lines for the sentinel target: $n"

section "4. sentinel failover as the app sees it (docker compose stop redis)"
req POST /app/players/p-001/stats/refresh; expect_status "before the failover: learner SET through the app" 200
: > "$TMPD/fo.log"
T0=$(now_ms)
( DC stop redis >"$TMPD/stop.log" 2>&1; echo "stop returned after $(( $(now_ms) - T0 )) ms" >> "$TMPD/fo.events" ) &
STOP_PID=$!
FIRST_ERR=""; RECOVERED=""; MASTER_AT=""; OK_STREAK=0
while [ $(( $(now_ms) - T0 )) -lt 45000 ]; do
  t=$(now_ms)
  code=$(curl -s -m 4 -o "$TMPD/fo.body" -w '%{http_code}' -X POST "$BASE/app/players/p-001/stats/refresh")
  tgt=$(curl -s -m 3 "$BASE/app/target")
  m=$(js "$tgt" 'j.master||"none"')
  rel=$((t - T0))
  printf '%s %s %s\n' "$rel" "$code" "$m" >> "$TMPD/fo.log"
  if [ -z "$FIRST_ERR" ] && [ "$code" != "200" ]; then FIRST_ERR=$rel; FIRST_ERR_BODY=$(head -c 200 "$TMPD/fo.body"); fi
  if [ -z "$MASTER_AT" ] && [ "$m" = "redis-replica:6379" ]; then MASTER_AT=$rel; fi
  if [ -n "$FIRST_ERR" ] && [ "$code" = "200" ]; then OK_STREAK=$((OK_STREAK + 1)); [ -z "$RECOVERED" ] && RECOVERED=$rel; else OK_STREAK=0; RECOVERED=""; fi
  if [ -n "$RECOVERED" ] && [ "$OK_STREAK" -ge 3 ] && [ -n "$MASTER_AT" ]; then break; fi
  sleep 0.2
done
wait $STOP_PID 2>/dev/null
cat "$TMPD/fo.events" 2>/dev/null | while read -r l; do info "$l"; done
info "first failing learner SET after the stop: ${FIRST_ERR:-never} ms ($FIRST_ERR_BODY)"
info "first successful learner SET after that, held for 3 calls: ${RECOVERED:-never} ms after the stop command was issued"
info "/app/target showed master redis-replica:6379 at: ${MASTER_AT:-never} ms"
info "the timeline (ms since the stop command, learner SET status, master the app reports), transitions only:"
awk '{ k = $2 " " $3; if (k != last) { print "        " $1 " ms  HTTP " $2 "  master " $3; last = k } }' "$TMPD/fo.log"
if [ -n "$RECOVERED" ] && [ "$RECOVERED" -le 20000 ]; then ok "within 20 s ($RECOVERED ms) a learner SET through the app succeeds again"; else bad "no stable learner SET within 20 s (recovered: ${RECOVERED:-never})"; fi
if [ -n "$MASTER_AT" ] && [ "$MASTER_AT" -le 20000 ]; then ok "/app/target shows the new master redis-replica:6379 after $MASTER_AT ms"; else bad "/app/target never showed redis-replica:6379 within 20 s"; fi
SENT_NOW=$(SENT SENTINEL get-master-addr-by-name mymaster | tr '\n' ':' | sed 's/:$//')
[ "$SENT_NOW" = "redis-replica:6379" ] && ok "sentinel agrees: mymaster is $SENT_NOW" || bad "sentinel master is $SENT_NOW"
req POST /app/players/p-001/stats/refresh
expect_js "after the failover: the learner's GET returns what it SET on the new master" 'j.result.got==="v1"'
[ "$(RC redis-replica GET '{a}:1')" = "v1" ] && ok "{a}:1 = v1 on redis-replica, the new master" || bad "{a}:1 on redis-replica: $(RC redis-replica GET '{a}:1')"
LOG=$(app_log_lines 120)
printf '%s\n' "$LOG" | grep -E 'sentinel master changed|sentinel master is' | tail -3 | while read -r l; do info "app log: $(printf '%s' "$l" | cut -c1-260)"; done
printf '%s\n' "$LOG" | grep -q 'sentinel master changed: redis:6379 -> redis-replica:6379' && ok "the app logged the master change: redis:6379 -> redis-replica:6379" || bad "no 'sentinel master changed' line in the app log"
# the workers and redisCached follow the new master
PSQL "UPDATE matches SET venue = 'A05 Failover Ground' WHERE id = 'm-043'" >/dev/null
applied_fo() { [ "$(RC redis-replica HGET cache:match:m-043 venue)" = "A05 Failover Ground" ]; }
wait_until apply 20 applied_fo && ok "after the failover the outbox and the change consumer work against the new master (cache:match:m-043 updated on redis-replica)" || bad "cache:match:m-043 venue on the new master: $(RC redis-replica HGET cache:match:m-043 venue)"
app_cached "sentinel after failover" redis-replica redis-cli redis-replica
runner_cached "$URL_SENTINEL" "sentinel after failover" redis-replica
req GET /app/health
expect_js "the app is healthy at the end" "j.ok===true&&j.redis==='up'"

section "restore the default target before the cleanup"
req PUT /api/target "{\"redisUrl\":\"$URL_SINGLE\"}"
info "PUT /api/target single -> $STATUS (the redis service is stopped, so the app reports redis down; the project is torn down next)"
