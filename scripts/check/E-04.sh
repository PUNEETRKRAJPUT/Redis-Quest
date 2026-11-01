#!/usr/bin/env bash
# E-04 check: engine, schema, UI and harness pieces the Finale needs.
#   1. shared, engine and ui unit tests, lints, format (the whole repo), levels:validate over the real tree, the
#      scratch chapter (accepted) and the bad shapes (each rejected with a position)
#   2. a real stack (compose project quest-e04, .env.e04) with scratch levels: example-code, example-interview and
#      a scratch chapter `scratch-e04` (two pool levels over the two example-code levels, and an ops level that
#      waits for portfolio_written), a scratch save and a scratch workspace
#   3. the pool: blank start (the learner's file moved aside once), the draw (stable, restart-proof, never repeats
#      across pool levels), the level payload, the harness grading the drawn level's own solutions
#   4. the portfolio from the save (stored traffic metrics, drawn levels, workspace tree), its route and event
#   5. regression: example-code and example-interview grade with no MISMATCH, rebuild_of levels are not blanked
# bash 3.2 compatible. Never touches the default project or any other quest-* project.
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1

PROJECT=quest-e04
ENV_FILE=.env.e04
CHECK_DIR="$ROOT/logs/.e-04-check"
OVERRIDE="$CHECK_DIR/compose.e04.yaml"
BASE=http://127.0.0.1:3600
SERVICES="redis postgres engine app runner proxy"
CLI="packages/shared/dist/levels/cli.js"
FIX="engine/test/fixtures/scratch-e04"
FAILED=0

say() { printf '\n== %s\n' "$*"; }
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILED=1; }
dc() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.yml -f "$OVERRIDE" "$@"; }

setvar() { grep -v "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null; printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE.tmp"; mv "$ENV_FILE.tmp" "$ENV_FILE"; }

export E04_WORKSPACE="$CHECK_DIR/workspace" E04_LOGS="$CHECK_DIR/logs" E04_PROGRESS="$CHECK_DIR/progress" E04_LEVELS="$CHECK_DIR/levels"

cleanup() {
  say "cleanup"
  if [ -f "$OVERRIDE" ]; then
    dc down -v --remove-orphans >/dev/null 2>&1 && echo "docker compose -p $PROJECT down -v: done"
  fi
  rm -rf "$CHECK_DIR" && echo "removed scratch dir logs/.e-04-check"
  if [ "$FAILED" -eq 0 ]; then printf '\nE-04 OK\n'; else printf '\nE-04 FAILED\n'; fi
}
trap cleanup EXIT
finish() { exit "$FAILED"; }
die() { fail "$1"; finish; }

rm -rf "$CHECK_DIR"
mkdir -p "$CHECK_DIR" "$E04_WORKSPACE" "$E04_LOGS" "$E04_PROGRESS" "$E04_LEVELS"

# Tiny JSON helper: `... | pick 'j.interview.drawn.id'` prints the value of the JS expression over the parsed stdin.
cat > "$CHECK_DIR/pick.js" <<'EOF'
let s = '';
process.stdin.on('data', (d) => (s += d));
process.stdin.on('end', () => {
  let j;
  try { j = JSON.parse(s); } catch { process.exit(0); }
  const v = eval(process.argv[2]);
  if (v !== undefined) process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v));
});
EOF
pick() { node "$CHECK_DIR/pick.js" "$1"; }
jget() { curl -s -m 20 "$BASE$1"; }
EMPTY='{}'
jpost() { curl -s -m 60 -X POST -H 'content-type: application/json' -d "${2:-$EMPTY}" "$BASE$1"; }
assert_eq() { # description actual expected
  if [ "$2" = "$3" ]; then pass "$1: $2"; else fail "$1: got '$2', wanted '$3'"; fi
}

wait_engine() {
  i=0
  while [ $i -lt 120 ]; do
    h="$(curl -s -m 2 "$BASE/health" || true)"
    case "$h" in *'"redis":"up"'*'"postgres":"up"'*'"levels":"ok"'*) echo "$h"; return 0 ;; esac
    sleep 2; i=$((i + 1))
  done
  echo "$h"; return 1
}

