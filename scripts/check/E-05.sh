#!/usr/bin/env bash
# E-05 check: follow-up questions on every interview level, and ops levels graded by the harness.
#   1. shared and engine unit tests, lints, format (whole repo), levels:validate over the real tree (8 chapters, 96
#      levels) after the first-line edits of the ops .sh solutions (the check proves they touch the first lines only)
#   2. a real stack (compose project quest-e05, .env.e05, the G-01 override with the profile ports removed) with scratch
#      levels: example-cli, example-code, example-ops and the scratch chapter scratch-e05 (an interview level with two
#      `questions`, and two ops levels graded by a real `docker compose up -d --scale app=2 app`)
#   3. WITHOUT --run-ops: example-cli, example-code, example-ops and the interview with questions grade exactly as before
#      (no MISMATCH; ops rows SKIPPED); the questions are in GET /api/levels/:id after the level's own verifier and decide
#      the verdict through the engine
#   4. WITH --run-ops and the exported compose environment: example-ops (reference and the wrong `down -v`), and the scale
#      levels graded by their own .sh (a real second instance, nothing faked), the app back to one instance after, and the
#      default project (redis-quest) untouched
#   5. G-01.sh has the run-ops mode (bash -n and a grep for its exports)
# bash 3.2 compatible. Never starts, stops or downs the default project or any other quest-* project.
# E05_ALLOW_FORMAT_FILES="path path": other agents' in-flight files that may fail `pnpm format:check` (printed as WARN).
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1

PROJECT=quest-e05
ENV_FILE=.env.e05
CHECK_DIR="$ROOT/logs/.e-05-check"
OVERRIDE="$CHECK_DIR/compose.e05.yaml"
BASE=http://127.0.0.1:3650
SERVICES="redis postgres engine app runner proxy"
CLI="packages/shared/dist/levels/cli.js"
FIX="engine/test/fixtures/scratch-e05"
FAILED=0

say() { printf '\n== %s\n' "$*"; }
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILED=1; }
warn() { printf 'WARN  %s\n' "$*"; }
dc() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.yml -f "$OVERRIDE" "$@"; }

setvar() { grep -v "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null; printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE.tmp"; mv "$ENV_FILE.tmp" "$ENV_FILE"; }

export G01_WORKSPACE="$CHECK_DIR/workspace" G01_LOGS="$CHECK_DIR/logs" G01_PROGRESS="$CHECK_DIR/progress" G01_LEVELS="$CHECK_DIR/levels"

cleanup() {
  say "cleanup"
  if [ -f "$OVERRIDE" ]; then
    dc --profile '*' down -v --remove-orphans >/dev/null 2>&1 && echo "docker compose -p $PROJECT down -v: done"
  fi
  rm -rf "$CHECK_DIR" && echo "removed scratch dir logs/.e-05-check"
  if [ "$FAILED" -eq 0 ]; then printf '\nE-05 OK\n'; else printf '\nE-05 FAILED\n'; fi
}
trap cleanup EXIT
finish() { exit "$FAILED"; }
die() { fail "$1"; finish; }

rm -rf "$CHECK_DIR"
mkdir -p "$CHECK_DIR" "$G01_WORKSPACE" "$G01_LOGS" "$G01_PROGRESS" "$G01_LEVELS"

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
jpost() { curl -s -m 120 -X POST -H 'content-type: application/json' -d "${2:-$EMPTY}" "$BASE$1"; }
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
wait_app() {
  i=0
  while [ $i -lt 40 ]; do
    a="$(curl -s -m 2 "$BASE/app/health" || true)"
    case "$a" in *'"service":"app"'*) echo "$a"; return 0 ;; esac
    sleep 2; i=$((i + 1))
  done
  echo "$a"; return 1
}

# ---- 1. unit tests, lints, format, validate ---------------------------------------------------------------------
say "pnpm install --frozen-lockfile, builds"
if pnpm install --frozen-lockfile >/dev/null 2>&1; then pass "lockfile matches"; else die "pnpm install --frozen-lockfile"; fi
for pkg in shared engine; do
  if B="$(pnpm --filter "@quest/$pkg" build 2>&1)"; then pass "pnpm --filter @quest/$pkg build"; else printf '%s\n' "$B" | tail -25; die "$pkg build"; fi
