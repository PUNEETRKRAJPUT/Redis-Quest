#!/usr/bin/env bash
# C4 acceptance: Chapter 4, "Work in the background" (19 levels: 16 levels and 3 interview rebuilds).
# Static part: the chapter validates with 19 levels, chapter.yaml lists every level in order, every solution and fixture exists and
# parses, every solution module is valid JavaScript with the exports its level needs (bundles named after the slot, default export =
# the first slot checked), the spec's rules hold in each level's verify list, the fiction rules hold (no real cricketer or franchise,
# no bet/stake/payout/cash/IPL, no AI or vector content), and the chapter has no traffic verifier and no scenario.
# Local proof part: starts ONE throwaway container,
#     docker run -d --rm --name quest-c4-redis -p 127.0.0.1:6399:6379 redis:8
# (no compose project, never the default project), stops it on exit, and runs the engine's own behavior, antipattern and redis
# evaluators against every reference and wrong solution of every level (learner dependencies built by the real createLearnerDeps,
# a fake Postgres that knows one users row, calls made in parallel at the level's concurrency), then compares the verdict with the
# declared one. Level 12's key_expired event is emulated by a subscriber with the harness's 3 s wait. Extra proofs repeat the
# concurrency verdicts five times and check the numbers the level texts state (delivery counters, trim lengths, TTL spread ...).
# If Docker is not running the proof is SKIPPED with a loud NOTE and says so in the summary. Quizzes, the `answer` verifier of level 15
# and the key_expired event are the orchestrator's live grading: the proof prints which verdicts rest on them.
# bash 3.2 compatible: no associative arrays, no mapfile.
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
CH="levels/ch4-work-in-the-background"
FAILS=0
TMP=$(mktemp -d "${TMPDIR:-/tmp}/c4.XXXXXX")
CONTAINER="quest-c4-redis"
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

step "build @quest/shared and @quest/engine (the evaluators and the CLI splitter come from the engine)"
pnpm --filter @quest/shared build >/dev/null 2>&1 && pass "shared build" || { fail "shared build"; exit 1; }
pnpm --filter @quest/engine build >/dev/null 2>&1 && pass "engine build" || { fail "engine build"; exit 1; }

step "validate $CH"
OUT=$(pnpm --silent --filter @quest/shared levels:validate "$CH" 2>&1); RC=$?
if [ $RC -eq 0 ]; then pass "$OUT"; else fail "validate (exit $RC)"; echo "$OUT"; fi
case "$OUT" in *"19 level(s)"*) pass "19 levels";; *) fail "expected 19 levels in the chapter";; esac

step "chapter.yaml"
if sed -n 's/^id: *//p' "$CH/chapter.yaml" | head -n 1 | grep -qx 'ch4'; then pass "chapter id ch4"; else fail "chapter id is not ch4"; fi
LISTED=$(grep -E '^  - ch4-' "$CH/chapter.yaml" | wc -l | tr -d ' ')
[ "$LISTED" -eq 19 ] && pass "chapter lists exactly 19 levels" || fail "chapter lists $LISTED levels, want 19"
ORDER=$(grep -E '^  - ch4-' "$CH/chapter.yaml" | sed -E 's/^  - //' | tr '\n' ' ')
WANT="ch4-01-the-ball-log ch4-02-two-workers-every-ball-once ch4-03-a-worker-died ch4-04-the-poison-ball ch4-05-analytics-wants-it-too ch4-06-how-much-history ch4-07-the-job-queue ch4-08-credit-the-wallet-once ch4-09-later-and-more-important ch4-10-last-slot-in-the-contest ch4-11-the-lock-expired-while-you-held-it ch4-12-lobby-expired-tell-everyone ch4-13-forty-thousand-sessions-expired-in-one-second ch4-14-is-this-username-taken ch4-15-find-me-a-contest ch4-16-the-ops-wall ch4-17-interview-streaming ch4-18-interview-job-queue ch4-19-interview-time-series-dashboard "
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
  if grep -qE '^[[:space:]]+scenario: ' "$f" || grep -qE 'type: traffic' "$f"; then fail "  scenario or traffic verifier in $id (this chapter has none)"; fi
  if grep -qiE '\b(bet|stake|payout|cash|ipl)\b' "$f"; then fail "  forbidden fiction word (bet, stake, payout, cash, IPL) in $id"; fi
