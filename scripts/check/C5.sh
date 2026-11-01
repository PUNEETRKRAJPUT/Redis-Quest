#!/usr/bin/env bash
# C5 acceptance: Chapter 5, "Survive and scale" (14 levels: ops, cli, code and decision).
# Static part: the chapter validates with 14 levels, chapter.yaml lists every level in order, every solution and fixture exists and parses
# (.js with node --check, .sh with bash -n), the spec's rules hold in each level's verify list and task text (targets, the way back, the
# measured timings the text quotes), the fiction rules hold (no real cricketer or franchise, no bet/stake/payout/cash/IPL, no AI or vector
# content) and every solution is declared by a level.
# Local proof part: starts ONE throwaway container,
#     docker run -d --rm --name quest-c5-redis -p 127.0.0.1:6399:6379 redis:8
# plus, for the replication texts of levels 7 and 8 only, ONE second throwaway container (quest-c5-replica) on a user-defined network
# (quest-c5-net) that this script creates and removes. It never runs a compose project and never touches the default project or any quest-*
# compose project. It runs the engine's own behavior and redis evaluators against every reference and wrong solution that can run on a single
# node (a `.redis` file is played line by line on its own connection, like the game's terminal, a `.js` file through createLearnerDeps),
# compares the verdict with the declared one, runs an empty stub through every level that is decided by evaluators (it must be wrong), and
# re-measures every size, text and timing the levels quote. Quizzes, events (redis_target_changed, redis_disconnect, redis_reconnect,
# sentinel_failover), traffic and the `.sh` solutions are NOT run here: they are the orchestrator's live and hand grading, and the output says
# which verdicts rest on them (levels 01, 07, 08 and 09 are graded by hand with the compose profiles).
# If Docker is not running the proof is SKIPPED with a loud NOTE and says so in the summary.
# Development: C5_LEVELS=<dir> runs the check against a levels root that is not the engine's tree yet; ONLY=05,10 limits the proof to levels.
# bash 3.2 compatible: no associative arrays, no mapfile.
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
LEVELS="${C5_LEVELS:-levels}"
CH="$LEVELS/ch5-survive"
FAILS=0
TMP=$(mktemp -d "${TMPDIR:-/tmp}/c5.XXXXXX")
CONTAINER="quest-c5-redis"
REPLICA="quest-c5-replica"
NETWORK="quest-c5-net"
HOST_PORT=6399
CONTAINER_STARTED=""
REPLICA_STARTED=""
NETWORK_MADE=""
PROOF_RAN=""

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILS=$((FAILS + 1)); }
step() { echo; echo "== $1"; }

cleanup() {
  if [ -n "$REPLICA_STARTED" ]; then docker stop "$REPLICA" >/dev/null 2>&1 || true; fi
  if [ -n "$NETWORK_MADE" ]; then
    docker network disconnect "$NETWORK" "$CONTAINER" >/dev/null 2>&1 || true
    docker network rm "$NETWORK" >/dev/null 2>&1 || true
  fi
  if [ -n "$CONTAINER_STARTED" ]; then docker stop "$CONTAINER" >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

step "build @quest/shared and @quest/engine (the evaluators, the level loader and the CLI splitter come from them)"
pnpm --filter @quest/shared build >/dev/null 2>&1 && pass "shared build" || { fail "shared build"; exit 1; }
pnpm --filter @quest/engine build >/dev/null 2>&1 && pass "engine build" || { fail "engine build"; exit 1; }

step "validate $CH"
OUT=$(pnpm --silent --filter @quest/shared levels:validate "$CH" 2>&1); RC=$?
if [ $RC -eq 0 ]; then pass "$OUT"; else fail "validate (exit $RC)"; echo "$OUT"; fi
case "$OUT" in *"14 level(s)"*) pass "14 levels";; *) fail "expected 14 levels in the chapter";; esac

