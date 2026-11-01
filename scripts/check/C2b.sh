#!/usr/bin/env bash
# C2b acceptance: Chapter 2, levels 2.5 to 2.11 (files 05 to 13: the three interview rebuilds 11a-c are files 11, 12, 13).
# Static part: the chapter validates with 13 levels, chapter.yaml lists every level in order, every solution and
# fixture exists and parses, every solution module is valid JavaScript with the exports its level needs, the spec's
# "follow the 2.2 rule" holds in each level's verify list, the three new scenarios parse with the engine's own parser.
# Local proof part (skipped with a note when redis-server is not on the PATH): starts a throwaway redis-server on a free
# port and runs the engine's own behavior, antipattern and redis evaluators against every reference and wrong solution
# with a fake Postgres, then compares the verdict with the declared one. Needs no Docker. Traffic, event and quiz
# verifiers are not run here: the orchestrator's live grading (scripts/grade/grade.sh) covers those.
# bash 3.2 compatible: no associative arrays, no mapfile.
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
CH="levels/ch2-everyone-showed-up"
FAILS=0
TMP=$(mktemp -d "${TMPDIR:-/tmp}/c2b.XXXXXX")
REDIS_PID_PORT=""

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILS=$((FAILS + 1)); }
step() { echo; echo "== $1"; }

cleanup() {
  if [ -n "$REDIS_PID_PORT" ]; then redis-cli -p "$REDIS_PID_PORT" shutdown nosave >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

step "build @quest/shared"
pnpm --filter @quest/shared build >/dev/null 2>&1 && pass "build" || { fail "build"; exit 1; }

step "validate $CH"
OUT=$(pnpm --silent --filter @quest/shared levels:validate "$CH" 2>&1); RC=$?
if [ $RC -eq 0 ]; then pass "$OUT"; else fail "validate (exit $RC)"; echo "$OUT"; fi
case "$OUT" in *"13 level(s)"*) pass "13 levels (2.1 to 2.11 with 11a, 11b, 11c as three files)";; *) fail "expected 13 levels in the chapter";; esac

step "chapter.yaml"
if sed -n 's/^id: *//p' "$CH/chapter.yaml" | head -n 1 | grep -qx 'ch2'; then pass "chapter id ch2"; else fail "chapter id is not ch2"; fi
LISTED=$(grep -E '^  - ch2-' "$CH/chapter.yaml" | wc -l | tr -d ' ')
[ "$LISTED" -eq 13 ] && pass "chapter lists exactly 13 levels" || fail "chapter lists $LISTED levels, want 13"
ORDER=$(grep -E '^  - ch2-' "$CH/chapter.yaml" | sed -E 's/^  - //' | tr '\n' ' ')
WANT="ch2-01-feel-it ch2-02-cache-aside-v1 ch2-03-stale-is-a-bug ch2-04-stampede-at-the-toss ch2-05-the-player-who-does-not-exist ch2-06-hit-ratio-is-the-number ch2-07-fixtures-must-never-miss ch2-08-otp-login-properly ch2-09-the-box-is-full ch2-10-redis-is-down-the-app-is-not ch2-11-interview-cache-aside ch2-12-interview-prefetch ch2-13-interview-session-store "
[ "$ORDER" = "$WANT" ] && pass "levels listed in order, 01 to 04 first" || { fail "chapter.yaml order differs"; echo "  got:  $ORDER"; }