done
[ "$COUNT" -eq 19 ] && pass "19 level files" || fail "found $COUNT level files, want 19"
for p in "$CH"/fixtures/*.yaml; do
  base=$(basename "$p")
  grep -rq "fixtures/$base" "$CH"/[0-9][0-9]-*.yaml && pass "fixtures/$base is used by a level" || fail "fixtures/$base is not used by any level"
done
for p in "$CH"/solutions/*; do
  base=$(basename "$p")
  grep -q "solutions/$base" "$CH"/[0-9][0-9]-*.yaml && pass "solutions/$base is declared by a level" || fail "solutions/$base is not declared by any level"
done

step "spec rules and solution modules (one node pass over the real parsed levels)"
cat > "$TMP/static.mjs" <<'EOF'
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
const root = process.env.QUEST_ROOT;
const shared = await import(pathToFileURL(join(root, 'packages/shared/dist/index.js')).href);
const { chapters } = await shared.loadAllLevels(join(root, 'levels'));
const ch4 = chapters.find((c) => c.id === 'ch4');
const DIR = 'levels/ch4-work-in-the-background';
const lv = (n) => ch4.levels.find((l) => l.level.id.startsWith(`ch4-${n}-`)).level;
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const vs = (l, type) => l.verify.filter((v) => v.type === type);
const sideEffects = (v) => (v.assertions ?? []).flatMap((a) => a.sideEffect ?? []);
const wrongs = (l) => l.solutions.wrong.map((w) => `${w.path.replace('solutions/', '')}:${w.expect}`).join();
const types = (l) => l.verify.map((v) => v.type).join();
const slotsOf = (l) => [...new Set(l.verify.filter((v) => v.slot).map((v) => v.slot))].join();
const cmdText = (c) => c.cmd.join(' ');
const read = (rel) => readFileSync(join(root, DIR, rel), 'utf8');
const count = (s, re) => (s.match(re) ?? []).length;

// ---- chapter
{
  const raw = read('chapter.yaml');
  const times = [...raw.matchAll(/time: "(\d\d:\d\d)"/g)].map((m) => m[1]);
  ok(times.length >= 6 && times.length <= 8, `incident thread has ${times.length} lines (six to eight)`);
  ok(times[0] >= '22:30' && times[times.length - 1] <= '22:45', `incident runs ${times[0]} to ${times[times.length - 1]}`);
  ok(ch4.chapter.title === 'Work in the background', 'chapter title is "Work in the background"');
  const slugs = new Set([...raw.matchAll(/from: ([a-z-]+)/g)].map((m) => m[1]));
  const cast = JSON.parse(readFileSync(join(root, 'fiction/cast.json'), 'utf8')).cast.map((c) => c.slug);
  ok([...slugs].every((s) => s === 'you' || cast.includes(s)), `incident speakers are cast slugs or "you" (${[...slugs].join(', ')})`);
}
// ---- the whole chapter: no traffic, no scenarios, fiction rules, denylist
{
  ok(ch4.levels.every((e) => !e.level.verify.some((v) => v.type === 'traffic') && !e.level.scenario), 'no level has a traffic verifier or a scenario (every lesson here is correctness and recovery, which the runner proves)');
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
}
// ---- 01
{
  const l = lv('01');
  ok(l.mode === 'cli' && l.setup.length === 1 && l.setup[0].cmd.join(' ') === 'DEL match:m-041:balls', '01 cli, setup deletes match:m-041:balls');
  const r = vs(l, 'redis')[0];
  ok(r.checks.some((c) => cmdText(c) === 'TYPE match:m-041:balls' && c.equals === 'stream') && r.checks.some((c) => cmdText(c) === 'XLEN match:m-041:balls' && c.equals === 6) && r.checks.some((c) => cmdText(c) === 'XINFO STREAM match:m-041:balls' && c.contains === 'length'), '01 redis: TYPE stream, XLEN 6, XINFO STREAM contains length');
  ok(vs(l, 'quiz').length === 2 && /MAXLEN ~ 1000/.test(l.task) && /XRANGE match:m-041:balls \(/.test(l.task), '01 two quizzes; task has MAXLEN ~ 1000 and the XRANGE page');
  ok(l.show_me.component === 'stream_log' && l.show_me.keys[0] === 'match:m-041:balls', '01 show_me stream_log');
  ok(wrongs(l) === '01-wrong-list.redis:wrong', '01 solutions: reference + wrong list');
}
// ---- 02
{
  const l = lv('02');
  const b = vs(l, 'behavior')[0];
  ok(b.slot === 'points.consume' && b.assertions.length === 3 && JSON.stringify(b.assertions[0].call.args) === '["m-041","w1",3]' && JSON.stringify(b.assertions[1].call.args) === '["m-041","w2",3]', '02 behavior: w1 x3, w2 x3, then w1 again, in one verifier');
  ok(JSON.stringify(b.assertions[0].expect.processed) === '["1700000000001-0","1700000000002-0","1700000000003-0"]' && JSON.stringify(b.assertions[1].expect.processed) === '["1700000000004-0","1700000000005-0","1700000000006-0"]', '02 behavior names the explicit ids');
  ok(sideEffects(b).some((c) => cmdText(c) === 'ZSCORE lb:match:m-041 p-028' && c.equals === 11) && sideEffects(b).some((c) => cmdText(c) === 'ZSCORE lb:match:m-041 p-034' && c.equals === 8), '02 behavior: ZSCORE p-028 11 and p-034 8 at the end');
  ok(sideEffects(b).every((c) => c.cmd[0] === 'ZSCORE'), '02 behavior has no XPENDING check (the antipattern owns it, 2.2 rule)');
  const a = vs(l, 'antipattern')[0];
  ok(a.checks && a.checks[0].cmd[0] === 'EVAL_RO' && /XPENDING/.test(a.checks[0].cmd[1]) && a.checks[0].equals === 0, '02 antipattern: pending count equals 0');
  ok(vs(l, 'quiz').length === 2 && l.show_me.component === 'stream_groups', '02 two quizzes, stream_groups (F-13)');
  ok(wrongs(l) === '02-wrong-xread.js:wrong,02-works-but-wrong-no-ack.js:works_but_wrong', '02 solutions as bound');
  ok(count(read('fixtures/02-six-balls.yaml'), /\[XADD,/g) === 6, '02 fixture: six XADD with explicit ids');
}
// ---- 03
{
  const l = lv('03');
  ok(slotsOf(l) === 'points.consume,points.sweep', '03 verifies both slots, so it is a bundle (consume, sweep)');
  const sw = vs(l, 'behavior')[1];
  ok(sw.assertions[0].call.args.join() === 'm-041,w1,0,5' && sw.assertions[0].expect.deadLettered.length === 0 && sw.assertions[0].expect.reclaimed.length === 3, '03 behavior: sweep("m-041","w1",0,5) -> three reclaimed, none dead-lettered');
  ok(sideEffects(sw).some((c) => c.cmd[0] === 'EVAL_RO' && c.equals === 0) && sideEffects(sw).some((c) => cmdText(c) === 'ZSCORE lb:match:m-041 p-028' && c.equals === 5), '03 sweep: pending 0 and ZSCORE p-028 5');
  ok(vs(l, 'quiz').length === 1 && /XAUTOCLAIM/.test(l.teach) && /XPENDING/.test(l.teach), '03 quiz; teach names XPENDING and XAUTOCLAIM');
  ok(wrongs(l) === '03-wrong-consume-only.js:wrong,03-wrong-xclaim-no-ack.js:wrong', '03 solutions as bound');
  const fx = read('fixtures/03-w2-died.yaml');
  ok(/XREADGROUP, GROUP, points, w2, COUNT, 3/.test(fx), '03 fixture: w2 read three and died');
}
// ---- 04
{
  const l = lv('04');
  const b = vs(l, 'behavior')[0];
  ok(b.slot === 'points.sweep' && JSON.stringify(b.assertions[0].expect.deadLettered) === '["1700000000004-0"]' && b.assertions[0].expect.reclaimed.length === 5, '04 behavior: poison 1700000000004-0 dead-lettered, five reclaimed');
  ok(sideEffects(b).some((c) => cmdText(c) === 'XLEN match:m-041:balls:dead' && c.equals === 1) && sideEffects(b).some((c) => c.cmd[0] === 'EVAL_RO' && c.equals === 0), '04 side effects: XLEN dead 1, pending 0');
  ok(count(read('fixtures/04-poison.yaml'), /\[XCLAIM,/g) === 4 && /runs, x\]/.test(read('fixtures/04-poison.yaml')), '04 fixture: four XCLAIM and a runs "x" ball');
  ok(wrongs(l) === '04-wrong-retry-for-ever.js:wrong' && vs(l, 'quiz').length === 1, '04 solutions and quiz');
}
// ---- 05
{
  const l = lv('05');
  ok(l.mode === 'cli' && l.setup.length === 10 && vs(l, 'redis')[0].checks.length === 5 && vs(l, 'quiz').length === 2, '05 cli: ten setup steps, five checks, two quizzes');
  const r = vs(l, 'redis')[0].checks;
  ok(r.some((c) => c.equals === 8 && c.cmd[0] === 'XLEN') && r.some((c) => c.cmd[0] === 'EVAL_RO' && c.cmd.includes('analytics') && c.equals === 2), '05 checks: XLEN 8 and analytics pending 2');
  ok(wrongs(l) === '05-wrong-group-at-zero.redis:wrong', '05 solutions as bound');
}
// ---- 06
{
  const l = lv('06');
  ok(l.mode === 'cli' && l.setup.length === 3 && /for i = 0, 199/.test(l.setup[1].cmd[1]), '06 cli: setup writes 200 balls with one EVAL and creates the group');
  const r = vs(l, 'redis')[0].checks;
  ok(r.some((c) => c.cmd[0] === 'XLEN' && c.lte === 100) && r.some((c) => c.cmd[0] === 'XLEN' && c.gte === 87) && r.some((c) => c.cmd[0] === 'EXISTS' && c.equals === 1), '06 checks: XLEN between 87 and 100, EXISTS 1');
  ok(/1700112600000-0/.test(l.task) && vs(l, 'quiz').length === 2, '06 task names the MINID, two quizzes');
  ok(wrongs(l) === '06-wrong-del.redis:wrong', '06 solutions as bound');
}
// ---- 07
{
  const l = lv('07');
  ok(slotsOf(l) === 'jobs.enqueue,jobs.claim,jobs.reclaim,jobs.complete,jobs.fail', '07 verifies all five slots (a bundle)');
  ok(vs(l, 'behavior').length === 6 && vs(l, 'antipattern').length === 1 && vs(l, 'quiz').length === 3, '07 six behavior verifiers, one antipattern, three quizzes');
  const a = vs(l, 'antipattern')[0];
  ok(a.slot === 'jobs.claim' && sideEffects(a)[0].cmd.join(' ') === 'HGET queue:jobs:job:fixture-1 claim_token' && sideEffects(a)[0].lengthGte === 8, '07 antipattern: claim leaves a claim_token of 8+ characters');
  ok(vs(l, 'behavior').every((b) => sideEffects(b).every((c) => !(c.cmd[0] === 'HGET' && c.cmd[2] === 'claim_token' && c.lengthGte))), '07 no behavior pins the stored token length (the antipattern owns it)');
  const complete = vs(l, 'behavior').find((b) => b.slot === 'jobs.complete');
  ok(complete.assertions[0].expect === false && complete.assertions[1].expect === true && complete.assertions[2].expect === false, '07 complete: wrong token false, right token true, replay false');
  ok(vs(l, 'behavior').filter((b) => b.slot === 'jobs.fail').map((b) => b.assertions.map((a) => JSON.stringify(a.expect)).join('|')).join(' ; ') === 'false|"failed" ; "retry"', '07 fail: false then "failed" at maxAttempts 1, and "retry" at 3');
  ok(/duplicate\(\)/.test(l.teach) && /BLMOVE/.test(l.teach) && /at-least-once/.test(l.teach), '07 teach: duplicate(), BLMOVE, at-least-once');
  ok(wrongs(l) === '07-wrong-rpop.js:wrong,07-wrong-no-token-check.js:wrong,07-works-but-wrong-no-token-stored.js:works_but_wrong', '07 solutions as bound (the no-token-check file is named wrong, not works-but-wrong: it is declared wrong)');
}
// ---- 08
{
  const l = lv('08');
  const b = vs(l, 'behavior');
  ok(b[0].assertions[0].expect.balance === 150 && b[0].assertions[1].expect.credited === false, '08 behavior: credit 50 twice -> 150 then credited false');
  ok(b[1].concurrency === 20 && b[1].assertions[0].repeat === 20 && b[1].assertions[0].expectCount.equals === 1 && b[1].assertions[0].expectCount.value.balance === 150, '08 behavior: 20 at once, exactly one { credited: true, balance: 150 }');
  const a = vs(l, 'antipattern')[0];
  ok(a.checks[0].cmd.join(' ') === 'TTL idem:award-m-041-u-000011' && a.checks[0].between.join() === '1,86400', '08 antipattern: TTL of the idem key between [1, 86400]');
  ok(sideEffects(b[0]).every((c) => c.between === undefined) && vs(l, 'quiz').length === 2, '08 behaviors have no TTL bound (2.2 rule); two quizzes');
  ok(wrongs(l) === '08-wrong-no-idempotency.js:wrong,08-works-but-wrong-no-ttl-on-key.js:works_but_wrong', '08 solutions as bound');
}
// ---- 09
{
  const l = lv('09');
  ok(slotsOf(l) === 'jobs.schedule,jobs.promoteDue', '09 verifies both slots (a bundle)');
  const p = vs(l, 'behavior')[1];
  ok(p.assertions[0].call.args[0] === 1000 && p.assertions[0].expect === 1 && sideEffects(p).some((c) => c.cmd.join(' ') === 'ZCARD queue:jobs:delayed' && c.equals === 1) && sideEffects(p).some((c) => c.cmd.join(' ') === 'LLEN queue:jobs:pending' && c.equals === 1), '09 behavior: promoteDue(1000) -> 1, ZCARD delayed 1, LLEN pending 1');
  const a = vs(l, 'antipattern')[0];
  ok(a.slot === 'jobs.promoteDue' && a.concurrency === 10 && a.assertions[0].repeat === 10 && sideEffects(a)[0].equals === 50, '09 antipattern: ten promoters over fifty due jobs, LLEN pending equals 50');
  ok(/Lua/.test(l.teach) && vs(l, 'quiz').length === 2, '09 teach names Lua; two quizzes');
  ok(wrongs(l) === '09-wrong-promote-all.js:wrong,09-works-but-wrong-js-two-step.js:works_but_wrong', '09 solutions as bound');
}
// ---- 10
{
  const l = lv('10');
  const b = vs(l, 'behavior')[0];
  ok(b.concurrency === 200 && b.assertions[0].repeat === 200 && b.assertions[0].expectCount.value === true && b.assertions[0].expectCount.equals === 1, '10 behavior: 200 at once, exactly one true');
  ok(sideEffects(b).some((c) => cmdText(c) === 'GET contest:9001:slots' && c.equals === 0) && sideEffects(b).some((c) => cmdText(c) === 'EXISTS lock:contest:9001' && c.equals === 0) && b.assertions[1].expect === false, '10 behavior: slots 0, lock released, then a sequential call false');
  ok(/DELEX/.test(l.teach) && /8\.4/.test(l.teach) && /NX PX/.test(l.teach), '10 teach: DELEX since 8.4 and the NX PX recipe');
  ok(wrongs(l) === '10-wrong-no-lock.js:wrong', '10 solutions: reference + no-lock (the spec drops the plain-DEL one)');
}
// ---- 11
{
  const l = lv('11');
  ok(l.mode === 'decision' && vs(l, 'quiz').length === 4 && l.show_me === undefined, '11 decision level, four quizzes, no show_me');
  const correct = vs(l, 'quiz').flatMap((q) => q.correct).sort().join();
  ok(correct === [...l.solutions.reference].sort().join(), '11 reference lists exactly the correct ids');
  ok(l.solutions.wrong.length === 4 && /fencing/.test(l.teach) && /Redlock/.test(l.teach) && /Kleppmann/.test(l.teach), '11 one wrong entry per quiz; teach names fencing, Redlock, Kleppmann');
}
// ---- 12
{
  const l = lv('12');
  const e = vs(l, 'event')[0];
  ok(l.mode === 'cli' && e.kind === 'key_expired' && e.match.key === 'lobby:m-043' && e.timeoutMs === 60000, '12 event key_expired on lobby:m-043, timeoutMs 60000');
  ok(vs(l, 'redis')[0].checks[0].cmd.join(' ') === 'CONFIG GET notify-keyspace-events' && vs(l, 'redis')[0].checks[0].oneOf.length >= 2, '12 redis: CONFIG GET notify-keyspace-events, oneOf the accepted values');
  ok(/EX 10/.test(l.task) && /Ex/.test(l.task), '12 task: EX 10 and CONFIG SET ... Ex');
  ok(/EX 2/.test(read('solutions/12-reference.redis')), '12 reference file uses EX 2 (the harness event wait is 3 s; see the handoff)');
  ok(l.show_me.component === 'ttl_timer' && wrongs(l) === '12-wrong-no-config.redis:wrong' && vs(l, 'quiz').length === 2, '12 show_me ttl_timer, one wrong, two quizzes');
}
// ---- 13
{
  const l = lv('13');
  const b = vs(l, 'behavior')[0];
  const args = b.assertions[0].call.args;
  ok(args[0].length === 50 && args[0][0] === 'storm:1' && args[0][49] === 'storm:50' && args[1] === 600 && args[2] === 120 && b.assertions[0].expect === 50, '13 behavior: 50 keys storm:1..storm:50, base 600, jitter 120 -> 50');
  const se = sideEffects(b);
  ok(se.length === 3 && se[0].gte === 599 && se[1].lte === 720 && se[2].gte === 40, '13 side effects: min TTL >= 599, max <= 720, spread >= 40');
  ok(l.show_me.component === 'ttl_timer' && wrongs(l) === '13-wrong-same-ttl.js:wrong' && vs(l, 'quiz').length === 2, '13 show_me, one wrong, two quizzes');
}
// ---- 14
{
  const l = lv('14');
  const b = vs(l, 'behavior')[0];
  ok(JSON.stringify(b.assertions.map((a) => [a.call.args[0], a.expect.taken, a.expect.checkedDb])) === '[["tariq.bhat75",true,true],["quest.ghost99",false,true],["nobody.has.this.name",false,false]]', '14 behavior: real handle, filter false positive, unknown name');
  ok(/tariq\.bhat75/.test(read('fixtures/14-filter.yaml')) && /BF\.RESERVE/.test(read('fixtures/14-filter.yaml')), '14 fixture: BF.RESERVE and the seed handle');
  ok(wrongs(l) === '14-wrong-postgres-always.js:wrong,14-wrong-trust-the-filter.js:wrong' && /14\.378/.test(l.teach) && vs(l, 'quiz').length === 2, '14 solutions, teach quotes 14.378 bits, two quizzes');
  ok(l.show_me.component === 'bf_card' && l.show_me.keys[0] === 'bf:usernames', '14 show_me bf_card on bf:usernames (F-13)');
}
// ---- 15
{
  const l = lv('15');
  const r = vs(l, 'redis')[0].checks;
  ok(l.mode === 'cli' && l.setup.length === 9 && /FT\.DROPINDEX/.test(l.setup[0].cmd[1]) && /pcall/.test(l.setup[0].cmd[1]) && l.setup.slice(1).every((s) => s.cmd[0] === 'JSON.SET'), '15 cli: setup drops the index (guarded with pcall) and writes eight JSON contests');
  ok(JSON.stringify(r.map((c) => c.equals)) === '[[8],[3],[4]]', '15 redis: FT.SEARCH counts [8], [3], [4]');
  ok(vs(l, 'answer').length === 1 && vs(l, 'quiz').length === 2 && l.show_me.component === 'ft_card', '15 answer verifier (avg entry), two quizzes, ft_card (F-13)');
  ok(wrongs(l) === '15-wrong-hostel-as-text.redis:wrong' && /\$\.tags\[\*\]/.test(l.teach), '15 solutions as bound (the spec\'s tags-without-star wrong does not fail on this Redis: see the handoff)');
}
// ---- 16
{
  const l = lv('16');
  ok(slotsOf(l) === 'ops.record,ops.range', '16 verifies both slots (a bundle)');
  const rec = vs(l, 'behavior')[0];
  ok(rec.assertions.length === 5 && rec.assertions.map((a) => a.call.args[0].at).join() === '1700000040000,1700000050000,1700000059000,1700000100000,1700000130000', '16 record: five samples at the fixed times');
  const last = sideEffects(rec);
  ok(last.some((c) => c.cmd[0] === 'TS.RANGE' && JSON.stringify(c.equals) === '[[1700000040000,3],[1700000100000,2]]') && last.some((c) => c.cmd[0] === 'TS.INFO' && c.contains === 'retentionTime') && last.some((c) => c.cmd[0] === 'EVAL_RO' && /TDIGEST\.QUANTILE/.test(c.cmd[1]) && c.between.join() === '200,300'), '16 record: TS.RANGE sums [3, 2], TS.INFO contains retentionTime, p99 between 200 and 300');
  ok(vs(l, 'antipattern')[0].checks[0].contains === 86400000, '16 antipattern: TS.INFO contains 86400000');
  ok(l.verify.map((v) => v.type).join() === 'behavior,antipattern,behavior,quiz,quiz', '16 order: record behavior, retention antipattern, range behavior (its own seeded fixture), quizzes');
  const rng = vs(l, 'behavior')[1];
  ok(JSON.stringify(rng.assertions[0].expect.buckets) === JSON.stringify([{ at: 1700000040000, requests: 3, errors: 1, avgMs: 120 }, { at: 1700000100000, requests: 2, errors: 1, avgMs: 80 }]), '16 range: two buckets {3, 1, 120} and {2, 1, 80}');
  ok(/TS\.CREATERULE/.test(l.teach) && /TOPK/.test(l.teach) && wrongs(l) === '16-wrong-zset-per-minute.js:wrong,16-works-but-wrong-no-retention.js:works_but_wrong', '16 teach names TS.CREATERULE and TOPK; solutions as bound');
}
// ---- 17, 18, 19
for (const [n, rebuild, minutes] of [['17', 'ch4-03-a-worker-died', 25], ['18', 'ch4-07-the-job-queue', 30], ['19', 'ch4-16-the-ops-wall', 20]]) {
  const l = lv(n);
  ok(l.interview && l.interview.rebuild_of === rebuild && l.interview.minutes === minutes && l.interview.hint_xp_cost === 10, `${n} interview: ${minutes} min, rebuild_of ${rebuild}, hint cost 10`);
  ok(l.teach === undefined && l.reward.xp === 90, `${n} has no teach and rewards 90 XP`);
  const rebuilt = ch4.levels.find((x) => x.level.id === rebuild).level;
  ok(types(l) === types(rebuilt), `${n} has the same verifier list as ${rebuild} (${types(l)})`);
  ok(slotsOf(l) === slotsOf(rebuilt), `${n} verifies the same slots as ${rebuild} (${slotsOf(l)})`);
  ok(JSON.stringify(l.solutions) === JSON.stringify(rebuilt.solutions), `${n} uses ${rebuild}'s solutions by path`);
  const ownFixtures = new Set(l.verify.filter((v) => v.fixtures).map((v) => v.fixtures));
  ok([...ownFixtures].every((f) => f.startsWith(`fixtures/${n}-`)), `${n} uses its own fixture files`);
}
// ---- solution modules: parse as modules and export what their level needs
const bundles = { '03': ['consume', 'sweep', 'consume'], '04': ['consume', 'sweep', 'sweep'], '07': ['enqueue', 'claim', 'complete', 'fail', 'reclaim', 'enqueue'], '09': ['schedule', 'promoteDue', 'schedule'], '16': ['record', 'range', 'record'] };
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
QUEST_ROOT="$ROOT" node "$TMP/static.mjs" > "$TMP/static.out" 2>&1; RC=$?
cat "$TMP/static.out"
[ $RC -eq 0 ] && pass "static node checks" || fail "static node checks (exit $RC)"

step "the seed handle the Bloom level quotes (level 14)"
SEED_HANDLE_U10=$(gzip -dc postgres/init/002-seed.sql.gz 2>/dev/null | awk -F'\t' '/^COPY users /{f=1;next} f&&/^\\\.$/{f=0} f&&$1=="u-000010"{print $2; exit}')
echo "handle of u-000010 in postgres/init/002-seed.sql.gz: ${SEED_HANDLE_U10:-<not found>}"
export SEED_HANDLE_U10

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
      MODS=$(docker exec "$CONTAINER" redis-cli MODULE LIST | grep -v '^$' | paste -sd' ' - )
      for m in search ReJSON timeseries bf; do
        case "$MODS" in *"$m"*) pass "module $m is loaded";; *) fail "module $m is not loaded in redis:8";; esac
      done
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
const { splitArgs } = await imp('engine/dist/cli.js');
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

// A fake Postgres: the users table holds one handle the levels know about (seed user u-000010, read from 002-seed.sql.gz).
const SEED_HANDLE = 'tariq.bhat75';
const fakePool = {
  query: async (text, params) => {
    if (/FROM users WHERE handle = \$1/i.test(text)) return { rows: params[0] === SEED_HANDLE ? [{ '?column?': 1 }] : [] };
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
  await send(['FLUSHALL']);
  await send(['SCRIPT', 'FLUSH']);
};

let bad = 0;
const row = (okv, text) => { console.log(`${okv ? 'PASS' : 'FAIL'}  ${text}`); if (!okv) bad++; };
const { chapters } = await shared.loadAllLevels(join(root, 'levels'));
const ch4 = chapters.find((c) => c.id === 'ch4');
const liveByLevel = [];

for (const entry of ch4.levels) {
  const L = entry.level;
  if (only && !only.some((n) => L.id.startsWith(`ch4-${n}-`))) continue;
  const dir = dirname(entry.file);
  const nSlots = slotsOfLevel(L).length;
  const liveKinds = new Set();
  for (const v of L.verify) {
    if (v.type === 'traffic') liveKinds.add(`traffic ${v.scenario}`);
    if (v.type === 'quiz') liveKinds.add('quiz');
    if (v.type === 'event') liveKinds.add(`event ${v.kind}${v.match?.name ? ` ${v.match.name}` : ''} (emulated here)`);
  }
  if (liveKinds.size) liveByLevel.push(`${L.id}: ${[...liveKinds].join('; ')}`);
  if (L.mode === 'decision') { console.log(`-- ${L.id}: decision level, checked statically (reference = the correct ids)`); continue; }

  const solutions = [{ path: L.solutions.reference, expect: 'right' }, ...L.solutions.wrong.map((w) => ({ path: w.path, expect: w.expect }))];
  for (const s of solutions) {
    await reset();
    const file = join(dir, s.path);
    let failed = false;
    let hit = false;
    const notes = [];
    const keyEvent = L.verify.find((v) => v.type === 'event' && v.kind === 'key_expired');
    const expired = [];
    let sub = null;
    if (keyEvent) {
      sub = redis.duplicate();
      sub.on('error', () => {});
      await sub.connect();
      await sub.pSubscribe('__keyevent@*__:expired', (k) => expired.push(k));
    }
    const judgeChecks = async (v) => {
      const items = await runChecks(send, v.checks);
      const badItems = items.filter((i) => !i.ok);
      if (badItems.length) { if (v.type === 'redis') failed = true; else hit = true; notes.push(`${v.type}: ${badItems.map((b) => b.feedback).join(' | ').slice(0, 220)}`); }
    };
    const judgeEvent = async (v) => {
      // key_expired: the check waits for the event, up to the harness cap of 3 s (VERIFY_MAX_EVENT_WAIT_MS).
      const t0 = Date.now();
      while (Date.now() - t0 < 3000 && !expired.includes(v.match.key)) await sleep(50);
      if (!expired.includes(v.match.key)) { failed = true; notes.push(`event key_expired: no expiry of ${v.match.key} seen within 3 s`); }
    };
    try {
      if (L.mode === 'code') {
        const mod = await import(`${pathToFileURL(file).href}?${Math.random()}`);
        const run = makeRun(mod, nSlots);
        for (const v of L.verify.filter((x) => x.type !== 'traffic')) {
          if (v.type === 'behavior' || (v.type === 'antipattern' && v.slot)) {
            const err = await runFixtureSteps(fixtureSteps(dir, v.fixtures), send);
            if (err) { notes.push(err); failed = true; continue; }
            const r = await runAssertions({ slot: v.slot, module: v.slot, concurrency: v.concurrency, assertions: v.assertions }, { run, send });
            if (!r.ok) { if (v.type === 'behavior') failed = true; else hit = true; notes.push(`${v.type} ${v.slot}: ${r.message.split('\n').join(' | ').slice(0, 220)}`); }
          } else if (v.type === 'redis' || (v.type === 'antipattern' && v.checks)) {
            await judgeChecks(v);
          } else if (v.type === 'event' && v.kind === 'key_expired') {
            await judgeEvent(v);
          }
        }
      } else if (L.mode === 'cli') {
        for (const st of L.setup ?? []) if (st.cmd) await send(st.cmd);
        for (const line of readFileSync(file, 'utf8').split('\n')) {
          const t = line.trim();
          if (!t || t.startsWith('#')) continue;
          const argv = splitArgs(t);
          if (!argv) throw new Error(`cannot split: ${t}`);
          try { await send(argv); } catch (e) { notes.push(`solution line ${argv[0]} failed: ${e.message}`); }
        }
        await sleep(300); // a learner takes longer than this; Search indexes existing documents in the background
        for (const v of L.verify) {
          if (v.type === 'redis' || (v.type === 'antipattern' && v.checks)) await judgeChecks(v);
          else if (v.type === 'event' && v.kind === 'key_expired') await judgeEvent(v);
        }
      }
    } finally {
      if (sub) await sub.quit().catch(() => {});
    }
    const verdict = failed ? 'wrong' : hit ? 'works_but_wrong' : 'right';
    row(verdict === s.expect, `${L.id} ${s.path}: declared ${s.expect}, evaluators say ${verdict}`);
    if (verdict !== s.expect || process.env.VERBOSE) for (const x of notes) console.log(`        ${x}`);
    if (verdict === s.expect && s.expect !== 'right') for (const x of notes.slice(0, 2)) console.log(`        how: ${x}`);
  }
}

console.log('\n-- extra proofs');
const LV = join(root, 'levels/ch4-work-in-the-background');
const fx = async (rel) => { const err = await runFixtureSteps(fixtureSteps(LV, rel), send); if (err) throw new Error(err); };
const modOf = async (file) => import(`${pathToFileURL(join(LV, 'solutions', file)).href}?${Math.random()}`);
const llen = async (key) => Number(await send(['LLEN', key]));
if (!only) {
  // A. the concurrency verdicts are not luck: five runs each, the reference exact every time, the wrong ones wrong every time
  {
    const wrongCounts = [];
    const refCounts = [];
    for (let k = 0; k < 5; k++) {
      for (const [file, bag] of [['09-works-but-wrong-js-two-step.js', wrongCounts], ['09-reference.js', refCounts]]) {
        await reset();
        await fx('fixtures/09-fifty-due.yaml');
        const run = makeRun(await modOf(file), 2);
        await run({ module: 'jobs.promoteDue', concurrency: 10, calls: Array.from({ length: 10 }, () => ({ args: [1000] })) });
        bag.push(await llen('queue:jobs:pending'));
      }
    }
    row(wrongCounts.every((c) => c > 50) && refCounts.every((c) => c === 50), `09 ten promoters over fifty due jobs, LLEN pending in five runs: js two-step ${wrongCounts.join(', ')} (all above 50), Lua reference ${refCounts.join(', ')} (all exactly 50)`);
  }
  {
    const wrongTrue = [];
    const refTrue = [];
    for (let k = 0; k < 5; k++) {
      for (const [file, bag] of [['10-wrong-no-lock.js', wrongTrue], ['10-reference.js', refTrue]]) {
        await reset();
        await fx('fixtures/10-one-slot.yaml');
        const run = makeRun(await modOf(file), 1);
        const res = await run({ module: 'contest.claimLastSlot', concurrency: 200, calls: Array.from({ length: 200 }, () => ({ args: [9001, 'u-000010'] })) });
        bag.push(res.results.filter((r) => r.ok && r.value === true).length);
      }
    }
    row(wrongTrue.every((c) => c > 1) && refTrue.every((c) => c === 1), `10 200 callers for one slot, true answers in five runs: no lock ${wrongTrue.join(', ')} (all above 1), lock reference ${refTrue.join(', ')} (all exactly 1)`);
  }
  {
    const refCredits = [];
    for (let k = 0; k < 5; k++) {
      await reset();
      await fx('fixtures/08-wallet-fresh.yaml');
      const run = makeRun(await modOf('08-reference.js'), 1);
      const res = await run({ module: 'wallet.credit', concurrency: 20, calls: Array.from({ length: 20 }, () => ({ args: ['u-000011', 50, 'award-m-041-u-000011'] })) });
      refCredits.push(res.results.filter((r) => r.ok && r.value.credited === true).length);
    }
    row(refCredits.every((c) => c === 1), `08 twenty callers with one idempotency key, credited in five runs: ${refCredits.join(', ')} (all exactly 1)`);
  }
  // B. delivery counters (levels 3 and 4 state them)
  {
    await reset();
    await fx('fixtures/04-poison.yaml');
    const key = 'match:m-041:balls';
    const before = await send(['XPENDING', key, 'points', '-', '+', '10']);
    const countOf = (rows, id) => Number(rows.find((r) => r[0] === id)[3]);
    const poison = countOf(before, '1700000000004-0');
    const good = countOf(before, '1700000000001-0');
    await send(['XAUTOCLAIM', key, 'points', 'w1', '0', '0-0', 'COUNT', '100']);
    const after = await send(['XPENDING', key, 'points', '-', '+', '10']);
    row(poison === 5 && good === 1 && countOf(after, '1700000000004-0') === 6 && countOf(after, '1700000000001-0') === 2, `04 delivery counters: poison ${poison} and others ${good} after the fixture, ${countOf(after, '1700000000004-0')} and ${countOf(after, '1700000000001-0')} after one XAUTOCLAIM (a claim adds one; the extended XPENDING row is [id, consumer, idle ms, count])`);
  }
  // C. 06: the numbers the text states (exact trim leaves 87, the approximate one keeps more: 100 here)
  {
    await reset();
    const lv6 = ch4.levels.find((e) => e.level.id === 'ch4-06-how-much-history').level;
    for (const st of lv6.setup) await send(st.cmd);
    await send(['XTRIM', 'match:m-041:balls', 'MINID', '~', '1700112600000-0']);
    const approx = Number(await send(['XLEN', 'match:m-041:balls']));
    await reset();
    for (const st of lv6.setup) await send(st.cmd);
    await send(['XTRIM', 'match:m-041:balls', 'MINID', '1700112600000-0']);
    const exact = Number(await send(['XLEN', 'match:m-041:balls']));
    const newest = (await send(['XREVRANGE', 'match:m-041:balls', '+', '-', 'COUNT', '1']))[0][0];
    row(exact === 87 && approx >= 87 && approx <= 100 && newest === '1700199000000-0', `06 trimming to MINID 1700112600000-0: exact leaves ${exact} (the text says 87), approximate leaves ${approx} (the text says 100 on this stack); newest id ${newest}`);
  }
  // D. 15: the teach says $.tags alone also indexed the arrays on this server
  {
    await reset();
    const lv15 = ch4.levels.find((e) => e.level.id === 'ch4-15-find-me-a-contest').level;
    for (const st of lv15.setup) await send(st.cmd);
    await send(['FT.CREATE', 'idx:contest', 'ON', 'JSON', 'PREFIX', '1', 'contest:', 'SCHEMA', '$.tags', 'AS', 'tags', 'TAG']);
    await sleep(500);
    const n = (await send(['FT.SEARCH', 'idx:contest', '@tags:{night}', 'LIMIT', '0', '0']))[0];
    const star = await (async () => { await send(['FT.DROPINDEX', 'idx:contest']); await send(['FT.CREATE', 'idx:contest', 'ON', 'JSON', 'PREFIX', '1', 'contest:', 'SCHEMA', '$.tags[*]', 'AS', 'tags', 'TAG']); await sleep(500); return (await send(['FT.SEARCH', 'idx:contest', '@tags:{night}', 'LIMIT', '0', '0']))[0]; })();
    let syntaxErr = '';
    try { await send(['FT.SEARCH', 'idx:contest', '@hostel:{h-c-02-2}', 'LIMIT', '0', '0']); } catch (e) { syntaxErr = String(e.message).slice(0, 40); }
    row(Number(n) === 4 && Number(star) === 4, `15 night contests with $.tags (no star) = ${n}, with $.tags[*] = ${star} (the text says both work on this server; the spec's wrong that relied on the star cannot exist)`);
    console.log(`      15 an unescaped hyphen in a TAG query: ${syntaxErr || 'no error (the text says it is a syntax error)'}`);
  }
  // E. 16: duplicate timestamps add up for requests (the text and the task say so), and a missing `at` is accepted
  {
    await reset();
    const mod = await modOf('16-reference.js');
    const ctx = await shared.createLearnerDeps({ redisClient: redis, dbPool: fakePool });
    const R = 'GET /app/players/:id/stats';
    await mod.record(ctx.deps, { route: R, status: 200, ms: 10, at: 1700000040000 });
    await mod.record(ctx.deps, { route: R, status: 200, ms: 30, at: 1700000040000 });
    await mod.record(ctx.deps, { route: 'GET /app/other', status: 200, ms: 5 });
    const got = await mod.range(ctx.deps, R, 1700000040000, 1700000099999, 60000);
    const stamp = (await send(['TS.GET', 'ts:requests:GET_app_other']))[0];
    await ctx.close();
    row(got.route === R && got.buckets.length === 1 && got.buckets[0].requests === 2 && got.buckets[0].avgMs === 30, `16 two samples in the same millisecond: requests ${got.buckets[0]?.requests} (DUPLICATE_POLICY SUM), latency ${got.buckets[0]?.avgMs} (LAST wins: 30); the route key rule maps "${R}" to ${R.replace(/[ /]+/g, '_')}`);
    const keys = await send(['KEYS', 'ts:*']);
    row(keys.includes('ts:requests:GET_app_players_:id_stats') && Math.abs(Number(stamp) - Date.now()) < 5000, '16 a route with spaces and slashes is stored under the route key rule (GET_app_players_:id_stats); a sample with no at is stamped with the current time');
  }
  // F. 10 and 12 facts the text states
  {
    await reset();
    await send(['SET', 'lk', 'tok']);
    const del = await send(['DELEX', 'lk', 'IFEQ', 'tok']);
    row(Number(del) === 1, '10 DELEX key IFEQ value exists on this Redis (8.4 and later; the text says the game runs 8.10)');
    await send(['CONFIG', 'SET', 'notify-keyspace-events', 'Ex']);
    const got = await send(['CONFIG', 'GET', 'notify-keyspace-events']);
    row(got[1] === 'xE', `12 CONFIG SET notify-keyspace-events Ex reads back as ${got[1]} (the text says xE)`);
    await send(['CONFIG', 'SET', 'notify-keyspace-events', '']);
  }
  // G. 13: the spread of the reference
  {
    await reset();
    await fx('fixtures/13-storm.yaml');
    const mod = await modOf('13-reference.js');
    const ctx = await shared.createLearnerDeps({ redisClient: redis, dbPool: fakePool });
    const keys = Array.from({ length: 50 }, (_, i) => `storm:${i + 1}`);
    const n = await mod.default(ctx.deps, keys, 600, 120);
    await ctx.close();
    const ttls = [];
    for (const k of keys) ttls.push(Number(await send(['TTL', k])));
    const min = Math.min(...ttls);
    const max = Math.max(...ttls);
    row(n === 50 && min >= 599 && max <= 720 && max - min >= 40, `13 reference: ${n} keys, TTL min ${min} max ${max} spread ${max - min} (needs min >= 599, max <= 720, spread >= 40)`);
  }
  // H. 14: the handle in the fixture is the seed's handle for u-000010
  {
    const want = process.env.SEED_HANDLE_U10;
    row(want === SEED_HANDLE, `14 the handle of seed user u-000010 in postgres/init/002-seed.sql.gz is ${want}, the one the fixture and the fake pool use`);
  }
}
await sleep(500);
if (strayClosed) console.log(`NOTE  ${strayClosed} ClientClosedError(s) from timers (swallowed)`);
console.log(`LIVE_SUMMARY ${JSON.stringify(liveByLevel)}`);
await send(['CONFIG', 'SET', 'notify-keyspace-events', '']);
await redis.quit();
process.exit(bad ? 1 : 0);
EOF
      QUEST_ROOT="$ROOT" PROOF_PORT="$HOST_PORT" node "$TMP/proof.mjs" > "$TMP/proof.out" 2>&1; RC=$?
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
' "every level with a quiz (01 to 10, 12 to 19 here, 11 is all quizzes): the harness types the right options for right and works_but_wrong solutions and a wrong one for wrong ones; none of the proof above covers a quiz" \
  "ch4-11-the-lock-expired-while-you-held-it: decision level, four quizzes; reference = the four correct ids (checked statically above), one wrong option per quiz" \
  "ch4-12-lobby-expired-tell-everyone: event key_expired (60 s in the game, the harness caps it at 3 s: the reference file uses EX 2). The proof emulates it with a subscriber on __keyevent@*__:expired; live, the engine subscribes only while its check waits" \
  "ch4-15-find-me-a-contest: the answer verifier (average entry fee 37.5, read from the JSON by an EVAL_RO through /api/cli) is typed by the harness; the FT.SEARCH checks are proven above" \
  "no level rests on traffic: this chapter has no scenario" \
  "every behavior and antipattern verdict above is proven here with createLearnerDeps over one shared connection, like the runner child; the real runner path (slots shimmed from the bundle files, the real Postgres for level 14) is the orchestrator's live grading and is not exercised by this check"

step "owned files"
echo "git status --short (this task's paths):"
git status --short -- "$CH" scripts/check/C4.sh docs/handoffs/C4.md 2>/dev/null | sed 's/^/  /'
if [ -z "$PROOF_RAN" ]; then echo "NOTE  the local proof did not run in this invocation (see above)"; fi

echo
if [ $FAILS -eq 0 ]; then echo "C4 OK"; exit 0; fi
echo "C4 FAILED ($FAILS)"; exit 1