# ---- 1. unit tests, lints, format ----------------------------------------------------------------------------
say "pnpm install --frozen-lockfile, builds"
if pnpm install --frozen-lockfile >/dev/null 2>&1; then pass "lockfile matches"; else die "pnpm install --frozen-lockfile"; fi
for pkg in shared engine ui; do
  if B="$(pnpm --filter "@quest/$pkg" build 2>&1)"; then pass "pnpm --filter @quest/$pkg build"; else printf '%s\n' "$B" | tail -25; die "$pkg build"; fi
done
if bash -n scripts/check/E-04.sh && node --check scripts/grade/grade.mjs; then pass "E-04.sh and grade.mjs parse"; else die "syntax"; fi

say "unit tests: shared (schema, loader), engine (draw, blank start, payload, metrics, portfolio), ui (story)"
for pkg in shared engine ui; do
  if T="$(pnpm --filter "@quest/$pkg" test 2>&1)"; then
    pass "$pkg vitest: $(printf '%s\n' "$T" | grep -E '^ +Tests ' | sed 's/^ *//')"
  else printf '%s\n' "$T" | tail -40; fail "$pkg vitest"; fi
done
for f in packages/shared/src/levels/__tests__/pool.test.ts engine/test/pool.test.ts ui/test/portfolio.test.tsx; do
  [ -f "$f" ] && pass "present: $f" || fail "missing: $f"
done

say "lint and format (the whole repo)"
if L="$(pnpm lint 2>&1)"; then pass "pnpm lint (every package)"; else printf '%s\n' "$L" | tail -30; fail "pnpm lint"; fi
if F="$(pnpm format:check 2>&1)"; then pass "pnpm format:check (whole repo)"; else printf '%s\n' "$F" | tail -20; fail "pnpm format:check"; fi

# ---- levels:validate ------------------------------------------------------------------------------------------
say "levels:validate: the real tree, the examples, the scratch chapter, and the bad shapes"
if O="$(node "$CLI" levels 2>&1)"; then
  pass "levels: $O"
  # every chapter OK, no change to any existing level file (git sees none of them modified)
  if git diff --quiet HEAD -- levels ':!levels/README.md'; then pass "no existing level file differs from HEAD (only levels/README.md may)"; else git diff --stat HEAD -- levels; fail "an existing level file differs from HEAD"; fi
else printf '%s\n' "$O"; fail "levels:validate levels"; fi
for ch in example-cli example-code example-decision example-ops; do
  O="$(node "$CLI" "levels/_examples/$ch" 2>&1)" && pass "_examples/$ch: $O" || { printf '%s\n' "$O"; fail "_examples/$ch"; }
done
CASES="$CHECK_DIR/cases"
mkdir -p "$CASES"
mk_case() { # name sed-expression-or-empty
  mkdir -p "$CASES/$1"
  cp -R levels/_examples/example-code "$CASES/$1/example-code"
  cp -R "$FIX" "$CASES/$1/scratch-e04"
  if [ -n "$2" ]; then sed -i '' -e "$2" "$CASES/$1/scratch-e04/01-mock-one.yaml"; fi
}
mk_case ok ''
O="$(node "$CLI" "$CASES/ok/example-code" "$CASES/ok/scratch-e04" 2>&1)" && pass "scratch chapter accepted (pool over example-code, ops level): $O" || { printf '%s\n' "$O"; fail "scratch chapter should validate"; }
O="$(node "$CLI" "$CASES/ok" 2>&1)" && pass "same tree as one directory: $O" || { printf '%s\n' "$O"; fail "scratch tree as one directory"; }
expect_fail() { # case-name error-regex
  O="$(node "$CLI" "$CASES/$1" 2>&1)"; RC=$?
  if [ "$RC" -eq 1 ] && printf '%s\n' "$O" | grep -qE "01-mock-one\.yaml:[0-9]+:[0-9]+ $2"; then
    pass "case $1 -> $(printf '%s\n' "$O" | grep -E "$2" | head -1 | sed "s#$CASES/##" | cut -c1-175)"
  else printf '%s\n' "$O"; fail "case $1 should exit 1 with a positioned error matching: $2"; fi
}
mk_case rebuild-not-earlier 's/rebuild_of: example-code-02-token-bucket/rebuild_of: scratch-e04-03-write-story/'
expect_fail rebuild-not-earlier 'interview\.pool\[1\]\.rebuild_of: scratch-e04-03-write-story comes after this level'
mk_case rebuild-missing 's/rebuild_of: example-code-02-token-bucket/rebuild_of: example-code-09-nothing/'
expect_fail rebuild-missing 'interview\.pool\[1\]\.rebuild_of: example-code-09-nothing is not a level that was loaded'
mk_case with-verify ''
cat >> "$CASES/with-verify/scratch-e04/01-mock-one.yaml" <<'EOF'

