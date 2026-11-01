#!/usr/bin/env bash
# CF acceptance: the Finale "The architect" (7 levels: three drawn mock interviews, the gauntlet, the neighbours, the code review and
# the story).
# No Docker at all. The pool levels (01 to 03) have no verifiers or solutions of their own: the engine draws one of nine earlier levels
# at the first start and grades the learner with THAT level's checks, so there is nothing to run for them here, and their drawn levels are
# proven by the checks of Chapters 2 to 4. What this script proves is the chapter itself:
#   - the whole levels tree validates with 8 chapters and 96 levels (pools reference earlier chapters, so the tree is validated as one),
#     and the finale alone cannot resolve its pools (by design);
#   - chapter.yaml (order, the 09:00 to 09:30 thread, cast speakers);
#   - the pools: all nine use cases, in the same order in the three levels, three follow-up questions each, answers that exist, answer
#     positions that vary, the panel level in Mukul's voice, no teach / verify / solutions / show_me on a pool level;
#   - the decision levels run statically through the engine's own quiz grader (the reference passes, every wrong entry fails, an empty
#     answer fails, ticking everything fails the multi-select quizzes): the gauntlet (15 statements, `not-redis` option in each, four
#     of them the right answer), the neighbours (6, named as reasoning), the code review (3 multi-select quizzes with the planted sets,
#     and the three files in the teach parse as JavaScript);
#   - level 07 (ops): the portfolio_written event, its two quizzes, its solutions exist and parse;
#   - the fiction rules (no real cricketer or franchise, no bet / stake / payout / cash / IPL, no AI or vector content, no build task ids).
# Level 07's solutions are .sh files, which the grading harness never runs without --run-ops (and those commands would `git init` the
# real workspace), so level 07 is graded by hand once per release; the output says so.
# Exit 0 only if everything passed.
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
LEVELS="${CF_LEVELS:-levels}"
CH="$LEVELS/finale"
FAILS=0
TMP=$(mktemp -d "${TMPDIR:-/tmp}/cf.XXXXXX")

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILS=$((FAILS + 1)); }
step() { echo; echo "== $1"; }

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
trap 'exit 130' INT TERM

step "build @quest/shared and @quest/engine (the level loader and the quiz grader come from them)"
pnpm --filter @quest/shared build >/dev/null 2>&1 && pass "shared build" || { fail "shared build"; exit 1; }
pnpm --filter @quest/engine build >/dev/null 2>&1 && pass "engine build" || { fail "engine build"; exit 1; }

step "validate the whole tree (the pools reference Chapters 2 to 4, so the finale is validated together with them)"
OUT=$(pnpm --silent --filter @quest/shared levels:validate "$LEVELS" 2>&1); RC=$?
if [ $RC -eq 0 ]; then pass "$OUT"; else fail "validate (exit $RC)"; echo "$OUT"; fi
case "$OUT" in *"8 chapter(s), 96 level(s)"*) pass "8 chapters and 96 levels";; *) fail "expected 8 chapters and 96 levels";; esac
ALONE=$(pnpm --silent --filter @quest/shared levels:validate "$CH" 2>&1); RC=$?
if [ $RC -ne 0 ]; then pass "the finale alone does not validate, as designed (its pools name levels of earlier chapters)"; else fail "the finale validated alone: its pools should need the earlier chapters ($ALONE)"; fi

