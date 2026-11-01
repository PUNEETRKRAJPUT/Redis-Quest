#!/usr/bin/env bash
# A-03 acceptance: the app work Chapter 4 needs (stream consume/sweep, the job queue, idempotent credit, the
# contest lock, TTL jitter, the Bloom username check, the ops wall with its provided request hook).
# Own compose project quest-a03 with .env.a03 (PROXY 3800, REDIS 6398, PG 5440, INSIGHT 5548); never the default
# project and never another quest-* project. Ends with `docker compose -p quest-a03 down -v`. Bash 3.2.
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

PROJECT=quest-a03
ENVF=.env.a03
FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
note() { printf 'NOTE  %s\n' "$1"; }
info() { printf '      %s\n' "$1"; }
section() { printf '\n== %s\n' "$1"; }

if [ ! -f "$ENVF" ]; then
  printf '# A-03 check only (gitignored): isolated compose project quest-a03 on its own host ports.\nPROXY_PORT=3800\nREDIS_PORT=6398\nPG_PORT=5440\nINSIGHT_PORT=5548\n' > "$ENVF"
fi
PROXY_PORT=$(sed -n 's/^PROXY_PORT=//p' "$ENVF")
REDIS_PORT=$(sed -n 's/^REDIS_PORT=//p' "$ENVF")
PG_PORT=$(sed -n 's/^PG_PORT=//p' "$ENVF")
BASE="http://127.0.0.1:${PROXY_PORT:-3800}"

SCRATCH="$ROOT/logs/.a-03-check"
rm -rf "$SCRATCH"
mkdir -p "$SCRATCH/levels" "$SCRATCH/progress" logs workspace
cp -R levels/_examples/example-cli "$SCRATCH/levels/example-cli"
export QUEST_LEVELS_DIR="$SCRATCH/levels"
export QUEST_PROGRESS_DIR="$SCRATCH/progress"
DC() { docker compose -p "$PROJECT" --env-file "$ENVF" -f "$ROOT/docker-compose.yml" "$@"; }

# Learner files this check installs under workspace/ch4 (slot file names from app/src/slots/registry.ts).
# Never overwrite a real one.
SLOT_FILES="points-consume points-sweep jobs-enqueue jobs-claim jobs-complete jobs-fail jobs-reclaim jobs-schedule jobs-promote wallet-credit contest-last-slot sessions-jitter username-taken ops-record ops-range"
MADE_CH4=""
[ -d "$ROOT/workspace/ch4" ] || MADE_CH4=1
INSTALLED=""
for f in $SLOT_FILES; do
  if [ -e "$ROOT/workspace/ch4/$f.js" ]; then
    echo "workspace/ch4/$f.js already exists (a learner file?); refusing to overwrite it. Move it away and re-run."
    exit 1
  fi
done
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/a03.XXXXXX")

finish() {
  section "cleanup"
  DC down -v --remove-orphans >/dev/null 2>&1 && echo "docker compose -p $PROJECT down -v: done"
  for f in $INSTALLED; do rm -f "$ROOT/workspace/ch4/$f.js" && echo "removed workspace/ch4/$f.js"; done
  if [ -n "$MADE_CH4" ]; then rmdir "$ROOT/workspace/ch4" 2>/dev/null && echo "removed empty workspace/ch4"; fi
  rm -rf "$SCRATCH" "$TMPD"
  if [ "$FAILED" -eq 0 ]; then printf '\nA-03 OK\n'; exit 0; fi
  printf '\nA-03 FAILED\n'; exit 1
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
expect_slot() { if [ "$(hdr x-quest-slots)" = "$1" ]; then ok "x-quest-slots: $1"; else bad "x-quest-slots: want $1, got $(hdr x-quest-slots)"; fi; }
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
install_fixture() { # install_fixture NAME (the fixture and the workspace file share the name)
  mkdir -p "$ROOT/workspace/ch4"
  cp "app/test/fixtures/$1.js" "$ROOT/workspace/ch4/$1.js" && INSTALLED="$INSTALLED $1"
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
count_lines() { grep -c "^$2\$" "$1" 2>/dev/null; true; }

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

section "quality gates: format, engine slot table, app vitest (own redis and postgres: ports $REDIS_PORT / $PG_PORT)"
pnpm exec prettier --check app engine/src/verify/slots.ts >"$TMPD/fmt-own.log" 2>&1 && ok "prettier --check on app/ and engine/src/verify/slots.ts" || { head -20 "$TMPD/fmt-own.log"; bad "prettier --check on own files"; }
if pnpm format:check >"$TMPD/fmt.log" 2>&1; then
  ok "pnpm format:check (whole repo)"
else
  OFFENDERS=$(grep -E '^\[warn\] [^ ]+$' "$TMPD/fmt.log" | sed 's/^\[warn\] //')
  THEIRS=""; OURS=""
  for f in $OFFENDERS; do
    case "$f" in
      levels/ch4-*|scripts/check/C4.sh) THEIRS="$THEIRS $f";;
      *) OURS="$OURS $f";;
    esac
  done
  if [ -z "$OURS" ]; then
    ok "pnpm format:check: the only unformatted files are C4's in-flight files:$THEIRS"
  else
    bad "pnpm format:check fails on files that are not C4's:$OURS"
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
RCLI FLUSHALL >/dev/null 2>&1