verify:
  - type: quiz
    question: "q?"
    options:
      - { id: a1, label: "a" }
      - { id: b1, label: "b" }
    correct: a1
    explanation: "e"
EOF
expect_fail with-verify 'verify: a pool level has no verify of its own'
mk_case with-solutions ''
cat >> "$CASES/with-solutions/scratch-e04/01-mock-one.yaml" <<'EOF'

solutions:
  reference: solutions/03-reference.redis
  wrong:
    - path: solutions/03-wrong-no-page.redis
      expect: wrong
      because: "b"
EOF
expect_fail with-solutions 'solutions: a pool level has no solutions of its own'
mk_case both 's/^  minutes: 20$/  minutes: 20\
  rebuild_of: example-code-01-cache-aside/'
expect_fail both 'interview\.pool: use either rebuild_of or pool, not both'
mk_case neither 's/^  pool:$/  xpool:/'
expect_fail neither 'interview\.xpool: unknown key'
mk_case one-entry ''
node -e "
const fs = require('fs'); const f = '$CASES/one-entry/scratch-e04/01-mock-one.yaml';
let t = fs.readFileSync(f, 'utf8'); const i = t.indexOf('    - rebuild_of: example-code-02-token-bucket'); const j = t.indexOf('\nstory:');
fs.writeFileSync(f, t.slice(0, i) + t.slice(j + 1));"
expect_fail one-entry 'interview\.pool: a pool needs at least 2 entries'
rm -rf "$CASES"

# ---- 2. the stack ---------------------------------------------------------------------------------------------
say "scratch levels, save and workspace; isolated stack settings ($ENV_FILE, project $PROJECT)"
cp -R levels/_examples/example-code "$E04_LEVELS/example-code"
cp -R levels/_examples/example-interview "$E04_LEVELS/example-interview"
cp -R "$FIX" "$E04_LEVELS/scratch-e04"
O="$(node "$CLI" "$E04_LEVELS" 2>&1)" && pass "scratch levels valid: $O" || { printf '%s\n' "$O"; die "scratch levels invalid"; }

A_ID=scratch-e04-01-mock-one
B_ID=scratch-e04-02-mock-two
C_ID=scratch-e04-03-write-story
CACHE_ID=example-code-01-cache-aside
BUCKET_ID=example-code-02-token-bucket
# The save is made here so the draw is known in advance: a player id whose seed (sha256 of "<player>:<level>", first
# four bytes, big-endian, modulo the number of entries) picks the first pool entry, example-code-01-cache-aside.
PLAYER_ID="$(node -e "
const c = require('crypto');
for (let i = 0; ; i++) {
  const id = 'p-e04-' + i;
  if (c.createHash('sha256').update(id + ':$A_ID').digest().readUInt32BE(0) % 2 === 0) { console.log(id); break; }
}")"
node -e "
const fs = require('fs');
fs.writeFileSync('$E04_PROGRESS/progress.json', JSON.stringify({
  version: 1,
  player: { id: '$PLAYER_ID', name: 'Asha E04', createdAt: new Date().toISOString() },
  target: { redisUrl: 'redis://redis:6379' },
  activeSlots: [], levels: {}, xp: 0, badges: [],
}, null, 2));"
mkdir -p "$E04_WORKSPACE/ch2" "$E04_WORKSPACE/ch3"
printf '// my own cache-aside, written before the finale\nexport default async function getPlayerStats() { return null; }\n' > "$E04_WORKSPACE/ch2/cache.js"
printf '// my own limiter\n' > "$E04_WORKSPACE/ch3/ratelimit.js"
OLD_CACHE="$(cat "$E04_WORKSPACE/ch2/cache.js")"
pass "scratch save: player $PLAYER_ID; non-empty workspace/ch2/cache.js and ch3/ratelimit.js"