step "levels"
COUNT=0
for f in "$CH"/[0-9][0-9]-*.yaml; do
  [ -f "$f" ] || continue
  COUNT=$((COUNT + 1))
  id=$(sed -n 's/^id: *//p' "$f" | head -n 1)
  echo "level $id"
  grep -qE "^  - $id\$" "$CH/chapter.yaml" && pass "  listed in chapter.yaml" || fail "  not listed in chapter.yaml ($id)"
  for p in $(grep -E '^[[:space:]]*(reference:|- path:)[[:space:]]+solutions/' "$f" | sed -E 's/.*(solutions\/[^[:space:]]+).*/\1/'); do
    if [ -s "$CH/$p" ]; then pass "  $p exists, non-empty"; else fail "  $p missing or empty ($id)"; fi
    case "$p" in
      *.js) node --check "$CH/$p" 2>/dev/null && pass "  $p is valid JavaScript" || fail "  $p does not parse ($id)";;
    esac
  done
  for p in $(grep -E '^[[:space:]]*fixtures:[[:space:]]+fixtures/' "$f" | sed -E 's/.*(fixtures\/[^[:space:]]+).*/\1/' | sort -u); do
    if [ -s "$CH/$p" ]; then pass "  $p exists, non-empty"; else fail "  $p missing or empty ($id)"; fi
  done
  if grep -qE '^docs:' "$f" && grep -qE '^  - https://redis\.io/docs/' "$f"; then pass "  docs link present"; else fail "  no docs link ($id)"; fi
  if grep -qE '^interview:' "$f"; then
    if grep -qE '^teach:' "$f"; then fail "  interview level has a teach block ($id)"; else pass "  interview level, no teach"; fi
  else
    n=$(awk '/^teach: \|/{t=1;next} t&&/^[^ ]/{exit} t{c++} END{print c+0}' "$f")
    if [ "$n" -ge 8 ] && [ "$n" -le 24 ]; then pass "  teach is $n lines"; else fail "  teach is $n lines, want 8 to 24 ($id)"; fi
  fi
  sc=$(sed -n 's/^scenario: *\([A-Za-z0-9-]*\).*/\1/p' "$f" | head -n 1)
  if [ -n "$sc" ]; then
    [ -f "scenarios/$sc.yaml" ] && pass "  scenario $sc exists" || fail "  scenario $sc has no file ($id)"
  fi
  tsc=$(grep -E '^[[:space:]]+scenario: ' "$f" | sed -E 's/.*scenario: *([A-Za-z0-9-]+).*/\1/' | sort -u)
  for s in $tsc; do
    [ -f "scenarios/$s.yaml" ] && pass "  traffic scenario $s exists" || fail "  traffic scenario $s has no file ($id)"
  done
done
[ "$COUNT" -eq 13 ] && pass "13 level files" || fail "found $COUNT level files, want 13"

step "level files 01 to 04 untouched"
if git diff --quiet HEAD -- "$CH/01-feel-it.yaml" "$CH/02-cache-aside-v1.yaml" "$CH/03-stale-is-a-bug.yaml" "$CH/04-stampede-at-the-toss.yaml" 2>/dev/null; then pass "01 to 04 have no changes against the index/HEAD"; else fail "levels 01 to 04 differ from git"; fi

step "spec rules, solution modules, scenarios (one node pass over the real parsed levels)"
cat > "$TMP/static.mjs" <<'EOF'
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
const root = process.env.QUEST_ROOT;
const shared = await import(pathToFileURL(join(root, 'packages/shared/dist/index.js')).href);
const { chapters } = await shared.loadAllLevels(join(root, 'levels'));
const ch2 = chapters.find((c) => c.id === 'ch2');
const lv = (n) => ch2.levels.find((l) => l.level.id.startsWith(`ch2-${n}-`)).level;
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const verifiers = (l, type) => l.verify.filter((v) => v.type === type);
const sideEffects = (v) => (v.assertions ?? []).flatMap((a) => a.sideEffect ?? []);