step "files and chapter.yaml"
FILES=$(ls "$CH"/[0-9][0-9]-*.yaml 2>/dev/null | wc -l | tr -d ' ')
[ "$FILES" -eq 7 ] && pass "7 level files" || fail "found $FILES level files, want 7"
if sed -n 's/^id: *//p' "$CH/chapter.yaml" | head -n 1 | grep -qx 'finale'; then pass "chapter id finale"; else fail "chapter id is not finale"; fi
LISTED=$(grep -E '^  - finale-' "$CH/chapter.yaml" | wc -l | tr -d ' ')
[ "$LISTED" -eq 7 ] && pass "chapter lists exactly 7 levels" || fail "chapter lists $LISTED levels, want 7"
ORDER=$(grep -E '^  - finale-' "$CH/chapter.yaml" | sed -E 's/^  - //' | tr '\n' ' ')
WANT="finale-01-mock-interview-one finale-02-mock-interview-two finale-03-mock-interview-three finale-04-the-gauntlet finale-05-the-neighbours finale-06-the-code-review finale-07-your-story "
[ "$ORDER" = "$WANT" ] && pass "levels listed in the spec's order" || { fail "chapter.yaml order differs"; echo "  got:  $ORDER"; }
for f in "$CH"/[0-9][0-9]-*.yaml; do
  id=$(sed -n 's/^id: *//p' "$f" | head -n 1)
  grep -qE "^  - $id\$" "$CH/chapter.yaml" && pass "  $id is listed in chapter.yaml" || fail "  $id is not listed in chapter.yaml"
  case "$(basename "$f")" in
    04-*|05-*|06-*)
      if grep -qE '^docs:' "$f" && grep -qE '^  - https://redis\.io/docs/' "$f"; then pass "  $id has a docs link"; else fail "  $id has no docs link"; fi;;
  esac
done
for p in "$CH"/solutions/*; do
  base=$(basename "$p")
  grep -q "solutions/$base" "$CH"/[0-9][0-9]-*.yaml && pass "solutions/$base is declared by a level" || fail "solutions/$base is not declared by any level"
done
for p in $(grep -hE '^[[:space:]]*(reference:|- path:)[[:space:]]+solutions/' "$CH"/[0-9][0-9]-*.yaml | sed -E 's/.*(solutions\/[^[:space:]]+).*/\1/'); do
  if [ -s "$CH/$p" ]; then pass "$p exists, non-empty"; else fail "$p missing or empty"; fi
  case "$p" in *.sh) bash -n "$CH/$p" 2>/dev/null && pass "$p is valid bash" || fail "$p does not parse";; esac
done

step "the chapter's content, one node pass over the real parsed levels"
cat > "$TMP/static.mjs" <<'EOF'
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = process.env.QUEST_ROOT;
const levelsDir = process.env.QUEST_LEVELS;
const tmp = process.env.QUEST_TMP;
const shared = await import(pathToFileURL(join(root, 'packages/shared/dist/index.js')).href);
const { gradeQuiz } = await import(pathToFileURL(join(root, 'engine/dist/verify/quiz-answer.js')).href);
const { chooseDraw } = await import(pathToFileURL(join(root, 'engine/dist/pool.js')).href);
const { chapters } = await shared.loadAllLevels(resolve(root, levelsDir));
const ch = chapters.find((c) => c.id === 'finale');
const DIR = join(levelsDir, 'finale');
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = (rel) => readFileSync(resolve(root, DIR, rel), 'utf8');
const lv = (n) => ch.levels.find((l) => l.level.id.startsWith(`finale-${n}-`)).level;
const quizzes = (l) => l.verify.filter((v) => v.type === 'quiz');
const gradeAll = (qs, picks) => qs.map((q, i) => gradeQuiz(q, picks[i]).ok);

ok(ch && ch.levels.length === 7, 'chapter finale loads with 7 levels');
ok(ch.chapter.title === 'The architect', 'chapter title is "The architect"');

// ---- chapter thread
{
  const raw = read('chapter.yaml');
  const times = [...raw.matchAll(/time: "(\d\d:\d\d)"/g)].map((m) => m[1]);
  ok(times.length >= 6 && times.length <= 8, `incident thread has ${times.length} lines (six to eight)`);
  ok(times[0] === '09:00' && times[times.length - 1] === '09:30', `thread runs ${times[0]} to ${times[times.length - 1]} (09:00 to 09:30)`);
  ok(same(times, [...times].sort()), 'thread times are in order');
  const slugs = new Set([...raw.matchAll(/from: ([a-z-]+)/g)].map((m) => m[1]));
  const cast = JSON.parse(readFileSync(join(root, 'fiction/cast.json'), 'utf8')).cast.map((c) => c.slug);
  ok([...slugs].every((s) => s === 'you' || cast.includes(s)), `thread speakers are cast slugs or "you" (${[...slugs].join(', ')})`);
  ok(['senior', 'roommate', 'rival-college'].every((s) => slugs.has(s)), 'Harry Bhaiya, Teja and Mukul all speak in the thread');
}

