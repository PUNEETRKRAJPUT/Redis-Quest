#!/usr/bin/env bash
# C3 acceptance: Chapter 3, "Compete and talk" (15 levels).
# Static part: the chapter validates with 15 levels, chapter.yaml lists every level in order, every solution and fixture
# exists and parses, every solution module is valid JavaScript with the exports its level needs, the spec's rules hold in
# each level's verify list, the two scenarios parse with the engine's own parser, scripts/ticker-drill.sh passes bash -n
# and runs against a stub of the app's ticker.
# Local proof part (skipped with a note when redis-server is not on the PATH): starts a throwaway redis-server on a free
# port and runs the engine's own behavior, antipattern and redis evaluators against every reference and wrong solution
# (learner dependencies built by the real createLearnerDeps, calls made in parallel at the level's concurrency), then
# compares the verdict with the declared one. The channel_message event of levels 10 and 15 is emulated by a subscriber.
# Needs no Docker. Traffic, quiz, service_scaled and ticker_gap verifiers are not run here: the orchestrator's live
# grading (scripts/grade/grade.sh) covers those, and the proof prints which solutions rest on them.
# bash 3.2 compatible: no associative arrays, no mapfile.
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
CH="levels/ch3-compete-and-talk"
FAILS=0
TMP=$(mktemp -d "${TMPDIR:-/tmp}/c3.XXXXXX")
REDIS_PORT_STARTED=""

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILS=$((FAILS + 1)); }
step() { echo; echo "== $1"; }

cleanup() {
  if [ -n "$REDIS_PORT_STARTED" ]; then redis-cli -p "$REDIS_PORT_STARTED" shutdown nosave >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

step "build @quest/shared and @quest/engine (the scenario parser and the evaluators come from the engine)"
pnpm --filter @quest/shared build >/dev/null 2>&1 && pass "shared build" || { fail "shared build"; exit 1; }
pnpm --filter @quest/engine build >/dev/null 2>&1 && pass "engine build" || { fail "engine build"; exit 1; }

step "validate $CH"
OUT=$(pnpm --silent --filter @quest/shared levels:validate "$CH" 2>&1); RC=$?
if [ $RC -eq 0 ]; then pass "$OUT"; else fail "validate (exit $RC)"; echo "$OUT"; fi
case "$OUT" in *"15 level(s)"*) pass "15 levels";; *) fail "expected 15 levels in the chapter";; esac

step "chapter.yaml"
if sed -n 's/^id: *//p' "$CH/chapter.yaml" | head -n 1 | grep -qx 'ch3'; then pass "chapter id ch3"; else fail "chapter id is not ch3"; fi
LISTED=$(grep -E '^  - ch3-' "$CH/chapter.yaml" | wc -l | tr -d ' ')
[ "$LISTED" -eq 15 ] && pass "chapter lists exactly 15 levels" || fail "chapter lists $LISTED levels, want 15"
ORDER=$(grep -E '^  - ch3-' "$CH/chapter.yaml" | sed -E 's/^  - //' | tr '\n' ' ')
WANT="ch3-01-you-are-not-alone ch3-02-fixed-window ch3-03-token-bucket ch3-04-sliding-window-log ch3-05-fail-open-or-fail-closed ch3-06-the-real-leaderboard ch3-07-hostel-college-india ch3-08-forty-thousand-updates ch3-09-money-moves ch3-10-the-ticker ch3-11-at-most-once ch3-12-make-it-a-function ch3-13-interview-rate-limiter ch3-14-interview-leaderboard ch3-15-interview-ticker "
[ "$ORDER" = "$WANT" ] && pass "levels listed in the spec's order" || { fail "chapter.yaml order differs"; echo "  got:  $ORDER"; }

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
      *.sh) bash -n "$CH/$p" 2>/dev/null && pass "  $p passes bash -n" || fail "  $p does not parse ($id)";;
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
  tsc=$(grep -E '^[[:space:]]+scenario: ' "$f" | sed -E 's/.*scenario: *([A-Za-z0-9-]+).*/\1/' | sort -u)
  for s in $tsc; do
    [ -f "scenarios/$s.yaml" ] && pass "  traffic scenario $s exists" || fail "  traffic scenario $s has no file ($id)"
  done
  if grep -qiE '\b(bet|stake|payout|cash|ipl)\b' "$f"; then fail "  forbidden fiction word (bet, stake, payout, cash, IPL) in $id"; fi
done
[ "$COUNT" -eq 15 ] && pass "15 level files" || fail "found $COUNT level files, want 15"

step "scripts/ticker-drill.sh parses (the run against a stub of the ticker is further down)"
bash -n scripts/ticker-drill.sh && pass "ticker-drill.sh passes bash -n" || fail "ticker-drill.sh does not parse"
[ -x scripts/ticker-drill.sh ] && pass "ticker-drill.sh is executable" || fail "ticker-drill.sh is not executable"

step "spec rules, scenarios, solution modules (one node pass over the real parsed levels)"
cat > "$TMP/static.mjs" <<'EOF'
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
const root = process.env.QUEST_ROOT;
const shared = await import(pathToFileURL(join(root, 'packages/shared/dist/index.js')).href);
const { chapters } = await shared.loadAllLevels(join(root, 'levels'));
const ch3 = chapters.find((c) => c.id === 'ch3');
const lv = (n) => ch3.levels.find((l) => l.level.id.startsWith(`ch3-${n}-`)).level;
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const vs = (l, type) => l.verify.filter((v) => v.type === type);
const sideEffects = (v) => (v.assertions ?? []).flatMap((a) => a.sideEffect ?? []);
const wrongs = (l) => l.solutions.wrong.map((w) => `${w.path.replace('solutions/', '')}:${w.expect}`).join();
const types = (l) => l.verify.map((v) => v.type).join();