cp .env.example "$ENV_FILE"
setvar PROXY_PORT 3600
setvar REDIS_PORT 6396
setvar PG_PORT 5438
setvar INSIGHT_PORT 5546
setvar ENGINE_DEV 1
pass "wrote $ENV_FILE (gitignored): PROXY_PORT=3600 REDIS_PORT=6396 PG_PORT=5438 INSIGHT_PORT=5546 ENGINE_DEV=1"

cat > "$OVERRIDE" <<EOF
# Generated by scripts/check/E-04.sh (project quest-e04): own image tag, scratch workspace, logs, progress, levels.
x-e04-node: &e04-node
  image: quest-e04-node:latest

services:
  engine:
    <<: *e04-node
    environment:
      # Event waits are capped so wrong solutions that wait for an event grade in seconds, not minutes.
      VERIFY_MAX_EVENT_WAIT_MS: "5000"
    volumes:
      - $E04_WORKSPACE:/workspace
      - $E04_LOGS:/logs
      - $E04_PROGRESS:/progress
      - $E04_LEVELS:/levels:ro
      - $ROOT/scenarios:/srv/scenarios:ro
  app:
    <<: *e04-node
    volumes:
      - $E04_WORKSPACE:/workspace
      - $E04_LOGS:/logs
      - $E04_PROGRESS:/progress
  runner:
    <<: *e04-node
    volumes:
      - $E04_WORKSPACE:/workspace
      - $E04_LOGS:/logs
      - $E04_PROGRESS:/progress
  proxy:
    volumes:
      - $ROOT/docker/Caddyfile:/etc/caddy/Caddyfile:ro
      - $E04_LOGS:/logs
  postgres:
    volumes:
      - pg-data:/var/lib/postgresql/data
      - $ROOT/postgres/init:/docker-entrypoint-initdb.d:ro
      - $E04_LOGS:/logs
EOF

say "docker compose -p $PROJECT build (image quest-e04-node, retried), up -d $SERVICES"
for p in 3600 6396 5438 5546; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then die "port $p is already in use by something that is not the $PROJECT stack"; fi
done
dc down -v --remove-orphans >/dev/null 2>&1
n=0
until dc build engine >"$CHECK_DIR/build.log" 2>&1; do
  n=$((n + 1))
  if [ $n -ge 3 ]; then tail -30 "$CHECK_DIR/build.log"; die "docker build failed 3 times"; fi
  echo "build attempt $n failed, retrying"; tail -5 "$CHECK_DIR/build.log"; sleep 10
done
pass "image built"
# shellcheck disable=SC2086
dc up -d --no-build $SERVICES >"$CHECK_DIR/up.log" 2>&1 || { tail -20 "$CHECK_DIR/up.log"; die "compose up"; }
if h="$(wait_engine)"; then pass "engine healthy through the proxy on 3600 with the scratch levels loaded: $h"; else dc logs --tail 40 engine; die "engine not healthy: $h"; fi

# ---- 3a. regression first: example-code (stores real traffic metrics) and the rebuild_of interview ------------
grade() { # name json-name target...
  name="$1"; jname="$2"; shift 2
  scripts/grade/grade.sh --engine "$BASE" --levels "$E04_LEVELS" --json "$CHECK_DIR/$jname.json" "$@" 2>&1 \
    | tee "$CHECK_DIR/$jname.out" | grep -E '^ *[0-9]+s +(PASS|MISMATCH|SKIPPED|NOTE|####|==)' | sed 's/^ *[0-9]*s  /      /' | cut -c1-230
  return "${PIPESTATUS[0]}"
}
mismatches() { node -e "const j=JSON.parse(require('fs').readFileSync('$CHECK_DIR/$1.json','utf8'));console.log(j.rows.filter(r=>r.result==='MISMATCH').length)"; }
rowsof() { node -e "const j=JSON.parse(require('fs').readFileSync('$CHECK_DIR/$1.json','utf8'));console.log(j.rows.filter(r=>r.level==='$2').map(r=>r.declared+'/'+r.engine+'/'+r.result).join(' '))"; }