done
if bash -n scripts/check/E-05.sh && bash -n scripts/check/G-01.sh && bash -n scripts/grade/grade.sh && node --check scripts/grade/grade.mjs; then pass "E-05.sh, G-01.sh, grade.sh and grade.mjs parse"; else die "syntax"; fi
BADSH=0
for f in $(find levels -name '*.sh' -path '*/solutions/*' | sort); do bash -n "$f" || { BADSH=1; echo "      syntax error in $f"; }; done
[ "$BADSH" -eq 0 ] && pass "every ops .sh solution under levels/*/solutions parses ($(find levels -name '*.sh' -path '*/solutions/*' | wc -l | tr -d ' ') files)" || fail "an ops .sh solution has a syntax error"

say "unit tests: shared (schema, loader), engine (questions payload and grading)"
for pkg in shared engine; do
  if T="$(pnpm --filter "@quest/$pkg" test 2>&1)"; then
    pass "$pkg vitest: $(printf '%s\n' "$T" | grep -E '^ +Tests ' | sed 's/^ *//')"
  else printf '%s\n' "$T" | tail -40; fail "$pkg vitest"; fi
done
for f in packages/shared/src/levels/__tests__/questions.test.ts engine/test/questions.test.ts "$FIX/chapter.yaml"; do
  [ -f "$f" ] && pass "present: $f" || fail "missing: $f"
done

say "lint and format (the whole repo)"
if L="$(pnpm lint 2>&1)"; then pass "pnpm lint (every package)"; else printf '%s\n' "$L" | tail -30; fail "pnpm lint"; fi
if F="$(pnpm format:check 2>&1)"; then
  pass "pnpm format:check (whole repo)"
else
  BAD="$(printf '%s\n' "$F" | grep '^\[warn\] ' | grep -v 'Code style issues' | sed 's/^\[warn\] //')"
  UNEXPECTED=""
  for f in $BAD; do
    case " ${E05_ALLOW_FORMAT_FILES:-} " in *" $f "*) warn "format: $f (another agent's in-flight file, allowed by E05_ALLOW_FORMAT_FILES)" ;; *) UNEXPECTED="$UNEXPECTED $f" ;; esac
  done
  if [ -z "$UNEXPECTED" ] && [ -n "$BAD" ]; then pass "pnpm format:check (whole repo) except the in-flight files named above"; else printf '%s\n' "$F" | tail -20; fail "pnpm format:check:$UNEXPECTED"; fi
fi

say "levels:validate: the real tree after the .sh first-line edits"
if O="$(node "$CLI" levels 2>&1)"; then
  assert_eq "levels:validate levels" "$O" "levels:validate: OK (8 chapter(s), 96 level(s))"
else printf '%s\n' "$O"; fail "levels:validate levels"; fi
# The only changes to the ops .sh files are in their first lines (the API= line, or the finale's cd line).
SHDIFF="$(git diff -U0 HEAD -- 'levels/*/solutions/*.sh' | awk '/^@@/ { split($2, a, ","); sub(/^-/, "", a[1]); if (a[1] + 0 > 8) print "hunk at line " a[1] }')"
if [ -z "$SHDIFF" ]; then pass "every edit to a levels/*/solutions/*.sh file is within its first 8 lines"; else printf '%s\n' "$SHDIFF"; fail "an .sh solution was edited below its first lines"; fi
SHCHANGED="$(git diff --name-only HEAD -- 'levels/*/solutions/*.sh' | tr '\n' ' ')"
echo "      .sh files changed vs HEAD: $SHCHANGED"
if git diff HEAD -- 'levels/*/solutions/*.sh' | grep '^[-+]' | grep -v '^+++\|^---' | grep -vE 'API=|QUEST_API|QUEST_OPS_ROOT' >/dev/null; then
  git diff HEAD -- 'levels/*/solutions/*.sh' | grep '^[-+]' | grep -v '^+++\|^---'; fail "an .sh solution changed in a way that is not the API= / QUEST_OPS_ROOT first lines"