// chapter
{
  const raw = readFileSync(join(root, 'levels/ch3-compete-and-talk/chapter.yaml'), 'utf8');
  const times = [...raw.matchAll(/time: "(\d\d:\d\d)"/g)].map((m) => m[1]);
  ok(times.length >= 6 && times.length <= 8, `incident thread has ${times.length} lines (six to eight)`);
  ok(times[0] >= '22:10' && times[times.length - 1] <= '22:20', `incident runs ${times[0]} to ${times[times.length - 1]}`);
  ok(ch3.chapter.title === 'Compete and talk', 'chapter title is "Compete and talk"');
}
// 01
{
  const l = lv('01');
  ok(l.mode === 'ops', '01 is an ops level');
  const e = vs(l, 'event')[0];
  ok(e.kind === 'service_scaled' && e.match.service === 'app' && e.match.instances === 2 && e.timeoutMs === 120000, '01 event service_scaled { service: app, instances: 2 }, timeoutMs 120000');
  ok(vs(l, 'quiz').length === 2, '01 has two quizzes');
  ok(l.show_me.component === 'cache_stats' && l.show_me.keys.length === 0, '01 show_me cache_stats with no keys');
  ok(wrongs(l) === '01-wrong-restart.sh:wrong', '01 solutions: reference + restart (wrong)');
  ok(/scripts\/hit\.sh 30/.test(l.task) && /--scale app=2 app/.test(l.task) && /u-000011/.test(l.task) && /instances=1/.test(l.task), '01 task names hit.sh 30, --scale app=2, u-000011 and instances=1');
}
// 02
{
  const l = lv('02');
  const b = vs(l, 'behavior')[0];
  ok(b.slot === 'ratelimit.allow' && b.assertions[0].repeat === 15 && b.assertions[0].expectCount.equals === 10 && b.assertions[0].expectCount.value === true, '02 behavior: u-limit-1 x15 -> 10 true');
  ok(sideEffects(b).every((c) => c.between === undefined), '02 behavior step has no TTL bound (2.2 rule: the antipattern owns it)');
  ok(sideEffects(b).some((c) => c.cmd[0] === 'GET' && c.equals === '15'), '02 behavior: GET ratelimit:fixed:u-limit-1 equals "15"');
  const a = vs(l, 'antipattern');
  ok(a[0].checks && a[0].checks[0].cmd.join(' ') === 'TTL ratelimit:fixed:u-limit-1' && a[0].checks[0].between.join() === '1,60', '02 antipattern 1: TTL between [1, 60]');
  ok(a[1].slot === 'ratelimit.allow' && a[1].concurrency === 100 && a[1].assertions[0].expectCount.lte === 10, '02 antipattern 2: concurrency 100 on u-limit-2, lte 10, after the TTL one');
  ok(vs(l, 'quiz').length === 1, '02 has the boundary quiz');
  ok(wrongs(l) === '02-wrong-in-memory.js:wrong,02-works-but-wrong-get-then-set.js:works_but_wrong,02-works-but-wrong-no-expire.js:works_but_wrong', '02 solutions as bound');
  ok(l.show_me.component === 'otp_limiter_panel', '02 show_me otp_limiter_panel');
}
// 03
{
  const l = lv('03');
  const b = vs(l, 'behavior')[0];
  ok(sideEffects(b).some((c) => c.cmd.join(' ') === 'TYPE ratelimit:u-limit-1' && c.equals === 'hash') && sideEffects(b).some((c) => c.cmd.join(' ') === 'HGET ratelimit:u-limit-1 tokens' && c.equals === '0'), '03 behavior: TYPE hash and HGET tokens "0"');
  const a = vs(l, 'antipattern')[0];
  ok(a.concurrency === 100 && a.assertions[0].expectCount.lte === 10, '03 antipattern: concurrency 100, lte 10');
  ok(wrongs(l) === '03-wrong-allow-all.js:wrong,03-works-but-wrong-js-race.js:works_but_wrong', '03 solutions as bound');
  ok(/SCRIPT LOAD/.test(l.teach) && /EVALSHA/.test(l.teach) && /NOSCRIPT/.test(l.teach), '03 teach covers SCRIPT LOAD, EVALSHA and NOSCRIPT');
}
// 04
{
  const l = lv('04');
  const b = vs(l, 'behavior')[0];
  ok(sideEffects(b).some((c) => c.cmd[0] === 'ZCARD' && c.equals === 10) && sideEffects(b).some((c) => c.cmd[0] === 'TTL' && c.between.join() === '1,120'), '04 behavior: ZCARD 10, TTL between [1, 120]');
  const fx = readFileSync(join(root, 'levels/ch3-compete-and-talk/fixtures/04-seed-old-entries.yaml'), 'utf8');
  ok((fx.match(/^\s+- 1700000000000$/gm) ?? []).length === 10, '04 fixture seeds ten entries scored 1700000000000');
  ok(vs(l, 'antipattern')[0].concurrency === 100, '04 antipattern concurrency 100');
  ok(vs(l, 'quiz').length === 1 && l.show_me.component === 'kv_card' && l.show_me.keys[0] === 'ratelimit:log:u-limit-1', '04 cost quiz, show_me kv_card on the log key');
  ok(wrongs(l) === '04-wrong-no-trim.js:wrong,04-works-but-wrong-js-race.js:works_but_wrong', '04 solutions as bound');
}
// 05
{
  const l = lv('05');
  ok(l.mode === 'decision' && vs(l, 'quiz').length === 3 && l.show_me === undefined, '05 decision level, three quizzes, no show_me');
  const correct = vs(l, 'quiz').flatMap((q) => q.correct).sort().join();
  ok(correct === [...l.solutions.reference].sort().join(), '05 reference lists exactly the correct ids');
  ok(l.solutions.wrong.length === 3, '05 one wrong entry per quiz');
}
// 06
{
  const l = lv('06');
  const slots = vs(l, 'behavior').map((b) => b.slot).sort().join();
  ok(slots === 'leaderboard.addPoints,leaderboard.rank,leaderboard.top', '06 behaviors on top, addPoints and rank');
  const t = vs(l, 'traffic')[0];
  ok(t.scenario === 'leaderboard-storm' && t.baseline === false && t.assertions.p99_ms_lte === 60 && t.assertions.error_rate_lte === 0 && t.assertions.db_queries_lte === 0, '06 traffic: leaderboard-storm, baseline false, p99 60, errors 0, db queries 0');
  ok(vs(l, 'behavior').every((b) => b.fixtures === 'fixtures/06-seed-40k.yaml'), '06 every behavior uses the 40k seed');
  ok(wrongs(l) === '06-wrong-postgres.js:wrong,06-wrong-sort-in-js.js:wrong', '06 solutions as bound');
  ok(JSON.stringify(vs(l, 'behavior')[0].assertions[0].expect[0]) === '{"teamId":"ft-29284","points":9999.6}', '06 top returns { teamId, points } (A-02 handoff, not the spec table\'s score)');
}
// 07
{
  const l = lv('07');
  ok(l.mode === 'cli' && l.setup.length === 2, '07 cli level with the seeding EVAL and the DEL');
  const r = vs(l, 'redis')[0];
  ok(r.checks.every((c) => c.cmd[0] !== 'TTL'), '07 redis verifier has no TTL check (2.2 rule: the antipattern owns it)');
  ok(r.checks.some((c) => c.cmd[0] === 'ZSCORE' && c.equals === 656), '07 ZSCORE h-c-04-1 equals 656');
  ok(vs(l, 'antipattern')[0].checks[0].between.join() === '1,604800', '07 antipattern TTL between [1, 604800]');
  ok(vs(l, 'quiz').length === 1, '07 tie-break quiz');
  ok(wrongs(l) === '07-wrong-aggregate-max.redis:wrong,07-works-but-wrong-no-expire.redis:works_but_wrong', '07 solutions as bound');
}
// 08
{
  const l = lv('08');
  const t = vs(l, 'traffic')[0];
  ok(t.scenario === 'recompute-storm' && t.baseline === false && t.assertions.p99_ms_lte === 2500 && t.assertions.error_rate_lte === 0, '08 traffic: recompute-storm, p99 2500, errors 0');
  ok(/40,098/.test(l.task), '08 task names the 40,098 rows A-02 measured');
  ok(sideEffects(vs(l, 'behavior')[0]).length === 3, '08 behavior: three ZSCORE side effects');
  ok(wrongs(l) === '08-wrong-one-at-a-time.js:wrong' && l.show_me.keys[0] === 'lb:contest:1', '08 solutions and show_me as bound');
}
// 09
{
  const l = lv('09');
  const b = vs(l, 'behavior');
  ok(b[0].concurrency === 50 && b[0].assertions[0].repeat === 50 && b[0].assertions[0].expectCount.equals === 10, '09 behavior: 50 concurrent joins -> exactly 10 true');
  ok(b[1].assertions[0].expect === false, '09 behavior: u-000011 with 5 points -> false');
  ok(wrongs(l) === '09-wrong-get-then-decrby.js:wrong,09-wrong-watch-on-shared-client.js:wrong', '09 solutions as bound');
  ok(/WatchError/.test(l.teach) && /duplicate\(\)/.test(l.teach) && /createClientPool/.test(l.teach), '09 teach: WatchError, duplicate(), createClientPool');
}
// 10
{
  const l = lv('10');
  const e = vs(l, 'event')[0];
  ok(e.kind === 'channel_message' && e.match.channel === 'score:match:m-041' && e.timeoutMs === 120000, '10 event channel_message on score:match:m-041, timeoutMs 120000');
  ok(sideEffects(vs(l, 'behavior')[0]).some((c) => c.cmd[0] === 'GET' && c.matches === '"seq":7'), '10 behavior: GET last matches "seq":7');
  ok(/Run my code in the app/.test(l.task) && /curl -s -X POST localhost:3000\/app\/matches\/m-041\/balls/.test(l.task) && /\/app\/ticker\/m-041/.test(l.task), '10 task: the switch, the ball curl and the ticker curl');
  ok(wrongs(l) === '10-wrong-no-publish.js:wrong,10-wrong-wrong-channel.js:wrong', '10 solutions as bound');
}
// 11
{
  const l = lv('11');
  ok(l.mode === 'cli', '11 is a cli level');
  const e = vs(l, 'event')[0];
  ok(e.kind === 'custom' && e.match.name === 'ticker_gap' && e.timeoutMs === 180000, '11 event custom ticker_gap, timeoutMs 180000');
  ok(vs(l, 'redis')[0].checks.some((c) => c.cmd.slice(0, 2).join(' ') === 'PUBSUB NUMSUB'), '11 redis check on PUBSUB NUMSUB');
  ok(vs(l, 'quiz').length === 2, '11 two quizzes');
  ok(wrongs(l) === '11-wrong-numpat.redis:wrong', '11 solutions as bound');
  ok(/scripts\/ticker-drill\.sh/.test(l.task), '11 task names scripts/ticker-drill.sh');
}
// 12
{
  const l = lv('12');
  const r = vs(l, 'redis')[0];
  ok(r.checks[0].cmd.join(' ') === 'FUNCTION LIST LIBRARYNAME limiter', '12 redis check: FUNCTION LIST LIBRARYNAME limiter');
  ok(vs(l, 'behavior')[0].fixtures === 'fixtures/12-reset-function.yaml' && vs(l, 'antipattern')[0].concurrency === 100, '12 behavior clears functions first; antipattern concurrency 100');
  ok(/tb_allow/.test(l.task) && /FCALL/.test(l.task) && /FUNCTION LOAD REPLACE/.test(l.task), '12 task: tb_allow, FCALL, FUNCTION LOAD REPLACE');
  ok(wrongs(l) === '12-wrong-evalsha-only.js:wrong,12-wrong-allow-all.js:wrong,12-works-but-wrong-js-race.js:works_but_wrong', '12 solutions as bound (plus one works_but_wrong the antipattern needs)');
}
// 13, 14, 15
for (const [n, rebuild, minutes] of [['13', 'ch3-03-token-bucket', 20], ['14', 'ch3-06-the-real-leaderboard', 25], ['15', 'ch3-10-the-ticker', 15]]) {
  const l = lv(n);
  ok(l.interview && l.interview.rebuild_of === rebuild && l.interview.minutes === minutes && l.interview.hint_xp_cost === 10, `${n} interview: ${minutes} min, rebuild_of ${rebuild}, hint cost 10`);
  ok(l.teach === undefined && l.reward.xp === 80, `${n} has no teach and rewards 80 XP`);
  const rebuilt = ch3.levels.find((x) => x.level.id === rebuild).level;
  ok(types(l) === types(rebuilt), `${n} has the same verifier list as ${rebuild} (${types(l)})`);
  const ownFixtures = new Set(l.verify.filter((v) => v.fixtures).map((v) => v.fixtures));
  ok([...ownFixtures].every((f) => f.startsWith(`fixtures/${n}-`)), `${n} uses its own fixture files`);
}
// scenarios, with the engine's own parser
const sc = await import(pathToFileURL(join(root, 'engine/dist/load/scenario.js')).href);
try {
  const s = await sc.loadScenario(join(root, 'scenarios'), 'leaderboard-storm');
  ok(s.connections === 100 && s.durationSec === 8 && s.warmup?.durationSec === 2 && s.users.count === 100 && s.users.distribution === 'uniform', 'leaderboard-storm: 100 connections, 8 s, 2 s warmup, 100 uniform users');
  const w = s.requests.map((r) => `${r.weight}:${r.path}`).join();
  ok(w === '70:/app/leaderboard/9001?limit=10,30:/app/leaderboard/9001/teams/{team}', 'leaderboard-storm: 70% top ten, 30% rank');
  ok(s.params.team.values.join() === 'ft-1,ft-5,ft-777,ft-12345,ft-39999', 'leaderboard-storm: the five teams');
} catch (e) { ok(false, `leaderboard-storm: ${e.message}`); }
try {
  const s = await sc.loadScenario(join(root, 'scenarios'), 'recompute-storm');
  ok(s.connections === 2 && s.durationSec === 8 && !s.warmup && s.requests.length === 1 && s.requests[0].method === 'POST' && s.requests[0].path === '/app/leaderboards/recompute', 'recompute-storm: 2 connections, 8 s, no warmup, one POST');
  ok(s.requests[0].body.matchIds.join() === 'm-001,m-002,m-003,m-004,m-005,m-006,m-007,m-008', 'recompute-storm: matchIds m-001 .. m-008');
} catch (e) { ok(false, `recompute-storm: ${e.message}`); }
// solution modules: parse as modules and export what their level needs
const bundle = ['top', 'addPoints', 'rank'];
const need = { '06-reference.js': bundle, '06-wrong-postgres.js': bundle, '06-wrong-sort-in-js.js': bundle };
for (const f of ['02-reference.js', '02-wrong-in-memory.js', '02-works-but-wrong-get-then-set.js', '02-works-but-wrong-no-expire.js', '03-reference.js', '03-wrong-allow-all.js', '03-works-but-wrong-js-race.js', '04-reference.js', '04-wrong-no-trim.js', '04-works-but-wrong-js-race.js', '08-reference.js', '08-wrong-one-at-a-time.js', '09-reference.js', '09-wrong-get-then-decrby.js', '09-wrong-watch-on-shared-client.js', '10-reference.js', '10-wrong-no-publish.js', '10-wrong-wrong-channel.js', '12-reference.js', '12-wrong-evalsha-only.js', '12-wrong-allow-all.js', '12-works-but-wrong-js-race.js']) need[f] = [];
for (const [file, names] of Object.entries(need)) {
  try {
    const m = await import(pathToFileURL(join(root, 'levels/ch3-compete-and-talk/solutions', file)).href);
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
    REDIS_PORT_STARTED="$PORT"
    pass "throwaway redis-server on 127.0.0.1:$PORT ($(redis-server --version | sed -E 's/.*v=([0-9.]+).*/redis \1/'))"
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
const url = `redis://127.0.0.1:${process.env.PROOF_PORT}`;

// packages/shared/src/learner/deps.ts closeRedis() arms a 2 s timer that calls client.destroy() and never clears it, so a
// duplicate that closed cleanly still gets destroy() called on it and throws ClientClosedError from a timer. The app and
// the runner child have uncaughtException handlers that log it. Count them here instead of dying, and say so at the end.
let strayClosed = 0;
process.on('uncaughtException', (e) => {
  if (e && (e.constructor?.name === 'ClientClosedError' || /The client is closed/.test(String(e.message)))) { strayClosed += 1; return; }
  console.error(e); process.exit(1);
});

const redis = createClient({ url });
redis.on('error', () => {});
await redis.connect();
const send = (cmd) => redis.sendCommand(cmd.map(String));

// A fake Postgres pool: contest_entries holds nothing for contest 9001, which is what the real database holds.
const fakePool = { query: async () => ({ rows: [] }) };
const toJson = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

// Every call gets its own learner deps from the real createLearnerDeps (counting, fail-fast and the swallowed connect()
// on the shared client, closed duplicates), over one shared connection, like the app does. Calls run in parallel up to
// the verifier's concurrency, like the runner does.
function pickFn(mod, slot) {
  const name = slot.split('.').slice(1).join('.');
  const hasBundle = ['top', 'addPoints', 'rank'].some((n) => typeof mod[n] === 'function');
  if (typeof mod[name] === 'function') return mod[name];
  if (hasBundle) return undefined;
  return mod.default;
}
function makeRun(mod) {
  return async (req) => {
    const fn = pickFn(mod, req.module);
    const results = new Array(req.calls.length);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= req.calls.length) return;
        const t0 = Date.now();
        const ctx = await shared.createLearnerDeps({ redisClient: redis, dbPool: fakePool, log: () => {} });
        try {
          if (!fn) throw new Error(`the bundle has no export for ${req.module}`);
          const value = await fn(ctx.deps, ...req.calls[i].args);
          results[i] = { ok: true, value: toJson(value), ms: Date.now() - t0 };
        } catch (e) {
          results[i] = { ok: false, error: { name: e.name, message: e.message }, ms: Date.now() - t0 };
        } finally {
          await ctx.close();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(req.concurrency, req.calls.length)) }, worker));
    return { results };
  };
}
const fixtureSteps = (dir, rel) => shared.fixtureFileSchema.parse(parse(readFileSync(join(dir, rel), 'utf8'))).steps;
const reset = async () => { await send(['FLUSHALL']); await send(['SCRIPT', 'FLUSH']); await send(['FUNCTION', 'FLUSH']); };

