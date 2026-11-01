#!/usr/bin/env bash
# C4b acceptance: Chapter 4b, "On call" (7 levels: six diagnose-first code levels and one decision checklist).
# Static part: the chapter validates with 7 levels, chapter.yaml lists every level in order, every solution and fixture exists and
# parses, every solution module is valid JavaScript with the exports its level needs (level 4 is a bundle named after its two slots),
# the spec's rules hold in each level's verify list, the three scenarios parse with the engine's own scenario parser, the team names
# match fiction/teams.json, the fiction rules hold (no real cricketer or franchise, no bet/stake/payout/cash/IPL, no AI or vector
# content), and the on-call rules hold (level 5 tells the learner to kill the script before Verify or Start).
# Local proof part: starts ONE throwaway container,
#     docker run -d --rm --name quest-c4b-redis -p 127.0.0.1:6399:6379 redis:8
# (no compose project, never the default project, never a quest-* project), stops it on exit, and runs the engine's own behavior,
# antipattern and redis evaluators against every reference and wrong solution of every code level (each level's own `setup` first,
# learner dependencies built by the real createLearnerDeps, a fake Postgres that knows one player row), then compares the verdict
# with the declared one. Quizzes, events (load_finished, redis_busy, script_killed) and traffic verifiers are NOT run here: they
# are the orchestrator's live grading, and the proof prints which verdicts rest on them. Extra proofs re-measure every size and time
# a level quotes (MEMORY USAGE, DEL against UNLINK, the KEYS slow log entry, key sizes, the BUSY timeline, the setup scripts' own
# durations) and approximate the one traffic bound that can be approximated (Redis commands per call of level 1's two files).
# If Docker is not running the proof is SKIPPED with a loud NOTE and says so in the summary.
# Development: C4B_LEVELS=levels/.c4b-wip runs the check against a chapter that is not in the engine's tree yet.
# bash 3.2 compatible: no associative arrays, no mapfile.
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
LEVELS="${C4B_LEVELS:-levels}"
CH="$LEVELS/ch4b-on-call"
FAILS=0
TMP=$(mktemp -d "${TMPDIR:-/tmp}/c4b.XXXXXX")
CONTAINER="quest-c4b-redis"
HOST_PORT=6399
CONTAINER_STARTED=""
PROOF_RAN=""

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILS=$((FAILS + 1)); }
step() { echo; echo "== $1"; }

cleanup() {
  if [ -n "$CONTAINER_STARTED" ]; then docker stop "$CONTAINER" >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

step "build @quest/shared and @quest/engine (the evaluators, the scenario parser and the CLI splitter come from the engine)"
pnpm --filter @quest/shared build >/dev/null 2>&1 && pass "shared build" || { fail "shared build"; exit 1; }
pnpm --filter @quest/engine build >/dev/null 2>&1 && pass "engine build" || { fail "engine build"; exit 1; }

step "validate $CH"
OUT=$(pnpm --silent --filter @quest/shared levels:validate "$CH" 2>&1); RC=$?
if [ $RC -eq 0 ]; then pass "$OUT"; else fail "validate (exit $RC)"; echo "$OUT"; fi
case "$OUT" in *"7 level(s)"*) pass "7 levels";; *) fail "expected 7 levels in the chapter";; esac

step "chapter.yaml"
if sed -n 's/^id: *//p' "$CH/chapter.yaml" | head -n 1 | grep -qx 'ch4b'; then pass "chapter id ch4b"; else fail "chapter id is not ch4b"; fi
LISTED=$(grep -E '^  - ch4b-' "$CH/chapter.yaml" | wc -l | tr -d ' ')
[ "$LISTED" -eq 7 ] && pass "chapter lists exactly 7 levels" || fail "chapter lists $LISTED levels, want 7"
ORDER=$(grep -E '^  - ch4b-' "$CH/chapter.yaml" | sed -E 's/^  - //' | tr '\n' ' ')
WANT="ch4b-01-one-celebrity-player ch4b-02-one-hash-with-three-lakh-fields ch4b-03-a-cron-runs-keys ch4b-04-memory-grows-every-day ch4b-05-everything-froze ch4b-06-connections-climbing ch4b-07-the-on-call-checklist "
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
    esac
  done
  for p in $(grep -E '^[[:space:]]*fixtures:[[:space:]]+fixtures/' "$f" | sed -E 's/.*(fixtures\/[^[:space:]]+).*/\1/' | sort -u); do
    if [ -s "$CH/$p" ]; then pass "  $p exists, non-empty"; else fail "  $p missing or empty ($id)"; fi
  done
  if grep -qE '^docs:' "$f" && grep -qE '^  - https://redis\.io/docs/' "$f"; then pass "  docs link present"; else fail "  no docs link ($id)"; fi
  n=$(awk '/^teach: \|/{t=1;next} t&&/^[^ ]/{exit} t{c++} END{print c+0}' "$f")
  if [ "$n" -ge 8 ] && [ "$n" -le 28 ]; then pass "  teach is $n lines"; else fail "  teach is $n lines, want 8 to 28 ($id)"; fi
  if grep -qiE '\b(bet|stake|payout|cash|ipl)\b' "$f"; then fail "  forbidden fiction word (bet, stake, payout, cash, IPL) in $id"; fi