else pass "the .sh changes are only the API= line (QUEST_API first) and the finale's QUEST_OPS_ROOT lines"; fi
for f in levels/ch5-survive/solutions/01-reference.sh levels/ch5-survive/solutions/08-wrong-one-sentinel.sh; do
  grep -q 'API="${QUEST_API:-${API:-http://localhost:3000}}"' "$f" && pass "$f honours QUEST_API (and still API)" || fail "$f does not honour QUEST_API"
done

say "the finale's scripts cd into QUEST_OPS_ROOT: the grading stack's workspace, never the learner's"
FW="$CHECK_DIR/finale-ws"; FR="$CHECK_DIR/finale-root"
mkdir -p "$FW" "$FR"; echo "a file in the grading workspace" > "$FW/a.txt"; ln -s "$FW" "$FR/workspace"
REAL_WS_BEFORE="$(ls -a "$ROOT/workspace" 2>/dev/null | tr '\n' ' ')"
( cd "$CHECK_DIR" && QUEST_OPS_ROOT="$FR" GIT_AUTHOR_NAME=g GIT_AUTHOR_EMAIL=g@x.invalid GIT_COMMITTER_NAME=g GIT_COMMITTER_EMAIL=g@x.invalid \
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false bash "$ROOT/levels/finale/solutions/07-wrong-no-page.sh" >"$CHECK_DIR/finale-run.log" 2>&1 )
assert_eq "finale 07 wrong: the scratch workspace became a repository with one commit" "$([ -d "$FW/.git" ] && git -C "$FW" log --oneline 2>/dev/null | wc -l | tr -d ' ')" "1"
assert_eq "finale 07 wrong: the learner's own workspace/ is unchanged" "$(ls -a "$ROOT/workspace" 2>/dev/null | tr '\n' ' ')" "$REAL_WS_BEFORE"

say "G-01.sh: the run-ops mode (a dry run takes too long; syntax and exports only)"
for pat in 'G01_RUN_OPS' 'export COMPOSE_PROJECT_NAME="$PROJECT"' 'export COMPOSE_FILE=' 'export COMPOSE_ENV_FILES="$ENV_FILE"' 'export QUEST_API="$BASE"' 'PROXY_PORT=3500' 'RUN_OPS_ARG="--run-ops"' 'G-01 mode: RUN-OPS' 'G-01 mode: default'; do
  grep -qF -- "$pat" scripts/check/G-01.sh && pass "G-01.sh has: $pat" || fail "G-01.sh lacks: $pat"
done
grep -qF -- '$RUN_OPS_ARG --json' scripts/check/G-01.sh && pass "G-01.sh passes \$RUN_OPS_ARG to every grade call" || fail "G-01.sh does not pass --run-ops to the tool"
G01_RUN_OPS=1 bash -c 'set -u; G01_RUN_OPS="${G01_RUN_OPS:-0}"; [ "$G01_RUN_OPS" = 1 ]' && pass "G01_RUN_OPS=1 selects the mode (default is 0: the full local run stays as it was)"
grep -q 'ports: !reset \[\]' scripts/grade/compose.g01.yaml && pass "compose.g01.yaml removes the profile services' host ports"
for n in redis-replica sentinel-1 sentinel-2 sentinel-3 redis-c1 redis-c2 redis-c3 redis-c4 redis-c5 redis-c6; do
  grep -A1 "^  $n:" scripts/grade/compose.g01.yaml | grep -q 'ports: !reset' || fail "compose.g01.yaml keeps host ports of $n"
done

# ---- 2. the stack -------------------------------------------------------------------------------------------------
say "scratch levels (example-cli, example-code, example-ops, scratch-e05), save, workspace; stack settings ($ENV_FILE, project $PROJECT)"
for d in example-cli example-code example-ops; do cp -R "levels/_examples/$d" "$G01_LEVELS/$d"; done
cp -R "$FIX" "$G01_LEVELS/scratch-e05"
O="$(node "$CLI" "$G01_LEVELS" 2>&1)" && pass "scratch levels valid: $O" || { printf '%s\n' "$O"; die "scratch levels invalid"; }

IV_ID=scratch-e05-01-cache-aside-questions
SC_ID=scratch-e05-02-scale-two
ST_ID=scratch-e05-03-stay-two
OPS_ID=example-ops-01-roommate-ran-down
mkdir -p "$G01_WORKSPACE/ch2"