// ---- the three pool levels
const NINE = [
  'ch2-02-cache-aside-v1',
  'ch2-07-fixtures-must-never-miss',
  'ch2-08-otp-login-properly',
  'ch3-03-token-bucket',
  'ch3-06-the-real-leaderboard',
  'ch3-10-the-ticker',
  'ch4-03-a-worker-died',
  'ch4-07-the-job-queue',
  'ch4-16-the-ops-wall',
];
const allLevels = new Map(chapters.flatMap((c) => c.levels.map((l) => [l.level.id, l.level])));
const pools = [
  ['01', 20, 'Mock one'],
  ['02', 20, 'Mock two'],
  ['03', 15, 'Panel round'],
].map(([n, minutes, badge]) => ({ n, minutes, badge, l: lv(n) }));
for (const { n, minutes, badge, l } of pools) {
  const iv = l.interview;
  ok(l.mode === 'code' && iv && Array.isArray(iv.pool), `${l.id}: a code level with an interview pool`);
  ok(iv.minutes === minutes, `${l.id}: ${minutes} minutes`);
  ok(iv.hint_xp_cost === 20 && iv.blank_start === true, `${l.id}: hints cost 20 XP, blank_start true`);
  ok(iv.rebuild_of === undefined, `${l.id}: a pool, not a rebuild_of`);
  ok(same(iv.pool.map((e) => e.rebuild_of), NINE), `${l.id}: the pool is the nine use cases, in the spec's order`);
  ok(iv.pool.every((e) => allLevels.get(e.rebuild_of)?.mode === 'code' && !allLevels.get(e.rebuild_of).interview), `${l.id}: every entry is an ordinary code level of an earlier chapter`);
  ok(iv.pool.every((e) => e.questions.length === 3), `${l.id}: exactly three follow-up questions in each of the nine entries`);
  ok(
    iv.pool.every((e) => e.questions.every((q) => q.options.length >= 3 && q.options.length <= 4 && q.correct.length === 1 && q.options.some((o) => o.id === q.correct[0]))),
    `${l.id}: each question has 3 or 4 options and one correct answer that is among them`,
  );
  ok(iv.pool.every((e) => e.questions.every((q) => /\b(level|page|Chapter|docs)\b/i.test(q.explanation))), `${l.id}: every explanation names its level or its docs page`);
  const positions = new Set(iv.pool.flatMap((e) => e.questions.map((q) => q.options.findIndex((o) => o.id === q.correct[0]))));
  ok(positions.size >= 3, `${l.id}: the right answer is not always in the same place (positions used: ${[...positions].sort().join(',')})`);
  ok(l.teach === undefined && l.verify.length === 0 && l.solutions === undefined && l.show_me === undefined, `${l.id}: no teach, verify, solutions or show_me (the engine takes them from the draw)`);
  ok(l.reward.xp === 150 && l.reward.badge === badge, `${l.id}: reward 150 XP and the badge "${badge}"`);
  ok(Array.isArray(l.hints) && l.hints.length >= 2 && l.hints.length <= 4, `${l.id}: ${l.hints?.length} hints, pattern-agnostic`);
  ok(l.brainstorm.options.some((o) => o.id === 'not-redis'), `${l.id}: the brainstorm has a not-redis option`);
  ok(l.task.trim().length > 0 && l.task.length < 120, `${l.id}: a one-line placeholder task`);
}
{
  const [a, b, c] = pools.map((p) => p.l.interview.pool);
  ok(same(a, b), 'levels 01 and 02 ask the same questions (the draw never gives the same use case twice)');
  const strip = (pool) => pool.map((e) => e.questions.map((q) => ({ o: q.options, c: q.correct })));
  ok(same(strip(a), strip(c)), 'level 03 has the same options and answers as 01, in a different voice');
  const mukul = c.flatMap((e) => e.questions.map((q) => q.question));
  ok(mukul.length === 27 && mukul.every((t) => t.startsWith('Mukul:')), 'level 03: all 27 questions are asked by Mukul');
  ok(a.flatMap((e) => e.questions.map((q) => q.question)).every((t) => !t.startsWith('Mukul:')), 'levels 01 and 02: none of the questions is in Mukul\'s voice');
  const story3 = pools[2].l.story;
  ok(/Mukul/.test(story3) && /INTERN/.test(story3), 'level 03 story: Mukul is on the panel, as an intern');
  ok(/alumni/.test(pools[0].l.story) && /\.before-finale-01-mock-interview-one/.test(pools[0].l.story), 'level 01 story: the alumni interviewer, and where the earlier file goes');
  ok(/\.before-finale-02-mock-interview-two/.test(pools[1].l.story), 'level 02 story: where the earlier file goes');
  ok(/\.before-finale-03-mock-interview-three/.test(pools[2].l.story), 'level 03 story: where the earlier file goes');
  // the spec's own examples must be present with their answers
  const flat = a.flatMap((e) => e.questions);
  const findQ = (re) => flat.find((q) => re.test(q.question));
  const label = (q) => q.options.find((o) => o.id === q.correct[0]).label;
  ok(/refills from Postgres|writes the hash back/.test(label(findQ(/comes back empty/))), 'cache-aside: Redis restarts empty -> it refills from Postgres, slower for a while');
  ok(/same Redis key|already shared/.test(label(findQ(/second app server/))), 'cache-aside: two app servers -> nothing changes, the cache is shared');
  ok(/memory|client-side caching/.test(label(findQ(/on every screen/))), 'cache-aside: one player on every screen -> a local copy or client-side caching');
  ok(/decision for this limiter/.test(label(findQ(/unreachable for ten seconds/))) && /level 3\.5/i.test(findQ(/unreachable for ten seconds/).explanation), 'token bucket: Redis unreachable -> a per-limiter decision, the answer of level 3.5');
  ok(/atomic/.test(label(findQ(/one Lua script/))), 'token bucket: why Lua -> atomic read, decide, write');
  ok(/TIME/.test(label(findQ(/clocks of your app servers/))) && /caller/.test(label(findQ(/clocks of your app servers/))), 'token bucket: clocks differ -> the script takes time from the caller, and what that costs');
  ok(flat.some((q) => /Mukul/.test(q.question)) === false, 'no stray Mukul in the calm pool');
}