done
[ "$COUNT" -eq 7 ] && pass "7 level files" || fail "found $COUNT level files, want 7"
for p in "$CH"/fixtures/*.yaml; do
  base=$(basename "$p")
  grep -rq "fixtures/$base" "$CH"/[0-9][0-9]-*.yaml && pass "fixtures/$base is used by a level" || fail "fixtures/$base is not used by any level"
done
for p in "$CH"/solutions/*; do
  base=$(basename "$p")
  grep -q "solutions/$base" "$CH"/[0-9][0-9]-*.yaml && pass "solutions/$base is declared by a level" || fail "solutions/$base is not declared by any level"
done

step "spec rules, scenarios and solution modules (one node pass over the real parsed levels and the engine's scenario parser)"
cat > "$TMP/static.mjs" <<'EOF'
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
const root = process.env.QUEST_ROOT;
const levelsDir = process.env.QUEST_LEVELS;
const shared = await import(pathToFileURL(join(root, 'packages/shared/dist/index.js')).href);
const scenarioMod = await import(pathToFileURL(join(root, 'engine/dist/load/scenario.js')).href);
const { chapters } = await shared.loadAllLevels(join(root, levelsDir));
const ch = chapters.find((c) => c.id === 'ch4b');
const DIR = join(levelsDir, 'ch4b-on-call');
const lv = (n) => ch.levels.find((l) => l.level.id.startsWith(`ch4b-${n}-`)).level;
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const vs = (l, type) => l.verify.filter((v) => v.type === type);
const sideEffects = (v) => (v.assertions ?? []).flatMap((a) => a.sideEffect ?? []);
const wrongs = (l) => l.solutions.wrong.map((w) => `${(w.path ?? w.option).replace('solutions/', '')}:${w.expect}`).join();
const types = (l) => l.verify.map((v) => v.type).join();
const slotsOf = (l) => [...new Set(l.verify.filter((v) => v.slot).map((v) => v.slot))].join();
const cmdText = (c) => c.cmd.join(' ');
const read = (rel) => readFileSync(join(root, DIR, rel), 'utf8');
const eventOf = (l, name) => vs(l, 'event').find((e) => e.kind === 'custom' && e.match.name === name);

ok(ch && ch.levels.length === 7, 'chapter ch4b loads with 7 levels');
// ---- chapter
{
  const raw = read('chapter.yaml');
  const times = [...raw.matchAll(/time: "(\d\d:\d\d)"/g)].map((m) => m[1]);
  ok(times.length >= 6 && times.length <= 8, `incident thread has ${times.length} lines (six to eight)`);
  ok(times[0] === '02:05' && times[times.length - 1] === '02:20', `incident runs ${times[0]} to ${times[times.length - 1]} (02:05 to 02:20)`);
  ok(JSON.stringify(times) === JSON.stringify([...times].sort()), 'incident times are in order');
  ok(ch.chapter.title === 'On call', 'chapter title is "On call"');
  const slugs = new Set([...raw.matchAll(/from: ([a-z-]+)/g)].map((m) => m[1]));
  const cast = JSON.parse(readFileSync(join(root, 'fiction/cast.json'), 'utf8')).cast.map((c) => c.slug);
  ok([...slugs].every((s) => s === 'you' || cast.includes(s)), `incident speakers are cast slugs or "you" (${[...slugs].join(', ')})`);
  ok(!/from: senior\s*\n\s*time: "02:(0|1[0-9])"/.test(raw) && /from: senior\s*\n\s*time: "02:20"/.test(raw), 'Harry Bhaiya is asleep until 02:20 (his only line is the last)');
  const emoji = (raw.match(/[\u{1F300}-\u{1FAFF}]/gu) ?? []).length;
  ok(emoji <= 2, `at most two emoji in the thread (${emoji})`);
}
// ---- the whole chapter: fiction rules, denylist, no AI content
{
  const deny = JSON.parse(readFileSync(join(root, 'fiction/denylist.json'), 'utf8'));
  const names = [...deny.cricketers, ...deny.franchises].map((n) => n.toLowerCase());
  let hit = null;
  const files = readdirSync(join(root, DIR)).filter((f) => f.endsWith('.yaml'));
  for (const f of files) {
    const t = read(f).toLowerCase();
    for (const n of names) if (t.includes(n)) hit = `${f}: ${n}`;
  }
  ok(!hit, `no denylisted cricketer or franchise in any chapter file${hit ? ` (${hit})` : ''}`);
  let aiHit = null;
  for (const f of files) if (/\b(AI|LLM|embeddings?|vectors?)\b/.test(read(f))) aiHit = f;
  ok(!aiHit, `no AI, vector or LLM content${aiHit ? ` (${aiHit})` : ''}`);
  ok(ch.levels.every((e) => e.level.reward.xp >= 40 && e.level.reward.xp <= 70), `every reward is 40 to 70 XP (${ch.levels.map((e) => e.level.reward.xp).join(', ')})`);
  ok(ch.levels.every((e) => e.level.brainstorm.options.some((o) => o.id === 'not-redis')), 'every brainstorm has a not-redis option');
  ok(ch.levels.every((e) => e.level.mode === 'decision' || (e.level.hints ?? []).length >= 3), 'every code level has three or more hints');
  ok(ch.levels.every((e) => e.level.solutions.wrong.every((w) => w.because && w.because.length > 40)), 'every wrong solution has a real because');
}
// ---- scenarios, parsed with the engine's parser
{
  const dir = join(root, 'scenarios');
  const cel = await scenarioMod.loadScenario(dir, 'celebrity-100');
  ok(cel.durationSec === 10 && cel.connections === 100 && !cel.warmup && cel.requests.length === 1 && cel.requests[0].method === 'GET' && cel.requests[0].path === '/app/players/p-028/stats', 'celebrity-100: 100 connections, 10 s, no warmup, one request GET /app/players/p-028/stats');
  const views = await scenarioMod.loadScenario(dir, 'oncall-views-100');
  ok(views.durationSec === 8 && views.connections === 100 && views.users.count === 20000 && views.users.distribution === 'uniform' && views.requests.length === 1 && views.requests[0].method === 'POST' && views.requests[0].path === '/app/oncall/views' && JSON.stringify(views.requests[0].body) === JSON.stringify({ userId: '{user}', matchId: 'm-041' }), 'oncall-views-100: 100 connections, 8 s, 20,000 users uniform, POST /app/oncall/views { userId: "{user}", matchId: "m-041" }');
  const teams = await scenarioMod.loadScenario(dir, 'oncall-teams-100');
  ok(teams.durationSec === 8 && teams.connections === 100 && teams.requests[0].method === 'GET' && teams.requests[0].path === '/app/oncall/teams/{team}' && JSON.stringify(teams.params.team.values) === JSON.stringify(['t-01', 't-02', 't-03', 't-04', 't-05', 't-06', 't-07', 't-08']), 'oncall-teams-100: 100 connections, 8 s, GET /app/oncall/teams/{team} over t-01 .. t-08');
  ok(JSON.stringify(ch.levels.filter((e) => e.level.scenario).map((e) => `${e.level.id.slice(0, 7)}=${e.level.scenario}`)) === JSON.stringify(['ch4b-01=celebrity-100', 'ch4b-04=oncall-views-100', 'ch4b-06=oncall-teams-100']), 'levels 01, 04 and 06 name their scenarios; no other level has one');
}
// ---- 01
{
  const l = lv('01');
  ok(l.mode === 'code' && l.scenario === 'celebrity-100' && types(l) === 'quiz,behavior,event,traffic', `01 code, scenario celebrity-100, verify order ${types(l)}`);
  const q = vs(l, 'quiz')[0];
  ok(q.correct.join() === 'hot-key' && q.options.map((o) => o.id).sort().join() === 'big-key,connection-leak,hot-key,slow-command', '01 quiz: hot-key against big-key, slow-command, connection-leak');
  const b = vs(l, 'behavior')[0];
  ok(b.slot === 'cache.getPlayerStats' && b.assertions[0].call.args[0] === 'p-028' && b.assertions[0].repeat === 2 && sideEffects(b).some((c) => c.cmd[0] === 'TYPE' && c.equals === 'hash') && b.assertions[1].call.args[0] === 'p-999' && b.assertions[1].expect === null, '01 behavior: p-028 twice leaves a hash, p-999 is null');
  const e = eventOf(l, 'load_finished');
  ok(e && e.match.scenario === 'celebrity-100' && e.timeoutMs === 60000, '01 event custom load_finished celebrity-100, timeoutMs 60000');
  const t = vs(l, 'traffic')[0];
  ok(t.scenario === 'celebrity-100' && t.baseline === false && t.assertions.redis_per_request_lte === 0.2 && t.assertions.error_rate_lte === 0 && t.assertions.p99_ms_lte === 100, '01 traffic: baseline false, redis_per_request_lte 0.2, error_rate_lte 0, p99_ms_lte 100');
  ok(l.show_me.component === 'cache_stats' && l.show_me.keys.length === 0, '01 show_me cache_stats []');
  ok(wrongs(l) === '01-wrong-plain-cache.js:wrong', '01 solutions: reference + the plain Chapter 2 cache');
  ok(/RESP: 3/.test(l.teach) && /clientSideCache/.test(l.teach) && /INFO commandstats/.test(l.task) && /INFO stats/.test(l.task) && /Run traffic/.test(l.task), '01 teach names RESP: 3 and clientSideCache; task names INFO commandstats, INFO stats and Run traffic');
  ok(/export default async function getPlayerStats/.test(l.task), '01 task carries a cache-aside for a learner who lost the Chapter 2 file');
}
// ---- 02
{
  const l = lv('02');
  ok(l.mode === 'code' && !l.scenario && types(l) === 'quiz,behavior,redis' && l.setup.length === 2 && /300000/.test(l.setup[0].cmd[1]) && /fans:t-01:\*/.test(l.setup[0].cmd[1]) && l.setup[1].cmd.join(' ') === 'CONFIG RESETSTAT', `02 setup: one EVAL building 300,000 fields and clearing the buckets, then CONFIG RESETSTAT; verify order ${types(l)}`);
  const b = vs(l, 'behavior')[0];
  ok(b.slot === 'oncall.splitBigKey' && JSON.stringify(b.assertions[0].call.args) === '["fans:t-01",64]' && JSON.stringify(b.assertions[0].expect) === '{"fields":300000,"buckets":64}', '02 behavior: splitBigKey("fans:t-01", 64) -> { fields: 300000, buckets: 64 }');
  const se = sideEffects(b);
  ok(se.some((c) => cmdText(c) === 'EXISTS fans:t-01' && c.equals === 0) && se.some((c) => c.cmd[0] === 'EVAL_RO' && /HLEN/.test(c.cmd[1]) && c.equals === 300000), '02 side effects: original gone, 64 buckets sum to 300000');
  ok(vs(l, 'redis')[0].checks[0].cmd.join(' ') === 'INFO commandstats' && /cmdstat_unlink/.test(vs(l, 'redis')[0].checks[0].matches), '02 redis: INFO commandstats matches cmdstat_unlink:calls=[1-9]');
  ok(l.show_me.component === 'hash_card' && l.show_me.keys[0] === 'fans:t-01:0', '02 show_me hash_card fans:t-01:0');
  ok(/15,180,435/.test(l.teach) && /--bigkeys/.test(l.task) && /OBJECT ENCODING/.test(l.task) && /MEMORY USAGE/.test(l.task) && /HLEN/.test(l.task) && /512/.test(l.teach), '02 task names MEMORY USAGE, OBJECT ENCODING, HLEN and --bigkeys; teach quotes 15,180,435 and the 512 limit');
  ok(wrongs(l) === '02-wrong-del.js:wrong', '02 solutions: reference + DEL');
  ok(read('fixtures/02-big-hash.yaml').includes('CONFIG, RESETSTAT'), '02 fixture rebuilds the hash and ends with CONFIG RESETSTAT');
}
// ---- 03
{
  const l = lv('03');
  ok(l.mode === 'code' && !l.scenario && types(l) === 'quiz,behavior,redis' && l.setup.length === 4 && /500000/.test(l.setup[0].cmd[1]) && l.setup[1].cmd.join(' ') === 'SLOWLOG RESET' && l.setup[3].cmd.join(' ') === 'CONFIG SET latency-monitor-threshold 10', `03 setup: 500,000 keys by one EVAL, SLOWLOG RESET, LATENCY RESET, latency-monitor-threshold 10; verify order ${types(l)}`);
  const b = vs(l, 'behavior')[0];
  ok(b.slot === 'oncall.countUsers' && JSON.stringify(b.assertions[0].call.args) === '["oncall:user:"]' && b.assertions[0].expect === 500000 && b.fixtures === 'fixtures/03-reset-stats.yaml', '03 behavior: countUsers("oncall:user:") -> 500000 after a stats reset');
  const r = vs(l, 'redis')[0].checks;
  ok(r.length === 2 && r[0].cmd.join(' ') === 'INFO commandstats' && r[0].notContains === 'cmdstat_keys' && r[1].matches === 'cmdstat_scan:calls=[1-9]', '03 redis: notContains cmdstat_keys, matches cmdstat_scan:calls=[1-9]');
  ok(/SLOWLOG GET 5/.test(l.task) && /LATENCY LATEST/.test(l.task) && /LATENCY DOCTOR/.test(l.task) && /curl 'localhost:3000\/app\/oncall\/users\/count\?prefix=oncall:user:'/.test(l.task), '03 task: the curl three times, SLOWLOG GET 5, LATENCY LATEST, LATENCY DOCTOR');
  ok(l.show_me.component === 'cache_stats' && wrongs(l) === '03-wrong-keys.js:wrong', '03 show_me cache_stats; solutions: reference + KEYS');
  ok(read('fixtures/03-reset-stats.yaml').includes('CONFIG, RESETSTAT') && read('fixtures/03-reset-stats.yaml').includes('SLOWLOG, RESET'), '03 fixture: CONFIG RESETSTAT and SLOWLOG RESET');
}
// ---- 04
{
  const l = lv('04');
  ok(l.mode === 'code' && l.scenario === 'oncall-views-100' && types(l) === 'quiz,behavior,behavior,antipattern,event', `04 scenario oncall-views-100; verify order ${types(l)}`);
  ok(slotsOf(l) === 'oncall.recordView,oncall.addTtls', '04 verifies both slots (a bundle: recordView, addTtls)');
  ok(l.setup.length === 3 && /5000/.test(l.setup[2].cmd[1]) && /oncall:user:\*/.test(l.setup[0].cmd[1]) && l.setup[1].cmd.join(' ') === 'CONFIG SET latency-monitor-threshold 0', '04 setup: unlink the level-3 keys, restore latency-monitor-threshold 0, seed 5,000 views with no TTL');
  const rec = vs(l, 'behavior')[0];
  ok(sideEffects(rec).every((c) => c.between === undefined) && sideEffects(rec).some((c) => cmdText(c) === 'EXISTS view:u-000010:m-041' && c.equals === 1), '04 recordView behavior only checks the key exists (the TTL bound is the antipattern, the 2.2 rule)');
  const add = vs(l, 'behavior')[1];
  ok(JSON.stringify(add.assertions[0].call.args) === '["view:*",86400]' && add.assertions[0].expect === 1000 && sideEffects(add).some((c) => c.cmd[0] === 'EVAL_RO' && /TTL/.test(c.cmd[1]) && c.equals === 0), '04 addTtls behavior: ("view:*", 86400) -> 1000, then no view:* key with TTL -1');
  const a = vs(l, 'antipattern')[0];
  ok(a.slot === 'oncall.recordView' && sideEffects(a).some((c) => cmdText(c) === 'TTL view:u-000010:m-041' && c.between.join() === '1,86400'), '04 antipattern: recordView leaves a TTL between 1 and 86400');
  const e = eventOf(l, 'load_finished');
  ok(e && e.match.scenario === 'oncall-views-100' && e.timeoutMs === 60000, '04 event load_finished oncall-views-100, timeoutMs 60000');
  ok(l.show_me.component === 'ttl_timer' && l.show_me.keys[0] === 'view:u-000010:m-041', '04 show_me ttl_timer');
  ok(wrongs(l) === '04-wrong-no-ttl.js:wrong,04-works-but-wrong-sweep-only.js:works_but_wrong', '04 solutions as bound');
  ok(/INFO keyspace/.test(l.task) && /INFO memory/.test(l.task) && /--memkeys/.test(l.task), '04 task: INFO keyspace, INFO memory, --memkeys');
  ok(read('fixtures/04-seed-views.yaml').includes('11, 1010') && /view:\*/.test(read('fixtures/04-seed-views.yaml')), '04 fixture: clears view:* then seeds 1,000 views u-000011 .. u-001010');
}
// ---- 05
{
  const l = lv('05');
  ok(l.mode === 'code' && !l.scenario && types(l) === 'event,event,quiz,quiz,behavior,redis', `05 verify order ${types(l)}`);
  ok(eventOf(l, 'redis_busy')?.timeoutMs === 300000 && eventOf(l, 'script_killed')?.timeoutMs === 300000, '05 events redis_busy and script_killed, timeoutMs 300000');
  const b = vs(l, 'behavior')[0];
  const se = sideEffects(b);
  ok(b.slot === 'oncall.recomputeBadges' && JSON.stringify(b.assertions[0].call.args) === '[]' && se.some((c) => cmdText(c) === 'HGET badges:fifties m-901' && c.equals === 3) && se.some((c) => cmdText(c) === 'HGET badges:fifties m-902' && c.equals === 4), '05 behavior: recomputeBadges() -> badges:fifties m-901 = 3, m-902 = 4');
  const r = vs(l, 'redis')[0].checks[0];
  ok(r.cmd.join(' ') === 'INFO commandstats' && r.notContains === 'cmdstat_eval:', '05 redis: INFO commandstats notContains "cmdstat_eval:" (the colon keeps eval_ro and evalsha out of it)');
  ok(/Kill the script before you press Verify or Start/.test(l.task) && /BUSY/.test(l.task) && /counts as an attempt/.test(l.task), '05 task says plainly: kill the script before Verify or Start (every check BUSY, counts as an attempt)');
  ok(l.hints.some((h) => /BUSY/.test(h) && /attempt/.test(h)), '05 a hint repeats the warning');
  ok(/busy-reply-threshold/.test(l.teach) && /SCRIPT KILL/.test(l.teach) && /SHUTDOWN NOSAVE/.test(l.teach) && /5,164,480/.test(l.teach), '05 teach: busy-reply-threshold, SCRIPT KILL, SHUTDOWN NOSAVE, the measured 5,164,480 microseconds');
  ok(/SLOWLOG GET 3/.test(l.task) && /CONFIG GET busy-reply-threshold/.test(l.task) && /curl -X POST localhost:3000\/app\/oncall\/badges\/recompute/.test(l.task), '05 task: curl the job, PING, SLOWLOG GET 3, SCRIPT KILL, CONFIG GET busy-reply-threshold');
  ok(l.show_me.component === 'hash_card' && l.show_me.keys[0] === 'badges:fifties', '05 show_me hash_card badges:fifties');
  ok(wrongs(l) === '05-wrong-lua-loop.js:wrong', '05 solutions: reference + the Lua loop');
  const fx = read('fixtures/05-two-matches.yaml');
  ok(/DEL.*badges:fifties/.test(fx) && fx.trimEnd().split('\n').pop().includes('RESETSTAT'), '05 fixture: DEL badges:fifties, two zsets, CONFIG RESETSTAT last');
}
// ---- 06
{
  const l = lv('06');
  ok(l.mode === 'code' && l.scenario === 'oncall-teams-100' && types(l) === 'quiz,behavior,event,redis', `06 scenario oncall-teams-100; verify order ${types(l)}`);
  const teamsJson = JSON.parse(readFileSync(join(root, 'fiction/teams.json'), 'utf8')).teams;
  const fromSetup = l.setup.map((s) => s.cmd);
  ok(fromSetup.length === 8 && teamsJson.every((t) => fromSetup.some((c) => c[0] === 'HSET' && c[1] === `team:${t.id}` && c[3] === t.id && c[5] === t.name)), '06 setup: the eight team hashes with id and name copied from fiction/teams.json');
  const fixture = read('fixtures/06-teams.yaml');
  ok(teamsJson.every((t) => fixture.includes(`"${t.name}"`)), '06 fixture holds the same eight names');
  const b = vs(l, 'behavior')[0];
  ok(b.slot === 'oncall.lookupTeam' && JSON.stringify(b.assertions[0].call.args) === '["t-01"]' && JSON.stringify(b.assertions[0].expect) === '{"id":"t-01","name":"Mumbai Monsoon"}' && b.assertions[1].call.args[0] === 't-99' && b.assertions[1].expect === null, '06 behavior: lookupTeam("t-01") -> { id, name }, t-99 -> null');
  const e = eventOf(l, 'load_finished');
  ok(e && e.match.scenario === 'oncall-teams-100' && e.timeoutMs === 60000, '06 event load_finished oncall-teams-100, timeoutMs 60000');
  const r = vs(l, 'redis')[0].checks[0];
  ok(r.cmd.join(' ') === 'INFO clients' && r.matches === 'connected_clients:([0-9]|[1-5][0-9])\\b', '06 redis: INFO clients, connected_clients under 60');
  ok(/docker compose restart app/.test(l.task) && /INFO clients/.test(l.task) && /CLIENT LIST/.test(l.task) && /oncall\/status/.test(l.task) && /duplicate\(\)/.test(l.teach), '06 task: INFO clients, CLIENT LIST, /app/oncall/status, docker compose restart app; teach names duplicate()');
  ok(l.show_me.component === 'cache_stats' && wrongs(l) === '06-wrong-client-per-call.js:wrong', '06 show_me cache_stats; solutions: reference + client per call');
}
// ---- 07
{
  const l = lv('07');
  const qs = vs(l, 'quiz');
  ok(l.mode === 'decision' && qs.length === 7 && l.show_me === undefined && l.interview === undefined, '07 decision level, seven quizzes, no show_me');
  ok(qs.every((q) => q.options.length === 4), '07 every quiz has four options');
  const ids = qs.flatMap((q) => q.options.map((o) => o.id));
  ok(new Set(ids).size === ids.length, '07 option ids are unique across the quizzes');
  ok(JSON.stringify([...qs.flatMap((q) => q.correct)].sort()) === JSON.stringify([...l.solutions.reference].sort()), '07 reference lists exactly the seven correct ids');
  const wrongOpts = l.solutions.wrong.map((w) => w.option);
  ok(l.solutions.wrong.length === 7 && qs.every((q) => wrongOpts.filter((o) => q.options.some((x) => x.id === o) && !q.correct.includes(o)).length === 1), '07 exactly one wrong entry per quiz, each naming an incorrect option');
  ok(/Redis latency spiked at 2 am/.test(qs[2].question) && /KEYS \*/.test(qs[6].options.map((o) => o.label).join(' ')) && /MONITOR/.test(qs[6].options.map((o) => o.label).join(' ')) && /FLUSHALL/.test(qs[6].options.map((o) => o.label).join(' ')) && /DEBUG/.test(qs[6].options.map((o) => o.label).join(' ')), '07 interviewer wording on the spike question; the last quiz names KEYS *, MONITOR, FLUSHALL and DEBUG');
}
// ---- solution modules: parse as modules and export what their level needs
const bundles = { '04': ['recordView', 'addTtls', 'recordView'] };
const solFiles = readdirSync(join(root, DIR, 'solutions')).filter((f) => f.endsWith('.js'));
for (const f of solFiles) {
  const prefix = f.slice(0, 2);
  try {
    const m = await import(pathToFileURL(join(root, DIR, 'solutions', f)).href);
    const spec = bundles[prefix];
    if (spec) {
      const names = spec.slice(0, -1);
      const first = spec[spec.length - 1];
      const missing = names.filter((n) => typeof m[n] !== 'function');
      ok(typeof m.default === 'function' && missing.length === 0 && m.default === m[first], `${f}: exports ${names.join(', ')}, default export is ${first}`);
    } else {
      ok(typeof m.default === 'function', `${f}: default export is a function`);
    }
  } catch (e) { ok(false, `${f}: ${e.message}`); }
}
process.exit(fails ? 1 : 0);
EOF
QUEST_ROOT="$ROOT" QUEST_LEVELS="$LEVELS" node "$TMP/static.mjs" > "$TMP/static.out" 2>&1; RC=$?
cat "$TMP/static.out"
[ $RC -eq 0 ] && pass "static node checks" || fail "static node checks (exit $RC)"