section "measured facts (node-redis 5.12 against the redis in this compose project; re-measured on every run)"
FACTS_OUT=$(ROOT="$ROOT" REDIS_URL="redis://127.0.0.1:${REDIS_PORT}" node --input-type=module - <<'NODE' 2>&1
import { createRequire } from 'node:module';
const require = createRequire(`${process.env.ROOT}/app/package.json`);
const { createClient } = require('redis');
const shared = await import(`${process.env.ROOT}/packages/shared/dist/index.js`);
const url = process.env.REDIS_URL;
const out = [];
const say = (ok, msg) => out.push(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
const info = (msg) => out.push(`      ${msg}`);
const r = createClient({ url });
await r.connect();
const ver = (await r.info('server')).split('\n').find((l) => l.startsWith('redis_version')).trim();
info(`${ver}; node-redis ${require('redis/package.json').version}`);

// streams
const K = 'a03:facts:balls';
await r.del(K);
for (let i = 1; i <= 4; i++) await r.xAdd(K, `170000000000${i}-0`, { n: String(i) });
await r.xGroupCreate(K, 'points', '0-0');
await r.xReadGroup('points', 'w2', { key: K, id: '>' }, { COUNT: 3 });
const ext = await r.xPendingRange(K, 'points', '-', '+', 10);
say(ext.length === 3 && ['id', 'consumer', 'millisecondsSinceLastDelivery', 'deliveriesCounter'].every((k) => k in ext[0]) && ext[0].deliveriesCounter === 1,
  `XPENDING extended (xPendingRange) rows are { id, consumer, millisecondsSinceLastDelivery, deliveriesCounter }, first delivery counter 1: ${JSON.stringify(ext[0])}`);
const sum = await r.xPending(K, 'points');
say(sum.pending === 3 && sum.firstId === '1700000000001-0' && sum.consumers[0].name === 'w2',
  `XPENDING summary (xPending) is { pending, firstId, lastId, consumers: [{ name, deliveriesCounter }] }: ${JSON.stringify(sum)}`);
await r.xClaim(K, 'points', 'w2', 0, '1700000000001-0');
await r.xDel(K, '1700000000002-0');
const ac = await r.xAutoClaim(K, 'points', 'w1', 0, '0-0', { COUNT: 100 });
say(JSON.stringify(Object.keys(ac)) === '["nextId","messages","deletedMessages"]' && ac.nextId === '0-0'
  && ac.messages.length === 2 && ac.messages[0].id === '1700000000001-0' && ac.messages[0].message.n === '1'
  && JSON.stringify(ac.deletedMessages) === '["1700000000002-0"]',
  `XAUTOCLAIM (xAutoClaim) returns { nextId, messages: [{ id, message }], deletedMessages: [ids] }; the deleted pending entry shows in deletedMessages and is gone from the PEL: ${JSON.stringify(ac).slice(0, 220)}`);
const after = await r.xPendingRange(K, 'points', '-', '+', 10);
say(after.length === 2 && after[0].consumer === 'w1' && after[0].deliveriesCounter === 3 && after[1].deliveriesCounter === 2,
  `delivery counters after XREADGROUP + XCLAIM + XAUTOCLAIM: ${after.map((p) => `${p.id}=${p.deliveriesCounter}`).join(' ')} (each XCLAIM and each XAUTOCLAIM with bodies adds one)`);
await r.xAutoClaimJustId(K, 'points', 'w1', 0, '0-0');
const jid = await r.xPendingRange(K, 'points', '-', '+', 10);
say(jid[0].deliveriesCounter === 3, `XAUTOCLAIM JUSTID (xAutoClaimJustId) leaves the delivery counter alone (still ${jid[0].deliveriesCounter})`);
const raw = await r.sendCommand(['XAUTOCLAIM', K, 'points', 'w1', '0', '0-0', 'COUNT', '10']);
say(Array.isArray(raw) && raw.length === 3, `raw sendCommand XAUTOCLAIM is a 3-element array [nextId, entries, deletedIds]: ${JSON.stringify(raw).slice(0, 120)}`);
try { await r.xGroupCreate(K, 'points', '0-0'); say(false, 'XGROUP CREATE on an existing group should fail'); }
catch (e) { say(/^BUSYGROUP/.test(e.message), `XGROUP CREATE on an existing group rejects with ${JSON.stringify(e.message)} (name ${e.name})`); }
await r.del(K);

// BLMOVE and XREADGROUP BLOCK on the fail-fast learner client
const base = createClient({ url, disableOfflineQueue: true });
await base.connect();
const ctx = await shared.createLearnerDeps({ redisClient: base, dbPool: { query: async () => ({ rows: [] }) }, log: () => {} });
const dup = ctx.deps.redis.duplicate();
await dup.connect();
await r.del(['a03:facts:q', 'a03:facts:p']);
let t0 = Date.now();
let v;
try { v = await dup.blMove('a03:facts:q', 'a03:facts:p', 'RIGHT', 'LEFT', 3); } catch (e) { v = `ERR ${e.name}: ${e.message}`; }
let ms = Date.now() - t0;
say(v === null && ms >= 2800 && ms < 4500, `BLMOVE on a duplicate() of the fail-fast client waits its full 3 s on an empty list and answers null (${ms} ms): the 2 s command timeout exempts blocking commands`);
const bl = ctx.deps.redis.blMove('a03:facts:q', 'a03:facts:p', 'RIGHT', 'LEFT', 2);
await new Promise((x) => setTimeout(x, 100));
t0 = Date.now();
await ctx.deps.redis.get('a03:facts:nothing');
ms = Date.now() - t0;
await bl;
say(ms >= 1500, `a GET on the SHARED client waits behind a BLMOVE on the same client (${ms} ms of a 2 s block): blocking reads belong on a duplicate()`);
await r.del('a03:facts:xs');
await r.xAdd('a03:facts:xs', '*', { a: '1' });
await r.xGroupCreate('a03:facts:xs', 'g', '$');
t0 = Date.now();
const xr = await dup.xReadGroup('g', 'c', { key: 'a03:facts:xs', id: '>' }, { BLOCK: 2500, COUNT: 1 });
ms = Date.now() - t0;
say(xr === null && ms >= 2400, `XREADGROUP BLOCK 2500 on the fail-fast duplicate returns null after ${ms} ms (also exempt)`);
await r.del('a03:facts:xs');

// module commands: typed methods or sendCommand
const typed = {
  'redis.bf.reserve': () => r.bf.reserve('a03:facts:bf', 0.001, 1000),
  'redis.bf.add / mAdd / exists / mExists': async () => { await r.bf.add('a03:facts:bf', 'a'); await r.bf.mAdd('a03:facts:bf', ['b']); return [await r.bf.exists('a03:facts:bf', 'a'), await r.bf.exists('a03:facts:bf', 'zz'), ...(await r.bf.mExists('a03:facts:bf', ['b', 'zz']))]; },
  'redis.cf.reserve / add / exists / del': async () => { await r.cf.reserve('a03:facts:cf', 100); await r.cf.add('a03:facts:cf', 'x'); const e = await r.cf.exists('a03:facts:cf', 'x'); const d = await r.cf.del('a03:facts:cf', 'x'); return [e, d]; },
  'redis.tDigest.create / add / quantile': async () => { await r.tDigest.create('a03:facts:td'); await r.tDigest.add('a03:facts:td', [10, 20, 30, 40, 100]); return r.tDigest.quantile('a03:facts:td', [0.5, 0.99]); },
  'redis.topK.reserve / add / list': async () => { await r.topK.reserve('a03:facts:tk', 3); await r.topK.add('a03:facts:tk', ['p-028', 'p-028', 'p-101']); return r.topK.list('a03:facts:tk'); },
  'redis.ts.create / mAdd / range / info': async () => { await r.ts.create('a03:facts:ts', { RETENTION: 86400000, DUPLICATE_POLICY: 'SUM', LABELS: { kind: 'requests' } }); await r.ts.mAdd([{ key: 'a03:facts:ts', timestamp: 1000, value: 1 }, { key: 'a03:facts:ts', timestamp: 1000, value: 2 }]); const rg = await r.ts.range('a03:facts:ts', 0, 60000, { ALIGN: 0, AGGREGATION: { type: 'SUM', timeBucket: 60000 } }); const inf = await r.ts.info('a03:facts:ts'); return [rg, inf.retentionTime, inf.duplicatePolicy]; },
  'redis.json.set / get': async () => { await r.json.set('a03:facts:js', '$', { a: 1 }); return r.json.get('a03:facts:js'); },
  'redis.ft.info (missing index rejects)': async () => { try { await r.ft.info('a03:facts:noindex'); return 'no error'; } catch (e) { return e.message; } },
};
await r.del(['a03:facts:bf', 'a03:facts:cf', 'a03:facts:td', 'a03:facts:tk', 'a03:facts:ts', 'a03:facts:js']);
for (const [name, fn] of Object.entries(typed)) {
  try { const res = await fn(); say(true, `${name} is a typed method and works: ${JSON.stringify(res).slice(0, 150)}`); }
  catch (e) { say(false, `${name}: ${e.name}: ${e.message}`); }
}
const throughProxy = await ctx.deps.redis.bf.exists('a03:facts:bf', 'a');
say(throughProxy === true, 'the typed module methods also work through the learner client (counting proxy + fail-fast wrapper)');
say((await r.sendCommand(['BF.EXISTS', 'a03:facts:bf', 'a'])) === 1, 'sendCommand reaches the same commands with raw replies: BF.EXISTS answers the integer 1 where redis.bf.exists answers true');
const rawQ = await r.sendCommand(['TDIGEST.QUANTILE', 'a03:facts:td', '0.5']);
say(rawQ[0] === '30', `raw TDIGEST.QUANTILE answers strings (${JSON.stringify(rawQ)}) where the typed method answers numbers`);
const rawRange = await r.sendCommand(['TS.RANGE', 'a03:facts:ts', '-', '+']);
say(Array.isArray(rawRange[0]) && typeof rawRange[0][1] === 'string', `raw TS.RANGE answers [[timestamp, "value"]] (${JSON.stringify(rawRange)}) where redis.ts.range answers [{ timestamp, value }]`);

// TS.CREATE on an existing key, TS.MADD on a missing key
for (const [label, fn] of [
  ['TS.CREATE on an existing key', () => r.ts.create('a03:facts:ts', { RETENTION: 86400000 })],
  ['BF.RESERVE on an existing key', () => r.bf.reserve('a03:facts:bf', 0.001, 1000)],
]) {
  try { await fn(); say(false, `${label} should reject`); }
  catch (e) { say(true, `${label} rejects with ${JSON.stringify(e.message)} (name ${e.name})`); }
}
const madd = await r.ts.mAdd([{ key: 'a03:facts:missing-ts', timestamp: 1, value: 1 }]);
say(madd[0] instanceof Error, `TS.MADD on a missing key does NOT throw: the reply array holds an error for that item (${madd[0] && madd[0].message}); TS.MADD never creates keys`);
try { await r.tDigest.add('a03:facts:missing-td', [1]); say(false, 'TDIGEST.ADD on a missing key should reject'); }
catch (e) { say(true, `TDIGEST.ADD on a missing key rejects with ${JSON.stringify(e.message)}`); }
const del = await r.sendCommand(['SET', 'a03:facts:lock', 'tok']).then(() => r.sendCommand(['DELEX', 'a03:facts:lock', 'IFEQ', 'tok']));
say(del === 1, 'DELEX key IFEQ value works on this server (compare-and-delete in one command)');
await r.del(['a03:facts:bf', 'a03:facts:cf', 'a03:facts:td', 'a03:facts:tk', 'a03:facts:ts', 'a03:facts:js', 'a03:facts:q', 'a03:facts:p', 'a03:facts:lock']);
await dup.close().catch(() => {});
await ctx.close();
await base.close();
await r.close();
console.log(out.join('\n'));
NODE
)
printf '%s\n' "$FACTS_OUT" | grep -v '^\(PASS\|FAIL\|      \)' | head -20
printf '%s\n' "$FACTS_OUT" | grep '^\(PASS\|FAIL\|      \)'
if printf '%s\n' "$FACTS_OUT" | grep -q '^FAIL'; then FAILED=1; fi
if ! printf '%s\n' "$FACTS_OUT" | grep -q '^PASS'; then bad "the facts script printed nothing usable"; fi

section "docker compose -p $PROJECT up -d --build engine app proxy runner"
up_ok=""
for attempt in 1 2 3; do
  if DC up -d --build engine app proxy runner >"$TMPD/up.log" 2>&1; then up_ok=1; break; fi
  echo "compose up attempt $attempt failed:"; grep -E 'error|ERR|failed' "$TMPD/up.log" | head -6
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
wait_until seed 60 seeded && ok "app can read postgres" || die "app cannot read postgres"
set_slots '{"active":[]}' && ok "no slot active (all baselines)" || bad "PUT /api/slots []"
sleep 2.5

HANDLE=$(PSQL "SELECT handle FROM users WHERE id = 'u-000010'")
info "handle of seeded user u-000010 (for the Bloom level): $HANDLE"
[ -n "$HANDLE" ] && ok "u-000010 has handle $HANDLE" || die "could not read the handle of u-000010"

section "1. baseline streams: the legacy path processes and acks nothing"
RCLI DEL match:m-001:balls lb:match:m-001 >/dev/null
req POST /app/workers/points/consume '{"matchId":"m-001","consumer":"w1","count":5}'; expect_status "POST /app/workers/points/consume" 200
expect_js "result is { processed: [] }" 'j.ok===true&&Array.isArray(j.result.processed)&&j.result.processed.length===0'
expect_slot "points.consume=baseline"
[ "$(RCLI EXISTS match:m-001:balls)" = "0" ] && ok "nothing was added to Redis" || bad "match:m-001:balls exists after the baseline consume"
req POST /app/workers/points/sweep '{"matchId":"m-001","consumer":"w1"}'; expect_status "POST /app/workers/points/sweep" 200
expect_js "result is { reclaimed: [], deadLettered: [] }" 'j.result.reclaimed.length===0&&j.result.deadLettered.length===0'
req POST /app/workers/points/consume '{"consumer":"w1"}'; expect_status "consume without matchId" 400
req POST /app/workers/points/consume '{"matchId":"m","consumer":"w","count":101}'; expect_status "consume with count 101" 400

section "2. baseline job queue: the in-process Map (works on one instance, and that is the bug)"
req GET /app/jobs/stats; expect_status "GET /app/jobs/stats" 200
expect_js "stats has the five Redis counts at 0 and an inMemory object" 'j.pending===0&&j.processing===0&&j.completed===0&&j.failed===0&&j.delayed===0&&typeof j.inMemory==="object"'
req POST /app/jobs '{"payload":{"kind":"payout","userId":"u-000010","amount":50}}'; expect_status "POST /app/jobs" 201
JOB=$(js "$BODY" 'j.id'); expect_slot "jobs.enqueue=baseline"
[ "${#JOB}" = "16" ] && ok "job id is 16 hex characters: $JOB" || bad "job id: $JOB"
[ "$(RCLI LLEN queue:jobs:pending)" = "0" ] && ok "nothing in queue:jobs:pending (the job lives in this process's memory)" || bad "queue:jobs:pending is not empty"
req POST /app/jobs/claim '{"worker":"w1","timeoutMs":200}'; expect_status "POST /app/jobs/claim" 200
expect_js "claimed the job: id, payload, token, attempts 1" "j.job.id==='$JOB'&&j.job.payload.amount===50&&typeof j.job.token==='string'&&j.job.attempts===1"
TOK=$(js "$BODY" 'j.job.token')
req POST "/app/jobs/$JOB/complete" '{"token":"not-the-token"}'; expect_status "complete with a wrong token" 409
expect_js "409 body is not_owner" "j.error==='not_owner'"
req POST "/app/jobs/$JOB/complete" "{\"token\":\"$TOK\",\"result\":{\"ok\":true}}"; expect_status "complete with the right token" 200
req POST /app/jobs/claim '{"worker":"w1","timeoutMs":100}'
expect_js "an empty Map queue answers { job: null }" 'j.job===null'
req POST /app/jobs/reclaim '{}'; expect_js "reclaim moves nothing (0)" 'j.reclaimed===0'
req POST /app/jobs/schedule "{\"payload\":\"later\",\"runAtMs\":$(( $(date +%s) * 1000 + 100 ))}"; expect_status "POST /app/jobs/schedule" 201
req POST /app/jobs/promote '{}'; expect_js "promote moves nothing (0): the baseline uses a timer" 'j.promoted===0'
req GET /app/jobs/stats; expect_js "inMemory.completed is 1" 'j.inMemory.completed===1'
req POST /app/jobs '{}'; expect_status "enqueue without payload" 400
req POST /app/jobs "{\"payload\":\"$(head -c 5000 /dev/zero | tr '\0' 'x')\"}"; expect_status "enqueue with a payload over 4 KB" 400

section "3. baseline wallet: the same key credits twice (the double-credit bug)"
BAL0=$(PSQL "SELECT balance FROM wallets WHERE user_id = 'u-000010'")
req POST /app/wallets/u-000010/credit '{"amount":5,"key":"a03-dup"}'; expect_status "credit #1" 200
expect_js "credited: true, balance $((BAL0 + 5))" "j.credited===true&&j.balance===$((BAL0 + 5))"
expect_slot "wallet.credit=baseline"
req POST /app/wallets/u-000010/credit '{"amount":5,"key":"a03-dup"}'; expect_status "credit #2, same key" 200
expect_js "credited: true again, balance $((BAL0 + 10))" "j.credited===true&&j.balance===$((BAL0 + 10))"
BAL1=$(PSQL "SELECT balance FROM wallets WHERE user_id = 'u-000010'")
ROWS=$(PSQL "SELECT count(*) FROM wallet_transactions WHERE reason = 'contest_payout' AND ref = 'a03-dup'")
[ "$BAL1" = "$((BAL0 + 10))" ] && ok "psql: balance $BAL0 -> $BAL1 (credited twice: the bug)" || bad "psql balance $BAL0 -> $BAL1"
[ "$ROWS" = "2" ] && ok "psql: 2 ledger rows with ref a03-dup (reason contest_payout)" || bad "psql: $ROWS ledger rows for a03-dup"
PSQL "UPDATE wallets SET balance = $BAL0 WHERE user_id = 'u-000010'; DELETE FROM wallet_transactions WHERE ref = 'a03-dup'" >/dev/null
req POST /app/wallets/u-000010/credit '{"amount":0,"key":"k"}'; expect_status "credit with amount 0" 400

section "4. baseline contest slot: GET then DECR races (one slot, 50 parallel requests)"
MULTI=""
for try in 1 2 3; do
  RCLI SET contest:9001:slots 1 >/dev/null
  seq 1 50 | xargs -P 50 -I{} curl -s -m 60 -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data '{"userId":"u-{}"}' "$BASE/app/contests/9001/last-slot" > "$TMPD/slot$try.txt"
  W=$(count_lines "$TMPD/slot$try.txt" 200); F=$(count_lines "$TMPD/slot$try.txt" 409)
  info "try $try: 200 x $W, 409 x $F, counter now $(RCLI GET contest:9001:slots)"
  if [ "$W" -gt 1 ]; then MULTI=$try; break; fi
done
if [ -n "$MULTI" ]; then ok "more than one request got the last slot (try $MULTI): the check-then-act race reproduces"; else note "the race did NOT reproduce in 3 tries here (one winner each time); the baseline is still check-then-act"; fi
RCLI SET contest:9001:slots 1 >/dev/null
req POST /app/contests/9001/last-slot '{"userId":"u-1"}'; expect_status "a single request with one slot left" 200
req POST /app/contests/9001/last-slot '{"userId":"u-2"}'; expect_status "the next one" 409
expect_js "409 body is contest_full" "j.error==='contest_full'"
req POST /app/contests/9001/last-slot '{}'; expect_status "last-slot without userId" 400

section "5. baseline expire-batch: one EXPIRE per key, the same TTL for all (the storm)"
RCLI EVAL "for i=1,50 do redis.call('SET', 'storm:'..i, 'x') end return 1" 0 >/dev/null
KEYS_JSON=$(node -e 'console.log(JSON.stringify(Array.from({length:50},(_, i)=>"storm:"+(i+1))))')
req POST /app/ops/expire-batch "{\"keys\":$KEYS_JSON,\"baseSeconds\":600,\"jitterSeconds\":120}"; expect_status "POST /app/ops/expire-batch" 200
expect_js "expired: 50" 'j.expired===50'
expect_slot "sessions.expireWithJitter=baseline"
PT=$(RCLI EVAL "local lo, hi = 1e12, 0 for i=1,50 do local t = redis.call('PTTL', 'storm:'..i) if t < lo then lo = t end if t > hi then hi = t end end return {lo, hi}" 0 | tr '\n' ' ')
PLO=$(printf '%s' "$PT" | cut -d' ' -f1); PHI=$(printf '%s' "$PT" | cut -d' ' -f2)
info "PTTL of the 50 keys: min $PLO ms, max $PHI ms (spread $((PHI - PLO)) ms: the time the loop took)"
[ "$PLO" -ge 599000 ] && [ "$PHI" -le 600000 ] && [ $((PHI - PLO)) -lt 1000 ] && ok "every key got the same TTL (600 s, PTTL spread under 1 s)" || bad "PTTLs: $PLO..$PHI"
req POST /app/ops/expire-batch '{"keys":["game:x"],"baseSeconds":10,"jitterSeconds":0}'; expect_status "a key under game:* is refused" 400
req POST /app/ops/expire-batch '{"keys":[],"baseSeconds":10,"jitterSeconds":0}'; expect_status "no keys" 400

section "6. baseline username check: Postgres every time"
req GET "/app/usernames/$HANDLE"; expect_status "GET /app/usernames/$HANDLE" 200
expect_js "taken: true, checkedDb: true" "j.name==='$HANDLE'&&j.taken===true&&j.checkedDb===true"
expect_slot "users.usernameTaken=baseline"
req GET /app/usernames/nobody.has.this.name; expect_js "unknown name: taken false, checkedDb true (a query for nothing)" 'j.taken===false&&j.checkedDb===true'

section "7. baseline ops wall: the hook has nothing to call, the wall is empty"
req POST /app/ops/samples '{"route":"GET /app/players/:id","status":200,"ms":12.5}'; expect_status "POST /app/ops/samples" 200
expect_js "{ ok: true }" 'j.ok===true'
req GET '/app/ops/wall?route=GET%20/app/players/:id'; expect_status "GET /app/ops/wall" 200
expect_js "{ route, buckets: [] }" 'j.route==="GET /app/players/:id"&&Array.isArray(j.buckets)&&j.buckets.length===0'
req GET '/app/ops/wall'; expect_status "wall without a route" 400
[ "$(RCLI EXISTS ts:requests:GET_app_players_:id)" = "0" ] && ok "no time series exists: the baseline never touches Redis" || bad "a ts:requests key exists with the baseline active"

section "8. learner path: the fifteen reference fixtures, activated through PUT /api/slots"
for f in $SLOT_FILES; do install_fixture "$f"; done
ok "copied the fixtures to workspace/ch4/ ($SLOT_FILES)"
RCLI FLUSHALL >/dev/null

echo "-- streams: six balls, w1 then w2"
activate "points.consume points.sweep"
for i in 1 2 3 4 5 6; do RCLI XADD match:m-041:balls "170000000000$i-0" over 1 ball "$i" batter p-028 runs "$i" >/dev/null; done
req POST /app/workers/points/consume '{"matchId":"m-041","consumer":"w1","count":3}'; expect_status "consume as w1 (count 3)" 200
expect_js "w1 processed the first three ids in order" 'JSON.stringify(j.result.processed)==="[\"1700000000001-0\",\"1700000000002-0\",\"1700000000003-0\"]"'
expect_slot "points.consume=learner"
req POST /app/workers/points/consume '{"matchId":"m-041","consumer":"w2","count":3}'
expect_js "w2 processed the other three" 'JSON.stringify(j.result.processed)==="[\"1700000000004-0\",\"1700000000005-0\",\"1700000000006-0\"]"'
[ "$(RCLI XPENDING match:m-041:balls points | head -1)" = "0" ] && ok "XPENDING: 0 (every ball acked)" || bad "XPENDING is $(RCLI XPENDING match:m-041:balls points | head -1)"
[ "$(RCLI ZSCORE lb:match:m-041 p-028)" = "21" ] && ok "ZSCORE lb:match:m-041 p-028 = 21 (1+2+...+6, each ball once)" || bad "ZSCORE is $(RCLI ZSCORE lb:match:m-041 p-028)"
for i in 7 8 9; do RCLI XADD match:m-041:balls "170000000000$i-0" over 2 ball 1 batter p-028 runs 1 >/dev/null; done
RCLI XREADGROUP GROUP points w2 COUNT 3 STREAMS match:m-041:balls '>' >/dev/null
[ "$(RCLI XPENDING match:m-041:balls points | head -1)" = "3" ] && ok "w2 read three balls and never acked (XPENDING 3)" || bad "XPENDING is $(RCLI XPENDING match:m-041:balls points | head -1)"
req POST /app/workers/points/sweep '{"matchId":"m-041","consumer":"w1","minIdleMs":0}'; expect_status "sweep as w1 with minIdleMs 0" 200
expect_js "reclaimed the three ids, nothing dead-lettered" 'JSON.stringify(j.result)==="{\"reclaimed\":[\"1700000000007-0\",\"1700000000008-0\",\"1700000000009-0\"],\"deadLettered\":[]}"'
[ "$(RCLI XPENDING match:m-041:balls points | head -1)" = "0" ] && ok "XPENDING back to 0" || bad "XPENDING is $(RCLI XPENDING match:m-041:balls points | head -1)"
RCLI XADD match:m-041:balls 1700000000010-0 over 2 ball 2 batter p-028 runs x >/dev/null
RCLI XREADGROUP GROUP points w2 COUNT 1 STREAMS match:m-041:balls '>' >/dev/null
for i in 1 2 3 4; do RCLI XCLAIM match:m-041:balls points w2 0 1700000000010-0 >/dev/null; done
req POST /app/workers/points/sweep '{"matchId":"m-041","consumer":"w1","minIdleMs":0,"maxDeliveries":5}'
expect_js "a poison ball claimed five times is dead-lettered, not reclaimed" 'JSON.stringify(j.result)==="{\"reclaimed\":[],\"deadLettered\":[\"1700000000010-0\"]}"'
[ "$(RCLI XLEN match:m-041:balls:dead)" = "1" ] && ok "XLEN match:m-041:balls:dead = 1" || bad "dead letter length $(RCLI XLEN match:m-041:balls:dead)"
[ "$(RCLI XPENDING match:m-041:balls points | head -1)" = "0" ] && ok "the original was acked (XPENDING 0)" || bad "XPENDING is $(RCLI XPENDING match:m-041:balls points | head -1)"
RCLI XRANGE match:m-041:balls:dead - + | tr '\n' ' ' | grep -q 'max-deliveries' && ok "the dead letter carries reason max-deliveries" || bad "dead letter has no reason"

echo "-- job queue: 20 jobs, two workers claiming in parallel"
activate "jobs.enqueue jobs.claim jobs.complete jobs.fail jobs.reclaim jobs.schedule jobs.promoteDue"
seq 1 20 | xargs -P 10 -I{} curl -s -m 30 -o /dev/null -X POST -H 'content-type: application/json' --data '{"payload":{"n":{}}}' "$BASE/app/jobs"
[ "$(RCLI LLEN queue:jobs:pending)" = "20" ] && ok "LLEN queue:jobs:pending = 20" || bad "pending is $(RCLI LLEN queue:jobs:pending)"
req GET /app/jobs/stats; expect_js "stats: pending 20" 'j.pending===20&&j.processing===0'
claimer() { # claimer WORKER OUTFILE : claim until the queue is empty, one "id token" line per job
  local w=$1 out=$2 r pair
  : > "$out"
  while :; do
    r=$(curl -s -m 20 -X POST -H 'content-type: application/json' --data "{\"worker\":\"$w\",\"timeoutMs\":400}" "$BASE/app/jobs/claim")
    pair=$(printf '%s' "$r" | sed -n 's/.*"job":{"id":"\([0-9a-f]*\)".*"token":"\([0-9a-f]*\)".*/\1 \2/p')
    [ -z "$pair" ] && break
    printf '%s\n' "$pair" >> "$out"
  done
}
claimer w1 "$TMPD/c1.txt" & P1=$!
claimer w2 "$TMPD/c2.txt" & P2=$!
wait $P1 $P2
N1=$(grep -c . "$TMPD/c1.txt"); N2=$(grep -c . "$TMPD/c2.txt")
cat "$TMPD/c1.txt" "$TMPD/c2.txt" > "$TMPD/claims.txt"
DISTINCT=$(cut -d' ' -f1 "$TMPD/claims.txt" | sort -u | grep -c .)
info "w1 claimed $N1, w2 claimed $N2"
[ "$DISTINCT" = "20" ] && ok "20 distinct job ids claimed across two workers" || bad "distinct ids claimed: $DISTINCT (w1 $N1, w2 $N2)"
[ "$N1" -gt 0 ] && [ "$N2" -gt 0 ] && ok "both workers got work" || note "one worker got every job ($N1 / $N2)"
[ "$(RCLI LLEN queue:jobs:processing)" = "20" ] && [ "$(RCLI LLEN queue:jobs:pending)" = "0" ] && ok "LLEN processing 20, pending 0" || bad "processing $(RCLI LLEN queue:jobs:processing), pending $(RCLI LLEN queue:jobs:pending)"
FIRST_ID=$(sed -n 1p "$TMPD/claims.txt" | cut -d' ' -f1); FIRST_TOK=$(sed -n 1p "$TMPD/claims.txt" | cut -d' ' -f2)
[ "$(RCLI HGET "queue:jobs:job:$FIRST_ID" status)" = "processing" ] && [ "$(RCLI HGET "queue:jobs:job:$FIRST_ID" claim_token)" = "$FIRST_TOK" ] && ok "job hash: status processing, claim_token = the token handed out" || bad "job hash does not match the claim"
req POST "/app/jobs/$FIRST_ID/complete" '{"token":"stale-token"}'; expect_status "a stale token cannot complete" 409
expect_js "409 body is not_owner" "j.error==='not_owner'"
completed=0
while read -r id tok; do
  cbody="{\"token\":\"$tok\",\"result\":{\"ok\":true}}"
  code=$(post_json "/app/jobs/$id/complete" "$cbody")
  if [ "$code" = "200" ]; then completed=$((completed + 1)); else info "complete $id -> $code"; fi
done < "$TMPD/claims.txt"
[ "$completed" = "20" ] && ok "all 20 completed with their own tokens" || bad "completed $completed of 20"
[ "$(RCLI LLEN queue:jobs:completed)" = "20" ] && [ "$(RCLI LLEN queue:jobs:processing)" = "0" ] && ok "LLEN completed 20, processing 0" || bad "completed $(RCLI LLEN queue:jobs:completed), processing $(RCLI LLEN queue:jobs:processing)"
req POST "/app/jobs/$FIRST_ID/complete" "{\"token\":\"$FIRST_TOK\"}"; expect_status "completing the same job a second time" 409
[ "$(RCLI HGET "queue:jobs:job:$FIRST_ID" status)" = "completed" ] && ok "HGET status = completed" || bad "status is $(RCLI HGET "queue:jobs:job:$FIRST_ID" status)"

echo "-- fail: retry, then failed"
req POST /app/jobs '{"payload":"flaky"}'; FJ=$(js "$BODY" 'j.id')
req POST /app/jobs/claim '{"worker":"w1","timeoutMs":400}'; FT=$(js "$BODY" 'j.job.token')
req POST "/app/jobs/$FJ/fail" "{\"token\":\"$FT\",\"error\":\"boom\",\"maxAttempts\":2}"
expect_js "first failure: retry" 'j.outcome==="retry"'
[ "$(RCLI LLEN queue:jobs:pending)" = "1" ] && ok "the job is back in pending" || bad "pending is $(RCLI LLEN queue:jobs:pending)"
req POST "/app/jobs/$FJ/fail" "{\"token\":\"$FT\",\"error\":\"boom\",\"maxAttempts\":2}"; expect_status "the dead claim cannot fail it again" 409
req POST /app/jobs/claim '{"worker":"w1","timeoutMs":400}'; FT=$(js "$BODY" 'j.job.token')
expect_js "second claim: attempts 2" 'j.job.attempts===2'
req POST "/app/jobs/$FJ/fail" "{\"token\":\"$FT\",\"error\":\"boom\",\"maxAttempts\":2}"
expect_js "second failure: failed" 'j.outcome==="failed"'
[ "$(RCLI LLEN queue:jobs:failed)" = "1" ] && ok "LLEN queue:jobs:failed = 1" || bad "failed is $(RCLI LLEN queue:jobs:failed)"

echo "-- reclaim: a job left in processing with an old claimed_at_ms"
req POST /app/jobs '{"payload":"abandoned"}'; LOST=$(js "$BODY" 'j.id')
req POST /app/jobs/claim '{"worker":"dead-worker","timeoutMs":400}'; LOST_TOK=$(js "$BODY" 'j.job.token')
req POST /app/jobs/reclaim '{"visibilityMs":5000}'; expect_js "a fresh claim is not reclaimed (0)" 'j.reclaimed===0'
RCLI HSET "queue:jobs:job:$LOST" claimed_at_ms "$(( $(date +%s) * 1000 - 60000 ))" >/dev/null
req POST /app/jobs/reclaim '{"visibilityMs":5000}'; expect_js "the old claim is moved back (1)" 'j.reclaimed===1'
[ "$(RCLI LLEN queue:jobs:pending)" = "1" ] && [ "$(RCLI LLEN queue:jobs:processing)" = "0" ] && ok "pending 1, processing 0" || bad "pending $(RCLI LLEN queue:jobs:pending), processing $(RCLI LLEN queue:jobs:processing)"
req POST "/app/jobs/$LOST/complete" "{\"token\":\"$LOST_TOK\"}"; expect_status "the worker that lost it can no longer complete it" 409
req POST /app/jobs/claim '{"worker":"w2","timeoutMs":400}'
expect_js "another worker claims it: attempts 2" "j.job.id==='$LOST'&&j.job.attempts===2"

echo "-- delayed jobs: schedule in the past, promote"
req POST /app/jobs/schedule '{"payload":"due","runAtMs":1}'; expect_status "schedule runAtMs 1" 201; DUE=$(js "$BODY" 'j.id')
req POST /app/jobs/schedule '{"payload":"later","runAtMs":9999999999999}'; expect_status "schedule far in the future" 201
[ "$(RCLI ZCARD queue:jobs:delayed)" = "2" ] && ok "ZCARD queue:jobs:delayed = 2" || bad "delayed is $(RCLI ZCARD queue:jobs:delayed)"
req GET /app/jobs/stats; expect_js "stats: delayed 2" 'j.delayed===2'
P0=$(RCLI LLEN queue:jobs:pending)
req POST /app/jobs/promote '{}'; expect_js "promote moves exactly the due one" 'j.promoted===1'
[ "$(RCLI ZCARD queue:jobs:delayed)" = "1" ] && [ "$(RCLI LLEN queue:jobs:pending)" = "$((P0 + 1))" ] && ok "delayed 1, pending $((P0 + 1))" || bad "delayed $(RCLI ZCARD queue:jobs:delayed), pending $(RCLI LLEN queue:jobs:pending)"
[ "$(RCLI HGET "queue:jobs:job:$DUE" status)" = "pending" ] && ok "the promoted job's hash says pending" || bad "status is $(RCLI HGET "queue:jobs:job:$DUE" status)"
echo "-- an empty queue: claim waits out timeoutMs (BLMOVE on a duplicate) and answers null"
while [ "$(RCLI LLEN queue:jobs:pending)" != "0" ]; do curl -s -m 10 -o /dev/null -X POST -H 'content-type: application/json' --data '{"worker":"drain","timeoutMs":200}' "$BASE/app/jobs/claim"; done
req POST /app/jobs/claim '{"worker":"w1","timeoutMs":1500}'
expect_js "{ job: null }" 'j.job===null'
[ "${MS%.*}" -ge 1400 ] && ok "the empty claim took ${MS} ms (>= 1400): it blocked for its timeout" || bad "the empty claim returned after ${MS} ms"
req POST /app/jobs/claim '{"worker":"w1","timeoutMs":0}'
expect_js "timeoutMs 0 on an empty queue answers { job: null } at once (LMOVE, not a blocking BLMOVE 0)" 'j.job===null'
[ "${MS%.*}" -lt 700 ] && ok "timeoutMs 0 took ${MS} ms (no block)" || bad "timeoutMs 0 took ${MS} ms"
req POST /app/jobs '{"payload":"zero"}'
req POST /app/jobs/claim '{"worker":"w1","timeoutMs":0}'
expect_js "timeoutMs 0 with a job waiting claims it" 'j.job!==null&&j.job.payload==="zero"'

echo "-- wallet.credit with the idempotency key"
activate "wallet.credit"
RCLI SET wallet:u-000010 100 >/dev/null
req POST /app/wallets/u-000010/credit '{"amount":50,"key":"payout-m-041-u-000010"}'
expect_js "first call: credited true, balance 150" 'j.credited===true&&j.balance===150'
expect_slot "wallet.credit=learner"
req POST /app/wallets/u-000010/credit '{"amount":50,"key":"payout-m-041-u-000010"}'
expect_js "same key: credited false, balance 150" 'j.credited===false&&j.balance===150'
[ "$(RCLI GET wallet:u-000010)" = "150" ] && ok "GET wallet:u-000010 = 150" || bad "wallet is $(RCLI GET wallet:u-000010)"
TTL=$(RCLI TTL idem:payout-m-041-u-000010)
[ "$TTL" -ge 1 ] && [ "$TTL" -le 86400 ] && ok "TTL of the idempotency key: $TTL s (<= 86400)" || bad "idem TTL $TTL"
seq 1 20 | xargs -P 20 -I{} curl -s -m 30 -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data '{"amount":10,"key":"par-key"}' "$BASE/app/wallets/u-000011/credit" > "$TMPD/par.txt"
[ "$(RCLI GET wallet:u-000011)" = "10" ] && ok "20 parallel credits with one key: wallet:u-000011 = 10 (credited once)" || bad "wallet:u-000011 = $(RCLI GET wallet:u-000011)"
PSQL "SELECT count(*) FROM wallet_transactions WHERE ref = 'payout-m-041-u-000010'" | grep -q '^0$' && ok "Postgres is not touched by the learner's version" || bad "the ledger changed"

echo "-- contest lock: one slot, 50 parallel requests"
activate "contest.claimLastSlot"
RCLI SET contest:9001:slots 1 >/dev/null; RCLI DEL contest:9001:members lock:contest:9001 >/dev/null
seq 1 50 | xargs -P 50 -I{} curl -s -m 60 -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data '{"userId":"u-{}"}' "$BASE/app/contests/9001/last-slot" > "$TMPD/lock.txt"
W=$(count_lines "$TMPD/lock.txt" 200); F=$(count_lines "$TMPD/lock.txt" 409)
info "200 x $W, 409 x $F"
[ "$W" = "1" ] && [ "$F" = "49" ] && ok "exactly one 200 and 49 contest_full" || bad "200 x $W, 409 x $F"
[ "$(RCLI GET contest:9001:slots)" = "0" ] && ok "contest:9001:slots = 0" || bad "slots is $(RCLI GET contest:9001:slots)"
[ "$(RCLI SCARD contest:9001:members)" = "1" ] && ok "contest:9001:members has the one winner" || bad "members $(RCLI SCARD contest:9001:members)"
[ "$(RCLI EXISTS lock:contest:9001)" = "0" ] && ok "the lock was released" || bad "lock:contest:9001 still exists"

echo "-- TTL jitter: 200 keys, base 600, jitter 60"
activate "sessions.expireWithJitter"
RCLI EVAL "for i=1,200 do redis.call('SET', 'storm:'..i, 'x') end return 1" 0 >/dev/null
KEYS_JSON=$(node -e 'console.log(JSON.stringify(Array.from({length:200},(_, i)=>"storm:"+(i+1))))')
req POST /app/ops/expire-batch "{\"keys\":$KEYS_JSON,\"baseSeconds\":600,\"jitterSeconds\":60}"
expect_js "expired: 200" 'j.expired===200'
expect_slot "sessions.expireWithJitter=learner"
TT=$(RCLI EVAL "local lo, hi = 1e9, 0 for i=1,200 do local t = redis.call('TTL', 'storm:'..i) if t < lo then lo = t end if t > hi then hi = t end end return {lo, hi}" 0 | tr '\n' ' ')
LO=$(printf '%s' "$TT" | cut -d' ' -f1); HI=$(printf '%s' "$TT" | cut -d' ' -f2)
info "min TTL $LO, max TTL $HI, spread $((HI - LO))"
[ "$LO" -ge 599 ] && [ "$HI" -le 660 ] && [ $((HI - LO)) -ge 30 ] && ok "TTLs lie in 599..660 with a spread of $((HI - LO)) s (>= 30)" || bad "TTL range $LO..$HI"

echo "-- Bloom username check"
activate "users.usernameTaken"
RCLI DEL bf:usernames >/dev/null
RCLI BF.RESERVE bf:usernames 0.001 100000 >/dev/null
RCLI BF.MADD bf:usernames "$HANDLE" quest.ghost99 >/dev/null
req GET "/app/usernames/$HANDLE"
expect_js "in the filter and in Postgres: taken, checkedDb true" 'j.taken===true&&j.checkedDb===true'
expect_slot "users.usernameTaken=learner"
req GET /app/usernames/quest.ghost99
expect_js "in the filter, not in Postgres (a false positive): taken false, checkedDb true" 'j.taken===false&&j.checkedDb===true'
req GET /app/usernames/nobody.has.this.name
expect_js "not in the filter: taken false, checkedDb false (no query)" 'j.taken===false&&j.checkedDb===false'

echo "-- ops wall: record and range"
activate "ops.record ops.range"
req POST /app/ops/samples '{"route":"GET /app/check/route","status":200,"ms":10,"at":60000}'; expect_status "sample 1" 200
req POST /app/ops/samples '{"route":"GET /app/check/route","status":200,"ms":30,"at":60500}' >/dev/null
req POST /app/ops/samples '{"route":"GET /app/check/route","status":500,"ms":50,"at":61000}' >/dev/null
req POST /app/ops/samples '{"route":"GET /app/check/route","status":200,"ms":20,"at":125000}' >/dev/null
req GET '/app/ops/wall?route=GET%20/app/check/route&from=0&to=180000&bucket=60000'; expect_status "GET /app/ops/wall" 200
expect_js "two buckets: [60000: 3 requests, 1 error, avg 30] [120000: 1 request, 0 errors, avg 20]" 'JSON.stringify(j.buckets)==="[{\"at\":60000,\"requests\":3,\"errors\":1,\"avgMs\":30},{\"at\":120000,\"requests\":1,\"errors\":0,\"avgMs\":20}]"'
expect_slot "ops.range=learner"
[ "$(RCLI EXISTS ts:requests:GET_app_check_route)" = "1" ] && ok "key rule: ts:requests:GET_app_check_route exists (spaces and slashes collapse to _)" || bad "ts:requests:GET_app_check_route is missing"
[ "$(RCLI TS.INFO ts:requests:GET_app_check_route | tr '\n' ' ' | grep -c 'retentionTime 86400000')" = "1" ] && ok "TS.INFO: retentionTime 86400000" || bad "retention is not 86400000"

echo "-- the provided hook: 30 requests to /app/players/p-028 feed ops.record"
RCLI DEL ts:requests:GET_app_players_:id ts:errors:GET_app_players_:id ts:latency:GET_app_players_:id >/dev/null
seq 1 30 | xargs -P 1 -I{} curl -s -m 30 -o /dev/null "$BASE/app/players/p-028"
hook_sum() { [ "$(RCLI TS.RANGE ts:requests:GET_app_players_:id - + | awk 'NR % 2 == 0 { s += $1 } END { print s + 0 }')" = "30" ]; }
wait_until hook 10 hook_sum && ok "TS.RANGE ts:requests:GET_app_players_:id - + sums to 30 (one sample per request)" || bad "hook samples: $(RCLI TS.RANGE ts:requests:GET_app_players_:id - + | tr '\n' ' ' | head -c 300)"
req GET '/app/ops/wall?route=GET%20/app/players/:id&bucket=60000'
expect_js "the wall shows 30 requests, 0 errors" 'j.buckets.reduce((s,b)=>s+b.requests,0)===30&&j.buckets.reduce((s,b)=>s+b.errors,0)===0'
[ "$(RCLI EXISTS ts:requests:GET_app_ops_wall)" = "0" ] && ok "the wall's own reads are not recorded" || bad "ts:requests:GET_app_ops_wall exists"
req GET /app/metrics
expect_js "the hook adds no Redis commands to the request's own counters (players route redisCommands 0)" 'j.totals["GET /app/players/:id"].redisCommands===0'

section "9. the same modules on the runner path (a fresh child process per call, createLearnerDeps; this is what behavior verifiers use)"
runner_run() { # runner_run MODULE CALLS_JSON CONCURRENCY : prints the runner's JSON answer
  RUN_PAYLOAD="{\"module\":\"$1\",\"calls\":$2,\"concurrency\":$3,\"timeoutMs\":20000}" DC exec -T -e RUN_PAYLOAD runner node -e '
(async () => {
  const r = await fetch("http://127.0.0.1:4100/run", { method: "POST", headers: { "content-type": "application/json" }, body: process.env.RUN_PAYLOAD });
  console.log(JSON.stringify(await r.json()));
})().catch((e) => { console.log(JSON.stringify({ error: String(e) })); });
' 2>&1 | tail -1
}
RCLI FLUSHALL >/dev/null
CALLS20=$(node -e 'console.log(JSON.stringify(Array.from({length:20},()=>({args:["u-000012",10,"runner-key"]}))))')
OUT=$(runner_run ch4/wallet-credit.js "$CALLS20" 20)
[ "$(js "$OUT" 'j.results.filter(r=>r.ok&&r.value.credited===true).length')" = "1" ] && [ "$(js "$OUT" 'j.results.filter(r=>!r.ok).length')" = "0" ] && ok "runner: 20 concurrent wallet.credit with one key -> exactly one credited:true, no errors" || bad "runner wallet.credit: $(printf '%s' "$OUT" | head -c 300)"
[ "$(RCLI GET wallet:u-000012)" = "10" ] && ok "runner: wallet:u-000012 = 10" || bad "wallet:u-000012 = $(RCLI GET wallet:u-000012)"
OUT=$(runner_run ch4/jobs-claim.js '[{"args":["w1",600]}]' 1)
[ "$(js "$OUT" 'j.results[0].ok===true&&j.results[0].value===null')" = "true" ] && ok "runner: jobs.claim on an empty queue (BLMOVE 600 ms on a duplicate) -> null, no error ($(js "$OUT" 'j.results[0].ms') ms)" || bad "runner jobs.claim: $(printf '%s' "$OUT" | head -c 300)"
OUT=$(runner_run ch4/jobs-enqueue.js '[{"args":[{"kind":"payout","amount":50}]}]' 1)
RJ=$(js "$OUT" 'j.results[0].value')
[ "${#RJ}" = "16" ] && ok "runner: jobs.enqueue -> id $RJ" || bad "runner jobs.enqueue: $(printf '%s' "$OUT" | head -c 300)"
OUT=$(runner_run ch4/jobs-claim.js '[{"args":["w1",600]}]' 1)
[ "$(js "$OUT" "j.results[0].value.id==='$RJ'&&j.results[0].value.payload.amount===50&&j.results[0].value.attempts===1")" = "true" ] && ok "runner: jobs.claim returns that job (payload, token, attempts 1)" || bad "runner jobs.claim: $(printf '%s' "$OUT" | head -c 300)"
NAMES_JSON="[{\"args\":[\"$HANDLE\"]},{\"args\":[\"quest.ghost99\"]},{\"args\":[\"nobody.has.this.name\"]}]"
OUT=$(runner_run ch4/username-taken.js "$NAMES_JSON" 1)
[ "$(js "$OUT" 'JSON.stringify(j.results.map(r=>r.value))')" = '[{"taken":false,"checkedDb":false},{"taken":false,"checkedDb":false},{"taken":false,"checkedDb":false}]' ] && ok "runner: with NO filter key BF.EXISTS answers 0 (no error), so even a real handle comes back taken:false, checkedDb:false (a missing filter looks like an empty one)" || bad "runner username without a filter: $(printf '%s' "$OUT" | head -c 400)"
RCLI BF.RESERVE bf:usernames 0.001 100000 >/dev/null
RCLI BF.MADD bf:usernames "$HANDLE" quest.ghost99 >/dev/null
OUT=$(runner_run ch4/username-taken.js "$NAMES_JSON" 1)
[ "$(js "$OUT" 'JSON.stringify(j.results.map(r=>r.value))')" = '[{"taken":true,"checkedDb":true},{"taken":false,"checkedDb":true},{"taken":false,"checkedDb":false}]' ] && ok "runner: users.usernameTaken (Bloom module and Postgres both reachable)" || bad "runner username: $(printf '%s' "$OUT" | head -c 400)"
RCLI SET contest:9001:slots 1 >/dev/null; RCLI DEL contest:9001:members lock:contest:9001 >/dev/null
CALLS20=$(node -e 'console.log(JSON.stringify(Array.from({length:20},(_, i)=>({args:[9001,"u-"+i]}))))')
OUT=$(runner_run ch4/contest-last-slot.js "$CALLS20" 20)
[ "$(js "$OUT" 'j.results.filter(r=>r.ok&&r.value===true).length')" = "1" ] && [ "$(js "$OUT" 'j.results.filter(r=>!r.ok).length')" = "0" ] && ok "runner: 20 concurrent contest.claimLastSlot for one slot -> exactly one true" || bad "runner lock: $(printf '%s' "$OUT" | head -c 300)"
for i in 1 2 3 4 5 6; do RCLI XADD match:m-043:balls "170000000000$i-0" over 1 ball "$i" batter p-028 runs 2 >/dev/null; done
OUT=$(runner_run ch4/points-consume.js '[{"args":["m-043","w1",3]},{"args":["m-043","w2",3]}]' 1)
[ "$(js "$OUT" 'j.results.map(r=>r.value.processed.length).join()')" = "3,3" ] && [ "$(RCLI XPENDING match:m-043:balls points | head -1)" = "0" ] && ok "runner: points.consume as w1 then w2 -> 3 and 3, XPENDING 0" || bad "runner consume: $(printf '%s' "$OUT" | head -c 300)"
OUT=$(runner_run ch4/ops-record.js '[{"args":[{"route":"GET /app/runner/route","status":200,"ms":10,"at":60000}]},{"args":[{"route":"GET /app/runner/route","status":500,"ms":30,"at":61000}]}]' 1)
[ "$(js "$OUT" 'j.results.filter(r=>r.ok).length')" = "2" ] && ok "runner: ops.record x2" || bad "runner ops.record: $(printf '%s' "$OUT" | head -c 300)"
OUT=$(runner_run ch4/ops-range.js '[{"args":["GET /app/runner/route",0,120000,60000]}]' 1)
[ "$(js "$OUT" 'JSON.stringify(j.results[0].value.buckets)')" = '[{"at":60000,"requests":2,"errors":1,"avgMs":20}]' ] && ok "runner: ops.range -> one bucket, 2 requests, 1 error, avg 20" || bad "runner ops.range: $(printf '%s' "$OUT" | head -c 300)"