step "chapter.yaml"
if sed -n 's/^id: *//p' "$CH/chapter.yaml" | head -n 1 | grep -qx 'ch5'; then pass "chapter id ch5"; else fail "chapter id is not ch5"; fi
LISTED=$(grep -E '^  - ch5-' "$CH/chapter.yaml" | wc -l | tr -d ' ')
[ "$LISTED" -eq 14 ] && pass "chapter lists exactly 14 levels" || fail "chapter lists $LISTED levels, want 14"
ORDER=$(grep -E '^  - ch5-' "$CH/chapter.yaml" | sed -E 's/^  - //' | tr '\n' ' ')
WANT="ch5-01-the-crash ch5-02-snapshots ch5-03-the-log ch5-04-both-and-backups ch5-05-how-big-is-it-really ch5-06-the-celebrity-again ch5-07-a-second-box ch5-08-who-decides-who-is-master ch5-09-the-cluster-migration ch5-10-port-6379-is-on-the-internet ch5-11-the-doctors ch5-12-managed-redis ch5-13-the-production-checklist ch5-14-blank-rebuild "
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
      *.sh) bash -n "$CH/$p" 2>/dev/null && pass "  $p is valid bash" || fail "  $p does not parse ($id)";;
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
[ "$COUNT" -eq 14 ] && pass "14 level files" || fail "found $COUNT level files, want 14"
for p in "$CH"/fixtures/*.yaml; do
  [ -f "$p" ] || continue
  base=$(basename "$p")
  grep -rq "fixtures/$base" "$CH"/[0-9][0-9]-*.yaml && pass "fixtures/$base is used by a level" || fail "fixtures/$base is not used by any level"
done
for p in "$CH"/solutions/*; do
  base=$(basename "$p")
  grep -q "solutions/$base" "$CH"/[0-9][0-9]-*.yaml && pass "solutions/$base is declared by a level" || fail "solutions/$base is not declared by any level"
done

step "spec rules, targets, the way back and the quoted measurements (one node pass over the real parsed levels)"
cat > "$TMP/static.mjs" <<'EOF'
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
const root = process.env.QUEST_ROOT;
const levelsDir = process.env.QUEST_LEVELS;
const shared = await import(pathToFileURL(join(root, 'packages/shared/dist/index.js')).href);
const scenarioMod = await import(pathToFileURL(join(root, 'engine/dist/load/scenario.js')).href);
const { chapters } = await shared.loadAllLevels(resolve(root, levelsDir));
const ch = chapters.find((c) => c.id === 'ch5');
const DIR = join(levelsDir, 'ch5-survive');
const lv = (n) => ch.levels.find((l) => l.level.id.startsWith(`ch5-${n}-`)).level;
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const vs = (l, type) => l.verify.filter((v) => v.type === type);
const wrongs = (l) => l.solutions.wrong.map((w) => `${(w.path ?? w.option).replace('solutions/', '')}:${w.expect}`).join();
const types = (l) => l.verify.map((v) => v.type).join();
const has = (l, ...needles) => needles.every((n) => `${l.teach ?? ''}\n${l.task}\n${l.story}`.includes(n));
const task = (l, ...needles) => needles.every((n) => l.task.includes(n));
const read = (rel) => readFileSync(resolve(root, DIR, rel), 'utf8');
const eventOf = (l, name) => vs(l, 'event').find((e) => e.kind === 'custom' && e.match.name === name);
const checksOf = (l) => vs(l, 'redis').flatMap((v) => v.checks);
const cmdText = (c) => c.cmd.join(' ');

ok(ch && ch.levels.length === 14, 'chapter ch5 loads with 14 levels');
// ---- chapter
{
  const raw = read('chapter.yaml');
  const times = [...raw.matchAll(/time: "(\d\d:\d\d)"/g)].map((m) => m[1]);
  ok(times.length >= 6 && times.length <= 8, `incident thread has ${times.length} lines (six to eight)`);
  ok(times[0] === '19:00' && times[times.length - 1] === '19:30', `incident runs ${times[0]} to ${times[times.length - 1]} (19:00 to 19:30)`);
  ok(JSON.stringify(times) === JSON.stringify([...times].sort()), 'incident times are in order');
  ok(ch.chapter.title === 'Survive and scale', 'chapter title is "Survive and scale"');
  const slugs = new Set([...raw.matchAll(/from: ([a-z-]+)/g)].map((m) => m[1]));
  const cast = JSON.parse(readFileSync(join(root, 'fiction/cast.json'), 'utf8')).cast.map((c) => c.slug);
  ok([...slugs].every((s) => s === 'you' || cast.includes(s)), `incident speakers are cast slugs or "you" (${[...slugs].join(', ')})`);
  ok(/restarted Redis/i.test(raw) && /forty thousand/i.test(raw) && /second Redis, and a third/i.test(raw) && /6379/.test(raw) && /hostel wifi/i.test(raw), 'the thread has the three beats: the restart and forty thousand teams, a second and a third box, port 6379 from the hostel wifi');
  const emoji = (raw.match(/[\u{1F300}-\u{1FAFF}]/gu) ?? []).length;
  ok(emoji <= 2, `at most two emoji in the thread (${emoji})`);
}
// ---- the whole chapter: fiction rules, denylist, no AI content, shape of every level
{
  const deny = JSON.parse(readFileSync(join(root, 'fiction/denylist.json'), 'utf8'));
  const names = [...deny.cricketers, ...deny.franchises].map((n) => n.toLowerCase());
  let hit = null;
  const files = readdirSync(resolve(root, DIR)).filter((f) => f.endsWith('.yaml'));
  for (const f of files) {
    const t = read(f).toLowerCase();
    for (const n of names) if (t.includes(n)) hit = `${f}: ${n}`;
  }
  ok(!hit, `no denylisted cricketer or franchise in any chapter file${hit ? ` (${hit})` : ''}`);
  let aiHit = null;
  for (const f of files) if (/\b(AI|LLM|embeddings?|vectors?)\b/.test(read(f))) aiHit = f;
  ok(!aiHit, `no AI, vector or LLM content${aiHit ? ` (${aiHit})` : ''}`);
  ok(ch.levels.every((e) => e.level.reward.xp >= 40 && e.level.reward.xp <= 80), `every reward is 40 to 80 XP (${ch.levels.map((e) => e.level.reward.xp).join(', ')})`);
  ok(ch.levels.every((e) => e.level.brainstorm.options.some((o) => o.id === 'not-redis')), 'every brainstorm has a not-redis option');
  ok(ch.levels.every((e) => e.level.mode === 'decision' || (e.level.hints ?? []).length >= 3), 'every non-decision level has three or more hints');
  ok(ch.levels.every((e) => e.level.solutions.wrong.every((w) => w.because && w.because.length > 40)), 'every wrong solution has a real because');
  ok(ch.levels.every((e) => e.level.mode === 'decision' || e.level.show_me), 'every non-decision level has a show_me');
  ok(ch.levels.every((e) => e.level.mode !== 'decision' || (e.level.show_me === undefined && e.level.interview === undefined)), 'decision levels have no show_me and no interview');
  ok(JSON.stringify(ch.levels.map((e) => e.level.mode)) === JSON.stringify(['ops', 'cli', 'cli', 'decision', 'cli', 'code', 'ops', 'ops', 'code', 'cli', 'cli', 'decision', 'decision', 'cli']), 'modes: ops, cli, cli, decision, cli, code, ops, ops, code, cli, cli, decision, decision, cli');
  // every level that leaves the single node ends with the way back
  for (const n of ['01', '02', '03', '07', '08', '09']) {
    const l = lv(n);
    ok(l.task.includes('redis://redis:6379') && /way back/i.test(l.task), `${n} the task ends with the way back to redis://redis:6379`);
  }
}
// ---- the scenario level 06 reuses
{
  const cel = await scenarioMod.loadScenario(join(root, 'scenarios'), 'celebrity-100');
  ok(cel.connections === 100 && cel.durationSec === 10, 'celebrity-100 (reused, nothing new owned): 100 connections, 10 s');
  ok(JSON.stringify(ch.levels.filter((e) => e.level.scenario).map((e) => `${e.level.id.slice(0, 6)}=${e.level.scenario}`)) === JSON.stringify(['ch5-06=celebrity-100']), 'only level 06 names a scenario');
}
// ---- 01
{
  const l = lv('01');
  ok(l.mode === 'ops' && types(l) === 'event,event,event,redis,quiz', `01 ops; verify order ${types(l)}`);
  const t = eventOf(l, 'redis_target_changed');
  ok(t && t.match.to === 'redis://redis-nopersist:6379' && t.timeoutMs === 120000, '01 event custom redis_target_changed to the crash node, timeoutMs 120000');
  const d = vs(l, 'event').find((e) => e.kind === 'redis_disconnect');
  const r = vs(l, 'event').find((e) => e.kind === 'redis_reconnect');
  ok(d && r && r.timeoutMs === 300000, '01 events redis_disconnect and redis_reconnect (timeoutMs 300000)');
  const cs = checksOf(l);
  ok(cs.some((c) => cmdText(c) === 'EXISTS match:final:balls' && c.equals === 0) && cs.some((c) => cmdText(c) === 'EXISTS score:final' && c.equals === 0), '01 redis: EXISTS match:final:balls and EXISTS score:final equal 0');
  ok(task(l, 'docker compose --profile crash up -d redis-nopersist', 'redis://redis-nopersist:6379', 'PUT /api/target', 'XADD match:final:balls * over 1 ball 1 runs 4', 'SET score:final 24', 'XLEN match:final:balls', 'docker compose kill redis-nopersist', 'INFO persistence'), '01 task: start the crash profile, switch the target, play the over, XLEN, kill, up, INFO persistence');
  ok(has(l, 'progress file', 'mirror') && /--save ""/.test(l.teach) && /--appendonly no/.test(l.teach) && /SIGKILL/.test(l.teach), '01 teach: the progress file is the truth, the mirror; the crash node flags; kill is SIGKILL');
  ok(l.show_me.component === 'stream_log' && l.show_me.keys[0] === 'match:final:balls', '01 show_me stream_log match:final:balls');
  ok(wrongs(l) === '01-wrong-restart-only.sh:wrong' && l.solutions.reference === 'solutions/01-reference.sh', '01 solutions: .sh reference and the restart-only wrong');
  ok(vs(l, 'quiz')[0].correct.join() === 'no-save-no-log', '01 quiz: no save, no log');
}
// ---- 02
{
  const l = lv('02');
  ok(l.mode === 'cli' && types(l) === 'redis,quiz,quiz', `02 cli; verify order ${types(l)}`);
  const cs = checksOf(l);
  ok(cs.some((c) => cmdText(c) === 'CONFIG GET save' && c.contains === '60 1000') && cs.some((c) => cmdText(c) === 'INFO persistence' && /rdb_last_bgsave_status:ok/.test(c.matches ?? '')) && cs.some((c) => cmdText(c) === 'LASTSAVE' && c.gte === 1) && cs.some((c) => cmdText(c) === 'GET score:final' && c.equals === '24') && cs.some((c) => /rdb_saves/.test(c.matches ?? '')), '02 redis: save contains 60 1000, rdb_last_bgsave_status ok, LASTSAVE gte 1, score:final 24, rdb_saves moved');
  ok(task(l, 'CONFIG SET save "60 1000"', 'BGSAVE', 'LASTSAVE', 'INFO persistence', 'CONFIG GET dir', 'docker compose exec redis-nopersist ls -l /data', 'docker compose kill redis-nopersist', 'docker compose --profile crash rm -sfv redis-nopersist'), '02 task: CONFIG SET save, BGSAVE, LASTSAVE, INFO persistence, CONFIG GET dir, ls /data, kill and up, remove the crash node at the end');
  ok(task(l, 'while the target is still the crash node') && l.task.indexOf('press Verify') < l.task.indexOf('docker compose kill redis-nopersist'), '02 Verify comes before the kill (the restart forgets CONFIG SET and rdb_saves)');
  ok(/dump\.rdb/.test(l.teach) && /fork/.test(l.teach) && /CONFIG SET.*running server only/s.test(l.teach), '02 teach: dump.rdb, the fork cost, CONFIG SET is live only');
  ok(l.show_me.component === 'kv_card' && l.show_me.keys[0] === 'score:final' && wrongs(l) === '02-wrong-save-off.redis:wrong', '02 show_me kv_card score:final; solutions: reference + save off');
}
// ---- 03
{
  const l = lv('03');
  ok(l.mode === 'cli' && types(l) === 'redis,quiz,quiz', `03 cli; verify order ${types(l)}`);
  const cs = checksOf(l);
  ok(cs.some((c) => cmdText(c) === 'CONFIG GET appendonly' && JSON.stringify(c.equals) === '["appendonly","yes"]') && cs.some((c) => cmdText(c) === 'INFO persistence' && c.matches === 'aof_enabled:1') && cs.some((c) => cmdText(c) === 'CONFIG GET appendfsync' && JSON.stringify(c.equals) === '["appendfsync","everysec"]'), '03 redis: appendonly yes, aof_enabled:1, appendfsync everysec');
  ok(task(l, 'CONFIG SET appendonly yes', 'CONFIG GET appendfsync', 'BGREWRITEAOF', 'docker compose exec redis-nopersist redis-benchmark -t set -n 20000 -q', 'CONFIG SET appendfsync always', 'CONFIG SET appendfsync everysec', 'docker compose --profile crash rm -sfv redis-nopersist'), '03 task: appendonly on the live server, BGREWRITEAOF, redis-benchmark with everysec and always, back to everysec, remove the crash node');
  ok(/everysec/.test(l.teach) && /273,972/.test(l.teach) && /285,714/.test(l.teach) && /57,971/.test(l.teach) && /59,524/.test(l.teach) && /on this stack/i.test(l.teach), '03 teach quotes its own measured benchmark numbers, labelled on this stack');
  ok(/CONFIG SET appendonly yes/.test(l.teach) && /live server|running server/.test(l.teach), '03 teach: CONFIG SET appendonly yes on the live server first');
  ok(l.setup && l.setup.some((s) => s.cmd.join(' ') === 'CONFIG SET appendfsync everysec') && wrongs(l) === '03-wrong-fsync-no.redis:wrong', '03 setup restores appendfsync everysec; solutions: reference + appendfsync no');
}
// ---- 04
{
  const l = lv('04');
  const qs = vs(l, 'quiz');
  ok(l.mode === 'decision' && qs.length === 7 && qs.every((q) => q.options.length === 4), '04 decision level, seven quizzes of four options');
  const ids = qs.flatMap((q) => q.options.map((o) => o.id));
  ok(new Set(ids).size === ids.length, '04 option ids are unique across the quizzes');
  ok(JSON.stringify([...qs.flatMap((q) => q.correct)].sort()) === JSON.stringify([...l.solutions.reference].sort()), '04 reference lists exactly the seven correct ids');
  const wrongOpts = l.solutions.wrong.map((w) => w.option);
  ok(l.solutions.wrong.length === 7 && qs.every((q) => wrongOpts.filter((o) => q.options.some((x) => x.id === o) && !q.correct.includes(o)).length === 1), '04 exactly one wrong entry per quiz');
  const text = JSON.stringify(qs);
  ok(/both/i.test(text) && /RDB alone/.test(text) && /AOF alone|append-only file alone/i.test(text) && /atomic|renamed/.test(text) && /auto-aof-rewrite-percentage/.test(text) && /aof_rewrite_in_progress/.test(text) && /AOF is used|the append-only file, which is the more complete/.test(text), '04 covers both, RDB alone, AOF alone, copying RDB, copying AOF during a rewrite and which file is used on restart');
}
// ---- 05
{
  const l = lv('05');
  ok(l.mode === 'cli' && types(l) === 'answer,redis,quiz,quiz,quiz,quiz', `05 cli; verify order ${types(l)}`);
  const a = vs(l, 'answer')[0];
  ok(JSON.stringify(a.expected.cmd) === '["MEMORY","USAGE","player:p-028"]' && a.expected.transform === 'number', '05 answer: expected MEMORY USAGE player:p-028, transform number');
  const cs = checksOf(l);
  ok(cs.some((c) => cmdText(c) === 'OBJECT ENCODING player:p-028' && c.equals === 'listpack') && cs.some((c) => cmdText(c) === 'EXISTS big:hash' && c.equals === 0) && cs.some((c) => cmdText(c) === 'INFO commandstats' && /cmdstat_unlink/.test(c.matches)), '05 redis: listpack, EXISTS big:hash 0, cmdstat_unlink');
  ok(l.setup.length === 4 && l.setup[0].cmd[0] === 'DEL' && l.setup[1].cmd[0] === 'HSET' && (l.setup[1].cmd.length - 2) / 2 === 12 && l.setup[2].cmd[0] === 'EVAL' && /600/.test(l.setup[2].cmd[1]) && l.setup[3].cmd.join(' ') === 'CONFIG RESETSTAT', '05 setup: player:p-028 as 12 fields (24 arguments), big:hash of 600 fields by one EVAL, CONFIG RESETSTAT');
  ok(task(l, 'MEMORY USAGE player:p-028', 'OBJECT ENCODING player:p-028', 'OBJECT ENCODING big:hash', 'MEMORY USAGE big:hash', 'CONFIG GET hash-max-listpack-entries', 'UNLINK big:hash', '50,000,000'), '05 task: MEMORY USAGE, OBJECT ENCODING, the limit, UNLINK, the napkin times 50,000,000');
  ok(/268 bytes/.test(l.teach) && /32,059/.test(l.teach) && /13,018/.test(l.teach) && /85 MB/.test(l.teach) && /160 MB/.test(l.teach) && /up to ten times less/.test(l.teach) && /hash trick/.test(l.teach), '05 teach: the measured 268, 32,059 and 13,018, the FAQ figures 85 MB and 160 MB, up to ten times less memory, the hash trick');
  ok(l.show_me.component === 'hash_card' && l.show_me.keys[0] === 'player:p-028' && wrongs(l) === '05-wrong-del.redis:wrong', '05 show_me hash_card player:p-028; solutions: reference + DEL');
}
// ---- 06
{
  const l = lv('06');
  ok(l.mode === 'code' && l.scenario === 'celebrity-100' && types(l) === 'behavior,quiz,quiz,quiz,traffic', `06 code, scenario celebrity-100, verify order ${types(l)} (traffic runs last whatever the order)`);
  const b = vs(l, 'behavior')[0];
  ok(b.slot === 'cache.getPlayerStats' && b.assertions[0].repeat === 2 && b.assertions[1].call.args[0] === 'p-999' && b.assertions[1].expect === null, '06 behavior: p-028 twice, p-999 null');
  const se = b.assertions[0].sideEffect;
  ok(se.some((c) => c.cmd[0] === 'TYPE' && c.equals === 'hash') && se.some((c) => c.cmd[0] === 'TTL' && c.between) && se.some((c) => c.cmd[0] === 'HGET'), '06 side effects: hash, player_id, TTL set');
  const t = vs(l, 'traffic')[0];
  ok(t.scenario === 'celebrity-100' && t.baseline === false && t.assertions.redis_per_request_lte === 0.05 && t.assertions.error_rate_lte === 0 && t.assertions.p99_ms_lte === 100, '06 traffic: baseline false, redis_per_request_lte 0.05, error_rate_lte 0, p99_ms_lte 100');
  ok(task(l, 'redisCached', 'CONFIG RESETSTAT', 'Run traffic', 'INFO commandstats', 'cmdstat_hgetall') && has(l, 'RESP: 3', 'clientSideCache', 'tracking', 'flushes', 'HRANDFIELD', '5.1.0'), '06 task and teach: redisCached, CONFIG RESETSTAT, Run traffic, cmdstat_hgetall; tracking, flush on disconnect, never-cached commands, RESP 3 and 5.1.0');
  ok(l.show_me.component === 'cache_stats' && l.show_me.keys.length === 0 && wrongs(l) === '06-wrong-plain-client.js:wrong', '06 show_me cache_stats []; solutions: reference + the plain client');
  ok(read('fixtures/06-cold.yaml').includes('cache:player:p-028'), '06 fixture clears cache:player:p-028');
}
// ---- 07
{
  const l = lv('07');
  ok(l.mode === 'ops' && types(l) === 'event,redis,quiz,quiz,quiz,quiz', `07 ops; verify order ${types(l)}`);
  const e = eventOf(l, 'redis_target_changed');
  ok(e && e.match.to === 'redis://redis-replica:6379' && e.timeoutMs === 120000, '07 event redis_target_changed to the replica, timeoutMs 120000');
  const cs = checksOf(l);
  ok(cs.some((c) => cmdText(c) === 'INFO replication' && c.matches === 'connected_slaves:[1-9]') && cs.some((c) => cmdText(c) === 'GET score:final' && c.equals === '30'), '07 redis: connected_slaves:[1-9] and score:final 30 (both true on the master with the replica attached)');
  ok(task(l, 'docker compose --profile replica up -d redis-replica', 'INFO replication', 'SET score:final 30', 'redis://redis-replica:6379', 'SET score:final 31', 'WAIT 1 1000', 'min-replicas-to-write') && has(l, "READONLY You can't write against a read only replica."), "07 task: start the replica, INFO replication, SET 30, switch, SET 31, WAIT 1 1000, min-replicas-to-write; the exact READONLY text");
  ok(/persistence off/.test(JSON.stringify(l.verify)) || /no persistence/.test(JSON.stringify(l.verify)), '07 a quiz carries the trap: a master without persistence that auto-restarts empties its replicas');
  ok(wrongs(l) === '07-wrong-no-replica.sh:wrong' && l.solutions.reference === 'solutions/07-reference.sh', '07 solutions: .sh reference and the no-replica wrong');
}
// ---- 08
{
  const l = lv('08');
  ok(l.mode === 'ops' && types(l) === 'event,redis,quiz,quiz,quiz,quiz', `08 ops; verify order ${types(l)}`);
  const e = eventOf(l, 'sentinel_failover');
  ok(e && e.timeoutMs === 300000, '08 event custom sentinel_failover, timeoutMs 300000');
  ok(checksOf(l).some((c) => cmdText(c) === 'INFO replication' && c.matches === 'role:master'), '08 redis: INFO replication role:master');
  ok(task(l, 'docker compose --profile sentinel up -d sentinel-1 sentinel-2 sentinel-3', 'SENTINEL get-master-addr-by-name mymaster', 'sentinel://mymaster@sentinel-1:26379,sentinel-2:26379,sentinel-3:26379', 'docker compose stop redis', 'SET score:final 32', '/app/target', 'SENTINEL masters', 'docker compose start redis', 'SENTINEL replicas mymaster'), '08 task: three Sentinels, get-master-addr-by-name, the sentinel target, stop redis, SET 32, /app/target, SENTINEL masters, start redis, SENTINEL replicas');
  const t = l.task;
  const iWait = t.indexOf('Wait at least 10 seconds'), iStop = t.indexOf('docker compose stop redis-replica'), iStart = t.indexOf('docker compose start redis-replica'), iBack = t.lastIndexOf('redis://redis:6379');
  ok(iWait > 0 && iStop > iWait && iStart > iStop && iBack > iStart, '08 the way back is in E-03\'s order: wait at least 10 s, stop redis-replica, start redis-replica, point the game at redis://redis:6379');
  ok(/no-good-slave/.test(l.teach) && /3\.5 s/.test(l.teach) && /7\.3 s/.test(l.teach) && /7\.5 s/.test(l.teach) && /6\.6 s/.test(l.teach) && /7\.7 s/.test(l.teach) && /about 11 s/.test(l.teach) && /game.s own checks|on this stack/.test(l.teach) && !/[AE]-0\d/.test(l.teach), '08 teach quotes the measured failover timeline as the stack itself measured it (3.5, 6.6, 7.3, 7.5, 7.7 s, 11 s, no-good-slave), naming no build task');
  ok(/quorum/.test(JSON.stringify(l.verify)) && /majority/.test(JSON.stringify(l.verify)) && /three/i.test(JSON.stringify(l.verify)) && /NAT/.test(JSON.stringify(l.verify)), '08 quizzes: quorum against majority, at least three Sentinels, Docker and NAT');
  ok(wrongs(l) === '08-wrong-one-sentinel.sh:wrong' && /quorum 2/.test(l.solutions.wrong[0].because), '08 solutions: .sh reference and one Sentinel (the because names quorum 2)');
}
// ---- 09
{
  const l = lv('09');
  ok(l.mode === 'code' && types(l) === 'event,redis,behavior,behavior,quiz,quiz,quiz,quiz,quiz', `09 code; verify order ${types(l)}`);
  const e = vs(l, 'event')[0];
  ok(e.kind === 'custom' && e.match.name === 'redis_target_changed' && e.match.kind === 'cluster' && e.timeoutMs === 120000, '09 event redis_target_changed { kind: cluster }, timeoutMs 120000');
  ok(checksOf(l).some((c) => cmdText(c) === 'CLUSTER INFO' && c.contains === 'cluster_state:ok'), '09 redis: CLUSTER INFO contains cluster_state:ok');
  const b = vs(l, 'behavior')[0];
  const a = b.assertions[0];
  ok(b.slot === 'contest.join' && b.concurrency === 50 && a.repeat === 50 && JSON.stringify(a.call.args) === '["u-000010",9001,10]' && a.expectCount.value === true && a.expectCount.equals === 10, '09 behavior: concurrency 50, repeat 50, join("u-000010", 9001, 10) -> exactly 10 true');
  ok(a.sideEffect.some((c) => cmdText(c) === 'GET {wallet:u-000010}' && c.equals === '0') && a.sideEffect.some((c) => cmdText(c) === 'GET {wallet:u-000010}:joins:9001' && c.equals === '10'), '09 side effects: GET {wallet:u-000010} "0", GET {wallet:u-000010}:joins:9001 "10"');
  ok(task(l, 'docker compose exec redis-c1 redis-cli --cluster create redis-c1:6379 redis-c2:6379 redis-c3:6379 redis-c4:6379 redis-c5:6379 redis-c6:6379 --cluster-replicas 1 --cluster-yes', 'cluster://redis-c1:6379,redis-c2:6379,redis-c3:6379', 'CLUSTER INFO', 'CLUSTER KEYSLOT wallet:u-000010', 'CLUSTER KEYSLOT contest:9001:entries', 'MSET a 1 b 2', 'MSET {u:1}:a 1 {u:1}:b 2', 'conn.watch is not a function', '{wallet:<userId>}', 'docker compose --profile cluster stop'), '09 task: the exact create command, the cluster target, CLUSTER INFO, KEYSLOT of both keys, CROSSSLOT, the tagged MSET, conn.watch is not a function, the tagged key names, the way back');
  ok(has(l, 'CROSSSLOT Keys in request', 'MOVED <slot> <host>:6379', 'SPUBLISH', 'SSUBSCRIBE', 'owns slot 0', '16384') && /PUBLISH/.test(JSON.stringify(l.verify)), '09 teach: the exact CROSSSLOT and MOVED texts, SPUBLISH and SSUBSCRIBE, keyless commands go to slot 0\'s owner, 16384 slots');
  ok(l.show_me.component === 'kv_card' && l.show_me.keys[0] === '{wallet:u-000010}' && wrongs(l) === '09-wrong-two-slots.js:wrong' && /conn\.watch is not a function/.test(l.solutions.wrong[0].because), '09 show_me kv_card {wallet:u-000010}; the wrong because names conn.watch is not a function');
  ok(read('fixtures/09-wallet-100.yaml').includes('{wallet:u-000010}') && read('fixtures/09-wallet-100.yaml').includes('{wallet:u-000010}:joins:9001'), '09 fixture: SET {wallet:u-000010} 100, DEL {wallet:u-000010}:joins:9001');
}
// ---- 10
{
  const l = lv('10');
  ok(l.mode === 'cli' && types(l) === 'redis,quiz,quiz,quiz,quiz', `10 cli; verify order ${types(l)}`);
  const cs = checksOf(l);
  ok(cs.some((c) => cmdText(c) === 'ACL GETUSER worker' && c.contains === '-@all +@read +@write -@dangerous') && cs.some((c) => cmdText(c) === 'ACL GETUSER worker' && c.contains === '~queue:*') && cs.some((c) => cmdText(c) === 'ACL USERS' && c.contains === 'worker'), '10 redis: ACL GETUSER commands and keys, ACL USERS contains worker (ACL LIST is a list of whole lines, which contains cannot match)');
  ok(task(l, 'CONFIG GET protected-mode', 'CONFIG GET bind', 'ACL LIST', 'ACL SETUSER worker on >hostelpass ~queue:* +@read +@write -@dangerous', 'AUTH worker hostelpass', 'SET queue:x 1', 'SET other 1', 'FLUSHALL', 'AUTH default anything', 'ACL GETUSER worker'), '10 task: protected-mode, bind, ACL LIST, ACL SETUSER worker, AUTH worker, SET queue:x, SET other, FLUSHALL, AUTH default anything, ACL GETUSER');
  ok(l.task.indexOf('ACL WHOAMI') < l.task.indexOf('FLUSHALL') && /do not run the next two lines/.test(l.task), '10 the task has the learner prove who they are (ACL WHOAMI) before FLUSHALL');
  ok(l.setup.some((s) => s.cmd.join(' ') === 'ACL DELUSER worker') && l.show_me.component === 'kv_card', '10 setup removes worker; show_me kv_card');
  ok(/left to right/.test(l.teach) && /requirepass/.test(l.teach) && /@search/.test(l.teach) && /nopass/.test(l.teach), '10 teach: left to right, requirepass, Redis 8 categories, nopass');
  ok(wrongs(l) === '10-wrong-all-commands.redis:wrong', '10 solutions: reference + +@all');
}
// ---- 11
{
  const l = lv('11');
  ok(l.mode === 'cli' && types(l) === 'redis,quiz,quiz,quiz,quiz', `11 cli; verify order ${types(l)}`);
  const cs = checksOf(l);
  ok(cs.some((c) => cmdText(c) === 'CONFIG GET latency-monitor-threshold' && JSON.stringify(c.equals) === '["latency-monitor-threshold","100"]'), '11 redis: CONFIG GET latency-monitor-threshold equals [.., "100"]');
  ok(task(l, 'CONFIG SET latency-monitor-threshold 100', 'LATENCY DOCTOR', 'MEMORY DOCTOR', 'SLOWLOG GET 5', 'CLIENT PAUSE 4000 WRITE', 'CLIENT UNPAUSE'), '11 task: threshold 100, both doctors, SLOWLOG GET 5, CLIENT PAUSE ... WRITE, CLIENT UNPAUSE');
  ok(/replica/.test(l.verify[1].options.map((o) => o.label).join(' ')) && /CLIENT PAUSE/.test(l.verify[1].options.map((o) => o.label).join(' ')) && /REPLICAOF NO ONE/.test(l.verify[1].options.map((o) => o.label).join(' ')), '11 quiz 1: the zero-downtime order, replica, sync, CLIENT PAUSE, REPLICAOF NO ONE');
  ok(wrongs(l) === '11-wrong-threshold-off.redis:wrong', '11 solutions: reference + threshold off');
}
// ---- 12
{
  const l = lv('12');
  const qs = vs(l, 'quiz');
  ok(l.mode === 'decision' && qs.length === 6 && qs.every((q) => q.options.length === 4), '12 decision level, six quizzes of four options');
  const ids = qs.flatMap((q) => q.options.map((o) => o.id));
  ok(new Set(ids).size === ids.length && JSON.stringify([...qs.flatMap((q) => q.correct)].sort()) === JSON.stringify([...l.solutions.reference].sort()), '12 unique option ids; reference lists the six correct ids');
  ok(l.solutions.wrong.length === 6 && qs.every((q) => l.solutions.wrong.filter((w) => q.options.some((x) => x.id === w.option) && !q.correct.includes(w.option)).length === 1), '12 exactly one wrong entry per quiz');
  ok(/not cited|not from the docs|reasoned/i.test(l.story + l.teach) && !/\b(AWS|Azure|Google|ElastiCache|MemoryDB|Upstash|Redis Cloud|Redis Enterprise|Aiven|DigitalOcean|Heroku)\b/.test(read('12-managed-redis.yaml')), '12 says its answers are reasoned, not cited; names no vendor');
}
// ---- 13
{
  const l = lv('13');
  const qs = vs(l, 'quiz');
  ok(l.mode === 'decision' && qs.length === 10 && qs.every((q) => q.options.length === 4), '13 decision level, ten quizzes of four options (one per group)');
  const ids = qs.flatMap((q) => q.options.map((o) => o.id));
  ok(new Set(ids).size === ids.length && JSON.stringify([...qs.flatMap((q) => q.correct)].sort()) === JSON.stringify([...l.solutions.reference].sort()), '13 unique option ids; reference lists the ten correct ids');
  ok(l.solutions.wrong.length === 10 && qs.every((q) => l.solutions.wrong.filter((w) => q.options.some((x) => x.id === w.option) && !q.correct.includes(w.option)).length === 1), '13 exactly one wrong entry per quiz');
  const t = JSON.stringify(qs);
  ok(/TTL/.test(t) && /scheme|object-type:id/.test(t) && /SCAN/.test(t) && /UNLINK/.test(t) && /token/.test(t) && /idempotency key/.test(t) && /evictions/.test(t) && /pending/.test(t) && /lag/.test(t) && /failover/.test(t) && /ACL/.test(t) && /duplicate\(\)/.test(t), '13 covers TTL, key scheme, SCAN, UNLINK, lock token, idempotency key, alerts (evictions, pending, lag), persistence, failover, ACL, duplicate()');
}
// ---- 14
{
  const l = lv('14');
  ok(l.mode === 'cli' && types(l) === 'redis,quiz,quiz,quiz,quiz,quiz', `14 cli; verify order ${types(l)}`);
  const cs = checksOf(l);
  const want = [['CONFIG GET save', '["save","300 10"]'], ['CONFIG GET appendonly', '["appendonly","yes"]'], ['CONFIG GET appendfsync', '["appendfsync","everysec"]'], ['CONFIG GET maxmemory-policy', '["maxmemory-policy","noeviction"]'], ['CONFIG GET latency-monitor-threshold', '["latency-monitor-threshold","100"]']];
  ok(want.every(([c, e]) => cs.some((x) => cmdText(x) === c && JSON.stringify(x.equals) === e)), '14 redis: save 300 10, appendonly yes, appendfsync everysec, maxmemory-policy noeviction, latency-monitor-threshold 100 (each an exact equals)');
  ok(l.setup.length === 5 && l.setup.every((s) => s.cmd[0] === 'CONFIG' && s.cmd[1] === 'SET'), '14 setup makes the box blank with five CONFIG SETs');
  ok(task(l, 'CONFIG SET save "300 10"', 'CONFIG SET appendonly yes', 'CONFIG SET appendfsync everysec', 'CONFIG SET maxmemory-policy noeviction', 'CONFIG SET latency-monitor-threshold 100', 'CONFIG SET save "60 1000"') && l.task.indexOf('CONFIG SET save "60 1000"') > l.task.indexOf('Verify'), '14 task: the five settings, and the stack\'s CONFIG SET save "60 1000" restored after Verify');
  ok(/minute/.test(l.story) && /silently vanish/.test(l.story) && /sessions/.test(l.story), '14 story states the three constraints');
  ok(wrongs(l) === '14-wrong-allkeys-lru.redis:wrong', '14 solutions: reference + allkeys-lru');
}
// ---- solution modules: parse as modules and export what their level needs
const solFiles = readdirSync(resolve(root, DIR, 'solutions')).filter((f) => f.endsWith('.js'));
for (const f of solFiles) {
  try {
    const m = await import(pathToFileURL(resolve(root, DIR, 'solutions', f)).href);
    ok(typeof m.default === 'function', `${f}: default export is a function`);
  } catch (e) { ok(false, `${f}: ${e.message}`); }
}
process.exit(fails ? 1 : 0);
EOF
QUEST_ROOT="$ROOT" QUEST_LEVELS="$LEVELS" node "$TMP/static.mjs" > "$TMP/static.out" 2>&1; RC=$?
cat "$TMP/static.out"
[ $RC -eq 0 ] && pass "static node checks" || fail "static node checks (exit $RC)"

step "local proof: engine evaluators against every solution that can run on one node (one throwaway redis:8 container, a second one for the replica texts)"
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
  docker rm -f "$REPLICA" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  if docker run -d --rm --name "$CONTAINER" -p 127.0.0.1:$HOST_PORT:6379 redis:8 >/dev/null 2>"$TMP/docker.err"; then
    CONTAINER_STARTED=1
    i=0
    until docker exec "$CONTAINER" redis-cli ping >/dev/null 2>&1; do i=$((i + 1)); [ $i -gt 60 ] && break; sleep 0.5; done
    if docker exec "$CONTAINER" redis-cli ping >/dev/null 2>&1; then
      VER=$(docker exec "$CONTAINER" redis-cli INFO server | sed -n 's/^redis_version://p' | tr -d '\r')
      pass "throwaway container $CONTAINER on 127.0.0.1:$HOST_PORT (redis $VER)"
      # the second throwaway container, a replica of the first, on a user-defined network this script creates and removes
      REPLICA_UP=""
      if docker network create "$NETWORK" >/dev/null 2>&1; then
        NETWORK_MADE=1
        docker network connect "$NETWORK" "$CONTAINER" >/dev/null 2>&1
        if docker run -d --rm --name "$REPLICA" --network "$NETWORK" redis:8 redis-server --replicaof "$CONTAINER" 6379 --replica-announce-ip "$REPLICA" >/dev/null 2>&1; then
          REPLICA_STARTED=1
          i=0
          until docker exec "$CONTAINER" redis-cli INFO replication 2>/dev/null | grep -q 'state=online'; do i=$((i + 1)); [ $i -gt 60 ] && break; sleep 0.5; done
          if docker exec "$CONTAINER" redis-cli INFO replication 2>/dev/null | grep -q 'state=online'; then REPLICA_UP=1; pass "throwaway replica $REPLICA is online on network $NETWORK"; else echo "NOTE  the replica did not come online; the replication proofs for levels 7 and 8 are skipped"; fi
        else
          echo "NOTE  could not start the replica container; the replication proofs for levels 7 and 8 are skipped"
        fi
      else
        echo "NOTE  could not create the docker network; the replication proofs for levels 7 and 8 are skipped"
      fi
      cat > "$TMP/proof.mjs" <<'EOF'
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.env.QUEST_ROOT;
const levelsDir = process.env.QUEST_LEVELS;
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const { createClient } = await imp('app/node_modules/redis/dist/index.js');
const shared = await imp('packages/shared/dist/index.js');
const { runAssertions, runFixtureSteps } = await imp('engine/dist/verify/behavior.js');
const { runChecks } = await imp('engine/dist/verify/redis-checks.js');
const { evaluateAssertion } = await imp('engine/dist/verify/assert.js');
const { splitArgs } = await imp('engine/dist/cli.js');
const { parse } = await imp('engine/node_modules/yaml/dist/index.js');
const url = `redis://127.0.0.1:${process.env.PROOF_PORT}`;
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const CONTAINER = process.env.PROOF_CONTAINER;
const REPLICA = process.env.PROOF_REPLICA_UP ? process.env.PROOF_REPLICA : '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

process.on('uncaughtException', (e) => {
  if (e && (e.constructor?.name === 'ClientClosedError' || /The client is closed/.test(String(e.message)))) return;
  console.error(e); process.exit(1);
});

const redis = createClient({ url });
redis.on('error', () => {});
await redis.connect();
const send = (cmd) => redis.sendCommand(cmd.map(String));
const info = async (section) => String(await send(['INFO', section]));
const field = (text, name) => { const m = text.match(new RegExp(`^${name}:(.*)$`, 'm')); return m ? m[1].trim() : undefined; };
const cliIn = (container, args) => spawnSync('docker', ['exec', container, 'redis-cli', ...args.map(String)], { encoding: 'utf8' }).stdout.replace(/\r/g, '').replace(/\n$/, '');
const sh = (container, script) => spawnSync('docker', ['exec', container, 'sh', '-c', script], { encoding: 'utf8' }).stdout.replace(/\n$/, '');

// A fake Postgres: player_stats() knows p-028 (one null column, to exercise the null-to-empty-string rule), nobody else.
const fakePool = {
  query: async (text, params) => {
    if (/player_stats\(/i.test(text)) return { rows: params[0] === 'p-028' ? [{ player_id: 'p-028', name: 'Ganapathi Chengappa', runs: 4821, wickets: null }] : [] };
    return { rows: [] };
  },
};
const toJson = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const slotsOfLevel = (L) => [...new Set(L.verify.filter((v) => v.slot).map((v) => v.slot))];
function makeRun(mod) {
  return async (req) => {
    const fn = mod.default;
    const results = new Array(req.calls.length);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= req.calls.length) return;
        const t0 = Date.now();
        const ctx = await shared.createLearnerDeps({ redisClient: redis, redisUrl: url, dbPool: fakePool, log: () => {} });
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
// The throwaway starts like the crash node: no save points, no log. Every solution begins from this and from the level's own setup.
const reset = async () => {
  await send(['CLIENT', 'UNPAUSE']);
  await send(['FLUSHALL']);
  for (const [k, v] of [['save', ''], ['appendonly', 'no'], ['appendfsync', 'everysec'], ['latency-monitor-threshold', '0'], ['maxmemory-policy', 'noeviction'], ['notify-keyspace-events', ''], ['hash-max-listpack-entries', '512']]) await send(['CONFIG', 'SET', k, v]);
  try { await send(['ACL', 'DELUSER', 'worker']); } catch { /* none */ }
  await send(['SCRIPT', 'FLUSH']);
  await send(['CONFIG', 'RESETSTAT']);
  await send(['SLOWLOG', 'RESET']);
  await send(['LATENCY', 'RESET']);
};