step "local proof: engine evaluators against every solution (one throwaway redis:8 container, fake Postgres)"
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "NOTE  ##########################################################################"
  echo "NOTE  Docker is not running (or not installed): the LOCAL PROOF WAS SKIPPED."
  echo "NOTE  No solution of this chapter was proven against a real Redis by this run."
  echo "NOTE  Start Docker Desktop and run this check again before trusting the verdicts."
  echo "NOTE  ##########################################################################"
elif [ ! -f engine/dist/verify/behavior.js ]; then
  echo "NOTE  engine/dist is not built; the proof uses the engine's evaluators, so it was SKIPPED"
else
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  if docker run -d --rm --name "$CONTAINER" -p 127.0.0.1:$HOST_PORT:6379 redis:8 >/dev/null 2>"$TMP/docker.err"; then
    CONTAINER_STARTED=1
    i=0
    until docker exec "$CONTAINER" redis-cli ping >/dev/null 2>&1; do i=$((i + 1)); [ $i -gt 60 ] && break; sleep 0.5; done
    if docker exec "$CONTAINER" redis-cli ping >/dev/null 2>&1; then
      VER=$(docker exec "$CONTAINER" redis-cli INFO server | sed -n 's/^redis_version://p' | tr -d '\r')
      pass "throwaway container $CONTAINER on 127.0.0.1:$HOST_PORT (redis $VER)"
      cat > "$TMP/proof.mjs" <<'EOF'
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const root = process.env.QUEST_ROOT;
const levelsDir = process.env.QUEST_LEVELS;
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const { createClient } = await imp('app/node_modules/redis/dist/index.js');
const shared = await imp('packages/shared/dist/index.js');
const { runAssertions, runFixtureSteps } = await imp('engine/dist/verify/behavior.js');
const { runChecks } = await imp('engine/dist/verify/redis-checks.js');
const { parse } = await imp('engine/node_modules/yaml/dist/index.js');
const url = `redis://127.0.0.1:${process.env.PROOF_PORT}`;
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let strayClosed = 0;
process.on('uncaughtException', (e) => {
  if (e && (e.constructor?.name === 'ClientClosedError' || /The client is closed/.test(String(e.message)))) { strayClosed += 1; return; }
  console.error(e); process.exit(1);
});