say "regression: the harness grades example-code (traffic and stored metrics) and the rebuild_of interview as before"
grade example-code ex-code "$E04_LEVELS/example-code"; rc=$?
assert_eq "example-code: grade exit code" "$rc" "0"
assert_eq "example-code: MISMATCH rows" "$(mismatches ex-code)" "0"
assert_eq "example-code-01 rows (declared/engine/result)" "$(rowsof ex-code $CACHE_ID)" "right/right/PASS wrong/wrong/PASS works_but_wrong/works_but_wrong/PASS"
M="$(jget /api/progress | pick "(j.levels['$CACHE_ID'].verdicts.find(v => v.verdict === 'right') || {}).metrics")"
if [ "$(printf '%s' "$M" | pick 'typeof j.p99Ms === "number" && typeof j.baselineP99Ms === "number" && typeof j.dbPerRequest === "number" && typeof j.redisPerRequest === "number" && typeof j.hitRatio === "number" && typeof j.rps === "number"')" = true ]; then
  pass "the passing verdict of $CACHE_ID carries the traffic numbers in progress.json: $M"
else fail "no metrics on the passing verdict of $CACHE_ID: $M"; fi
if [ "$(jget /api/progress | pick "j.levels['$BUCKET_ID'].verdicts.every(v => v.metrics === undefined)")" = true ]; then pass "$BUCKET_ID has no traffic check, so its verdicts carry no metrics"; else fail "metrics on a level without traffic"; fi
grade example-interview ex-iv "$E04_LEVELS/example-interview"; rc=$?
assert_eq "example-interview (rebuild_of): grade exit code" "$rc" "0"
assert_eq "example-interview: MISMATCH rows" "$(mismatches ex-iv)" "0"
assert_eq "the rebuild_of interview did not blank anything (blank_start defaults to false)" "$(cat "$E04_WORKSPACE/ch2/cache.js")" "$OLD_CACHE"
ls "$E04_WORKSPACE/ch2" "$E04_WORKSPACE/ch3" | grep -c 'before-' | grep -qx 0 && pass "no .before- backup exists yet" || fail "a backup exists before any pool level started"
IVV="$(jget "/api/levels/example-interview-01-cache-aside-rebuild")"
assert_eq "rebuild_of level payload: interview.pool / drawn / blanked" "$(printf '%s' "$IVV" | pick 'JSON.stringify([j.interview.pool, j.interview.drawn, j.interview.blanked, j.interview.rebuildOf.id])')" '[false,null,[],"example-code-01-cache-aside"]'

# ---- 3b. the pool level: blank start, the draw, the payload ------------------------------------------------------
say "pool level (a) $A_ID: before the first start"
V="$(jget "/api/levels/$A_ID")"
assert_eq "interview.drawn before the start" "$(printf '%s' "$V" | pick 'j.interview.drawn')" "null"
assert_eq "task before the start" "$(printf '%s' "$V" | pick 'j.task')" "The interviewer picks when you start."
assert_eq "no verifier listed before the start" "$(printf '%s' "$V" | pick 'j.verifiers.length')" "0"
assert_eq "no clock before the start" "$(printf '%s' "$V" | pick 'j.interview.startedAt')" "null"

say "pool level (a): first start draws and blanks"
S="$(jpost "/api/levels/$A_ID/start")"
assert_eq "the draw (seed picks the first entry)" "$(printf '%s' "$S" | pick 'j.drawn')" "$CACHE_ID"
BACKUP="ch2/cache.js.before-$A_ID"
assert_eq "start response lists the blanked file" "$(printf '%s' "$S" | pick 'JSON.stringify(j.blanked)')" "[{\"file\":\"ch2/cache.js\",\"backup\":\"$BACKUP\"}]"
assert_eq "workspace/ch2/cache.js is now empty (bytes)" "$(wc -c < "$E04_WORKSPACE/ch2/cache.js" | tr -d ' ')" "0"
assert_eq "the earlier file is at workspace/$BACKUP" "$(cat "$E04_WORKSPACE/$BACKUP" 2>/dev/null)" "$OLD_CACHE"
assert_eq "the other slot file (ch3/ratelimit.js) was not touched" "$(cat "$E04_WORKSPACE/ch3/ratelimit.js")" "// my own limiter"
printf '// typed after the blank start\n' > "$E04_WORKSPACE/ch2/cache.js"
S2="$(jpost "/api/levels/$A_ID/start")"
assert_eq "second start keeps the draw" "$(printf '%s' "$S2" | pick 'j.drawn')" "$CACHE_ID"
assert_eq "second start does not blank again (the file keeps what was typed)" "$(cat "$E04_WORKSPACE/ch2/cache.js")" "// typed after the blank start"
assert_eq "the backup was not moved or overwritten" "$(cat "$E04_WORKSPACE/$BACKUP")" "$OLD_CACHE"
assert_eq "exactly one backup file exists" "$(ls "$E04_WORKSPACE/ch2" | grep -c 'before-')" "1"