let bad = 0;
const row = (okv, text) => { console.log(`${okv ? 'PASS' : 'FAIL'}  ${text}`); if (!okv) bad++; };
const { chapters } = await shared.loadAllLevels(resolve(root, levelsDir));
const ch = chapters.find((c) => c.id === 'ch5');
const lvl = (n) => ch.levels.find((e) => e.level.id.startsWith(`ch5-${n}-`)).level;
const liveByLevel = [];
// Levels with an event that needs the compose profiles are graded by hand; the evaluators here run only their redis and behavior parts.
const HAND = new Set(['01', '07', '08', '09']);
// A wrong solution whose declared failure is decided somewhere the evaluators cannot go (traffic here, a cluster for 09).
const DEFERRED_WRONG = new Set(['solutions/06-wrong-plain-client.js']);
const CLUSTER_WRONG = new Set(['solutions/09-wrong-two-slots.js']);

// Play a .redis file the way the game's terminal does: one connection of its own, each line split like redis-cli, errors kept as text.
async function playRedis(file) {
  const term = createClient({ url });
  term.on('error', () => {});
  await term.connect();
  const transcript = [];
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const argv = splitArgs(line);
    if (!argv || !argv.length) { transcript.push({ line, reply: 'Invalid argument(s)' }); continue; }
    try { transcript.push({ line, reply: await term.sendCommand(argv) }); } catch (e) { transcript.push({ line, reply: `(error) ${e.message}` }); }
  }
  await term.quit().catch(() => {});
  return transcript;
}