// 05: the behavior step checks the sentinel exists and has some TTL, never the upper bound the antipattern owns.
{
  const l = lv('05');
  const b = verifiers(l, 'behavior')[0];
  ok(b.slot === 'cache.getPlayerStats', '05 behavior is on cache.getPlayerStats');
  ok(sideEffects(b).every((c) => c.between === undefined && c.lte === undefined), '05 behavior step has no upper TTL bound (2.2 rule)');
  ok(b.assertions[0].repeat === 2 && b.assertions[0].expect === null, '05 behavior: p-999 returns null twice');
  const t = verifiers(l, 'traffic')[0];
  ok(t.scenario === 'bad-id-hammer' && t.assertions.db_queries_lte === 3 && t.assertions.error_rate_lte === 0 && t.baseline === false, '05 traffic: bad-id-hammer, db_queries_lte 3, error_rate_lte 0');
  const a = verifiers(l, 'antipattern')[0];
  ok(a.checks.some((c) => c.cmd[0] === 'TTL' && c.cmd[1] === 'cache:player:p-999' && c.lte === 10), '05 antipattern: TTL cache:player:p-999 lte 10');
  ok(l.solutions.wrong.map((w) => `${w.path}:${w.expect}`).join() === 'solutions/05-wrong-no-sentinel.js:wrong,solutions/05-works-but-wrong-long-ttl.js:works_but_wrong', '05 solutions: no-sentinel wrong, long-ttl works_but_wrong');
}
// 06
{
  const l = lv('06');
  ok(l.mode === 'code', '06 is a code level (its behavior step needs the learner cache file)');
  ok(verifiers(l, 'redis')[0].checks.some((c) => c.cmd.join(' ') === 'INFO stats' && /keyspace_hits/.test(c.matches)), '06 redis check on INFO stats keyspace_hits');
  ok(verifiers(l, 'quiz').length >= 1, '06 has a quiz');
  const t = verifiers(l, 'traffic')[0];
  ok(t.scenario === 'stats-hot-100' && t.assertions.hit_ratio_gte === 0.9 && t.baseline === false, '06 traffic: stats-hot-100, hit_ratio_gte 0.9, baseline false');
  ok(verifiers(l, 'behavior').some((b) => b.slot === 'cache.getPlayerStats'), '06 has a behavior on cache.getPlayerStats (slot activation)');
}
// 07
{
  const l = lv('07');
  const slots = verifiers(l, 'behavior').map((b) => b.slot).sort().join();
  ok(slots === 'prefetch.applyChange,prefetch.bulkLoad,prefetch.getFixtures', '07 behaviors cover bulkLoad, applyChange, getFixtures');
  const nullExpect = verifiers(l, 'behavior').some((b) => b.assertions.some((a) => a.expect === null));
  ok(!nullExpect, '07 behavior steps never assert the cold-miss null (2.2 rule)');
  const a = verifiers(l, 'antipattern')[0];
  ok(a.slot === 'prefetch.getFixtures' && a.assertions[0].expect === null, '07 antipattern: getFixtures on a cold cache returns null');
  const t = verifiers(l, 'traffic')[0];
  ok(t.scenario === 'fixtures-read' && t.assertions.db_calls_ratio_lte === 0.01 && t.assertions.error_rate_lte === 0 && t.baseline === true, '07 traffic: fixtures-read, db_calls_ratio_lte 0.01, error_rate_lte 0');
  const bulk = verifiers(l, 'behavior').find((b) => b.slot === 'prefetch.bulkLoad');
  ok(sideEffects(bulk).some((c) => c.cmd[0] === 'TTL' && c.between && c.between[0] === 3000 && c.between[1] === 3600), '07 bulkLoad leaves TTL between 3000 and 3600');
  const apply = verifiers(l, 'behavior').find((b) => b.slot === 'prefetch.applyChange');
  ok(sideEffects(apply).some((c) => c.cmd[0] === 'HGET' && c.cmd[2] === 'venue') && sideEffects(apply).some((c) => c.cmd[0] === 'EXISTS' && c.equals === 0), '07 applyChange: venue changes within the call, a delete removes the key');
  ok(l.solutions.wrong.some((w) => w.path === 'solutions/07-wrong-fallback-to-postgres.js' && w.expect === 'works_but_wrong') && l.solutions.wrong.some((w) => w.path === 'solutions/07-wrong-no-apply.js' && w.expect === 'wrong'), '07 solutions as bound (fallback is works_but_wrong)');
}
// 08
{
  const l = lv('08');
  const slots = verifiers(l, 'behavior').map((b) => b.slot).sort().join();
  ok(slots === 'session.create,session.destroy,session.destroyAll,session.get', '08 behaviors cover the four session slots');
  const createB = verifiers(l, 'behavior').find((b) => b.slot === 'session.create');
  ok(!sideEffects(createB).some((c) => c.between || (c.cmd[0] === 'SCARD')), '08 create behavior asserts neither TTL nor the user set (2.2 rule)');
  const a = verifiers(l, 'antipattern')[0];
  ok(a.slot === 'session.create' && sideEffects(a).some((c) => c.cmd[0] === 'SCARD' && c.equals === 1) && sideEffects(a).some((c) => c.cmd[0] === 'EVAL_RO' && c.between), '08 antipattern: SCARD of the user set equals 1 and the session TTL is bounded');
  const get = verifiers(l, 'behavior').find((b) => b.slot === 'session.get');
  ok(sideEffects(get).some((c) => c.cmd[0] === 'TTL' && c.between && c.between[0] === 1700), '08 get behavior: sliding TTL back to 1700..1800');
  ok(l.solutions.wrong.some((w) => w.path === 'solutions/08-wrong-in-memory.js' && w.expect === 'wrong') && l.solutions.wrong.some((w) => w.path === 'solutions/08-wrong-no-ttl.js' && w.expect === 'works_but_wrong'), '08 solutions: in-memory wrong, no-ttl works_but_wrong');
}
// 09
{
  const l = lv('09');
  ok(l.mode === 'ops', '09 is an ops level');
  const checks = verifiers(l, 'redis')[0].checks;
  ok(checks.some((c) => c.cmd.join(' ') === 'CONFIG GET maxmemory' && JSON.stringify(c.equals) === '["maxmemory","536870912"]'), '09 checks maxmemory back at 536870912');
  ok(checks.some((c) => c.cmd.join(' ') === 'INFO stats' && /evicted_keys/.test(c.matches)), '09 checks evicted_keys moved');
  ok(checks.some((c) => c.cmd.join(' ') === 'CONFIG GET maxmemory-policy' && c.contains === 'allkeys-lru'), '09 checks allkeys-lru');
  ok(verifiers(l, 'quiz').length >= 1, '09 has a quiz');
}
// 10
{
  const l = lv('10');
  const ev = verifiers(l, 'event');
  ok(ev.some((e) => e.kind === 'redis_disconnect') && ev.some((e) => e.kind === 'redis_reconnect' && e.timeoutMs === 300000), '10 events: redis_disconnect and redis_reconnect (timeoutMs 300000)');
  const t = verifiers(l, 'traffic')[0];
  ok(t.scenario === 'stats-redis-down' && t.assertions.error_rate_lte === 0 && t.baseline === false, '10 traffic: stats-redis-down, error_rate_lte 0, baseline false');
  ok(verifiers(l, 'behavior').some((b) => b.slot === 'cache.getPlayerStats'), '10 has a behavior on cache.getPlayerStats');
}
// 11, 12, 13
for (const [n, rebuild, minutes] of [['11', 'ch2-02-cache-aside-v1', 20], ['12', 'ch2-07-fixtures-must-never-miss', null], ['13', 'ch2-08-otp-login-properly', null]]) {
  const l = lv(n);
  ok(l.interview && l.interview.rebuild_of === rebuild && (minutes === null || l.interview.minutes === minutes), `${n} interview rebuilds ${rebuild}`);
  ok(l.teach === undefined, `${n} has no teach`);
  const rebuilt = ch2.levels.find((x) => x.level.id === rebuild).level;
  const types = (x) => x.verify.map((v) => v.type).join();
  ok(types(l) === types(rebuilt), `${n} has the same verifier list as ${rebuild} (${types(l)})`);
}
// scenarios, with the engine's own parser
const sc = await import(pathToFileURL(join(root, 'engine/dist/load/scenario.js')).href);
const want = { 'bad-id-hammer': [100, 8], 'fixtures-read': [50, 6], 'stats-redis-down': [30, 6] };
for (const [id, [c, d]] of Object.entries(want)) {
  try {
    const s = await sc.loadScenario(join(root, 'scenarios'), id);
    ok(s.id === id && s.connections === c && s.durationSec === d, `scenarios/${id}.yaml parses: ${s.connections} connections, ${s.durationSec} s, ${s.requests.length} request(s)`);
  } catch (e) { ok(false, `scenarios/${id}.yaml: ${e.message}`); }
}
{
  const s = await sc.loadScenario(join(root, 'scenarios'), 'bad-id-hammer');
  ok(s.requests.length === 1 && s.requests[0].path === '/app/players/p-999/stats', 'bad-id-hammer only asks /app/players/p-999/stats');
  const f = await sc.loadScenario(join(root, 'scenarios'), 'fixtures-read');
  ok(f.requests.length === 1 && f.requests[0].path === '/app/fixtures', 'fixtures-read only asks /app/fixtures');
}
// solution modules: parse as modules and export what their level needs
const need = { '07-reference.js': ['bulkLoad', 'applyChange', 'getFixtures'], '07-wrong-no-apply.js': ['bulkLoad', 'applyChange', 'getFixtures'], '07-wrong-fallback-to-postgres.js': ['bulkLoad', 'applyChange', 'getFixtures'],
  '08-reference.js': ['create', 'get', 'destroy', 'destroyAll'], '08-wrong-no-ttl.js': ['create', 'get', 'destroy', 'destroyAll'], '08-wrong-in-memory.js': ['create', 'get', 'destroy', 'destroyAll'], '08-works-but-wrong-no-user-set.js': ['create', 'get', 'destroy', 'destroyAll'],
  '05-reference.js': [], '05-wrong-no-sentinel.js': [], '05-works-but-wrong-long-ttl.js': [], '10-reference.js': [], '10-wrong-no-catch.js': [] };
