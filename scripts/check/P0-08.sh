#!/usr/bin/env bash
# P0-08 acceptance: the runner executes learner modules with injected deps, metrics and crash isolation.
# Bash 3.2 compatible. Starts compose redis + postgres, runs the runner on the host, then stops
# the runner and `docker compose stop redis postgres`.
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT="$(pwd)"

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }

[ -f .env ] || cp .env.example .env
envval() {
  local v
  eval "v=\${$1:-}"
  [ -z "$v" ] && v="$(grep -E "^$1=" .env | tail -n 1 | sed 's/^[^=]*=//')"
  printf '%s' "${v:-$2}"
}
REDIS_PORT="$(envval REDIS_PORT 6379)"
PG_PORT="$(envval PG_PORT 5432)"
RUNNER_PORT="${RUNNER_PORT:-4100}"
BASE="http://127.0.0.1:$RUNNER_PORT"
LOGTMP="$(mktemp -d)"
TMPMOD="_check-tmp-$$"
RUNNER_PID=""

finish() {
  section "cleanup"
  if [ -n "$RUNNER_PID" ]; then kill "$RUNNER_PID" 2>/dev/null; wait "$RUNNER_PID" 2>/dev/null; echo "runner stopped"; fi
  rm -rf "$ROOT/workspace/$TMPMOD" "$LOGTMP"
  docker compose stop redis postgres >/dev/null 2>&1 && echo "redis and postgres stopped"
  if [ "$FAILED" -eq 0 ]; then printf '\nP0-08 OK\n'; exit 0; fi
  printf '\nP0-08 FAILED\n'; exit 1
}
trap 'finish' EXIT INT TERM

# node helper: evaluate a JS expression against JSON on stdin (as `d`).
jx() { node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); const v=eval(process.argv[1]); console.log(typeof v==="object"?JSON.stringify(v):String(v));' "$1"; }
post() { curl -s -m 20 -X POST -H 'content-type: application/json' -d "$2" "$BASE$1"; }
expect_eq() { # description actual expected
  if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1: expected '$3', got '$2'"; fi
}

echo "ports for this check: runner=$RUNNER_PORT redis=$REDIS_PORT postgres=$PG_PORT"

section "docker"
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running; starting Docker Desktop"
  open -a Docker
  i=0; while ! docker info >/dev/null 2>&1 && [ $i -lt 60 ]; do sleep 3; i=$((i+1)); done
fi
if docker info >/dev/null 2>&1; then ok "docker is running"; else bad "docker did not start"; exit 1; fi

section "pnpm -r build (retried: another task may be mid-edit in packages/shared/src/levels)"
built=0; try=1
while [ $try -le 3 ]; do
  if pnpm -r build >"$LOGTMP/build.log" 2>&1; then built=1; break; fi
  echo "build attempt $try failed; retrying in 30 s"; tail -n 5 "$LOGTMP/build.log"
  sleep 30; try=$((try+1))
done
if [ $built -eq 1 ]; then ok "pnpm -r build"; else bad "pnpm -r build failed"; cat "$LOGTMP/build.log"; exit 1; fi

section "docker compose up -d redis postgres"
docker compose up -d redis postgres 2>&1 | tail -n 6
i=0
while [ $i -lt 40 ]; do
  r="$(docker compose ps redis --format '{{.Health}}' 2>/dev/null)"; p="$(docker compose ps postgres --format '{{.Health}}' 2>/dev/null)"
  [ "$r" = "healthy" ] && [ "$p" = "healthy" ] && break
  sleep 2; i=$((i+1))
done
if [ "$r" = "healthy" ] && [ "$p" = "healthy" ]; then ok "redis and postgres healthy"; else bad "services not healthy (redis=$r postgres=$p)"; exit 1; fi

export REDIS_URL="redis://localhost:$REDIS_PORT"
export DATABASE_URL="postgres://quest:quest@localhost:$PG_PORT/quest"

section "runner unit and integration tests (vitest, real redis + postgres)"
if pnpm --filter @quest/runner test >"$LOGTMP/test.log" 2>&1; then ok "pnpm --filter @quest/runner test"; else bad "runner tests failed"; tail -n 40 "$LOGTMP/test.log"; fi

section "start the runner on the host"
if lsof -nP -iTCP:"$RUNNER_PORT" -sTCP:LISTEN >/dev/null 2>&1; then bad "port $RUNNER_PORT is already in use"; exit 1; fi
PORT="$RUNNER_PORT" WORKSPACE_DIR="$ROOT/workspace" LOG_DIR="$LOGTMP/logs" \
  node runner/dist/main.js >"$LOGTMP/runner.out" 2>&1 &
RUNNER_PID=$!
i=0; while ! curl -s -m 1 "$BASE/health" >/dev/null 2>&1 && [ $i -lt 30 ]; do sleep 0.5; i=$((i+1)); done

section "GET /health"
expect_eq "health" "$(curl -s "$BASE/health" | jx 'JSON.stringify(d)')" '{"ok":true,"service":"runner"}'