// ---- the engine's own draw over the real pools: three pool levels give three different use cases
{
  let distinct = 0;
  const firstDraws = new Set();
  const N = 300;
  for (let k = 0; k < N; k++) {
    const player = `p-sample-${k}`;
    const taken = new Set();
    const got = [];
    for (const { l } of pools) {
      const e = chooseDraw(l.interview.pool, player, l.id, taken);
      got.push(e.rebuild_of);
      taken.add(e.rebuild_of);
    }
    if (new Set(got).size === 3 && got.every((g) => NINE.includes(g))) distinct++;
    firstDraws.add(got[0]);
  }
  ok(distinct === N, `the engine's draw (chooseDraw) over the real pools: ${N} sample players each got three different use cases from the nine`);
  ok(firstDraws.size >= 6, `the first interviewer's pick varies between players (${firstDraws.size} of the nine seen over ${N} players)`);
}

// ---- 04 the gauntlet
{
  const l = lv('04');
  const qs = quizzes(l);
  ok(l.mode === 'decision' && qs.length === 15, '04: a decision level with fifteen quizzes');
  ok(qs.every((q) => q.options.length === 4), '04: four options in every quiz');
  ok(qs.every((q, i) => q.options.filter((o) => o.id === `q${String(i + 1).padStart(2, '0')}-not-redis`).length === 1), '04: every quiz has its own qNN-not-redis option');
  const correct = qs.map((q) => q.correct[0]);
  ok(qs.every((q) => q.correct.length === 1), '04: one correct answer per quiz');
  const notRedis = correct.filter((c) => c.endsWith('-not-redis'));
  ok(notRedis.length >= 4, `04: ${notRedis.length} statements whose right answer is not Redis (at least four)`);
  ok(same(correct.slice(0, 11), ['q01-bitmap', 'q02-hll', 'q03-cuckoo', 'q04-topk', 'q05-geo', 'q06-stream', 'q07-lock', 'q08-bucket', 'q09-presence', 'q10-zset', 'q11-aside']), '04: the eleven structure answers are bitmap, HyperLogLog, cuckoo, Top-K, geo, stream with groups, lock, token bucket, pub/sub with presence, sorted set, cache-aside');
  ok(same(correct.slice(11), ['q12-not-redis', 'q13-not-redis', 'q14-not-redis', 'q15-not-redis']), '04: the last four statements are the not-Redis ones');
  const texts = qs.map((q) => q.question);
  ok(/200 GB/.test(texts[11]) && /seven years/.test(texts[11]), '04: statement 12 is the 200 GB audit log kept seven years');
  ok(/joins five tables/.test(texts[12]) && /once a night/.test(texts[12]), '04: statement 13 is the report that joins five tables once a night');
  ok(/50 MB/.test(texts[13]), '04: statement 14 is the 50 MB file');
  ok(/exactly right/.test(texts[14]) && /once a day/.test(texts[14]), '04: statement 15 is the counter that must be exact and is read once a day');
  const positions = new Set(qs.map((q) => q.options.findIndex((o) => o.id === q.correct[0])));
  ok(positions.size >= 3, `04: the right answer is not always in the same place (positions ${[...positions].sort().join(',')})`);
  ok(same(l.solutions.reference, correct), '04: the reference lists every correct id, in order');
  ok(l.solutions.wrong.length === 15 && qs.every((q) => l.solutions.wrong.filter((w) => q.options.some((o) => o.id === w.option)).length === 1), '04: exactly one wrong entry per quiz');
  ok(l.solutions.wrong.every((w) => w.expect === 'wrong' && !correct.includes(w.option) && w.because.length > 30), '04: every wrong entry is a wrong option with a teaching because');
  ok(qs.every((q) => /\b(level|page|FAQ|Reasoned)\b/i.test(q.explanation)), '04: every explanation names its level, its page, or says it is reasoning');
  ok(/reasoned/i.test(l.story) && /reasoned/i.test(l.teach), '04: the story and the teach say the answers are reasoned, not docs quotations');
  ok(same(gradeAll(qs, qs.map((q) => q.correct)), qs.map(() => true)), '04 graded by the engine: the reference passes all fifteen');
  ok(gradeAll(qs, qs.map(() => undefined)).every((r) => r === false), '04 graded by the engine: an empty answer fails every quiz');
  for (const w of l.solutions.wrong) {
    const i = qs.findIndex((q) => q.options.some((o) => o.id === w.option));
    ok(gradeQuiz(qs[i], w.option).ok === false, `04 graded by the engine: wrong entry ${w.option} fails quiz ${i + 1}`);
  }
}