async function judge(L, dir, s, mode) {
  // mode: 'ref' | 'wrong' | 'stub'
  await reset();
  const file = s ? join(dir, s.path) : null;
  let failed = false;
  const notes = [];
  const t0 = Date.now();
  for (const st of L.setup ?? []) if (st.cmd) await send(st.cmd);
  const setupMs = Date.now() - t0;
  let mod = null;
  let transcript = [];
  if (file && file.endsWith('.redis')) { transcript = await playRedis(file); await sleep(300); }
  else if (file && file.endsWith('.js')) mod = await import(`${pathToFileURL(file).href}?${Math.random()}`);
  else if (mode === 'stub' && L.mode === 'code') mod = { default: async () => undefined };
  const run = mod ? makeRun(mod) : null;
  for (const v of L.verify) {
    if (v.type === 'behavior' && run) {
      const err = await runFixtureSteps(fixtureSteps(dir, v.fixtures), send);
      if (err) { notes.push(err); failed = true; continue; }
      const r = await runAssertions({ slot: v.slot, module: v.slot, concurrency: v.concurrency, assertions: v.assertions }, { run, send });
      if (!r.ok) { failed = true; notes.push(`behavior ${v.slot}: ${r.message.split('\n').join(' | ').slice(0, 300)}`); }
    } else if (v.type === 'redis') {
      // 09's CLUSTER INFO check needs a real cluster: hand grading (proved separately below to fail off-cluster)
      if (v.checks.every((c) => c.cmd[0] === 'CLUSTER')) { notes.push('redis: CLUSTER INFO needs a cluster, DEFER'); continue; }
      const items = await runChecks(send, v.checks);
      const badItems = items.filter((i) => !i.ok);
      if (badItems.length) { failed = true; notes.push(`redis: ${badItems.map((b) => b.feedback).join(' | ').slice(0, 300)}`); }
    } else if (v.type === 'answer') {
      // The harness types the live reply for a right solution and not-the-answer for a wrong one; here: what would be typed.
      const raw = await send(v.expected.cmd);
      const typed = mode === 'ref' ? String(raw) : 'not-the-answer';
      const expected = v.expected.transform === 'number' ? Number(raw) : String(raw);
      const okv = v.expected.transform === 'number' ? Number(typed) === expected : typed === expected;
      if (!okv) failed = true;
      notes.push(`answer: ${okv ? 'ok' : 'fails'} (typed ${typed})`);
    }
    // quiz, event and traffic verifiers: DEFER (the orchestrator's live and hand grading)
  }
  return { verdict: failed ? 'wrong' : 'right', notes, setupMs };
}