say "pool level (a): the level payload"
V="$(jget "/api/levels/$A_ID")"
assert_eq "interview.drawn" "$(printf '%s' "$V" | pick 'JSON.stringify([j.interview.drawn.id, j.interview.drawn.title, j.interview.drawn.chapter])')" '["example-code-01-cache-aside","Cache-aside, version one","example-code"]'
assert_eq "interview.blanked (the payload lists where the earlier file is)" "$(printf '%s' "$V" | pick 'JSON.stringify(j.interview.blanked)')" "[{\"file\":\"ch2/cache.js\",\"backup\":\"$BACKUP\"}]"
assert_eq "interview.rebuildOf is the drawn level" "$(printf '%s' "$V" | pick 'j.interview.rebuildOf.id')" "$CACHE_ID"
DV="$(jget "/api/levels/$CACHE_ID")"
assert_eq "task is the drawn level's task" "$(printf '%s' "$V" | pick 'j.task')" "$(printf '%s' "$DV" | pick 'j.task')"
assert_eq "story, title and reward are the pool level's own" "$(printf '%s' "$V" | pick 'JSON.stringify([j.title, j.reward.xp, /I will pick the question/.test(j.story)])')" '["Mock interview one",150,true]'
assert_eq "verifiers: the drawn level's, then the follow-up quiz" "$(printf '%s' "$V" | pick 'j.verifiers.map(v => v.type).join(",")')" "behavior,traffic,antipattern,quiz"
assert_eq "the follow-up quiz is index 3 and asks the interviewer's question" "$(printf '%s' "$V" | pick 'j.verifiers[3].index + ": " + j.verifiers[3].question')" "3: Redis restarts and comes back empty. What happens to your stats page (one)?"
assert_eq "interview.questionsFrom" "$(printf '%s' "$V" | pick 'j.interview.questionsFrom')" "3"
assert_eq "hints: the pool's one plus the drawn level's two" "$(printf '%s' "$V" | pick 'j.hintsTotal')" "3"
assert_eq "no answers leak into the payload" "$(printf '%s' "$V" | pick '/refills-one.*correct|correct/.test(JSON.stringify(j.verifiers))')" "false"
assert_eq "slots come from the drawn level" "$(printf '%s' "$V" | pick 'j.slots.own.join(",")')" "cache.getPlayerStats"
assert_eq "no teaching" "$(printf '%s' "$V" | pick 'j.teach')" ""

say "the draw survives an engine restart"
dc restart engine >/dev/null 2>&1
if h="$(wait_engine)"; then pass "engine back after restart"; else die "engine did not come back"; fi
assert_eq "(a) still drawn after the restart" "$(jget "/api/levels/$A_ID" | pick 'j.interview.drawn.id')" "$CACHE_ID"
assert_eq "(a) started again after the restart keeps the draw" "$(jpost "/api/levels/$A_ID/start" | pick 'j.drawn')" "$CACHE_ID"
assert_eq "...and the clock is the one from the first start" "$(jget "/api/levels/$A_ID" | pick 'j.interview.startedAt <= j.startedAt')" "true"
assert_eq "an ordinary level's payload says interview null" "$(jget "/api/levels/$CACHE_ID" | pick 'j.interview')" "null"