for (const [file, names] of Object.entries(need)) {
  try {
    const m = await import(pathToFileURL(join(root, 'levels/ch2-everyone-showed-up/solutions', file)).href);
    const missing = names.filter((n) => typeof m[n] !== 'function');
    ok(typeof m.default === 'function' && missing.length === 0, `${file}: default export is a function${names.length ? `, exports ${names.join(', ')}` : ''}`);
  } catch (e) { ok(false, `${file}: ${e.message}`); }
}
process.exit(fails ? 1 : 0);
EOF
QUEST_ROOT="$ROOT" node "$TMP/static.mjs" > "$TMP/static.out" 2>&1; RC=$?
cat "$TMP/static.out"
[ $RC -eq 0 ] && pass "static node checks" || fail "static node checks (exit $RC)"

step "local proof: engine evaluators against every solution (throwaway redis-server, fake Postgres, no Docker)"
if ! command -v redis-server >/dev/null 2>&1 || ! command -v redis-cli >/dev/null 2>&1; then
  echo "SKIP  redis-server or redis-cli not on PATH; the proof needs them (brew install redis)"
elif [ ! -f engine/dist/verify/behavior.js ]; then
  echo "SKIP  engine/dist is not built (pnpm --filter @quest/engine build); the proof uses the engine's evaluators"