for (const entry of ch.levels) {
  const L = entry.level;
  const n = L.id.slice(4, 6);
  if (only && !only.includes(n)) continue;
  const dir = dirname(entry.file);
  const liveKinds = new Set();
  for (const v of L.verify) {
    if (v.type === 'traffic') liveKinds.add(`traffic ${v.scenario}`);
    if (v.type === 'quiz') liveKinds.add('quiz');
    if (v.type === 'event') liveKinds.add(`event ${v.kind} ${v.match?.name ?? ''} ${v.match?.to ?? v.match?.kind ?? ''}`.trim());
  }
  if (liveKinds.size) liveByLevel.push(`${L.id}: ${[...liveKinds].join('; ')}`);
  if (L.mode === 'decision') { console.log(`-- ${L.id}: decision level, checked statically (reference = the correct ids, one wrong option per quiz); quizzes DEFER`); continue; }

  const solutions = [{ path: L.solutions.reference, expect: 'right' }, ...L.solutions.wrong.map((w) => ({ path: w.path, expect: w.expect }))];
  for (const s of solutions) {
    if (s.path.endsWith('.sh')) {
      row(true, `${L.id} ${s.path}: declared ${s.expect}; DEFER (an ops shell, played by hand against the compose profiles; only syntax is checked above)`);
      continue;
    }
    const r = await judge(L, dir, s, s.expect === 'right' ? 'ref' : 'wrong');
    let want = s.expect;
    let why = '';
    if (DEFERRED_WRONG.has(s.path)) { want = 'right'; why = ' (by a DEFERRED traffic verifier; the local evaluators must see right)'; }
    if (CLUSTER_WRONG.has(s.path)) { want = 'wrong'; why = ' (on a cluster it dies on conn.watch is not a function; on this single node it reads wallet:u-000010, which the level\'s fixture no longer writes, so the evaluators also say wrong)'; }
    const handNote = HAND.has(n) ? ' [redis and behavior part only; the event part DEFERs]' : '';
    row(r.verdict === want, `${L.id} ${s.path}: declared ${s.expect}${why}, evaluators say ${r.verdict}${handNote} (setup ${r.setupMs} ms)`);
    if (r.verdict !== want || process.env.VERBOSE) for (const x of r.notes) console.log(`        ${x}`);
    else if (s.expect !== 'right') for (const x of r.notes.slice(0, 2)) console.log(`        how: ${x}`);
    else for (const x of r.notes.filter((t) => t.startsWith('answer'))) console.log(`        ${x}`);
  }
  // an empty stub must be wrong, wherever the evaluators decide
  if (!HAND.has(n)) {
    const r = await judge(L, dir, null, 'stub');
    row(r.verdict === 'wrong', `${L.id} empty stub: declared wrong, evaluators say ${r.verdict}${r.verdict === 'right' ? ' (a level that passes with nothing done)' : ''}`);
    if (r.verdict === 'wrong') console.log(`        how: ${(r.notes[0] ?? '').slice(0, 200)}`);
  }
}