# ---- 3c. the harness grades the pool levels --------------------------------------------------------------------
say "the harness grades (a) and (b): the drawn level's reference right, its wrong ones as declared, the draw in the note"
grade pools pools "$A_ID" "$B_ID"; rc=$?
assert_eq "pool levels: grade exit code" "$rc" "0"
assert_eq "pool levels: MISMATCH rows" "$(mismatches pools)" "0"
assert_eq "(a) rows (declared/engine/result)" "$(rowsof pools $A_ID)" "right/right/PASS wrong/wrong/PASS works_but_wrong/works_but_wrong/PASS"
assert_eq "(b) rows (declared/engine/result)" "$(rowsof pools $B_ID)" "right/right/PASS wrong/wrong/PASS works_but_wrong/works_but_wrong/PASS"
for lv in "$A_ID:$CACHE_ID" "$B_ID:$BUCKET_ID"; do
  lid="${lv%%:*}"; drew="${lv#*:}"
  assert_eq "$lid: every row's note names the draw" "$(node -e "const j=JSON.parse(require('fs').readFileSync('$CHECK_DIR/pools.json','utf8'));console.log(j.rows.filter(r=>r.level==='$lid').every(r=>r.note.includes('drew $drew (')))")" "true"
done
assert_eq "(a) drew the first entry" "$(jget /api/progress | pick "j.levels['$A_ID'].drawn")" "$CACHE_ID"
assert_eq "(b) drew the other entry (the draw excludes (a)'s)" "$(jget /api/progress | pick "j.levels['$B_ID'].drawn")" "$BUCKET_ID"
assert_eq "(b) blanked the token bucket's file, not the cache file" "$(ls "$E04_WORKSPACE/ch3" | grep -c "ratelimit.js.before-$B_ID")" "1"
assert_eq "(b) is a different use case from (a)" "$([ "$(jget "/api/levels/$A_ID" | pick 'j.interview.drawn.id')" != "$(jget "/api/levels/$B_ID" | pick 'j.interview.drawn.id')" ] && echo different || echo same)" "different"
assert_eq "(b) task is the token bucket's" "$(jget "/api/levels/$B_ID" | pick 'j.task')" "$(jget "/api/levels/$BUCKET_ID" | pick 'j.task')"
assert_eq "(b) follow-up question comes from its entry" "$(jget "/api/levels/$B_ID" | pick 'j.verifiers.at(-1).question')" "Why one Lua script and not two commands (two)?"
dc restart engine >/dev/null 2>&1
if h="$(wait_engine)"; then pass "engine back after a second restart"; else die "engine did not come back"; fi
assert_eq "both draws survived it" "$(jget /api/progress | pick "j.levels['$A_ID'].drawn + ' ' + j.levels['$B_ID'].drawn")" "$CACHE_ID $BUCKET_ID"
assert_eq "the metrics of a pool verify are kept too (passing verdict of (a))" "$(jget /api/progress | pick "typeof j.levels['$A_ID'].verdicts.find(v => v.verdict === 'right').metrics.p99Ms")" "number"
assert_eq "...and the time into the interview clock" "$(jget /api/progress | pick "typeof j.levels['$A_ID'].verdicts.find(v => v.verdict === 'right').elapsedMs")" "number"

# ---- 4. the portfolio ------------------------------------------------------------------------------------------
say "portfolio: GET /api/portfolio is made from the save, the level files and the workspace"
printf '// the cache I rebuilt\n' > "$E04_WORKSPACE/ch2/cache.js"
P="$(jget /api/portfolio)"
echo "$P" > "$CHECK_DIR/portfolio.json"
md_has() { # description JS-regexp (against the markdown)
  if [ "$(printf '%s' "$P" | pick "new RegExp($2).test(j.markdown)")" = true ]; then pass "portfolio has: $1"; else fail "portfolio lacks: $1"; fi
}
md_has "the player's name in the title" "'^# Asha E04.s Redis Quest portfolio'"
md_has "the drawn level's title (cache-aside)" "'Cache-aside, version one'"
md_has "the drawn level's title (token bucket)" "'The OTP limiter, properly'"
md_has "a before/after p99 line for cache-aside from the stored metrics" "'Cache-aside, version one\\\\*\\\\* \\\\(example-code-01-cache-aside\\\\): p99 [0-9,.]+ ms to [0-9,.]+ ms'"
md_has "the interviews with what the interviewer drew" "'the interviewer drew \"Cache-aside, version one\" \\\\(example-code-01-cache-aside\\\\); rebuilt in [0-9]+:[0-9]{2} from a blank file'"
md_has "the workspace tree with a size" "'\`ch2/cache.js\` \\\\(23 bytes\\\\)'"
md_has "a closing section naming its levels" "'## What I would say in an interview[^#]*\\\\(example-code-01-cache-aside\\\\)'"
md_has "the brainstorm section" "'## How I thought about it'"
assert_eq "the page does not list backups or itself" "$(printf '%s' "$P" | pick '/before-|PORTFOLIO.md/.test(j.markdown)')" "false"
P99="$(printf '%s' "$P" | pick "(/p99 [0-9,.]+ ms to [0-9,.]+ ms/.exec(j.markdown) || [''])[0]")"
STORED="$(jget /api/progress | pick "(m => { const f = (n) => (n >= 100 ? Math.round(n).toLocaleString('en-US') : String(Math.round(n * 10) / 10)); return 'p99 ' + f(m.baselineP99Ms) + ' ms to ' + f(m.p99Ms) + ' ms'; })(j.levels['$CACHE_ID'].verdicts.find(v => v.verdict === 'right').metrics)")"
assert_eq "the page's p99 numbers are the stored ones (nothing invented)" "$P99" "$STORED"
assert_eq "stats" "$(printf '%s' "$P" | pick 'JSON.stringify([j.stats.player.name, j.stats.levelsPassed >= 4, j.stats.workspace.files >= 2, j.stats.interviews.length])')" '["Asha E04",true,true,3]'