// ---- 05 the neighbours
{
  const l = lv('05');
  const qs = quizzes(l);
  ok(l.mode === 'decision' && qs.length === 6, '05: a decision level with six quizzes');
  ok(qs.every((q) => q.options.length === 4 && q.correct.length === 1), '05: four options and one correct answer in every quiz');
  const topics = [/Memcached/, /Kafka/, /SKIP LOCKED/, /Map in the app/, /CDN/, /Postgres and Redis fit/];
  ok(topics.every((re, i) => re.test(qs[i].question)), '05: the six are Memcached, Kafka, SKIP LOCKED, an in-process Map, a CDN, and both');
  ok(qs.every((q) => /reasoned/i.test(q.explanation)), '05: every explanation says it is reasoning');
  ok(/streams page|consumer group/.test(qs[1].explanation) && /N different Redis keys/.test(qs[1].explanation), '05: the Kafka answer uses the digest\'s own comparison (groups balance on one key, partitions are N keys)');
  ok(/not from the digest|not from the docs/.test(qs[0].explanation + qs[2].explanation + qs[4].explanation), '05: answers about products the docs do not cover say so');
  ok(/reasoned|not quoted|judgement/i.test(l.story + l.teach), '05: the story and teach name the answers as reasoning');
  const correct = qs.map((q) => q.correct[0]);
  ok(same(l.solutions.reference, correct), '05: the reference lists every correct id');
  ok(l.solutions.wrong.length === 6 && qs.every((q) => l.solutions.wrong.filter((w) => q.options.some((o) => o.id === w.option)).length === 1), '05: exactly one wrong entry per quiz');
  ok(new Set(qs.map((q) => q.options.findIndex((o) => o.id === q.correct[0]))).size >= 3, '05: the right answer is not always in the same place');
  ok(same(gradeAll(qs, qs.map((q) => q.correct)), qs.map(() => true)), '05 graded by the engine: the reference passes all six');
  for (const w of l.solutions.wrong) {
    const i = qs.findIndex((q) => q.options.some((o) => o.id === w.option));
    ok(gradeQuiz(qs[i], w.option).ok === false, `05 graded by the engine: wrong entry ${w.option} fails quiz ${i + 1}`);
  }
}