else
  PORT=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
  redis-server --port "$PORT" --bind 127.0.0.1 --save "" --appendonly no --daemonize yes --dir "$TMP" --logfile "$TMP/redis.log" >/dev/null 2>&1
  sleep 1
  if redis-cli -p "$PORT" ping >/dev/null 2>&1; then
    REDIS_PID_PORT="$PORT"
    pass "throwaway redis-server on 127.0.0.1:$PORT"
    cat > "$TMP/proof.mjs" <<'EOF'
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const root = process.env.QUEST_ROOT;
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const { createClient } = await imp('app/node_modules/redis/dist/index.js');
const shared = await imp('packages/shared/dist/index.js');
const { runAssertions, runFixtureSteps } = await imp('engine/dist/verify/behavior.js');
const { runChecks } = await imp('engine/dist/verify/redis-checks.js');
const { parse } = await imp('engine/node_modules/yaml/dist/index.js');

const redis = createClient({ url: `redis://127.0.0.1:${process.env.PROOF_PORT}` });
redis.on('error', () => {});
await redis.connect();
const send = (cmd) => redis.sendCommand(cmd.map(String));
await redis.set('c2b:warm', '1'); await redis.get('c2b:warm'); await redis.get('c2b:cold'); // INFO stats has hits and misses for level 06

// A fake Postgres: one slow-ish row per real player, nothing for p-999, a canned fixtures list for the matches query.
const PLAYER = { player_id: 'p-151', name: 'Hitesh Bhatt', runs: '12' };
const db = { query: async (sql, args) => {
  if (/FROM matches/.test(sql)) return { rows: [{ id: 'from-postgres' }] };
  await new Promise((r) => setTimeout(r, 20));
  return { rows: args[0] === 'p-999' ? [] : [{ ...PLAYER, player_id: args[0] }] };
} };
const SLOT_EXPORT = { 'prefetch.bulkLoad': 'bulkLoad', 'prefetch.applyChange': 'applyChange', 'prefetch.getFixtures': 'getFixtures',
  'session.create': 'create', 'session.get': 'get', 'session.destroy': 'destroy', 'session.destroyAll': 'destroyAll' };

const { chapters } = await shared.loadAllLevels(join(root, 'levels'));
const ch2 = chapters.find((c) => c.id === 'ch2');
let bad = 0;
const row = (okv, text) => { console.log(`${okv ? 'PASS' : 'FAIL'}  ${text}`); if (!okv) bad++; };