cp .env.example "$ENV_FILE"
setvar PROXY_PORT 3650
setvar REDIS_PORT 6385
setvar PG_PORT 5443
setvar INSIGHT_PORT 5551
setvar ENGINE_DEV 1
pass "wrote $ENV_FILE (gitignored): PROXY_PORT=3650 REDIS_PORT=6385 PG_PORT=5443 INSIGHT_PORT=5551 ENGINE_DEV=1"

# The G-01 override (own image tag, scratch dirs through G01_*, event waits capped, profile ports removed), image tag renamed.
sed -e 's/quest-g01-node/quest-e05-node/g' -e 's/^# Compose override for scripts\/check\/G-01.sh only (project quest-g01)\./# Generated by scripts\/check\/E-05.sh from scripts\/grade\/compose.g01.yaml (project quest-e05)./' scripts/grade/compose.g01.yaml > "$OVERRIDE"
grep -q 'quest-e05-node' "$OVERRIDE" && pass "override generated from scripts/grade/compose.g01.yaml (image quest-e05-node, G01_* scratch dirs)" || die "override generation"

say "docker compose -p $PROJECT build (image quest-e05-node, retried), up -d $SERVICES"
for p in 3650 6385 5443 5551; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then die "port $p is already in use by something that is not the $PROJECT stack"; fi
done
# Snapshot of the default project, to prove the .sh solutions never touched it.
default_snapshot() { docker ps -a --filter label=com.docker.compose.project=redis-quest --format '{{.ID}} {{.State}}' 2>/dev/null | sort | tr '\n' '|'; }
DEFAULT_BEFORE="$(default_snapshot)"
echo "      default project redis-quest containers before: ${DEFAULT_BEFORE:-none}"
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
if h="$(wait_engine)"; then pass "engine healthy through the proxy on 3650 with the scratch levels loaded: $h"; else dc logs --tail 40 engine; die "engine not healthy: $h"; fi
if a="$(wait_app)"; then pass "app healthy: $a"; else die "app did not answer /app/health"; fi
assert_eq "app instances at the start" "$(dc ps -q app | wc -l | tr -d ' ')" "1"

grade() { # name json-name target...   (no run-ops, no compose environment)
  name="$1"; jname="$2"; shift 2
  scripts/grade/grade.sh --engine "$BASE" --levels "$G01_LEVELS" --json "$CHECK_DIR/$jname.json" "$@" 2>&1 \
    | tee "$CHECK_DIR/$jname.out" | grep -E '^ *[0-9]+s +(PASS|MISMATCH|SKIPPED|NOTE|####|==|running|ran with|app had|engine /health)' | sed 's/^ *[0-9]*s  /      /' | cut -c1-260
  return "${PIPESTATUS[0]}"
}
grade_ops() { # name json-name target...   (--run-ops and the exported compose environment: what G01_RUN_OPS=1 gives)
  name="$1"; jname="$2"; shift 2
  env COMPOSE_PROJECT_NAME="$PROJECT" COMPOSE_FILE="docker-compose.yml:$OVERRIDE" COMPOSE_ENV_FILES="$ENV_FILE" \
    QUEST_API="$BASE" PROXY_PORT=3650 REDIS_PORT=6385 PG_PORT=5443 INSIGHT_PORT=5551 E05_EVIDENCE="$CHECK_DIR/evidence" \
    scripts/grade/grade.sh --engine "$BASE" --levels "$G01_LEVELS" --run-ops --json "$CHECK_DIR/$jname.json" "$@" 2>&1 \
    | tee "$CHECK_DIR/$jname.out" | grep -E '^ *[0-9]+s +(PASS|MISMATCH|SKIPPED|NOTE|####|==|running|ran with|app had|engine /health)|^ +\.\.\.|stack had been' | sed 's/^ *[0-9]*s  /      /' | cut -c1-300
  return "${PIPESTATUS[0]}"
}
mismatches() { node -e "const j=JSON.parse(require('fs').readFileSync('$CHECK_DIR/$1.json','utf8'));console.log(j.rows.filter(r=>r.result==='MISMATCH').length)"; }
rowsof() { node -e "const j=JSON.parse(require('fs').readFileSync('$CHECK_DIR/$1.json','utf8'));console.log(j.rows.filter(r=>r.level==='$2').map(r=>r.declared+'/'+r.engine+'/'+r.result).join(' '))"; }
notes_of() { node -e "const j=JSON.parse(require('fs').readFileSync('$CHECK_DIR/$1.json','utf8'));console.log(j.rows.filter(r=>r.level==='$2'&&r.declared==='$3').map(r=>r.note).join(' || '))"; }