let bad = 0;
const row = (okv, text) => { console.log(`${okv ? 'PASS' : 'FAIL'}  ${text}`); if (!okv) bad++; };
const { chapters } = await shared.loadAllLevels(join(root, 'levels'));
const ch3 = chapters.find((c) => c.id === 'ch3');

// The only solutions allowed to differ locally from their declared verdict: what catches them is a traffic or quiz or
// service_scaled or ticker_gap verifier, which only the live engine can run.
const DEFER = {
  'ch3-06-the-real-leaderboard:06-wrong-sort-in-js.js': 'traffic leaderboard-storm (p99 with 40,000 members per request)',
  'ch3-14-interview-leaderboard:06-wrong-sort-in-js.js': 'traffic leaderboard-storm (p99 with 40,000 members per request)',
  'ch3-08-forty-thousand-updates:08-wrong-one-at-a-time.js': 'traffic recompute-storm (forty thousand round trips)',
  'ch3-11-at-most-once:11-wrong-numpat.redis': 'the ticker_gap event and the quizzes (its redis checks read global state)',
};
const liveByLevel = [];

for (const entry of ch3.levels) {
  const L = entry.level;
  const dir = dirname(entry.file);
  const liveKinds = new Set();
  for (const v of L.verify) {
    if (v.type === 'traffic') liveKinds.add(`traffic ${v.scenario}`);
    if (v.type === 'quiz') liveKinds.add('quiz');
    if (v.type === 'event') liveKinds.add(`event ${v.kind}${v.match?.name ? ` ${v.match.name}` : ''}${v.kind === 'channel_message' ? ' (emulated here)' : ''}`);
  }
  if (liveKinds.size) liveByLevel.push(`${L.id}: ${[...liveKinds].join('; ')}`);
  if (L.mode === 'decision') { console.log(`-- ${L.id}: decision level, checked statically (reference = the correct ids)`); continue; }
  if (L.mode === 'ops') { console.log(`-- ${L.id}: ops shell, never run by the harness; graded by hand by the orchestrator`); continue; }

  const solutions = [{ path: L.solutions.reference, expect: 'right' }, ...L.solutions.wrong.map((w) => ({ path: w.path, expect: w.expect }))];
  for (const s of solutions) {
    await reset();
    const file = join(dir, s.path);
    let failed = false;
    let hit = false;
    const notes = [];
    let sub = null;
    let heard = 0;
    const channelEvent = L.verify.find((v) => v.type === 'event' && v.kind === 'channel_message');
    const channelFor = channelEvent?.match.channel ?? (L.id.startsWith('ch3-11-') ? 'score:match:m-041' : null);
    if (channelFor) {
      sub = redis.duplicate();
      sub.on('error', () => {});
      await sub.connect();
      await sub.subscribe(channelFor, () => { heard += 1; });
    }
    try {
      if (L.mode === 'code') {
        const mod = await import(`${pathToFileURL(file).href}?${Math.random()}`);
        const run = makeRun(mod);
        const order = [...L.verify.filter((v) => v.type !== 'traffic')];
        for (const v of order) {
          if (v.type === 'behavior' || (v.type === 'antipattern' && v.slot)) {
            const err = await runFixtureSteps(fixtureSteps(dir, v.fixtures), send);
            if (err) { notes.push(err); failed = true; continue; }
            const r = await runAssertions({ slot: v.slot, module: v.slot, concurrency: v.concurrency, assertions: v.assertions }, { run, send });
            if (!r.ok) { if (v.type === 'behavior') failed = true; else hit = true; notes.push(`${v.type} ${v.slot}: ${r.message.split('\n').join(' | ').slice(0, 170)}`); }
          } else if (v.type === 'redis' || (v.type === 'antipattern' && v.checks)) {
            const items = await runChecks(send, v.checks);
            const badItems = items.filter((i) => !i.ok);
            if (badItems.length) { if (v.type === 'redis') failed = true; else hit = true; notes.push(`${v.type}: ${badItems.map((b) => b.feedback).join(' | ').slice(0, 170)}`); }
          } else if (v.type === 'event' && v.kind === 'channel_message') {
            await new Promise((r) => setTimeout(r, 150));
            if (heard === 0) { failed = true; notes.push(`event channel_message: nothing arrived on ${v.match.channel}`); }
          }
        }
      } else if (L.mode === 'cli') {
        // setup, then the .redis solution line by line, then every redis / antipattern check (level 11 has a subscriber
        // standing in for the app's ticker, which is what makes PUBSUB NUMSUB non-zero).
        for (const st of L.setup ?? []) if (st.cmd) await send(st.cmd);
        for (const line of readFileSync(file, 'utf8').split('\n')) {
          const t = line.trim();
          if (!t || t.startsWith('#')) continue;
          await send(t.split(/\s+/));
        }
        for (const v of L.verify) {
          if (v.type !== 'redis' && !(v.type === 'antipattern' && v.checks)) continue;
          const items = await runChecks(send, v.checks);
          const badItems = items.filter((i) => !i.ok);
          if (badItems.length) { if (v.type === 'redis') failed = true; else hit = true; notes.push(`${v.type}: ${badItems.map((b) => b.feedback).join(' | ').slice(0, 170)}`); }
        }
      }
    } finally {
      if (sub) { await sub.quit().catch(() => {}); }
    }
    const verdict = failed ? 'wrong' : hit ? 'works_but_wrong' : 'right';
    const key = `${L.id}:${s.path.replace('solutions/', '')}`;
    if (verdict !== s.expect && DEFER[key] && s.expect === 'wrong' && verdict === 'right') {
      console.log(`DEFER ${L.id} ${s.path}: declared wrong, local evaluators say right; it rests on ${DEFER[key]}`);
    } else {
      row(verdict === s.expect, `${L.id} ${s.path}: declared ${s.expect}, evaluators say ${verdict}`);
      if (verdict !== s.expect || process.env.VERBOSE) for (const x of notes) console.log(`        ${x}`);
    }
    if (verdict === s.expect && s.expect !== 'right') for (const x of notes.slice(0, 2)) console.log(`        how: ${x}`);
  }
}