section "POST /load"
R="$(post /load '{"module":"_examples/ok.js"}')"
expect_eq "/load ok.js ok" "$(echo "$R" | jx 'd.ok')" "true"
expect_eq "/load ok.js exports" "$(echo "$R" | jx 'd.exports')" '["default"]'
R="$(post /load '{"module":"_examples/bad-syntax.js"}')"
expect_eq "/load syntax-error file ok" "$(echo "$R" | jx 'd.ok')" "false"
expect_eq "/load syntax-error file error name" "$(echo "$R" | jx 'd.error.name')" "SyntaxError"

section "POST /run ok.js"
R="$(post /run '{"module":"_examples/ok.js","calls":[{"args":["check"]}]}')"
expect_eq "ok.js value" "$(echo "$R" | jx 'd.results[0].value')" '{"greeting":"hello check","two":2}'
expect_eq "ok.js dbQueries" "$(echo "$R" | jx 'd.metrics.dbQueries')" "1"
expect_eq "ok.js redisCommands >= 2" "$(echo "$R" | jx 'd.metrics.redisCommands >= 2')" "true"
expect_eq "ok.js log line captured" "$(echo "$R" | jx 'd.logs.indexOf("read greeting: hello check") >= 0')" "true"

section "POST /run throws.js"
R="$(post /run '{"module":"_examples/throws.js"}')"
expect_eq "throws.js reports ok=false" "$(echo "$R" | jx 'd.results[0].ok')" "false"
expect_eq "throws.js error name" "$(echo "$R" | jx 'd.results[0].error.name')" "TypeError"
expect_eq "throws.js metrics.errors" "$(echo "$R" | jx 'd.metrics.errors')" "1"
expect_eq "runner still healthy after throws.js" "$(curl -s "$BASE/health" | jx 'd.ok')" "true"

section "POST /run hangs.js (timeoutMs 1000, must return within 2.5 s)"
T0="$(node -e 'console.log(Date.now())')"
R="$(post /run '{"module":"_examples/hangs.js","timeoutMs":1000}')"
T1="$(node -e 'console.log(Date.now())')"
ELAPSED=$((T1 - T0))
if [ "$ELAPSED" -lt 2500 ]; then ok "hangs.js returned in ${ELAPSED} ms"; else bad "hangs.js took ${ELAPSED} ms"; fi
expect_eq "hangs.js error name" "$(echo "$R" | jx 'd.results[0].error.name')" "TimeoutError"

section "POST /run spins.js (synchronous infinite loop, hard kill)"
T0="$(node -e 'console.log(Date.now())')"
R="$(post /run '{"module":"_examples/spins.js","timeoutMs":1000}')"
T1="$(node -e 'console.log(Date.now())')"
ELAPSED=$((T1 - T0))
if [ "$ELAPSED" -lt 3000 ]; then ok "spins.js killed and reported in ${ELAPSED} ms"; else bad "spins.js took ${ELAPSED} ms"; fi
expect_eq "spins.js error name" "$(echo "$R" | jx 'd.results[0].error.name')" "KilledError"
expect_eq "runner still healthy after spins.js" "$(curl -s "$BASE/health" | jx 'd.ok')" "true"

section "POST /run exits.js"
R="$(post /run '{"module":"_examples/exits.js"}')"
expect_eq "exits.js error name" "$(echo "$R" | jx 'd.results[0].error.name')" "ChildExitError"
expect_eq "exits.js message mentions exit code 3" "$(echo "$R" | jx 'd.results[0].error.message.indexOf("exit code 3") >= 0')" "true"
expect_eq "runner still healthy after exits.js" "$(curl -s "$BASE/health" | jx 'd.ok')" "true"

section "POST /run concurrent-counter.js (concurrency 50)"
docker compose exec -T redis redis-cli DEL runner:example:counter >/dev/null
CALLS="$(node -e 'console.log(JSON.stringify(Array.from({length:50},()=>({args:[]}))))')"
R="$(post /run "{\"module\":\"_examples/concurrent-counter.js\",\"calls\":$CALLS,\"concurrency\":50}")"
expect_eq "50 calls, 0 errors" "$(echo "$R" | jx 'd.metrics.calls + "/" + d.metrics.errors')" "50/0"
expect_eq "counter in redis" "$(docker compose exec -T redis redis-cli GET runner:example:counter | tr -d '\r')" "50"
docker compose exec -T redis redis-cli DEL runner:example:counter >/dev/null

section "no stale cache: edit a copy of ok.js between two runs"
mkdir -p "$ROOT/workspace/$TMPMOD"
cp "$ROOT/workspace/_examples/ok.js" "$ROOT/workspace/$TMPMOD/edit.js"
R1="$(post /run "{\"module\":\"$TMPMOD/edit.js\"}")"
sleep 0.2
sed -i '' 's/hello /greetings, /' "$ROOT/workspace/$TMPMOD/edit.js"
R2="$(post /run "{\"module\":\"$TMPMOD/edit.js\"}")"
expect_eq "before edit" "$(echo "$R1" | jx 'd.results[0].value.greeting')" "hello world"
expect_eq "after edit" "$(echo "$R2" | jx 'd.results[0].value.greeting')" "greetings, world"

section "runner log file"
if [ -s "$LOGTMP/logs/runner/runner.log" ]; then ok "LOG_DIR/runner/runner.log has $(wc -l < "$LOGTMP/logs/runner/runner.log" | tr -d ' ') lines"; else bad "no runner.log written"; fi

exit 0