# ---- 3. without --run-ops: nothing changes -------------------------------------------------------------------------
say "regression, no --run-ops: example-cli, example-code and example-ops grade exactly as before"
grade examples ex-all "$G01_LEVELS/example-cli" "$G01_LEVELS/example-code" "$G01_LEVELS/example-ops"; rc=$?
assert_eq "examples: grade exit code" "$rc" "0"
assert_eq "examples: MISMATCH rows" "$(mismatches ex-all)" "0"
assert_eq "example-cli-01 rows" "$(rowsof ex-all example-cli-01-hostel-scoreboard)" "right/right/PASS wrong/wrong/PASS works_but_wrong/works_but_wrong/PASS"
assert_eq "example-code-01 rows" "$(rowsof ex-all example-code-01-cache-aside)" "right/right/PASS wrong/wrong/PASS works_but_wrong/works_but_wrong/PASS"
assert_eq "example-code-02 rows" "$(rowsof ex-all example-code-02-token-bucket)" "right/right/PASS wrong/wrong/PASS works_but_wrong/works_but_wrong/PASS"
assert_eq "example-ops rows: skipped as before (ops shell), not run" "$(rowsof ex-all $OPS_ID)" "right/-/SKIPPED wrong/-/SKIPPED"
assert_eq "...with the same note" "$(notes_of ex-all $OPS_ID right)" "SKIPPED (ops shell)"
assert_eq "the stack was not restarted by the examples: engine boots" "$(jget /health | pick 'j.boots')" "1"
assert_eq "app instances still 1" "$(dc ps -q app | wc -l | tr -d ' ')" "1"

say "the interview level with follow-up questions: the payload"
V="$(jget "/api/levels/$IV_ID")"
assert_eq "verifiers: the level's own first, then the two questions" "$(printf '%s' "$V" | pick 'j.verifiers.map(v => v.index + ":" + v.type).join(",")')" "0:behavior,1:quiz,2:quiz"
assert_eq "interview.questionsFrom" "$(printf '%s' "$V" | pick 'j.interview.questionsFrom')" "1"
assert_eq "interview.pool / rebuildOf" "$(printf '%s' "$V" | pick 'JSON.stringify([j.interview.pool, j.interview.rebuildOf.id])')" '[false,"example-code-01-cache-aside"]'
assert_eq "question 1 text" "$(printf '%s' "$V" | pick 'j.verifiers[1].question')" "Why does the cached stats hash get a TTL (one)?"
assert_eq "question 2 options" "$(printf '%s' "$V" | pick 'j.verifiers[2].options.map(o => o.id).join(",")')" "hset-and-expire,get-and-set,ttl-and-type"
assert_eq "no answer leaks into the payload" "$(printf '%s' "$V" | pick '/correct|explanation|stale-heals.*stale-heals/.test(JSON.stringify(j.verifiers))')" "false"
EX="$(jget "/api/levels/example-interview-01-cache-aside-rebuild")"
assert_eq "an interview level without questions: nothing extra" "$(printf '%s' "$EX" | pick 'j.verifiers === undefined ? "n/a" : String(j.interview.questionsFrom)')" "n/a"