console.log('\n-- extra proofs');
// 03: the reference survives the script cache being emptied (NOSCRIPT, then EVAL)
{
  await reset();
  const mod = await import(`${pathToFileURL(join(root, 'levels/ch3-compete-and-talk/solutions/03-reference.js')).href}?${Math.random()}`);
  const ctx = await shared.createLearnerDeps({ redisClient: redis, dbPool: fakePool });
  const got = [await mod.default(ctx.deps, 'u-noscript')];
  await send(['SCRIPT', 'FLUSH']);
  for (let i = 0; i < 14; i++) got.push(await mod.default(ctx.deps, 'u-noscript'));
  await ctx.close();
  row(got.filter(Boolean).length === 10, `03 reference after SCRIPT FLUSH (NOSCRIPT then EVAL): ${got.filter(Boolean).length} of 15 allowed, still exactly 10`);
}
// 12: the reference reloads its library when Redis has lost it
{
  await reset();
  const mod = await import(`${pathToFileURL(join(root, 'levels/ch3-compete-and-talk/solutions/12-reference.js')).href}?${Math.random()}`);
  const ctx = await shared.createLearnerDeps({ redisClient: redis, dbPool: fakePool });
  const got = [await mod.default(ctx.deps, 'u-fn')];
  const listed = await send(['FUNCTION', 'LIST', 'LIBRARYNAME', 'limiter']);
  await send(['FUNCTION', 'FLUSH']);
  for (let i = 0; i < 14; i++) got.push(await mod.default(ctx.deps, 'u-fn'));
  const after = await send(['FUNCTION', 'LIST', 'LIBRARYNAME', 'limiter']);
  await ctx.close();
  row(got.filter(Boolean).length === 10 && Array.isArray(listed) && listed.length === 1 && Array.isArray(after) && after.length === 1, `12 reference: library loaded lazily, reloaded after FUNCTION FLUSH, ${got.filter(Boolean).length} of 15 allowed`);
}
// 09: the shared-client WATCH solution must overspend every time, not just sometimes
{
  const dir = join(root, 'levels/ch3-compete-and-talk');
  const mod = await import(`${pathToFileURL(join(dir, 'solutions/09-wrong-watch-on-shared-client.js')).href}?${Math.random()}`);
  const run = makeRun(mod);
  const counts = [];
  for (let k = 0; k < 5; k++) {
    await runFixtureSteps(fixtureSteps(dir, 'fixtures/09-wallet-100.yaml'), send);
    const res = await run({ module: 'contest.join', concurrency: 50, calls: Array.from({ length: 50 }, () => ({ args: ['u-000010', 9001, 10] })) });
    counts.push(res.results.filter((r) => r.ok && r.value === true).length);
  }
  row(counts.every((c) => c > 10), `09 watch-on-shared-client: joins that succeeded in five runs of 50: ${counts.join(', ')} (every run above 10: it fails reliably)`);
}
// 08 and 06: evidence for the two solutions that only the load test condemns (not verdicts)
{
  await reset();
  const dir = join(root, 'levels/ch3-compete-and-talk/solutions');
  const rows = [];
  for (let i = 0; i < 40098; i++) rows.push({ contestId: (i % 8) + 1, teamId: `t-${i}`, points: (i * 7) % 1000 });
  const timeIt = async (file) => {
    const mod = await import(`${pathToFileURL(join(dir, file)).href}?${Math.random()}`);
    const ctx = await shared.createLearnerDeps({ redisClient: redis, dbPool: fakePool, commandTimeoutMs: 0 });
    const t0 = Date.now();
    await mod.default(ctx.deps, rows);
    const ms = Date.now() - t0;
    await ctx.close();
    return ms;
  };
  const ref = await timeIt('08-reference.js');
  const slow = await timeIt('08-wrong-one-at-a-time.js');
  console.log(`      08 recompute of 40,098 rows on this machine, local redis: pipelined ${ref} ms, one at a time ${slow} ms (evidence only; the live p99 limit is 2500 ms through the network and the proxy)`);
  row(slow > ref, '08 one-at-a-time is slower than the pipelined reference');
  await reset();
  await runFixtureSteps(fixtureSteps(join(root, 'levels/ch3-compete-and-talk'), 'fixtures/06-seed-40k.yaml'), send);
  const timeTop = async (file) => {
    const mod = await import(`${pathToFileURL(join(dir, file)).href}?${Math.random()}`);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 100 }, async () => {
      const ctx = await shared.createLearnerDeps({ redisClient: redis, dbPool: fakePool, commandTimeoutMs: 0 });
      try { await mod.top(ctx.deps, 9001, 10); } finally { await ctx.close(); }
    }));
    return Date.now() - t0;
  };
  const a = await timeTop('06-reference.js');
  const b = await timeTop('06-wrong-sort-in-js.js');
  console.log(`      06 one wave of 100 concurrent top(9001, 10) on 40,000 members: reference ${a} ms, sort in JavaScript ${b} ms (evidence only)`);
  row(b > a, '06 sort-in-JavaScript is slower than the reference under a wave of 100');
}
await new Promise((r) => setTimeout(r, 2500));
if (strayClosed) console.log(`NOTE  ${strayClosed} ClientClosedError(s) from the 2 s timer in createLearnerDeps' closeRedis (not mine, see the handoff): swallowed here, logged by the app and the runner`);
await redis.quit();
process.exit(bad ? 1 : 0);
EOF
    QUEST_ROOT="$ROOT" PROOF_PORT="$PORT" node "$TMP/proof.mjs" > "$TMP/proof.out" 2>&1; RC=$?
    cat "$TMP/proof.out"
    [ $RC -eq 0 ] && pass "every solution gets its declared verdict from the engine's evaluators (deferred ones are listed)" || fail "a solution got a different verdict than declared, or an extra proof failed (exit $RC)"

    step "which verdicts rest on traffic or events (the orchestrator's live grading through the engine)"
    node -e '
      const lines = process.argv.slice(1);
      for (const l of lines) console.log("LIVE  " + l);
    ' "ch3-01-you-are-not-alone: event service_scaled and 2 quizzes, and the ops shell (graded by hand)" \
      "ch3-02-fixed-window: quiz (the behavior and both antipatterns are proven above)" \
      "ch3-04-sliding-window-log: quiz" \
      "ch3-05-fail-open-or-fail-closed: three quizzes (decision level)" \
      "ch3-06-the-real-leaderboard: traffic leaderboard-storm decides 06-wrong-sort-in-js.js (declared wrong); behaviors proven above" \
      "ch3-07-hostel-college-india: quiz" \
      "ch3-08-forty-thousand-updates: traffic recompute-storm decides 08-wrong-one-at-a-time.js (declared wrong), and the reference's own pass" \
      "ch3-10-the-ticker / ch3-15-interview-ticker: event channel_message needs the learner's curl live (here the solution's own publish stands in)" \
      "ch3-11-at-most-once: event ticker_gap, 2 quizzes, and PUBSUB NUMSUB needs the app subscribed (a subscriber stands in here)" \
      "ch3-14-interview-leaderboard: traffic leaderboard-storm" \
      "ch3-02..04, 12, 13: the concurrency antipattern is proven here with 100 parallel calls; the live runner repeats it"

    step "scripts/ticker-drill.sh against a stub of the app's ticker (own redis-server, fake docker and curl-free stub server)"
    cat > "$TMP/stub.mjs" <<'EOF'