console.log('\n-- extra proofs (every size, text and timing a level quotes is re-measured here)');
const LV = resolve(root, levelsDir, 'ch5-survive');
const run1 = async (cmd) => { try { return await send(cmd); } catch (e) { return `(error) ${e.message}`; } };
const checksOfLevel = (L) => L.verify.filter((v) => v.type === 'redis').flatMap((v) => v.checks);
const evalCheck = async (c) => (await runChecks(send, [c]))[0];
if (!only) {
  // 01. The redis checks describe the crashed node; they fail on a node that still holds the over.
  {
    const L = lvl('01');
    await reset();
    for (const st of L.setup ?? []) await send(st.cmd);
    const fresh = await runChecks(send, checksOfLevel(L));
    for (let i = 1; i <= 6; i++) await send(['XADD', 'match:final:balls', '*', 'over', '1', 'ball', String(i), 'runs', '4']);
    await send(['SET', 'score:final', '24']);
    const xlen = Number(await send(['XLEN', 'match:final:balls']));
    const played = await runChecks(send, checksOfLevel(L));
    const ctext = String(await send(['CONFIG', 'GET', 'appendonly']));
    const persistence = await info('persistence');
    row(fresh.every((c) => c.ok) && played.every((c) => !c.ok) && xlen === 6, `01 the redis checks: all ${fresh.length} pass on a node that came back empty, all ${played.length} fail on a node still holding the over (XLEN ${xlen}); the events decide the rest (DEFER)`);
    row(field(persistence, 'aof_enabled') === '0' && /^\d+$/.test(field(persistence, 'rdb_changes_since_last_save') ?? ''), `01 INFO persistence on a node with no log: aof_enabled ${field(persistence, 'aof_enabled')} and rdb_changes_since_last_save ${field(persistence, 'rdb_changes_since_last_save')} (the text tells the learner to read both; CONFIG GET appendonly ${ctext.replace(/,/g, ' ')})`);
  }
  // 02. The crash node's restart, emulated by a second redis-server process inside the throwaway container: port 6500, the crash node's flags.
  {
    const C = (...a) => cliIn(CONTAINER, ['-p', '6500', ...a]);
    const start = () => sh(CONTAINER, 'cd /tmp/crash && redis-server --port 6500 --save "" --appendonly no --daemonize yes --dir /tmp/crash --logfile /tmp/crash/log >/dev/null; sleep 1');
    const kill9 = () => { const pid = C('INFO', 'server').split('\n').find((x) => x.startsWith('process_id:')).split(':')[1].trim(); sh(CONTAINER, `kill -9 ${pid}; sleep 0.5`); };
    sh(CONTAINER, 'redis-cli -p 6500 shutdown nosave >/dev/null 2>&1; rm -rf /tmp/crash && mkdir -p /tmp/crash');
    start();
    const save0 = C('CONFIG', 'GET', 'save').split('\n')[1];
    C('CONFIG', 'SET', 'save', '60 1000');
    C('SET', 'score:final', '24');
    const saves0 = field(C('INFO', 'persistence'), 'rdb_saves');
    C('BGSAVE');
    let waited = 0;
    while (field(C('INFO', 'persistence'), 'rdb_saves') === '0' && waited < 3000) { await sleep(25); waited += 25; }
    const p = C('INFO', 'persistence');
    const dirLs = sh(CONTAINER, 'ls /tmp/crash');
    C('SET', 'after:snapshot', '1');
    kill9();
    start();
    const back = C('GET', 'score:final');
    const lost = C('GET', 'after:snapshot');
    const saveAfter = C('CONFIG', 'GET', 'save').split('\n')[1];
    sh(CONTAINER, 'redis-cli -p 6500 shutdown nosave >/dev/null 2>&1; true');
    row(save0 === '' && saves0 === '0' && field(p, 'rdb_saves') === '1' && field(p, 'rdb_last_bgsave_status') === 'ok' && /dump\.rdb/.test(dirLs), `02 crash-node emulation: save starts empty, rdb_saves ${saves0} then ${field(p, 'rdb_saves')} (${waited} ms after BGSAVE), status ${field(p, 'rdb_last_bgsave_status')}, /data holds dump.rdb`);
    await reset();
    await send(['EVAL', "for i = 1, 300000 do redis.call('SET', 'k' .. i, string.rep('x', 50)) end return 1", '0']);
    const s0 = Number(field(await info('persistence'), 'rdb_saves'));
    const tb = Date.now();
    await send(['BGSAVE']);
    const first = await info('persistence');
    let ms = 0;
    while (field(await info('persistence'), 'rdb_bgsave_in_progress') !== '0' && ms < 5000) { await sleep(10); ms = Date.now() - tb; }
    const last = await info('persistence');
    row(Number(field(first, 'rdb_saves')) === s0 + 1 && field(last, 'rdb_bgsave_in_progress') === '0' && field(last, 'rdb_last_bgsave_status') === 'ok' && field(last, 'rdb_changes_since_last_save') === '0', `02 BGSAVE of 300,000 keys on the main throwaway: rdb_saves ${s0} -> ${field(first, 'rdb_saves')} at the first look (it counts snapshots started, in progress ${field(first, 'rdb_bgsave_in_progress')}), then rdb_bgsave_in_progress 0 after ${ms} ms, status ${field(last, 'rdb_last_bgsave_status')}, rdb_changes_since_last_save ${field(last, 'rdb_changes_since_last_save')} (the reference waits half a second with BLPOP so that the child has finished)`);
    row(back === '24' && lost === '' && saveAfter === '', `02 after kill -9 and a restart with the crash node's flags: GET score:final "${back}" (the snapshot loaded though save is off), after:snapshot "${lost}" (empty: lost), CONFIG GET save "${saveAfter}" (empty again): the text says all three`);
  }
  // 03. The log on a live node, the files, the benchmark ratio the text quotes.
  {
    const C = (...a) => cliIn(CONTAINER, ['-p', '6500', ...a]);
    sh(CONTAINER, 'redis-cli -p 6500 shutdown nosave >/dev/null 2>&1; rm -rf /tmp/crash && mkdir -p /tmp/crash; cd /tmp/crash && redis-server --port 6500 --save "" --appendonly no --daemonize yes --dir /tmp/crash --logfile /tmp/crash/log >/dev/null; sleep 1');
    for (const k of ['k1', 'k2', 'k3']) C('SET', k, 'v');
    const before = field(C('INFO', 'persistence'), 'aof_enabled');
    C('CONFIG', 'SET', 'appendonly', 'yes');
    let waited = 0;
    while (field(C('INFO', 'persistence'), 'aof_rewrites') === '0' && waited < 3000) { await sleep(25); waited += 25; }
    const p = C('INFO', 'persistence');
    const files = sh(CONTAINER, 'ls /tmp/crash/appendonlydir').split('\n').map((f) => f.replace(/\.\d+\./, '.<n>.'));
    const bench = (mode) => {
      C('CONFIG', 'SET', 'appendfsync', mode);
      const out = spawnSync('docker', ['exec', CONTAINER, 'redis-benchmark', '-p', '6500', '-t', 'set', '-n', '20000', '-q'], { encoding: 'utf8' }).stdout.replace(/\r/g, '\n');
      const m = out.match(/SET: ([\d.]+) requests per second/g)?.pop()?.match(/([\d.]+)/);
      return m ? Number(m[1]) : NaN;
    };
    const every = [bench('everysec'), bench('everysec'), bench('everysec')];
    const always = [bench('always'), bench('always'), bench('always')];
    const no = [bench('no'), bench('no'), bench('no')];
    C('CONFIG', 'SET', 'appendfsync', 'everysec');
    const lo = (a) => Math.min(...a);
    const ratio = (always.reduce((a, b) => a + b, 0) / 3) / (every.reduce((a, b) => a + b, 0) / 3);
    sh(CONTAINER, 'redis-cli -p 6500 shutdown nosave >/dev/null 2>&1; true');
    row(before === '0' && field(p, 'aof_enabled') === '1' && field(p, 'aof_rewrites') === '1' && files.includes('appendonly.aof.<n>.base.rdb') && files.includes('appendonly.aof.<n>.incr.aof') && files.includes('appendonly.aof.manifest'), `03 CONFIG SET appendonly yes on a live node: aof_enabled ${before} -> ${field(p, 'aof_enabled')}, aof_rewrites ${field(p, 'aof_rewrites')} after ${waited} ms, files ${files.join(', ')}`);
    row(ratio > 0.1 && ratio < 0.35, `03 redis-benchmark -t set -n 20000 -q, three runs each, now: everysec ${every.map(Math.round).join(', ')}, always ${always.map(Math.round).join(', ')}, no ${no.map(Math.round).join(', ')}; always is ${ratio.toFixed(2)} of everysec (the text says about a fifth, 57,971 to 59,524 against 273,972 to 285,714 on the author's runs; these runs differ, the ratio is the claim)`);
    void lo;
  }
  // 05. The sizes the level quotes.
  {
    const L = lvl('05');
    await reset();
    for (const st of L.setup ?? []) await send(st.cmd);
    const usage = Number(await send(['MEMORY', 'USAGE', 'player:p-028']));
    const enc = String(await send(['OBJECT', 'ENCODING', 'player:p-028']));
    const hlen = Number(await send(['HLEN', 'player:p-028']));
    const bigEnc = String(await send(['OBJECT', 'ENCODING', 'big:hash']));
    const bigUsage = Number(await send(['MEMORY', 'USAGE', 'big:hash']));
    const bigLen = Number(await send(['HLEN', 'big:hash']));
    const limits = [String((await send(['CONFIG', 'GET', 'hash-max-listpack-entries']))[1]), String((await send(['CONFIG', 'GET', 'hash-max-listpack-value']))[1]), String((await send(['CONFIG', 'GET', 'maxmemory']))[1])];
    row(usage === 268 && enc === 'listpack' && hlen === 12 && bigEnc === 'hashtable' && bigLen === 600 && bigUsage === 32059 && limits[0] === '512' && limits[1] === '64', `05 sizes the text quotes: player:p-028 ${usage} bytes (text: 268) as ${enc} with ${hlen} fields; big:hash ${bigUsage} bytes (text: 32,059) as ${bigEnc} with ${bigLen} fields; limits ${limits[0]} entries and ${limits[1]} bytes`);
    row(usage * 50_000_000 === 13_400_000_000, `05 the napkin: ${usage} x 50,000,000 = ${(usage * 50_000_000).toLocaleString('en-US')} bytes (the quiz explanation says 13.4 GB)`);
    await send(['CONFIG', 'SET', 'hash-max-listpack-entries', '1024']);
    await send(['EVAL', "for i = 1, 600 do redis.call('HSET', 'big:test', 'field-' .. i, 'value-' .. i) end return 600", '0']);
    const lpEnc = String(await send(['OBJECT', 'ENCODING', 'big:test']));
    const lpUsage = Number(await send(['MEMORY', 'USAGE', 'big:test']));
    await send(['CONFIG', 'SET', 'hash-max-listpack-entries', '512']);
    row(lpEnc === 'listpack' && lpUsage === 13018, `05 the same 600 fields as a listpack (limit raised to 1024 for the test): ${lpEnc}, ${lpUsage} bytes (text: 13,018)`);
    // DEL and UNLINK of a 300,000-field hash, as Chapter 4b measured
    await send(['EVAL', "for i = 1, 300000 do redis.call('HSET', 'big:300k', 'u' .. i, '1') end return 1", '0']);
    await send(['CONFIG', 'SET', 'slowlog-log-slower-than', '0']);
    await send(['SLOWLOG', 'RESET']);
    await send(['DEL', 'big:300k']);
    const del = Number((await send(['SLOWLOG', 'GET', '10'])).find((e) => String(e[3][0]).toLowerCase() === 'del')?.[2] ?? -1);
    await send(['EVAL', "for i = 1, 300000 do redis.call('HSET', 'big:300k', 'u' .. i, '1') end return 1", '0']);
    await send(['SLOWLOG', 'RESET']);
    await send(['UNLINK', 'big:300k']);
    const unlink = Number((await send(['SLOWLOG', 'GET', '10'])).find((e) => String(e[3][0]).toLowerCase() === 'unlink')?.[2] ?? -1);
    await send(['CONFIG', 'SET', 'slowlog-log-slower-than', '10000']);
    row(del > 3000 && unlink >= 0 && unlink < 1000, `05 DEL of a 300,000-field hash ${del} us against UNLINK ${unlink} us (the text quotes Chapter 4b: about 10 ms against 7 to 30 us)`);
  }
  // 06. Redis commands per call, through the real createLearnerDeps with the cached client, reference against the plain client.
  {
    const perCall = {};
    for (const file of ['06-reference.js', '06-wrong-plain-client.js']) {
      await reset();
      const mod = await import(`${pathToFileURL(join(LV, 'solutions', file)).href}?${Math.random()}`);
      const ctx = await shared.createLearnerDeps({ redisClient: redis, redisUrl: url, dbPool: fakePool, log: () => {} });
      await mod.default(ctx.deps, 'p-028'); // warm the hash, as the behavior check does before the traffic run
      await mod.default(ctx.deps, 'p-028'); // the second call is the first one the cached client answers from memory
      const before = Number(field(await info('stats'), 'total_commands_processed'));
      let calls = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 2500) {
        await Promise.all(Array.from({ length: 100 }, () => mod.default(ctx.deps, 'p-028')));
        calls += 100;
        await sleep(20);
      }
      const after = Number(field(await info('stats'), 'total_commands_processed'));
      const hg = field((await info('commandstats')).split(/\r?\n/).find((x) => x.startsWith('cmdstat_hgetall:')) ?? '', 'cmdstat_hgetall') ?? '';
      await ctx.close();
      perCall[file] = { r: (after - before - 1) / calls, calls, hg };
    }
    const a = perCall['06-reference.js'], b = perCall['06-wrong-plain-client.js'];
    row(a.r <= 0.05 && b.r > 0.5, `06 Redis commands per call (2.5 s, 100 at a time, one player): reference ${a.r.toFixed(4)} over ${a.calls} calls (needs at most 0.05; hgetall ${a.hg.slice(0, 20)}), plain client ${b.r.toFixed(3)} over ${b.calls} calls (about 1: the live traffic check fails it)`);
    // invalidation: a write from another connection makes the cached client read the server again
    await reset();
    const mod = await import(`${pathToFileURL(join(LV, 'solutions', '06-reference.js')).href}?${Math.random()}`);
    const ctx = await shared.createLearnerDeps({ redisClient: redis, redisUrl: url, dbPool: fakePool, log: () => {} });
    await mod.default(ctx.deps, 'p-028'); await mod.default(ctx.deps, 'p-028'); await mod.default(ctx.deps, 'p-028');
    await sleep(150); // the invalidation from the first write arrives a moment after it: a read in the same instant can still miss once
    const base = (await info('commandstats')).match(/cmdstat_hgetall:calls=(\d+)/)?.[1] ?? '0';
    await mod.default(ctx.deps, 'p-028'); await mod.default(ctx.deps, 'p-028');
    const same = (await info('commandstats')).match(/cmdstat_hgetall:calls=(\d+)/)?.[1] ?? '0';
    await send(['HSET', 'cache:player:p-028', 'runs', '4822']);
    await sleep(100);
    const got = await ctx.deps.redisCached.hGetAll('cache:player:p-028');
    const after = (await info('commandstats')).match(/cmdstat_hgetall:calls=(\d+)/)?.[1] ?? '0';
    await ctx.close();
    row(base === same && Number(after) === Number(same) + 1 && got.runs === '4822', `06 two more reads cost no server read (hgetall calls ${base} then ${same}); a write from another connection is seen on the next read (runs ${got.runs}) and costs exactly one (${after})`);
    const noWrite = ctx;
    void noWrite;
  }
  // 07 and 08. The replica texts, from the second throwaway container; the checks' verdicts on the master and on the replica.
  if (REPLICA) {
    const L7 = lvl('07'), L8 = lvl('08');
    const M = (...a) => cliIn(CONTAINER, a);
    const P = (...a) => cliIn(REPLICA, a);
    await reset();
    for (const st of L7.setup ?? []) await send(st.cmd);
    M('SET', 'score:final', '30');
    await sleep(300);
    const rm = M('INFO', 'replication');
    const rr = P('INFO', 'replication');
    const readonly = P('SET', 'score:final', '31');
    const got = P('GET', 'score:final');
    const wait = M('WAIT', '1', '1000');
    const minRep = M('CONFIG', 'GET', 'min-replicas-to-write').split('\n')[1];
    const minLag = M('CONFIG', 'GET', 'min-replicas-max-lag').split('\n')[1];
    row(/^role:master$/m.test(rm) && /^connected_slaves:1$/m.test(rm) && /^slave0:ip=quest-c5-replica,port=6379,state=online,offset=\d+,lag=\d+/m.test(rm) && /^role:slave$/m.test(rr) && /^master_link_status:up$/m.test(rr) && /^master_host:quest-c5-redis$/m.test(rr), '07 INFO replication: master role:master, connected_slaves:1 and a slave0:ip=...,port=6379,state=online,offset=...,lag=... line; replica role:slave, master_host, master_link_status:up (the text names all of them)');
    row(readonly.trim() === "READONLY You can't write against a read only replica." && got === '30' && wait === '1' && minRep === '0' && minLag === '10', `07 READONLY text "${readonly}", GET on the replica "${got}", WAIT 1 1000 -> ${wait}, min-replicas-to-write ${minRep}, min-replicas-max-lag ${minLag}`);
    const verdictOn = async (L, text, name) => {
      const items = [];
      for (const c of checksOfLevel(L)) { const r = evaluateAssertion(c, text(c)); items.push(r.ok); }
      return items;
    };
    // 07's checks on the master with the replica attached (true) and on a master with none (false: the wrong solution never starts it)
    const okAttached = await runChecks(send, checksOfLevel(L7));
    row(okAttached.every((c) => c.ok), `07 the redis checks pass on the master with the replica attached (${okAttached.length} checks)`);
    const detached = evaluateAssertion(checksOfLevel(L7)[0], 'role:master\r\nconnected_slaves:0\r\n');
    row(!detached.ok, '07 connected_slaves:[1-9] fails on a master with no replica (the wrong solution never starts the profile)');
    // 08's check: role:master on the master, role:slave on the replica
    const c8 = checksOfLevel(L8)[0];
    row(evaluateAssertion(c8, rm).ok && !evaluateAssertion(c8, rr).ok, '08 INFO replication role:master passes on the master and fails on the replica (so a failback that did not happen is caught)');
    void verdictOn;
  } else {
    console.log('NOTE  no replica container: the proofs of the replication texts of levels 7 and 8 were skipped');
  }
  // 09. Slots: the CRC16 the text quotes, checked against the numbers E-03 and A-05 measured on a real cluster.
  {
    const crc16 = (buf) => { let crc = 0; for (const b of buf) { crc ^= b << 8; for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff; } return crc; };
    const slot = (key) => { let k = Buffer.from(key); const s = k.indexOf('{'); if (s !== -1) { const e = k.indexOf('}', s + 1); if (e !== -1 && e !== s + 1) k = k.subarray(s + 1, e); } return crc16(k) % 16384; };
    const known = { 'contest:9001:entries': 7573, 'wallet:u-a05-3': 8805, 'wallet:u-a05-1': 551, '{u:1}:a': 16340 };
    row(Object.entries(known).every(([k, v]) => slot(k) === v), `09 the CRC16 used here reproduces what E-03 and A-05 measured on a real cluster: ${Object.entries(known).map(([k, v]) => `${k} ${slot(k)}=${v}`).join(', ')}`);
    const wallet = slot('wallet:u-000010'), tagged = slot('{wallet:u-000010}'), joins = slot('{wallet:u-000010}:joins:9001'), contest = slot('contest:9001:entries');
    row(wallet === 10458 && contest === 7573 && tagged === 10458 && joins === 10458 && wallet !== contest && slot('a') !== slot('b') && slot('{u:1}:a') === slot('{u:1}:b'), `09 the text's slots: wallet:u-000010 ${wallet} (text: 10458), contest:9001:entries ${contest} (text: 7573), {wallet:u-000010} ${tagged} and its joins key ${joins} share one slot; a ${slot('a')} and b ${slot('b')} differ (MSET a 1 b 2 is CROSSSLOT), {u:1}:a and {u:1}:b share ${slot('{u:1}:a')}`);
    const third = (s) => (s <= 5460 ? 'first third' : s <= 10922 ? 'second third' : 'last third');
    row(third(wallet) === third(contest), `09 both slots fall in the same third (${third(wallet)}), so on A-05's even split the plain MULTI is CROSSSLOT for u-000010, not MOVED`);
    const L = lvl('09');
    const clusterInfo = await run1(['CLUSTER', 'INFO']);
    const r = await evalCheck(checksOfLevel(L)[0]);
    row(!r.ok && /cluster support disabled/.test(String(clusterInfo)), `09 CLUSTER INFO check fails off-cluster: "${String(clusterInfo).slice(0, 60)}" (it passes on the cluster: hand grading)`);
  }
  // 10. The ACL texts the level quotes.
  {
    await reset();
    const term = createClient({ url });
    term.on('error', () => {});
    await term.connect();
    const T = async (...a) => { try { return await term.sendCommand(a.map(String)); } catch (e) { return `(error) ${e.message}`; } };
    const defaultUser = await send(['ACL', 'LIST']);
    const whoDefault = String(await T('ACL', 'WHOAMI'));
    await T('ACL', 'SETUSER', 'worker', 'on', '>hostelpass', '~queue:*', '+@read', '+@write', '-@dangerous');
    const g = await send(['ACL', 'GETUSER', 'worker']);
    const g1 = Object.fromEntries(g.reduce((acc, v, i) => (i % 2 ? acc : [...acc, [v, g[i + 1]]]), []));
    const auth = String(await T('AUTH', 'worker', 'hostelpass'));
    const whoami = String(await T('ACL', 'WHOAMI'));
    const setQ = String(await T('SET', 'queue:x', '1'));
    const getQ = String(await T('GET', 'queue:x'));
    const setO = String(await T('SET', 'other', '1'));
    const flush = String(await T('FLUSHALL'));
    const back = String(await T('AUTH', 'default', 'anything'));
    const whoBack = String(await T('ACL', 'WHOAMI'));
    await term.quit().catch(() => {});
    const cfg = [String((await send(['CONFIG', 'GET', 'protected-mode']))[1]), String((await send(['CONFIG', 'GET', 'bind']))[1])];
    row(defaultUser[0] === 'user default on nopass sanitize-payload ~* &* +@all' && whoDefault === 'default' && cfg[0] === 'no' && cfg[1] === '* -::*', `10 the open door, as quoted: ACL LIST "${defaultUser[0]}", protected-mode ${cfg[0]}, bind "${cfg[1]}"`);
    row(g1.commands === '-@all +@read +@write -@dangerous' && g1.keys === '~queue:*', `10 ACL GETUSER worker: commands "${g1.commands}", keys "${g1.keys}" (the checks read exactly these)`);
    row(auth === 'OK' && /^\(error\) NOPERM User worker has no permissions to run the 'acl\|whoami' command/.test(whoami) && setQ === 'OK' && getQ === '1' && /^\(error\) NOPERM No permissions to access a key/.test(setO) && /^\(error\) NOPERM User worker has no permissions to run the 'flushall' command/.test(flush), `10 as worker: AUTH ${auth}; ACL WHOAMI "${whoami.slice(0, 66)}..."; SET queue:x ${setQ}; GET queue:x ${getQ}; SET other "${setO.slice(0, 50)}"; FLUSHALL "${flush.slice(0, 70)}"`);
    row(back === 'OK' && whoBack === 'default', `10 AUTH default anything -> ${back}, ACL WHOAMI -> ${whoBack} (the default user has no password, so any value is accepted)`);
    // the wrong file: +@all, the checks see commands "+@all"
    await reset();
    const L = lvl('10');
    await playRedis(join(LV, 'solutions/10-wrong-all-commands.redis'));
    const g2 = await send(['ACL', 'GETUSER', 'worker']);
    row(g2[g2.indexOf('commands') + 1] === '+@all', `10 the wrong file leaves commands "${g2[g2.indexOf('commands') + 1]}" (+@all)`);
    void L;
  }
  // 11. The texts and timings the level quotes.
  {
    await reset();
    const a = await send(['CONFIG', 'GET', 'slowlog-log-slower-than']);
    const b = await send(['CONFIG', 'GET', 'slowlog-max-len']);
    const stall = ['EVAL', "local t = os.clock() while os.clock() - t < 0.25 do end return 1", '0'];
    await send(['LATENCY', 'RESET']);
    await send(stall);
    const at0 = await send(['LATENCY', 'LATEST']);
    await send(['CONFIG', 'SET', 'latency-monitor-threshold', '100']);
    await send(stall);
    const at100 = await send(['LATENCY', 'LATEST']);
    const doctor = String(await send(['LATENCY', 'DOCTOR']));
    const slow = (await send(['SLOWLOG', 'GET', '5'])).find((e) => String(e[3][0]).toLowerCase() === 'eval');
    row(a[1] === '10000' && b[1] === '128' && at0.length === 0 && at100.length === 1 && String(at100[0][0]) === 'command' && Number(at100[0][2]) >= 240 && /latency spikes/.test(doctor) && slow && Number(slow[2]) > 200000, `11 slowlog-log-slower-than ${a[1]} and slowlog-max-len ${b[1]}; a 250 ms stall: LATENCY LATEST ${at0.length} events at threshold 0, ${at100.length} ("${at100[0]?.[0]}", ${at100[0]?.[2]} ms) at 100; LATENCY DOCTOR reports spikes; SLOWLOG GET holds the EVAL for ${slow?.[2]} us`);
    await reset();
    await send(['CONFIG', 'SET', 'latency-monitor-threshold', '100']);
    const memDoctor = String(await send(['MEMORY', 'DOCTOR']));
    const calm = String((await (async () => { await send(['LATENCY', 'RESET']); return send(['LATENCY', 'DOCTOR']); })()));
    row(/empty or is using very little memory/.test(memDoctor) && /no latency spike was observed/.test(calm), `11 on a nearly empty server MEMORY DOCTOR says "${memDoctor.slice(0, 60)}..." and a calm LATENCY DOCTOR says "${calm.slice(0, 40)}..."`);
    // CLIENT PAUSE ... WRITE: a read answers at once, a write waits for the pause
    const w = createClient({ url }); w.on('error', () => {}); await w.connect();
    const r = createClient({ url }); r.on('error', () => {}); await r.connect();
    await send(['CLIENT', 'PAUSE', '3000', 'WRITE']);
    const t0 = Date.now();
    await r.sendCommand(['GET', 'score:final']);
    const readMs = Date.now() - t0;
    await w.sendCommand(['SET', 'paused:write', '1']);
    const writeMs = Date.now() - t0;
    await w.quit().catch(() => {}); await r.quit().catch(() => {});
    row(readMs < 500 && writeMs >= 2500 && writeMs < 5000, `11 CLIENT PAUSE 3000 WRITE: a GET answered after ${readMs} ms, a SET after ${writeMs} ms (the text: reads pass, writes wait for the pause)`);
    await send(['CLIENT', 'UNPAUSE']);
  }
  // 14. The blank box: each of the six checks fails on it individually, and passes after the reference.
  {
    const L = lvl('14');
    await reset();
    for (const st of L.setup ?? []) await send(st.cmd);
    const blank = await runChecks(send, checksOfLevel(L));
    row(blank.length === 6 && blank.every((c) => !c.ok), `14 the setup's blank box fails all ${blank.length} redis checks individually (save "", appendonly no, aof_enabled 0, appendfsync no, allkeys-lru, threshold 0)`);
    await playRedis(join(LV, 'solutions/14-reference.redis'));
    await sleep(300);
    const done = await runChecks(send, checksOfLevel(L));
    row(done.every((c) => c.ok), `14 and all ${done.length} pass after the reference (the file ends at save "300 10", which the stack's save "60 1000" must replace after Verify: the harness does not reset save)`);
  }
}
await sleep(500);
console.log(`LIVE_SUMMARY ${JSON.stringify(liveByLevel)}`);
await reset();
await send(['CONFIG', 'SET', 'save', '3600 1 300 100 60 10000']);
await redis.quit();
process.exit(bad ? 1 : 0);
EOF
      QUEST_ROOT="$ROOT" QUEST_LEVELS="$LEVELS" PROOF_PORT="$HOST_PORT" PROOF_CONTAINER="$CONTAINER" PROOF_REPLICA="$REPLICA" PROOF_REPLICA_UP="$REPLICA_UP" ONLY="${ONLY:-}" node "$TMP/proof.mjs" > "$TMP/proof.out" 2>&1; RC=$?
      grep -v '^LIVE_SUMMARY' "$TMP/proof.out"
      PROOF_RAN=1
      [ $RC -eq 0 ] && pass "every solution that can run on one node gets its declared verdict from the engine's evaluators; every empty stub is wrong; the extra proofs hold" || fail "a solution got a different verdict than declared, a stub passed, or an extra proof failed (exit $RC)"
    else
      fail "the throwaway container did not answer PING: $(docker logs "$CONTAINER" 2>&1 | tail -3)"
    fi
  else
    fail "could not start $CONTAINER on port $HOST_PORT: $(head -2 "$TMP/docker.err")"
  fi