say "the questions decide the verdict through the engine (the reference code in place, then every answer combination)"
cp "$FIX/solutions/01-reference.js" "$G01_WORKSPACE/ch2/cache.js"
sleep 3
jpost "/api/levels/$IV_ID/start" >/dev/null
sleep 2
v() { jpost "/api/levels/$IV_ID/verify" "$1"; }
R="$(v '{"answers":{"1":"stale-heals","2":"hset-and-expire"}}')"
assert_eq "both questions right: verdict" "$(printf '%s' "$R" | pick 'j.verdict')" "right"
assert_eq "checks: indices and types (the level's own check, then the questions)" "$(printf '%s' "$R" | pick 'j.checks.map(c => c.index + ":" + c.type + ":" + c.ok).join(",")')" "0:behavior:true,1:quiz:true,2:quiz:true"
R="$(v '{"answers":{"1":"ram-only","2":"hset-and-expire"}}')"
assert_eq "first question wrong: verdict" "$(printf '%s' "$R" | pick 'j.verdict')" "wrong"
assert_eq "...and only that check fails, with the code still fine" "$(printf '%s' "$R" | pick 'j.checks.map(c => c.ok).join(",")')" "true,false,true"
R="$(v '{"answers":{"1":"stale-heals"}}')"
assert_eq "second question unanswered: verdict" "$(printf '%s' "$R" | pick 'j.verdict')" "wrong"
printf '' > "$G01_WORKSPACE/ch2/cache.js"

say "the harness grades the interview with questions (no --run-ops): the questions are fed, right and wrong"
grade interview iv "$IV_ID"; rc=$?
assert_eq "interview: grade exit code" "$rc" "0"
assert_eq "interview: MISMATCH rows" "$(mismatches iv)" "0"
assert_eq "interview rows (declared/engine/result)" "$(rowsof iv $IV_ID)" "right/right/PASS wrong/wrong/PASS"
assert_eq "the notes say how many follow-up questions" "$(node -e "const j=JSON.parse(require('fs').readFileSync('$CHECK_DIR/iv.json','utf8'));console.log(j.rows.filter(r=>r.level==='$IV_ID').every(r=>r.note.includes('2 follow-up questions')))")" "true"
assert_eq "the reference row's verdict has all three checks ok" "$(node -e "const j=JSON.parse(require('fs').readFileSync('$CHECK_DIR/iv.json','utf8'));const r=j.rows.find(r=>r.level==='$IV_ID'&&r.declared==='right');console.log(r.feedback.map(f=>f.index+':'+f.type+':'+f.tag).join(','))")" "0:behavior:ok,1:quiz:ok,2:quiz:ok"
assert_eq "the wrong row fails the first follow-up question too (the harness answers it wrong)" "$(node -e "const j=JSON.parse(require('fs').readFileSync('$CHECK_DIR/iv.json','utf8'));const r=j.rows.find(r=>r.level==='$IV_ID'&&r.declared==='wrong');console.log(r.feedback.find(f=>f.index===1).tag)")" "fail"

# ---- 4. with --run-ops ---------------------------------------------------------------------------------------------
say "--run-ops, example-ops: the reference (down, up) and the wrong one (down -v): the harness waits for the engine"
grade_ops example-ops-run ops1 "$G01_LEVELS/example-ops"; rc=$?
assert_eq "example-ops under --run-ops: grade exit code" "$rc" "0"
assert_eq "example-ops rows (declared/engine/result)" "$(rowsof ops1 $OPS_ID)" "right/right/PASS wrong/wrong/PASS"
echo "      reference note: $(notes_of ops1 $OPS_ID right | cut -c1-400)"
echo "      wrong note:     $(notes_of ops1 $OPS_ID wrong | cut -c1-600)"
case "$(notes_of ops1 $OPS_ID wrong)" in *'engine /health'*'answered again after'*) pass "the wrong row says what happened to the engine (not answering after down -v, back after N s)";; *) fail "the wrong row's note does not say the engine came back";; esac
case "$(notes_of ops1 $OPS_ID right)" in *'ran with --run-ops, exit 0'*) pass "the reference row says it ran (exit 0)";; *) fail "the reference row's note: $(notes_of ops1 $OPS_ID right)";; esac
if h="$(wait_engine)"; then pass "engine healthy after the wrong solution: $h"; else die "engine did not come back: $h"; fi
assert_eq "the wrong solution really wiped the volumes (the engine boots counter restarted: the ops row for the wrong one failed on boots)" "$(node -e "const j=JSON.parse(require('fs').readFileSync('$CHECK_DIR/ops1.json','utf8'));const r=j.rows.find(r=>r.level==='$OPS_ID'&&r.declared==='wrong');console.log(r.feedback.some(f=>f.tag==='fail'))")" "true"
case "$(dc ps --format '{{.Project}}' 2>/dev/null | sort -u | tr '\n' ' ')" in "$PROJECT ") pass "docker compose ps in the grading environment lists only project $PROJECT";; *) fail "unexpected project list: $(dc ps --format '{{.Project}}' | sort -u | tr '\n' ' ')";; esac