// ---- 06 the code review
{
  const l = lv('06');
  const qs = quizzes(l);
  ok(l.mode === 'decision' && qs.length === 3, '06: a decision level with three quizzes');
  const PLANTED = [
    ['c-no-ttl', 'c-check-then-set', 'c-swallow', 'c-wrap-pg', 'c-no-negative'],
    ['w-keys', 'w-client-per-job', 'w-blpop-shared', 'w-rpop-claim'],
    ['l-set-expire', 'l-constant-value', 'l-plain-del', 'l-no-timeout'],
  ];
  qs.forEach((q, i) => {
    ok(same([...q.correct].sort(), [...PLANTED[i]].sort()), `06 quiz ${i + 1}: the planted set is ${PLANTED[i].join(', ')}`);
    ok(q.correct.length >= 4 && q.correct.length <= 6, `06 quiz ${i + 1}: ${q.correct.length} planted mistakes (four to six)`);
    ok(q.options.length >= 7 && q.options.length <= 9, `06 quiz ${i + 1}: ${q.options.length} options (seven to nine)`);
    ok(q.options.length - q.correct.length >= 3, `06 quiz ${i + 1}: at least three fine lines described as problems`);
    const levelsNamed = new Set([...q.explanation.matchAll(/(?:levels? |and )(\d+b?\.\d+)/g)].map((m) => m[1]));
    ok(levelsNamed.size >= 3, `06 quiz ${i + 1}: the explanation names the levels where the mistakes were the lesson (${[...levelsNamed].join(', ')})`);
    ok(q.explanation.includes('Fine lines'), `06 quiz ${i + 1}: the explanation also says why the fine lines are fine`);
    ok(gradeQuiz(q, q.correct).ok === true, `06 quiz ${i + 1} graded by the engine: the planted set passes`);
    ok(gradeQuiz(q, q.options.map((o) => o.id)).ok === false, `06 quiz ${i + 1} graded by the engine: ticking every option fails`);
    ok(gradeQuiz(q, undefined).ok === false, `06 quiz ${i + 1} graded by the engine: ticking nothing fails`);
    ok(gradeQuiz(q, q.correct.slice(1)).ok === false, `06 quiz ${i + 1} graded by the engine: missing one planted mistake fails`);
  });
  const all = qs.flatMap((q) => q.correct);
  ok(same(l.solutions.reference, all), '06: the reference lists every planted id');
  ok(l.solutions.wrong.length === 3 && qs.every((q) => l.solutions.wrong.filter((w) => q.options.some((o) => o.id === w.option)).length === 1), '06: one wrong entry per quiz');
  l.solutions.wrong.forEach((w) => {
    const i = qs.findIndex((q) => q.options.some((o) => o.id === w.option));
    const fine = !qs[i].correct.includes(w.option);
    ok(fine, `06: wrong entry ${w.option} is a fine line of quiz ${i + 1}`);
    ok(gradeQuiz(qs[i], [...qs[i].correct, w.option]).ok === false && gradeQuiz(qs[i], [w.option]).ok === false, `06 graded by the engine: ticking ${w.option} fails quiz ${i + 1}`);
  });
  // the pull request in the teach: three files, fenced, valid JavaScript, with the planted constructs really in them
  const blocks = [...l.teach.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]);
  ok(blocks.length === 3, '06: the teach holds three fenced JavaScript files');
  ['workspace/review/cache.js', 'workspace/review/worker.js', 'workspace/review/lock.js'].forEach((name, i) => {
    ok(l.teach.includes(`**\`${name}\`**`) && blocks[i]?.includes(`// ${name}`), `06: ${name} is shown, in order, with its path as the first comment`);
    const file = join(tmp, `review-${i}.mjs`);
    writeFileSync(file, blocks[i]);
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    ok(r.status === 0, `06: ${name} parses as JavaScript${r.status === 0 ? '' : ` (${r.stderr.split('\n')[0]})`}`);
  });
  const [cache, worker, lock] = blocks;
  ok(/hSet\(key, toStrings/.test(cache) && !/\.expire\(|multi\(/.test(cache), '06 cache.js: the hash is written with no expiry');
  ok(/await redis\.get\(lockKey\)/.test(cache) && /await redis\.set\(lockKey, '1', \{ expiration/.test(cache) && !/NX/.test(cache), '06 cache.js: the lock is a get then a set, with no NX');
  ok(/catch \(err\) \{\s*return null;/.test(cache) && /db\.query/.test(cache.slice(cache.indexOf('try'), cache.indexOf('catch'))), '06 cache.js: one catch returns null and the try covers the Postgres query');
  ok(/rows\.length === 0\) return null;/.test(cache) && !/_missing|sentinel/i.test(cache), '06 cache.js: an unknown id returns null and caches nothing');
  ok(/redis\.keys\('user:\*'\)/.test(worker) && /for \(const key of await redis\.keys/.test(worker), "06 worker.js: KEYS 'user:*' inside the loop");
  ok(/function award[\s\S]*createClient[\s\S]*connect\(\)/.test(worker) && !/\.(close|quit|disconnect)\(/.test(worker), '06 worker.js: a new client per job, never closed');
  ok(/await redis\.blPop\(/.test(worker), '06 worker.js: BLPOP on the shared client');
  ok(/await redis\.rPop\(/.test(worker), '06 worker.js: RPOP to claim');
  ok(/await redis\.set\(key, '1', \{ condition: 'NX' \}\)/.test(lock) && /await redis\.expire\(key, 30\)/.test(lock), '06 lock.js: SET NX then a separate EXPIRE');
  ok(/await redis\.del\(key\)/.test(lock) && !/token|eval|DELEX/i.test(lock), '06 lock.js: released with a plain DEL, no token');
  ok(/db\.query/.test(lock) && !/timeout|statement_timeout|AbortController/i.test(lock), '06 lock.js: held across a Postgres call with no bound');
}

// ---- 07 your story
{
  const l = lv('07');
  ok(l.mode === 'ops', '07: an ops level');
  const ev = l.verify.filter((v) => v.type === 'event');
  ok(ev.length === 1 && ev[0].kind === 'custom' && ev[0].match.name === 'portfolio_written' && ev[0].timeoutMs === 120000, '07: waits for the custom event portfolio_written, 120000 ms');
  const qs = quizzes(l);
  ok(qs.length === 2 && qs.every((q) => q.options.length === 4 && q.correct.length === 1), '07: two quizzes, four options and one correct answer each');
  ok(/numbers? it measured|number it measured/.test(qs[0].options.find((o) => o.id === qs[0].correct[0]).label) && /trade-off/.test(qs[0].options.find((o) => o.id === qs[0].correct[0]).label) && /level/.test(qs[0].options.find((o) => o.id === qs[0].correct[0]).label), '07: the right interview framing has the number, the trade-off and the level');
  ok(/\.env/.test(qs[1].options.find((o) => o.id === qs[1].correct[0]).label) && /customer/.test(qs[1].options.find((o) => o.id === qs[1].correct[0]).label), '07: the right answer on what not to push names .env, credentials and customer data');
  ok(gradeAll(qs, qs.map((q) => q.correct)).every(Boolean), '07 graded by the engine: both quizzes pass with the right answers');
  ok(gradeAll(qs, qs.map((q) => q.options.find((o) => !q.correct.includes(o.id)).id)).every((r) => r === false), '07 graded by the engine: a weaker framing fails each quiz');
  ok(l.show_me && l.show_me.component === 'cache_stats' && same(l.show_me.keys, []), '07: show_me is cache_stats with no keys');
  ok(l.reward.xp === 80, '07: reward 80 XP');
  ok(/POST \/api\/portfolio\/write|portfolio\/write/.test(l.task) && /git init/.test(l.task) && /git commit -m "Redis Quest: what I built"/.test(l.task) && /does not grade/.test(l.task), '07: the task has the button or curl, the git commands, and says the push is not graded');
  const ref = read(l.solutions.reference);
  const wrong = read(l.solutions.wrong[0].path);
  ok(l.solutions.reference === 'solutions/07-reference.sh' && l.solutions.wrong[0].path === 'solutions/07-wrong-no-page.sh' && l.solutions.wrong[0].expect === 'wrong', '07: solutions are 07-reference.sh and 07-wrong-no-page.sh (wrong)');
  ok(/api\/portfolio\/write/.test(ref) && /git init/.test(ref) && /git add \./.test(ref) && /git commit -m "Redis Quest: what I built"/.test(ref), '07: the reference makes the page, then runs git init, add and commit');
  ok(/git init/.test(wrong) && !/portfolio/.test(wrong.replace(/^#.*$/gm, '')), '07: the wrong solution is git only, no portfolio call (the event never fires)');
}

// ---- fiction and text rules over every file of the chapter
{
  const files = readdirSync(resolve(root, DIR)).filter((f) => f.endsWith('.yaml'));
  const deny = JSON.parse(readFileSync(join(root, 'fiction/denylist.json'), 'utf8'));
  const names = [...deny.cricketers, ...deny.franchises];
  for (const f of files) {
    const raw = read(f);
    const hits = names.filter((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(raw));
    ok(hits.length === 0, `${f}: no real cricketer or franchise from the denylist${hits.length ? ` (${hits.join(', ')})` : ''}`);
    ok(!/\b(bet|stake|payout|cash|ipl|indian premier)\b/i.test(raw), `${f}: no bet, stake, payout, cash or IPL`);
    ok(!/\b(AI|LLM|embeddings?|vectors?|GPT)\b/.test(raw), `${f}: no AI, vector or LLM content`);
    ok(!/\b(E-0[1-4]|F-1[0-2]|G-0[12]|A-0[1-5]|P0-\d\d)\b|\bC(?:[0-5]|2a|2b|4b)\b/.test(raw), `${f}: no build task id in learner-facing text`);
  }
}
process.exit(fails ? 1 : 0);
EOF
QUEST_ROOT="$ROOT" QUEST_LEVELS="$LEVELS" QUEST_TMP="$TMP" node "$TMP/static.mjs"
RC=$?
if [ $RC -ne 0 ]; then FAILS=$((FAILS + 1)); fi

step "local proof"
echo "NOTE  pool levels 01 to 03 have no verifiers or solutions of their own: the engine takes them from the drawn level,"
echo "      so there is nothing to run for them here (their nine drawn levels are proven by the checks of Chapters 2 to 4)."
echo "NOTE  04 to 06 were graded above through the engine's own quiz grader, statically (no Docker)."
echo "NOTE  07's solutions are .sh files: the grading harness skips them unless --run-ops, which would git init the real workspace."
echo "      Level 07 is graded by hand once per release: press 'Write my story' (or the curl), then Verify; then the wrong script must fail."

echo
if [ "$FAILS" -eq 0 ]; then echo "CF OK"; exit 0; else echo "CF FAILED ($FAILS)"; exit 1; fi