const redis = createClient({ url });
redis.on('error', () => {});
await redis.connect();
const send = (cmd) => redis.sendCommand(cmd.map(String));
const info = async (section) => String(await send(['INFO', section]));
const field = (text, name) => { const m = text.match(new RegExp(`^${name}:(.*)$`, 'm')); return m ? m[1].trim() : undefined; };

// A fake Postgres: player_stats() knows p-028 (one null column, to exercise the null-to-empty-string rule), nobody else.
const fakePool = {
  query: async (text, params) => {
    if (/player_stats\(/i.test(text)) return { rows: params[0] === 'p-028' ? [{ player_id: 'p-028', name: 'Ganapathi Chengappa', runs: 4821, wickets: null }] : [] };
    return { rows: [] };
  },
};
const toJson = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

const slotsOfLevel = (L) => [...new Set(L.verify.filter((v) => v.slot).map((v) => v.slot))];
// One slot: the engine copies the solution to that slot's file, so its default export is what runs. Several slots: a bundle,
// the named export after the dot (docs/grading.md, "Bundle solutions").
function pickFn(mod, slot, nSlots) {
  if (nSlots === 1) return mod.default;
  return mod[slot.split('.').slice(1).join('.')];
}
function makeRun(mod, nSlots) {
  return async (req) => {
    const fn = pickFn(mod, req.module, nSlots);
    const results = new Array(req.calls.length);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= req.calls.length) return;
        const t0 = Date.now();
        const ctx = await shared.createLearnerDeps({ redisClient: redis, dbPool: fakePool, log: () => {} });
        try {
          if (typeof fn !== 'function') throw new Error(`the solution has no usable export for ${req.module}`);
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
const reset = async () => {
  await send(['CONFIG', 'SET', 'notify-keyspace-events', '']);
  await send(['CONFIG', 'SET', 'latency-monitor-threshold', '0']);
  await send(['FLUSHALL']);
  await send(['SCRIPT', 'FLUSH']);
  await send(['CONFIG', 'RESETSTAT']);
  await send(['SLOWLOG', 'RESET']);
};

let bad = 0;
const row = (okv, text) => { console.log(`${okv ? 'PASS' : 'FAIL'}  ${text}`); if (!okv) bad++; };
const { chapters } = await shared.loadAllLevels(join(root, levelsDir));
const ch = chapters.find((c) => c.id === 'ch4b');
const liveByLevel = [];
// A wrong solution whose declared failure is a deferred verifier (traffic here): the local evaluators must say right,
// and an extra proof below measures what the traffic bound would see.
const DEFERRED_WRONG = new Set(['solutions/01-wrong-plain-cache.js']);

for (const entry of ch.levels) {
  const L = entry.level;
  if (only && !only.some((n) => L.id.startsWith(`ch4b-${n}-`))) continue;
  const dir = dirname(entry.file);
  const nSlots = slotsOfLevel(L).length;
  const liveKinds = new Set();
  for (const v of L.verify) {
    if (v.type === 'traffic') liveKinds.add(`traffic ${v.scenario}`);
    if (v.type === 'quiz') liveKinds.add('quiz');
    if (v.type === 'event') liveKinds.add(`event ${v.kind} ${v.match?.name ?? ''} ${v.match?.scenario ?? ''}`.trim());
  }
  if (liveKinds.size) liveByLevel.push(`${L.id}: ${[...liveKinds].join('; ')}`);
  if (L.mode === 'decision') { console.log(`-- ${L.id}: decision level, checked statically (reference = the correct ids, one wrong option per quiz)`); continue; }

  const solutions = [{ path: L.solutions.reference, expect: 'right' }, ...L.solutions.wrong.map((w) => ({ path: w.path, expect: w.expect }))];
  for (const s of solutions) {
    await reset();
    const file = join(dir, s.path);
    let failed = false;
    let hit = false;
    const notes = [];
    const t0 = Date.now();
    for (const st of L.setup ?? []) if (st.cmd) await send(st.cmd);
    const setupMs = Date.now() - t0;
    const judgeChecks = async (v) => {
      const items = await runChecks(send, v.checks);
      const badItems = items.filter((i) => !i.ok);
      if (badItems.length) { if (v.type === 'redis') failed = true; else hit = true; notes.push(`${v.type}: ${badItems.map((b) => b.feedback).join(' | ').slice(0, 260)}`); }
    };
    const mod = await import(`${pathToFileURL(file).href}?${Math.random()}`);
    const run = makeRun(mod, nSlots);
    for (const v of L.verify) {
      if (v.type === 'behavior' || (v.type === 'antipattern' && v.slot)) {
        const err = await runFixtureSteps(fixtureSteps(dir, v.fixtures), send);
        if (err) { notes.push(err); failed = true; continue; }
        const r = await runAssertions({ slot: v.slot, module: v.slot, concurrency: v.concurrency, assertions: v.assertions }, { run, send });
        if (!r.ok) { if (v.type === 'behavior') failed = true; else hit = true; notes.push(`${v.type} ${v.slot}: ${r.message.split('\n').join(' | ').slice(0, 260)}`); }
      } else if (v.type === 'redis' || (v.type === 'antipattern' && v.checks)) {
        await judgeChecks(v);
      }
      // quiz, event and traffic verifiers: DEFER (the orchestrator's live grading)
    }
    const verdict = failed ? 'wrong' : hit ? 'works_but_wrong' : 'right';
    const want = DEFERRED_WRONG.has(s.path) ? 'right' : s.expect;
    row(verdict === want, `${L.id} ${s.path}: declared ${s.expect}${want !== s.expect ? ' (by a DEFERRED verifier; the local evaluators must see right)' : ''}, evaluators say ${verdict} (setup ${setupMs} ms)`);
    if (verdict !== want || process.env.VERBOSE) for (const x of notes) console.log(`        ${x}`);
    if (verdict === want && s.expect !== 'right' && !DEFERRED_WRONG.has(s.path)) for (const x of notes.slice(0, 2)) console.log(`        how: ${x}`);
  }
}

console.log('\n-- extra proofs (every number a level quotes is re-measured here)');
const LV = join(root, levelsDir, 'ch4b-on-call');
const fx = async (rel) => { const err = await runFixtureSteps(fixtureSteps(LV, rel), send); if (err) throw new Error(err); };
const modOf = async (file) => import(`${pathToFileURL(join(LV, 'solutions', file)).href}?${Math.random()}`);
const lvl = (n) => ch.levels.find((e) => e.level.id.startsWith(`ch4b-${n}-`)).level;
const runSetup = async (n) => { const t = Date.now(); for (const st of lvl(n).setup ?? []) if (st.cmd) await send(st.cmd); return Date.now() - t; };
const usecOfLast = async (cmdName) => {
  const entries = await send(['SLOWLOG', 'GET', '20']);
  const e = entries.find((x) => String(x[3][0]).toLowerCase() === cmdName);
  return e ? Number(e[2]) : null;
};
if (!only) {
  // 01. The traffic bound redis_per_request_lte 0.2, approximated: Redis commands per call over about 2.5 s of 100 concurrent
  // calls for the one player (two memo expiries), for the reference and for the plain Chapter 2 cache. The live bound is the
  // engine's own number from the app's metrics; this is the same ratio from Redis's own counter.
  {
    const perCall = {};
    for (const file of ['01-reference.js', '01-wrong-plain-cache.js']) {
      await reset();
      const mod = await modOf(file);
      const ctx = await shared.createLearnerDeps({ redisClient: redis, dbPool: fakePool, log: () => {} });
      await mod.default(ctx.deps, 'p-028'); // warm the Redis hash, like the behavior check does before traffic
      const before = Number(field(await info('stats'), 'total_commands_processed'));
      let calls = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 2500) {
        await Promise.all(Array.from({ length: 100 }, () => mod.default(ctx.deps, 'p-028')));
        calls += 100;
        await sleep(20); // about 4,000 calls a second, the order of magnitude of a cached page under load (P0-09 saw about 2,000 requests a second)
      }
      const after = Number(field(await info('stats'), 'total_commands_processed'));
      await ctx.close();
      perCall[file] = (after - before - 1) / calls; // minus the INFO call itself
      perCall[`${file}#calls`] = calls;
    }
    row(perCall['01-reference.js'] <= 0.2 && perCall['01-wrong-plain-cache.js'] > 0.5, `01 Redis commands per call (2.5 s, 100 at a time, one player): reference ${perCall['01-reference.js'].toFixed(4)} over ${perCall['01-reference.js#calls']} calls (needs at most 0.2), plain Chapter 2 cache ${perCall['01-wrong-plain-cache.js'].toFixed(3)} over ${perCall['01-wrong-plain-cache.js#calls']} calls (about 1: the live traffic check fails it)`);
  }
  // 01. the memo is bounded and does not keep a missing player
  {
    await reset();
    const mod = await modOf('01-reference.js');
    const ctx = await shared.createLearnerDeps({ redisClient: redis, dbPool: fakePool, log: () => {} });
    const a = await mod.default(ctx.deps, 'p-999');
    const b = await mod.default(ctx.deps, 'p-999');
    const hashKeys = await send(['EXISTS', 'cache:player:p-999']);
    const first = await mod.default(ctx.deps, 'p-028');
    const second = await mod.default(ctx.deps, 'p-028');
    await ctx.close();
    row(a === null && b === null && Number(hashKeys) === 0 && first.player_id === 'p-028' && second.player_id === 'p-028', '01 reference: a missing player is null every time and leaves no key; p-028 comes back from Postgres, then from the memo, with the same player_id');
  }
  // 02. sizes and times the level quotes
  {
    await reset();
    const ms = await runSetup('02');
    row(ms < 2000, `02 the setup (one EVAL, 300,000 HSETs, plus RESETSTAT) took ${ms} ms (under two seconds)`);
    const usage = Number(await send(['MEMORY', 'USAGE', 'fans:t-01']));
    const enc = String(await send(['OBJECT', 'ENCODING', 'fans:t-01']));
    const hlen = Number(await send(['HLEN', 'fans:t-01']));
    const limit = String((await send(['CONFIG', 'GET', 'hash-max-listpack-entries']))[1]);
    row(Math.abs(usage - 15180435) / 15180435 < 0.05 && enc === 'hashtable' && hlen === 300000 && limit === '512', `02 fans:t-01: MEMORY USAGE ${usage} (the text says 15,180,435; within 5%), OBJECT ENCODING ${enc}, HLEN ${hlen}, hash-max-listpack-entries ${limit}`);
    await send(['CONFIG', 'SET', 'slowlog-log-slower-than', '0']);
    await send(['SLOWLOG', 'RESET']);
    await send(['DEL', 'fans:t-01']);
    const delUs = await usecOfLast('del');
    await fx('fixtures/02-big-hash.yaml');
    await send(['CONFIG', 'SET', 'slowlog-log-slower-than', '0']);
    await send(['SLOWLOG', 'RESET']);
    await send(['UNLINK', 'fans:t-01']);
    const unlinkUs = await usecOfLast('unlink');
    await send(['CONFIG', 'SET', 'slowlog-log-slower-than', '10000']);
    row(delUs !== null && unlinkUs !== null && delUs > 3000 && unlinkUs < 1000 && delUs > unlinkUs * 20, `02 server time for the 300,000-field hash: DEL ${delUs} us (the text says about 10 ms: 8,497 to 12,111 in the author's nine tries), UNLINK ${unlinkUs} us (the text says 7 to 30 us)`);
    // the split with the reference: bucket sizes and encoding
    await fx('fixtures/02-big-hash.yaml');
    const ctx = await shared.createLearnerDeps({ redisClient: redis, dbPool: fakePool, log: () => {} });
    const t0 = Date.now();
    const out = await (await modOf('02-reference.js')).default(ctx.deps, 'fans:t-01', 64);
    const splitMs = Date.now() - t0;
    await ctx.close();
    const sizes = [];
    for (let i = 0; i < 64; i++) sizes.push(Number(await send(['HLEN', `fans:t-01:${i}`])));
    const sum = sizes.reduce((a, b) => a + b, 0);
    const bucketEnc = String(await send(['OBJECT', 'ENCODING', 'fans:t-01:0']));
    row(out.fields === 300000 && out.buckets === 64 && sum === 300000 && Math.min(...sizes) > 4000 && Math.max(...sizes) < 5500 && bucketEnc === 'hashtable', `02 reference split: ${splitMs} ms, buckets ${Math.min(...sizes)} to ${Math.max(...sizes)} fields (the text says about 4,700), sum ${sum}, a bucket is ${bucketEnc} (the text says still hashtable)`);
    const poor = (f) => { let h = 0; for (let i = 0; i < f.length; i++) h = (h * 31 + f.charCodeAt(i)) | 0; return Math.abs(h) % 64; };
    const counts = new Array(64).fill(0);
    for (let i = 1; i <= 300000; i++) counts[poor(`u${i}`)]++;
    console.log(`      02 a multiply-by-31 hash on u1..u300000 gives buckets of ${Math.min(...counts)} to ${Math.max(...counts)} fields (A-04 measured 1,261 to 8,306 on f1..f300000, a different set of names; hint 3 quotes 1,870 to 7,619 from the author's run)`);
  }
  // 03. the KEYS entry, the latency event, the setup time
  {
    await reset();
    const ms = await runSetup('03');
    row(ms < 2000, `03 the setup (500,000 SETs by one EVAL, SLOWLOG RESET, LATENCY RESET, CONFIG SET) took ${ms} ms (the spec: under two seconds)`);
    const thr = String((await send(['CONFIG', 'GET', 'latency-monitor-threshold']))[1]);
    for (let i = 0; i < 3; i++) await send(['KEYS', 'oncall:user:*']);
    const usec = [];
    for (const e of await send(['SLOWLOG', 'GET', '10'])) if (String(e[3][0]).toLowerCase() === 'keys') usec.push(Number(e[2]));
    const lat = await send(['LATENCY', 'LATEST']);
    const names = lat.map((x) => String(x[0]));
    const doctor = String(await send(['LATENCY', 'DOCTOR']));
    row(thr === '10' && usec.length === 3 && usec.every((u) => u > 10000) && names.includes('command') && /latency spikes/i.test(doctor), `03 three KEYS over 500,000 keys: slow log ${usec.join(', ')} us (the text says 45,446 to 72,189 over 24 calls; the check needs each over the 10,000 us threshold), LATENCY LATEST events [${names.join(', ')}], LATENCY DOCTOR ${/latency spikes/i.test(doctor) ? 'reports spikes' : 'reports nothing'}`);
    await send(['SLOWLOG', 'RESET']);
    const n = await (await modOf('03-reference.js')).default((await shared.createLearnerDeps({ redisClient: redis, dbPool: fakePool, log: () => {} })).deps, 'oncall:user:');
    const noKeysEntry = (await send(['SLOWLOG', 'GET', '10'])).filter((e) => String(e[3][0]).toLowerCase() === 'keys').length === 0;
    row(n === 500000 && noKeysEntry, `03 the SCAN reference counts ${n} and leaves no keys entry in the slow log`);
  }
  // 04. sizes the level quotes, the setup, the sweep's effect on INFO keyspace
  {
    await reset();
    await runSetup('03'); // the level-3 keys the setup of level 4 cleans up
    await send(['CONFIG', 'SET', 'latency-monitor-threshold', '10']);
    const t0 = Date.now();
    await runSetup('04');
    const ms = Date.now() - t0;
    const ks = await info('keyspace');
    const line = ks.split(/\r?\n/).find((x) => x.startsWith('db0:')) ?? '';
    const lat = String((await send(['CONFIG', 'GET', 'latency-monitor-threshold']))[1]);
    const oncallLeft = Number(await send(['EVAL_RO', "local c = '0' local n = 0 repeat local r = redis.call('SCAN', c, 'MATCH', 'oncall:user:*', 'COUNT', 1000) c = r[1] n = n + #r[2] until c == '0' return n", 0]));
    row(ms < 2000 && /^db0:keys=5000,expires=0,avg_ttl=0,subexpiry=0$/.test(line) && lat === '0' && oncallLeft === 0, `04 the setup took ${ms} ms: unlinked the 500,000 level-3 keys (${oncallLeft} left), restored latency-monitor-threshold (${lat}), seeded 5,000 views; INFO keyspace reads "${line}" (the text shows the format db0:keys=<n>,expires=<m>,avg_ttl=<ms>,subexpiry=0)`);
    const noTtl = Number(await send(['MEMORY', 'USAGE', 'view:u-000001:m-041']));
    await send(['SET', 'view:probe:m-041', '2026-11-01T02:05:00.000Z', 'EX', '86400']);
    const withTtl = Number(await send(['MEMORY', 'USAGE', 'view:probe:m-041']));
    row(noTtl === 64 && withTtl === 80, `04 MEMORY USAGE of one view: ${noTtl} bytes without a TTL (the text says 64), ${withTtl} with one (the text says 80)`);
    const ttl = Number(await send(['TTL', 'view:u-000001:m-041']));
    const gone = Number(await send(['TTL', 'view:nothing:m-041']));
    row(ttl === -1 && gone === -2, `04 TTL answers ${ttl} for a key with no expiry and ${gone} for a missing key (the hint says -1 and -2)`);
  }
  // 05. the freeze, as the text describes it: BUSY after the threshold, SCRIPT KILL, the killed EVAL's error, slow log, commandstats
  {
    await reset();
    const thr = String((await send(['CONFIG', 'GET', 'busy-reply-threshold']))[1]);
    const spinner = redis.duplicate();
    spinner.on('error', () => {});
    await spinner.connect();
    const probe = redis.duplicate();
    probe.on('error', () => {});
    await probe.connect();
    const killer = redis.duplicate();
    killer.on('error', () => {});
    await killer.connect();
    const t0 = Date.now();
    let evalError = '';
    const spin = spinner.sendCommand(['EVAL', "local t = os.clock() while os.clock() - t < 8 do end return 'done'", '0']).catch((e) => { evalError = e.message; });
    await sleep(1000);
    const sentAt = Date.now();
    let busy = '';
    try { await probe.sendCommand(['PING']); busy = 'PONG'; } catch (e) { busy = e.message; }
    const answeredAfterStart = Date.now() - t0;
    const waited = Date.now() - sentAt;
    let other = '';
    try { await probe.sendCommand(['GET', 'x']); other = 'ok'; } catch (e) { other = e.message; }
    const kill = String(await killer.sendCommand(['SCRIPT', 'KILL']));
    await spin;
    const pong = String(await send(['PING']));
    const slow = await send(['SLOWLOG', 'GET', '3']);
    const evalEntry = slow.find((e) => String(e[3][0]).toLowerCase() === 'eval');
    const cs = await info('commandstats');
    const evalLine = cs.split(/\r?\n/).find((x) => x.startsWith('cmdstat_eval:')) ?? '';
    const pingLine = cs.split(/\r?\n/).find((x) => x.startsWith('cmdstat_ping:')) ?? '';
    await spinner.quit().catch(() => {}); await probe.quit().catch(() => {}); await killer.quit().catch(() => {});
    row(thr === '5000' && /^BUSY Redis is busy running a script/.test(busy) && answeredAfterStart > 4000 && answeredAfterStart < 6500 && /^BUSY/.test(other) && kill === 'OK' && /Script killed by user with SCRIPT KILL/.test(evalError) && pong === 'PONG', `05 freeze: busy-reply-threshold ${thr}; PING sent 1 s after the script started answered "${busy.slice(0, 60)}..." after ${waited} ms (${answeredAfterStart} ms after the start; the text says about four more seconds, about five in all); GET x then answered BUSY at once; SCRIPT KILL ${kill}; the EVAL's own error "${evalError.slice(0, 60)}..."; PING ${pong} after`);
    row(evalEntry && Number(evalEntry[2]) > 4_000_000 && /failed_calls=1/.test(evalLine) && /rejected_calls=1/.test(pingLine), `05 afterwards: SLOWLOG GET holds the eval for ${evalEntry ? evalEntry[2] : 'nothing'} us (the text quotes 5,009,668 to 5,164,480 from eight runs, a spin killed at about 5 s), INFO commandstats: "${evalLine.slice(0, 70)}..." and "${pingLine.slice(0, 60)}..."`);
  }
  // 05. the wrong file's result is right and it uses EVAL; the reference result equals the fixture's counts
  {
    await reset();
    await fx('fixtures/05-two-matches.yaml');
    const ctx = await shared.createLearnerDeps({ redisClient: redis, dbPool: fakePool, log: () => {} });
    await (await modOf('05-wrong-lua-loop.js')).default(ctx.deps);
    const a = [await send(['HGET', 'badges:fifties', 'm-901']), await send(['HGET', 'badges:fifties', 'm-902'])].join();
    const cs = await info('commandstats');
    await ctx.close();
    row(a === '3,4' && /cmdstat_eval:calls=1/.test(cs), `05 the Lua-loop wrong file answers ${a} (correct, as the because says) and shows cmdstat_eval:calls=1 in INFO commandstats`);
  }
  // 06. the regex bound, CLIENT LIST fields, maxclients
  {
    await reset();
    const re = new RegExp(lvl('06').verify.find((v) => v.type === 'redis').checks[0].matches);
    const sample = (n) => `# Clients\r\nconnected_clients:${n}\r\ncluster_connections:0\r\nmaxclients:10000\r\n`;
    row(re.test(sample(6)) && re.test(sample(9)) && re.test(sample(59)) && !re.test(sample(60)) && !re.test(sample(208)) && !re.test(sample(1000)), '06 the bound: connected_clients 6, 9 and 59 pass; 60, 208 and 1000 fail');
    await runSetup('06');
    await send(['HGETALL', 'team:t-01']);
    const list = String(await send(['CLIENT', 'LIST']));
    const first = list.split('\n')[0];
    const ic = await info('clients');
    row(/ age=\d+ idle=\d+ /.test(first) && / cmd=\S+ /.test(first) && field(ic, 'maxclients') === '10000' && /^\d+$/.test(field(ic, 'connected_clients') ?? ''), `06 CLIENT LIST lines carry age, idle and cmd; INFO clients has connected_clients ${field(ic, 'connected_clients')} here (this proof's own few connections) and maxclients ${field(ic, 'maxclients')} (the text says 10000)`);
    const ok = (await send(['HGETALL', 'team:t-01']));
    row(Array.isArray(ok) || typeof ok === 'object', '06 team hashes exist after the setup');
  }
}
await sleep(500);
if (strayClosed) console.log(`NOTE  ${strayClosed} ClientClosedError(s) from timers (swallowed)`);
console.log(`LIVE_SUMMARY ${JSON.stringify(liveByLevel)}`);
await reset();
await redis.quit();
process.exit(bad ? 1 : 0);
EOF
      QUEST_ROOT="$ROOT" QUEST_LEVELS="$LEVELS" PROOF_PORT="$HOST_PORT" node "$TMP/proof.mjs" > "$TMP/proof.out" 2>&1; RC=$?
      grep -v '^LIVE_SUMMARY' "$TMP/proof.out"
      PROOF_RAN=1
      [ $RC -eq 0 ] && pass "every solution gets its declared verdict from the engine's evaluators; the extra proofs hold" || fail "a solution got a different verdict than declared, or an extra proof failed (exit $RC)"
    else
      fail "the throwaway container did not answer PING: $(docker logs "$CONTAINER" 2>&1 | tail -3)"
    fi
  else
    fail "could not start $CONTAINER on port $HOST_PORT: $(cat "$TMP/docker.err" | head -2)"
  fi
fi

step "which verdicts rest on live grading (the orchestrator's grade.sh through the engine and the runner)"
node -e '
  for (const l of process.argv.slice(1)) console.log("LIVE  " + l);
' "every level with a quiz (01 to 07): the harness types the right options for right and works_but_wrong solutions and a wrong one for wrong ones; none of the proof above covers a quiz. Level 07 is all quizzes: the reference is the seven correct ids (checked statically), one wrong option per quiz" \
  "ch4b-01-one-celebrity-player: event custom load_finished (celebrity-100; the harness starts a 5 s run first) and the traffic verifier (redis_per_request_lte 0.2, error_rate_lte 0, p99_ms_lte 100). The declared verdict of 01-wrong-plain-cache.js (wrong) rests on the traffic verifier alone: the proof above shows the evaluators say right for it and measures about 1 Redis command per call against 0.2 for the reference, but only the live run decides it" \
  "ch4b-04-memory-grows-every-day: event load_finished (oncall-views-100). The harness's 5 s run happens before verify, leaves thousands of view:* keys, and the fixture clears them first" \
  "ch4b-05-everything-froze: events redis_busy and script_killed (the harness's dance: POST /app/oncall/badges/recompute, 5.5 s, PING, SCRIPT KILL). The proof above emulates the freeze with a read-only EVAL spin and shows the same BUSY and the same kill" \
  "ch4b-06-connections-climbing: event load_finished (oncall-teams-100) and the INFO clients bound. CAUTION for the orchestrator: the harness load dance runs the traffic against the planted baseline (it does not switch the learner slot on, and it cannot restart the app), so the baseline leaks about 200 connections and connected_clients is well over 60 when verify reads it: the reference is expected to MISMATCH live unless the app is restarted after the dance or the dance activates the slot first (see the handoff)" \
  "every behavior, antipattern and redis verdict above is proven here with createLearnerDeps over one shared connection, like the runner child; the real runner path (slots shimmed from the bundle files, the real Postgres for level 01) is the orchestrator's live grading and is not exercised by this check"

step "owned files"
echo "git status --short (this task's paths):"
git status --short -- "$CH" scenarios/celebrity-100.yaml scenarios/oncall-views-100.yaml scenarios/oncall-teams-100.yaml scripts/check/C4b.sh docs/handoffs/C4b.md 2>/dev/null | sed 's/^/  /'
if [ -z "$PROOF_RAN" ]; then echo "NOTE  the local proof did not run in this invocation (see above)"; fi

echo
if [ $FAILS -eq 0 ]; then echo "C4b OK"; exit 0; fi
echo "C4b FAILED ($FAILS)"; exit 1