fi

step "which verdicts rest on live or hand grading (the orchestrator's grade.sh through the engine, and by hand with the compose profiles)"
node -e '
  for (const l of process.argv.slice(1)) console.log("LIVE  " + l);
' "every level with a quiz (all fourteen): the harness types the right options for right solutions and a wrong one for wrong ones; none of the proof above covers a quiz. Levels 04, 12 and 13 are all quizzes: the reference is the correct ids (checked statically), one wrong option per quiz" \
  "HAND-GRADED, skipped by the harness (SKIPPED needs the compose profiles): 01 (events redis_target_changed to redis-nopersist, redis_disconnect, redis_reconnect), 07 (redis_target_changed to redis-replica), 08 (sentinel_failover), 09 (redis_target_changed kind cluster). Their .sh references are the exact command lists, and the proof above shows that their redis and behavior checks are true only in the right state: see docs/handoffs/C5.md for the order to play them in" \
  "ch5-06-the-celebrity-again: the traffic verifier (redis_per_request_lte 0.05, error_rate_lte 0, p99_ms_lte 100) through the app's real RESP 3 client. The declared verdict of 06-wrong-plain-client.js (wrong) rests on it alone: the proof shows the evaluators say right for it and measures about 1 Redis command per call against about 0 for the reference" \
  "ch5-09-the-cluster-migration: everything that needs a real cluster (the event, CLUSTER INFO, the behavior through the runner on the cluster, and the declared failure of 09-wrong-two-slots.js, conn.watch is not a function). The proof runs the reference and the wrong file against a single node only" \
  "every redis, behavior and answer verdict above is proven here on one throwaway redis:8 with createLearnerDeps over one shared connection; the real runner path (slots shimmed into workspace files, the real Postgres for the stats row) is the orchestrator's live grading and is not exercised by this check; each .redis file is played on a connection of its own with the engine's own argument splitter, like the terminal"

step "owned files"
echo "git status --short (this task's paths):"
git status --short -- "$CH" scripts/check/C5.sh docs/handoffs/C5.md 2>/dev/null | sed 's/^/  /'
if [ -z "$PROOF_RAN" ]; then echo "NOTE  the local proof did not run in this invocation (see above)"; fi

echo
if [ $FAILS -eq 0 ]; then echo "C5 OK"; exit 0; fi
echo "C5 FAILED ($FAILS)"; exit 1