say "--run-ops, the scale levels: a real second instance, nothing faked; the app back to one afterwards"
grade_ops scale-run ops2 "$G01_LEVELS/scratch-e05"; rc=$?
echo "      (the whole scratch chapter: the interview level as before, the two ops levels through their .sh solutions)"
assert_eq "scale levels under --run-ops: grade exit code" "$rc" "0"
assert_eq "$SC_ID rows (reference 2-then-1, wrong restart)" "$(rowsof ops2 $SC_ID)" "right/right/PASS wrong/wrong/PASS"
assert_eq "$ST_ID rows (reference 2 and stay, wrong restart)" "$(rowsof ops2 $ST_ID)" "right/right/PASS wrong/wrong/PASS"
assert_eq "the interview level in the same run-ops run still grades" "$(rowsof ops2 $IV_ID)" "right/right/PASS wrong/wrong/PASS"
N1="$(notes_of ops2 $SC_ID right)"; N2="$(notes_of ops2 $ST_ID right)"
echo "      $SC_ID reference note: $(printf '%s' "$N1" | cut -c1-500)"
echo "      $ST_ID reference note: $(printf '%s' "$N2" | cut -c1-500)"
case "$N1" in *'service_scaled: real'*) pass "$SC_ID: the note says service_scaled was real";; *) fail "$SC_ID: note lacks 'service_scaled: real'";; esac
case "$N1$N2" in *grader-instance-2*|*'fake pushes'*) fail "a fake instance was pushed under run-ops";; *) pass "no fake instance was pushed for a .sh solution (the rule: the harness fakes nothing when a .sh ran under --run-ops)";; esac
case "$N2" in *'app had 2 instance(s) after the script; scaled back to 1'*) pass "$ST_ID: the harness found two app instances after the script and scaled back to 1";; *) fail "$ST_ID: note lacks the scale-back line";; esac
# Evidence written by the scripts themselves: they acted on quest-e05 and saw a second app container.
EV="$CHECK_DIR/evidence"
assert_eq "$SC_ID script ran in project (its own compose project env)" "$(sed -n 1p "$EV" 2>/dev/null)" "project=$PROJECT"
assert_eq "$SC_ID: docker compose ps (inside the script) listed two app containers" "$(grep -c "^$PROJECT app " "$EV" 2>/dev/null)" "2"
assert_eq "$ST_ID: docker compose ps (inside the script) listed two app containers of $PROJECT" "$(grep -c "^$PROJECT app " "$EV.stay" 2>/dev/null)" "2"
assert_eq "no container of project redis-quest appears in that evidence" "$(cat "$EV" "$EV.stay" 2>/dev/null | grep -c '^redis-quest ')" "0"
assert_eq "app instances after the harness restored the stack (docker compose -p $PROJECT ps)" "$(dc ps -q app | wc -l | tr -d ' ')" "1"
if a="$(wait_app)"; then pass "app healthy after the scale-back: $a"; else fail "app not healthy: $a"; fi
assert_eq "service_scaled instances 2 was a real event of this stack" "$(jget '/api/events?since=2000-01-01T00:00:00.000Z' | pick "j.events.filter(e => e.data && e.data.kind === 'service_scaled' && e.data.data && e.data.data.instances === 2).length > 0")" "true"
DEFAULT_AFTER="$(default_snapshot)"
assert_eq "the default project redis-quest is untouched (containers and states)" "$DEFAULT_AFTER" "$DEFAULT_BEFORE"

say "regression, last: example-cli and example-code once more, without --run-ops, after everything above"
grade examples2 ex-all2 "$G01_LEVELS/example-cli" "$G01_LEVELS/example-code"; rc=$?
assert_eq "examples again: grade exit code" "$rc" "0"
assert_eq "examples again: MISMATCH rows" "$(mismatches ex-all2)" "0"

finish
