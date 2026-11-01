#!/usr/bin/env bash
# G-01 check: the level grading harness (scripts/grade/) plays every declared solution of the example levels,
# Chapter 0, Chapter 1 and Chapter 2 through the real engine and every graded solution must get the verdict
# its level declares. Runs in its own compose project (quest-g01, .env.g01: ports 3500/6395/5437/5545, no
# insight) with scratch workspace, logs, progress and a scratch copy of the levels under logs/.g-01-check, so
# it never touches another project and never reads a level file another agent is mid-edit on.
# Mismatches that are known content bugs are printed as CONTENT-BUG lines (scripts/grade/known-content-bugs.tsv);
# any mismatch, known or not, makes the check exit 1. bash 3.2 compatible.
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1

PROJECT=quest-g01
ENV_FILE=.env.g01
OVERRIDE=scripts/grade/compose.g01.yaml
CHECK_DIR="$ROOT/logs/.g-01-check"
BASE=http://127.0.0.1:3500
SERVICES="redis postgres engine app runner proxy"
FAILED=0

say() { printf '\n== %s\n' "$*"; }
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILED=1; }
dc() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.yml -f "$OVERRIDE" "$@"; }

# Project env: copy .env.p09 if present, else .env.example; then pin this project's ports and ENGINE_DEV=1
# (the grader unlocks levels through POST /api/levels/:id/complete, which needs it).
setvar() { grep -v "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null; printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE.tmp"; mv "$ENV_FILE.tmp" "$ENV_FILE"; }
if [ ! -f "$ENV_FILE" ]; then
  if [ -f .env.p09 ]; then cp .env.p09 "$ENV_FILE"; else cp .env.example "$ENV_FILE"; fi
  echo "created $ENV_FILE (gitignored)"
fi
setvar PROXY_PORT 3500
setvar REDIS_PORT 6395
setvar PG_PORT 5437
setvar INSIGHT_PORT 5545
setvar ENGINE_DEV 1

export G01_WORKSPACE="$CHECK_DIR/workspace" G01_LOGS="$CHECK_DIR/logs" G01_PROGRESS="$CHECK_DIR/progress" G01_LEVELS="$CHECK_DIR/levels"

cleanup() {
  say "cleanup"
  dc down -v --remove-orphans >/dev/null 2>&1 && echo "docker compose -p $PROJECT down -v: done"
  rm -rf "$CHECK_DIR" && echo "removed scratch dir logs/.g-01-check (workspace copies included)"
}
trap cleanup EXIT

wait_engine() {
  i=0
  while [ $i -lt 120 ]; do
    h="$(curl -s -m 2 "$BASE/health" || true)"
    case "$h" in *'"redis":"up"'*'"postgres":"up"'*) echo "$h"; return 0 ;; esac
    sleep 2; i=$((i + 1))
  done
  echo "last health: ${h:-none}"
  return 1
}

say "docker, pnpm install --frozen-lockfile, build @quest/shared, lint the tool"
if docker info >/dev/null 2>&1; then pass "docker is running"; else fail "docker is not running"; exit 1; fi
if pnpm install --frozen-lockfile >/dev/null 2>&1; then pass "lockfile matches"; else fail "pnpm install --frozen-lockfile"; exit 1; fi
n=0
until pnpm --filter @quest/shared build >/dev/null 2>&1; do
  n=$((n + 1)); [ $n -ge 3 ] && { fail "pnpm --filter @quest/shared build"; pnpm --filter @quest/shared build 2>&1 | tail -20; exit 1; }
  sleep 5
done
pass "@quest/shared built"
if bash -n scripts/grade/grade.sh && bash -n scripts/check/G-01.sh && node --check scripts/grade/grade.mjs; then pass "grade.sh, G-01.sh and grade.mjs parse"; else fail "syntax"; exit 1; fi

say "scratch levels: levels/_examples/example-{cli,code,decision,ops}, ch0-boot, ch1-keyspace, ch2-everyone-showed-up, ch3-compete-and-talk, ch4-work-in-the-background, ch4b-on-call"
rm -rf "$CHECK_DIR"
mkdir -p "$G01_WORKSPACE" "$G01_LOGS" "$G01_PROGRESS" "$G01_LEVELS"
for d in example-cli example-code example-decision example-ops; do cp -R "levels/_examples/$d" "$G01_LEVELS/"; done
for d in ch0-boot ch1-keyspace ch2-everyone-showed-up ch3-compete-and-talk ch4-work-in-the-background ch4b-on-call; do [ -d "levels/$d" ] || continue; cp -R "levels/$d" "$G01_LEVELS/"; done
v="$(node packages/shared/dist/levels/cli.js "$G01_LEVELS" 2>&1)"
if [ $? -eq 0 ]; then pass "scratch levels valid: $v"; else fail "scratch levels invalid"; printf '%s\n' "$v"; exit 1; fi

say "docker compose -p $PROJECT build (image quest-g01-node, shared build: retried), up -d $SERVICES"
dc down -v --remove-orphans >/dev/null 2>&1
n=0
until dc build engine >"$CHECK_DIR/build.log" 2>&1; do
  n=$((n + 1))
  if [ $n -ge 3 ]; then fail "docker build failed 3 times"; tail -30 "$CHECK_DIR/build.log"; exit 1; fi
  echo "build attempt $n failed, retrying"; tail -5 "$CHECK_DIR/build.log"; sleep 10
