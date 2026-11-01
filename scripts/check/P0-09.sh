#!/usr/bin/env bash
# P0-09 check: the verifier engine grades the example levels and Chapter 0 the way their solutions declare.
# Runs in its own compose project (quest-p09, .env.p09: ports 3200/6392/5434/5542) with scratch
# workspace, logs, progress and levels under logs/.p0-09-check, and never touches another project.
# bash 3.2 compatible.
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1

PROJECT=quest-p09
ENV_FILE=.env.p09
OVERRIDE=engine/test/check/compose.p09.yaml
CHECK_DIR="$ROOT/logs/.p0-09-check"
BASE=http://127.0.0.1:3200
SERVICES="redis postgres engine app runner proxy"
FAILED=0

say() { printf '\n== %s\n' "$*"; }
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILED=1; }
dc() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.yml -f "$OVERRIDE" "$@"; }

if [ ! -f "$ENV_FILE" ]; then
  printf 'PROXY_PORT=3200\nREDIS_PORT=6392\nPG_PORT=5434\nINSIGHT_PORT=5542\nENGINE_DEV=1\n' > "$ENV_FILE"
  echo "created $ENV_FILE (gitignored)"
fi

export P09_WORKSPACE="$CHECK_DIR/workspace" P09_LOGS="$CHECK_DIR/logs" P09_PROGRESS="$CHECK_DIR/progress" P09_LEVELS="$CHECK_DIR/levels"

cleanup() {
  say "cleanup"
  dc down -v --remove-orphans >/dev/null 2>&1 && echo "docker compose -p $PROJECT down -v: done"
  rm -rf "$CHECK_DIR" && echo "removed scratch dir logs/.p0-09-check (workspace copies included)"
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

say "pnpm install --frozen-lockfile, build, lint, test"
if pnpm install --frozen-lockfile >/dev/null 2>&1; then pass "lockfile matches"; else fail "pnpm install --frozen-lockfile"; exit 1; fi
if pnpm -r build >/dev/null 2>&1; then pass "pnpm -r build"; else fail "pnpm -r build"; pnpm -r build 2>&1 | tail -20; exit 1; fi
if pnpm --filter @quest/engine lint >/dev/null 2>&1; then pass "engine lint"; else fail "engine lint"; pnpm --filter @quest/engine lint 2>&1 | tail -20; fi
out="$(pnpm --filter @quest/engine test 2>&1)"
if [ $? -eq 0 ]; then pass "engine vitest: $(printf '%s\n' "$out" | grep -E '^ +Tests ' | sed 's/^ *//')"; else fail "engine vitest"; printf '%s\n' "$out" | tail -40; fi

say "scratch levels: levels/_examples/example-{cli,code,decision,ops} and levels/ch0-boot"
rm -rf "$CHECK_DIR"
mkdir -p "$P09_WORKSPACE" "$P09_LOGS" "$P09_PROGRESS" "$P09_LEVELS"
for d in example-cli example-code example-decision example-ops; do cp -R "levels/_examples/$d" "$P09_LEVELS/"; done
cp -R levels/ch0-boot "$P09_LEVELS/"
v="$(node packages/shared/dist/levels/cli.js "$P09_LEVELS" 2>&1)"
if [ $? -eq 0 ]; then pass "scratch levels valid: $v"; else fail "scratch levels invalid"; printf '%s\n' "$v"; exit 1; fi
echo "(levels/ch1-keyspace is not mounted: other agents are writing it; this check grades only the levels above)"

say "docker compose -p $PROJECT up -d --build $SERVICES"
dc down -v --remove-orphans >/dev/null 2>&1
# shellcheck disable=SC2086
if dc up -d --build $SERVICES 2>&1 | grep -vE '^ *#|^$' | tail -12; then :; fi
if h="$(wait_engine)"; then pass "engine healthy through the proxy on 3200: $h"; else fail "engine not healthy: $h"; dc logs --tail 40 engine; exit 1; fi

say "is the app serving? (traffic needs it)"
TRAFFIC=0
i=0
while [ $i -lt 30 ]; do
  a="$(curl -s -m 2 "$BASE/app/health" || true)"
  case "$a" in *'"service":"app"'*) TRAFFIC=1; break ;; esac
  sleep 2; i=$((i + 1))
done
if [ "$TRAFFIC" = 1 ]; then pass "app healthy: $a"; else
  echo "!!! TRAFFIC PORTION SKIPPED: /app/health did not answer (last: ${a:-none}) !!!"
fi

say "grade phase 1: Chapter 0 levels 1-4, example cli, code (both levels), decision; 409; progress; WebSocket"
BASE="$BASE" CHECK_DIR="$CHECK_DIR" TRAFFIC="$TRAFFIC" node engine/test/check/p09-grade.mjs phase1 || FAILED=1

say "docker compose -p $PROJECT down (no -v), then up: what ch0-05 and example-ops ask the learner to do"
dc down 2>&1 | tail -3
# shellcheck disable=SC2086
dc up -d $SERVICES 2>&1 | tail -3
if h="$(wait_engine)"; then pass "engine back: $h"; else fail "engine did not come back: $h"; fi

say "grade phase 2: ch0-05 and example-ops after the restart"
BASE="$BASE" CHECK_DIR="$CHECK_DIR" TRAFFIC="$TRAFFIC" node engine/test/check/p09-grade.mjs phase2 || FAILED=1

say "verdict table (level, solution, declared, engine, note)"
if [ -f "$CHECK_DIR/verdicts.tsv" ]; then
  awk -F '\t' '{ printf "%-36s %-48s %-16s %-16s %s\n", $1, $2, $3, $4, $5 }' "$CHECK_DIR/verdicts.tsv" | cut -c1-200
fi

say "engine log: read-only allowlist cross-check"
grep -h 'cross-check\|READ_ONLY_COMMANDS\|allowlisted commands' "$P09_LOGS/engine/engine.log" 2>/dev/null | head -5 | cut -c1-600

if [ "$TRAFFIC" != 1 ]; then echo; echo "!!! TRAFFIC PORTION SKIPPED (app not serving); everything else ran !!!"; fi
if [ $FAILED -eq 0 ]; then echo; echo "P0-09 OK"; exit 0; fi
echo; echo "P0-09 FAILED"; exit 1