say "portfolio: POST /api/portfolio/write writes workspace/PORTFOLIO.md and emits portfolio_written"
SINCE="$(date -u -v-5S +%Y-%m-%dT%H:%M:%S.000Z)"
W="$(jpost /api/portfolio/write)"
assert_eq "route answer" "$(printf '%s' "$W" | pick '[j.path, j.file, typeof j.bytes, typeof j.levels].join(" ")')" "workspace/PORTFOLIO.md PORTFOLIO.md number number"
assert_eq "file bytes on disk equal the answer" "$(wc -c < "$E04_WORKSPACE/PORTFOLIO.md" | tr -d ' ')" "$(printf '%s' "$W" | pick 'j.bytes')"
assert_eq "the file starts with the title" "$(head -1 "$E04_WORKSPACE/PORTFOLIO.md")" "# Asha E04's Redis Quest portfolio"
if grep -q 'p99 .* ms to .* ms' "$E04_WORKSPACE/PORTFOLIO.md"; then pass "the file has the p99 line"; else fail "the file lacks the p99 line"; fi
EV="$(jget "/api/events?since=$SINCE" | pick "j.events.filter(e => e.data && e.data.kind === 'custom' && e.data.name === 'portfolio_written').map(e => JSON.stringify(e.data.data)).join('|')")"
assert_eq "portfolio_written in GET /api/events" "$(printf '%s' "$EV" | pick 'typeof j.bytes + " " + typeof j.levels + " " + typeof j.passed' 2>/dev/null)" "number number number"
echo "      event data: $EV"
assert_eq "a second write is stable (the page does not list itself)" "$(jget /api/portfolio | pick 'j.markdown' | grep -c 'PORTFOLIO.md')" "0"

say "the harness grades (c) $C_ID: portfolio_written, right when the story is written, wrong when not"
grade story story "$C_ID"; rc=$?
assert_eq "(c): grade exit code" "$rc" "0"
assert_eq "(c) rows (declared/engine/result)" "$(rowsof story $C_ID)" "right/right/PASS wrong/wrong/PASS"
assert_eq "(c) the good row says the harness wrote the story" "$(node -e "const j=JSON.parse(require('fs').readFileSync('$CHECK_DIR/story.json','utf8'));console.log(j.rows.filter(r=>r.declared==='right').every(r=>r.note.includes('UI wrote the story (POST /api/portfolio/write -> 200')))")" "true"
assert_eq "(c) the wrong row did not" "$(node -e "const j=JSON.parse(require('fs').readFileSync('$CHECK_DIR/story.json','utf8'));console.log(j.rows.filter(r=>r.declared==='wrong').every(r=>!r.note.includes('wrote the story')))")" "true"

say "regression, once more: example-code after everything above"
grade example-code2 ex-code2 "$E04_LEVELS/example-code"; rc=$?
assert_eq "example-code: grade exit code" "$rc" "0"
assert_eq "example-code: MISMATCH rows" "$(mismatches ex-code2)" "0"

finish
