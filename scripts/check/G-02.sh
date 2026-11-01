#!/usr/bin/env bash
# G-02 check: the grading harness plays bundle solutions (several slots, one file) for ch2-07, 08, 12 and 13.
# Same startup as G-01.sh: compose project quest-g01, .env.g01, ENGINE_DEV=1, scratch workspace/levels under
# logs/.g-02-check. Never touches the default compose project. Content mismatches print as CONTENT-BUG and
# still exit 1. bash 3.2 compatible.
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1

PROJECT=quest-g01
ENV_FILE=.env.g01
OVERRIDE=scripts/grade/compose.g01.yaml
CHECK_DIR="$ROOT/logs/.g-02-check"
BASE=http://127.0.0.1:3500
SERVICES="redis postgres engine app runner proxy"
FAILED=0

say() { printf '\n== %s\n' "$*"; }
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILED=1; }
dc() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.yml -f "$OVERRIDE" "$@"; }

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
  rm -rf "$CHECK_DIR" && echo "removed scratch dir logs/.g-02-check"
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

say "docker, pnpm install --frozen-lockfile, build @quest/shared, parse"
if docker info >/dev/null 2>&1; then pass "docker is running"; else fail "docker is not running"; exit 1; fi
if pnpm install --frozen-lockfile >/dev/null 2>&1; then pass "lockfile matches"; else fail "pnpm install --frozen-lockfile"; exit 1; fi
n=0
until pnpm --filter @quest/shared build >/dev/null 2>&1; do
  n=$((n + 1)); [ $n -ge 3 ] && { fail "pnpm --filter @quest/shared build"; exit 1; }
  sleep 5
done
pass "@quest/shared built"
if bash -n scripts/grade/grade.sh && bash -n scripts/check/G-02.sh && node --check scripts/grade/grade.mjs; then pass "grade.sh, G-02.sh and grade.mjs parse"; else fail "syntax"; exit 1; fi

say "scratch levels: ch0-boot, ch1-keyspace, ch2-everyone-showed-up (earlier levels unlock the graded ones)"
rm -rf "$CHECK_DIR"
mkdir -p "$G01_WORKSPACE" "$G01_LOGS" "$G01_PROGRESS" "$G01_LEVELS"
for d in ch0-boot ch1-keyspace ch2-everyone-showed-up; do cp -R "levels/$d" "$G01_LEVELS/"; done
v="$(node packages/shared/dist/levels/cli.js "$G01_LEVELS" 2>&1)"
if [ $? -eq 0 ]; then pass "scratch levels valid: $v"; else fail "scratch levels invalid"; printf '%s\n' "$v"; exit 1; fi

say "docker compose -p $PROJECT build, up -d $SERVICES"
dc down -v --remove-orphans >/dev/null 2>&1
n=0
until dc build engine >"$CHECK_DIR/build.log" 2>&1; do
  n=$((n + 1))
  if [ $n -ge 3 ]; then fail "docker build failed 3 times"; tail -30 "$CHECK_DIR/build.log"; exit 1; fi
  echo "build attempt $n failed, retrying"; sleep 10
done
pass "image built"
# shellcheck disable=SC2086
dc up -d --no-build $SERVICES 2>&1 | grep -vE '^ *#|^$' | tail -12
if h="$(wait_engine)"; then pass "engine healthy on 3500: $h"; else fail "engine not healthy: $h"; dc logs --tail 40 engine; exit 1; fi
case "$h" in *'"levels":"ok"'*) pass "engine loaded the levels" ;; *) fail "levels invalid: $h"; exit 1 ;; esac

TRAFFIC=0
i=0
while [ $i -lt 40 ]; do
  a="$(curl -s -m 2 "$BASE/app/health" || true)"
  case "$a" in *'"service":"app"'*) TRAFFIC=1; break ;; esac
  sleep 2; i=$((i + 1))
done
if [ "$TRAFFIC" = 1 ]; then pass "app healthy: $a"; else fail "app did not answer /app/health"; exit 1; fi

say "grade ch2-07, ch2-08, ch2-12, ch2-13 (bundle solutions)"
scripts/grade/grade.sh --engine "$BASE" --levels "$G01_LEVELS" --json "$CHECK_DIR/g02.json" \
  ch2-07-fixtures-must-never-miss ch2-08-otp-login-properly ch2-12-interview-prefetch ch2-13-interview-session-store
rc=$?
case $rc in
  0) pass "every graded solution matches its declaration" ;;
  1) fail "mismatches (see the table above)" ;;
  *) fail "the grading tool could not run (exit $rc)" ;;
esac

say "content bugs"
node - "$CHECK_DIR/g02.json" <<'JS'
const fs = require('fs');
const f = process.argv[2];
if (!fs.existsSync(f)) process.exit(0);
const j = JSON.parse(fs.readFileSync(f, 'utf8'));
let skipped = 0;
for (const r of j.rows) {
  if (r.result === 'SKIPPED') skipped++;
  if (r.result !== 'MISMATCH') continue;
  const fb = r.feedback.filter((x) => x.tag !== 'ok' && x.tag !== 'skip').map((x) => `#${x.index} ${x.type}: ${x.message.replace(/\n/g, ' | ')}`).join(' || ');
  console.log(`CONTENT-BUG ${r.level} ${r.solution}: declared ${r.declared}, engine ${r.engine}\n    engine feedback: ${fb || '(none)'}`);
}
console.log(`rows ${j.rows.length}, skipped ${skipped}`);
if (skipped) console.log('FAIL: some solutions were skipped (the harness should grade all of them)');
process.exit(skipped ? 3 : 0);
JS
[ $? -eq 3 ] && FAILED=1

if [ $FAILED -eq 0 ]; then echo; echo "G-02 OK"; exit 0; fi
echo; echo "G-02 FAILED"; exit 1