// Stands in for the app: a subscriber on score:match:m-041 with the app's gap rule, GET /app/ticker/:id,
// POST /app/ticker/resubscribe, and GET /api/events. Two "instances" answer alternately, only the first resubscribes.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const root = process.env.QUEST_ROOT;
const { createClient } = await import(pathToFileURL(join(root, 'app/node_modules/redis/dist/index.js')).href);
const url = `redis://127.0.0.1:${process.env.PROOF_PORT}`;
const events = [];
function instance(name) {
  const st = { name, received: 0, lastSeq: null, gaps: 0 };
  const sub = createClient({ url });
  sub.on('error', () => {});
  const handler = (message) => {
    const m = JSON.parse(message);
    st.received += 1;
    if (st.lastSeq !== null && m.seq > st.lastSeq + 1) {
      st.gaps += 1;
      events.push({ at: new Date().toISOString(), type: 'level.event', data: { kind: 'custom', name: 'ticker_gap', data: { matchId: 'm-041', instance: name, expected: st.lastSeq + 1, got: m.seq, missed: m.seq - st.lastSeq - 1 } } });
    }
    st.lastSeq = m.seq;
  };
  return { st, sub, handler, start: async () => { await sub.connect(); await sub.subscribe('score:match:m-041', handler); } };
}
const a = instance('aaaa11112222');
const b = instance('bbbb33334444');
await a.start(); await b.start();
let turn = 0;
const server = createServer(async (req, res) => {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'GET' && req.url === '/app/ticker/m-041') {
    const inst = turn++ % 2 === 0 ? a : b;
    return send(200, { matchId: 'm-041', subscribed: true, received: inst.st.received, lastSeq: inst.st.lastSeq, last: null, recent: [], gaps: inst.st.gaps, malformed: 0, instance: inst.st.name });
  }
  if (req.method === 'POST' && req.url === '/app/ticker/resubscribe') {
    let raw = ''; for await (const c of req) raw += c;
    const { pauseMs } = JSON.parse(raw);
    await a.sub.unsubscribe('score:match:m-041');
    await new Promise((r) => setTimeout(r, pauseMs));
    await a.sub.subscribe('score:match:m-041', a.handler);
    return send(200, { ok: true, instance: a.st.name, pausedMs: pauseMs });
  }
  if (req.method === 'GET' && req.url === '/api/events') return send(200, { events });
  send(404, { error: 'no' });
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
EOF
    mkdir -p "$TMP/fakebin"
    cat > "$TMP/fakebin/docker" <<EOF
#!/usr/bin/env bash
# compose exec -T redis redis-cli <args>  ->  redis-cli against the throwaway server
shift 4
shift 1
exec redis-cli -p "$PORT" "\$@"
EOF
    chmod +x "$TMP/fakebin/docker"
    QUEST_ROOT="$ROOT" PROOF_PORT="$PORT" node "$TMP/stub.mjs" > "$TMP/stub.port" 2> "$TMP/stub.err" &
    STUB_PID=$!
    i=0; while [ ! -s "$TMP/stub.port" ] && [ $i -lt 40 ]; do sleep 0.25; i=$((i + 1)); done
    STUB_PORT=$(cat "$TMP/stub.port" 2>/dev/null)
    if [ -n "$STUB_PORT" ]; then
      PATH="$TMP/fakebin:$PATH" PROXY_PORT="$STUB_PORT" scripts/ticker-drill.sh > "$TMP/drill.out" 2>&1; DRC=$?
      sed 's/^/      /' "$TMP/drill.out"
      [ $DRC -eq 0 ] && pass "ticker-drill.sh exits 0" || fail "ticker-drill.sh exited $DRC"
      grep -q 'PUBLISH seq 1 -> 2 receiver' "$TMP/drill.out" && pass "ball 1 reached both stub instances" || fail "ball 1 did not reach two receivers"
      grep -q 'PUBLISH seq 2 -> 1 receiver' "$TMP/drill.out" && grep -q 'PUBLISH seq 3 -> 1 receiver' "$TMP/drill.out" && pass "balls 2 and 3 reached only the instance that was listening" || fail "balls 2 and 3 were not published into the pause"
      grep -q 'PUBLISH seq 4 -> 2 receiver' "$TMP/drill.out" && pass "ball 4 reached both again" || fail "ball 4 did not reach two receivers"
      grep -q 'instance=aaaa received=2 lastSeq=4 gaps=1' "$TMP/drill.out" && grep -q 'instance=bbbb received=4 lastSeq=4 gaps=0' "$TMP/drill.out" && pass "summary: the paused copy received 2 and saw a gap, the other received 4" || fail "summary lines are not what the stub should print"
      grep -q '"name":"ticker_gap","data":{"matchId":"m-041"' "$TMP/drill.out" && pass "the ticker_gap event line is printed" || fail "no ticker_gap line printed"
      PATH="$TMP/fakebin:$PATH" PROXY_PORT=1 scripts/ticker-drill.sh >/dev/null 2>&1; [ $? -eq 2 ] && pass "ticker-drill.sh exits 2 when the app does not answer" || fail "ticker-drill.sh should exit 2 with no app"
    else
      fail "the stub server did not start: $(cat "$TMP/stub.err" 2>/dev/null | head -3)"
    fi
    { kill "$STUB_PID"; wait "$STUB_PID"; } >/dev/null 2>&1 || true
  else
    fail "could not start a throwaway redis-server"
  fi
fi

step "owned files"
echo "git status --short (this task's paths):"
git status --short -- "$CH" scenarios/leaderboard-storm.yaml scenarios/recompute-storm.yaml scripts/ticker-drill.sh scripts/check/C3.sh docs/handoffs/C3.md 2>/dev/null | sed 's/^/  /'

echo
if [ $FAILS -eq 0 ]; then echo "C3 OK"; exit 0; fi
echo "C3 FAILED ($FAILS)"; exit 1