for (const entry of ch2.levels) {
  const L = entry.level;
  const n = Number(L.id.split('-')[1]);
  if (n < 5) continue;
  const dir = dirname(entry.file);
  const solutions = L.mode === 'decision' ? [] : [{ path: L.solutions.reference, expect: 'right' }, ...L.solutions.wrong.map((w) => ({ path: w.path, expect: w.expect }))];
  for (const s of solutions) {
    const file = join(dir, s.path);
    let verdictFailed = false;
    let hit = false;
    const notes = [];
    if (L.mode === 'code') {
      const mod = await import(`${pathToFileURL(file).href}?${Math.random()}`);
      const run = async (req) => {
        const fn = mod[SLOT_EXPORT[req.module]] ?? mod.default;
        const results = [];
        for (const c of req.calls) {
          try {
            const value = await fn({ redis, db, log: () => {} }, ...c.args);
            results.push({ ok: true, value: value === undefined ? null : JSON.parse(JSON.stringify(value)), ms: 1 });
          } catch (e) { results.push({ ok: false, error: { name: e.name, message: e.message }, ms: 1 }); }
        }
        return { results };
      };
      for (const v of L.verify) {
        if (v.type === 'behavior' || (v.type === 'antipattern' && v.slot)) {
          const fx = shared.fixtureFileSchema.parse(parse(readFileSync(join(dir, v.fixtures), 'utf8')));
          const err = await runFixtureSteps(fx.steps, send);
          if (err) { notes.push(err); verdictFailed = true; continue; }
          const r = await runAssertions({ slot: v.slot, module: v.slot, concurrency: v.concurrency, assertions: v.assertions }, { run, send });
          if (!r.ok) { if (v.type === 'behavior') verdictFailed = true; else hit = true; notes.push(`${v.type}: ${r.message.split('\n').join(' | ').slice(0, 160)}`); }
        } else if (v.type === 'redis' || (v.type === 'antipattern' && v.checks)) {
          const items = await runChecks(send, v.checks);
          const badItems = items.filter((i) => !i.ok);
          if (badItems.length) { if (v.type === 'redis') verdictFailed = true; else hit = true; notes.push(`${v.type}: ${badItems.map((b) => b.feedback).join(' | ').slice(0, 160)}`); }
        }
      }
    } else if (L.id.startsWith('ch2-09-')) {
      // cli and ops levels: run the .redis solution's commands, then the redis verifier. Level 06's wrong solution only
      // differs through its quiz answer (the grader sends a wrong pick), so its redis checks are expected to pass either way.
      for (const st of L.setup ?? []) if (st.cmd) await send(st.cmd);
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        await send(t.split(/\s+/));
      }
      for (const v of L.verify.filter((x) => x.type === 'redis')) {
        const items = await runChecks(send, v.checks);
        if (items.some((i) => !i.ok)) { verdictFailed = true; notes.push(items.filter((i) => !i.ok).map((i) => i.feedback).join(' | ').slice(0, 160)); }
      }
      await send(['CONFIG', 'SET', 'maxmemory', '0']); await send(['CONFIG', 'SET', 'maxmemory-policy', 'noeviction']); await send(['FLUSHALL']);
      await redis.set('c2b:warm', '1'); await redis.get('c2b:warm'); await redis.get('c2b:cold');
    }
    const verdict = verdictFailed ? 'wrong' : hit ? 'works_but_wrong' : 'right';
    row(verdict === s.expect, `${L.id} ${s.path}: declared ${s.expect}, evaluators say ${verdict}`);
    if (verdict !== s.expect) for (const x of notes) console.log(`        ${x}`);
  }
}
await redis.quit();
process.exit(bad ? 1 : 0);
EOF
    QUEST_ROOT="$ROOT" PROOF_PORT="$PORT" node "$TMP/proof.mjs" > "$TMP/proof.out" 2>&1; RC=$?
    cat "$TMP/proof.out"
    [ $RC -eq 0 ] && pass "every solution gets its declared verdict from the engine's evaluators" || fail "a solution got a different verdict than declared (exit $RC)"
  else
    fail "could not start a throwaway redis-server"
  fi
fi

step "owned files"
echo "git status --short (this task's paths):"
git status --short -- "$CH" scenarios/bad-id-hammer.yaml scenarios/fixtures-read.yaml scenarios/stats-redis-down.yaml scripts/check/C2b.sh docs/handoffs/C2b.md 2>/dev/null | sed 's/^/  /'

echo
if [ $FAILS -eq 0 ]; then echo "C2b OK"; exit 0; fi
echo "C2b FAILED ($FAILS)"; exit 1