done
pass "image built"
# shellcheck disable=SC2086
if dc up -d --no-build $SERVICES 2>&1 | grep -vE '^ *#|^$' | tail -12; then :; fi
if h="$(wait_engine)"; then pass "engine healthy through the proxy on 3500: $h"; else fail "engine not healthy: $h"; dc logs --tail 40 engine; exit 1; fi
case "$h" in *'"levels":"ok"'*) pass "engine loaded the levels (levels ok, not levels_invalid)" ;; *) fail "engine reports levels invalid: $h"; exit 1 ;; esac

say "is the app serving? (traffic levels need it)"
TRAFFIC=0
i=0
while [ $i -lt 40 ]; do
  a="$(curl -s -m 2 "$BASE/app/health" || true)"
  case "$a" in *'"service":"app"'*) TRAFFIC=1; break ;; esac
  sleep 2; i=$((i + 1))
done
if [ "$TRAFFIC" = 1 ]; then pass "app healthy: $a"; else fail "app did not answer /app/health (last: ${a:-none}); traffic levels cannot be graded"; exit 1; fi

say "grade: examples, ch0, ch1, ch2, ch3, ch4, ch4b (traffic levels take minutes; progress lines follow)"
JSONS=""
grade() {
  name="$1"; shift
  printf '\n----- %s -----\n' "$name"
  scripts/grade/grade.sh --engine "$BASE" --json "$CHECK_DIR/$name.json" "$@"
  rc=$?
  case $rc in
    0) pass "$name: every graded solution matches its declaration" ;;
    1) fail "$name: mismatches (listed above and at the end)" ;;
    *) fail "$name: the grading tool could not run (exit $rc)" ;;
  esac
  [ -f "$CHECK_DIR/$name.json" ] && JSONS="$JSONS $CHECK_DIR/$name.json"
}
grade examples "$G01_LEVELS/example-cli" "$G01_LEVELS/example-code" "$G01_LEVELS/example-decision" "$G01_LEVELS/example-ops"
grade ch0 "$G01_LEVELS/ch0-boot"
grade ch1 "$G01_LEVELS/ch1-keyspace"
grade ch2 "$G01_LEVELS/ch2-everyone-showed-up"
[ -d "$G01_LEVELS/ch3-compete-and-talk" ] && grade ch3 "$G01_LEVELS/ch3-compete-and-talk"
[ -d "$G01_LEVELS/ch4-work-in-the-background" ] && grade ch4 "$G01_LEVELS/ch4-work-in-the-background"
[ -d "$G01_LEVELS/ch4b-on-call" ] && grade ch4b "$G01_LEVELS/ch4b-on-call"

say "summary per chapter, and every mismatch"
# shellcheck disable=SC2086
KNOWN="$ROOT/scripts/grade/known-content-bugs.tsv" node - $JSONS <<'EOF'
const fs = require('fs');
const known = new Map();
if (fs.existsSync(process.env.KNOWN)) {
  for (const l of fs.readFileSync(process.env.KNOWN, 'utf8').split('\n')) {
    if (!l.trim() || l.startsWith('#')) continue;
    const [lvl, sol, ...note] = l.split('\t');
    known.set(`${lvl}|${sol}`, note.join(' '));
  }
}
let unexpected = 0, bugs = 0;
const tot = { PASS: 0, MISMATCH: 0, SKIPPED: 0 };
for (const f of process.argv.slice(2)) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const [ch, c] of Object.entries(j.summary)) {
    console.log(`${ch.padEnd(24)} PASS ${c.PASS}  MISMATCH ${c.MISMATCH}  SKIPPED ${c.SKIPPED}`);
    for (const k of Object.keys(tot)) tot[k] += c[k];
  }
  for (const r of j.rows.filter((x) => x.result === 'MISMATCH')) {
    const k = known.get(`${r.level}|${r.solution}`);
    const fb = r.feedback.filter((x) => x.tag !== 'ok' && x.tag !== 'skip').map((x) => `#${x.index} ${x.type}: ${x.message.replace(/\n/g, ' | ')}`).join(' || ');
    if (k !== undefined) {
      bugs++;
      console.log(`CONTENT-BUG ${r.level} ${r.solution}: declared ${r.declared}, engine ${r.engine}\n    why: ${k}\n    engine feedback: ${fb || '(none: every check passed)'}`);
    } else {
      unexpected++;
      console.log(`MISMATCH ${r.level} ${r.solution}: declared ${r.declared}, engine ${r.engine}\n    engine feedback: ${fb || '(none: every check passed)'}`);
    }
  }
}
console.log(`\ntotals: PASS ${tot.PASS}  MISMATCH ${tot.MISMATCH} (${bugs} listed content bugs, ${unexpected} unexplained)  SKIPPED ${tot.SKIPPED}`);
if (tot.MISMATCH > 0 && unexpected === 0) console.log('every mismatch is a listed content bug (scripts/grade/known-content-bugs.tsv); the check still fails until they are fixed');
EOF

if [ $FAILED -eq 0 ]; then echo; echo "G-01 OK"; exit 0; fi
echo; echo "G-01 FAILED"; exit 1
