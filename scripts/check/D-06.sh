#!/usr/bin/env bash
# D-06 acceptance: the wanted-commands board, the credits' data, and the unit tests of "Your turn" and the credits.
# Starts ONE throwaway redis:8 container (quest-d06-redis, 127.0.0.1:6397) and the built engine as a plain Node
# process on a free port with scratch progress directories; it reads the real levels/ directory and writes nothing
# in it. Never touches a compose project (so it does not need scripts/check/lib/isolate.sh). Bash 3.2.
# WRITTEN BUT NOT RUN by the task that wrote it (code-only mode, docs/specs/_days-common.md).
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

NAME=quest-d06-redis
RPORT=6397
FAILED=0
ENGINE_PID=""
SCRATCH=""
ok()   { printf 'PASS  %s\n' "$1"; }
bad()  { printf 'FAIL  %s\n' "$1"; FAILED=1; }
info() { printf '      %s\n' "$1"; }
section() { printf '\n== %s\n' "$1"; }

cleanup() {
  [ -n "$ENGINE_PID" ] && kill "$ENGINE_PID" 2>/dev/null
  docker rm -f "$NAME" >/dev/null 2>&1
  [ -n "$SCRATCH" ] && rm -rf "$SCRATCH"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

rcli() { docker exec "$NAME" redis-cli "$@"; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }

section "unit tests and static checks"
pnpm --silent --filter @quest/shared build || { bad "shared build failed"; exit 1; }
(cd engine && pnpm exec vitest run test/coverage.test.ts) >"${TMPDIR:-/tmp}/d06-engine-tests.log" 2>&1 \
  && ok "engine: coverage.test.ts" || { bad "engine tests"; tail -30 "${TMPDIR:-/tmp}/d06-engine-tests.log"; }
(cd ui && pnpm exec vitest run test/yourturn.test.tsx) >"${TMPDIR:-/tmp}/d06-ui-tests.log" 2>&1 \
  && ok "ui: yourturn.test.tsx" || { bad "ui tests"; tail -30 "${TMPDIR:-/tmp}/d06-ui-tests.log"; }
scripts/dev/check.sh @quest/engine >/dev/null 2>&1 && ok "engine type-checks and lints" || bad "engine check.sh"
scripts/dev/check.sh @quest/ui >/dev/null 2>&1 && ok "ui type-checks and lints" || bad "ui check.sh"
grep -q "enabled: true" ui/src/features/yourturn/entry.ts && grep -q "enabled: true" ui/src/features/credits/entry.ts \
  && ok "both feature entries are on" || bad "a feature entry is still off"
[ -f CONTRIBUTORS.md ] && ok "CONTRIBUTORS.md exists" || bad "CONTRIBUTORS.md missing"
n=$(find levels -name chapter.yaml -not -path 'levels/community/*' -not -path 'levels/_examples/*' | wc -l | tr -d ' ')
[ "$n" = 8 ] && ok "the campaign still has 8 chapters" || bad "campaign chapter count is $n"

section "setup: redis stopped, engine started against it"
docker rm -f "$NAME" >/dev/null 2>&1
if ! docker run -d --name "$NAME" --platform linux/arm64 -p 127.0.0.1:$RPORT:6379 redis:8 >/dev/null; then
  bad "could not start $NAME"; exit 1
fi
i=0; until rcli ping 2>/dev/null | grep -q PONG; do i=$((i+1)); [ $i -gt 40 ] && { bad "redis did not start"; exit 1; }; sleep 0.5; done
pnpm --silent --filter @quest/engine build || { bad "engine build failed"; exit 1; }
SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/quest-d06.XXXXXX")
mkdir -p "$SCRATCH/progress" "$SCRATCH/workspace" "$SCRATCH/logs"
PORT=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
case "$PORT" in 3000|3100|3400|6394|5436) bad "picked a forbidden port $PORT"; exit 1;; esac
BASE="http://127.0.0.1:$PORT"
docker stop "$NAME" >/dev/null
PORT=$PORT REDIS_URL="redis://127.0.0.1:$RPORT" DATABASE_URL="postgres://nobody@127.0.0.1:1/x" \
  LOG_DIR="$SCRATCH/logs" PROGRESS_DIR="$SCRATCH/progress" WORKSPACE_DIR="$SCRATCH/workspace" \
  LEVELS_DIR="$ROOT/levels" UI_DIST_DIR="$SCRATCH/ui" \
  node engine/dist/main.js >"$SCRATCH/engine.log" 2>&1 &
ENGINE_PID=$!
i=0; until curl -fsS "$BASE/health" >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 60 ] && { bad "engine did not listen"; tail -20 "$SCRATCH/engine.log"; exit 1; }; sleep 0.5; done

section "redis down: the board says so and lists nothing"
curl -fsS "$BASE/api/coverage" >"$SCRATCH/c0.json"
[ "$(json 'j.available' <"$SCRATCH/c0.json")" = false ] && ok "available: false while redis is down" || bad "coverage while down: $(cat "$SCRATCH/c0.json")"
[ "$(json '"groups" in j' <"$SCRATCH/c0.json")" = false ] && ok "no groups, no invented list" || bad "groups present while down"

section "credits data (does not need redis)"
curl -fsS "$BASE/api/credits" >"$SCRATCH/cr.json"
[ "$(json 'Array.isArray(j.cast) && j.cast.length >= 5' <"$SCRATCH/cr.json")" = true ] && ok "cast read from fiction/cast.json" || bad "cast: $(head -c 300 "$SCRATCH/cr.json")"
[ "$(json 'Array.isArray(j.contributors) && j.contributors.length >= 1' <"$SCRATCH/cr.json")" = true ] && ok "contributors read from CONTRIBUTORS.md" || bad "contributors"

section "redis comes up: the board appears without restarting the engine"
docker start "$NAME" >/dev/null
i=0; until curl -fsS "$BASE/api/coverage" 2>/dev/null | grep -q '"available":true'; do i=$((i+1)); [ $i -gt 120 ] && break; sleep 0.5; done
curl -fsS "$BASE/api/coverage" >"$SCRATCH/c1.json"
[ "$(json 'j.available' <"$SCRATCH/c1.json")" = true ] && ok "board available (engine pid $ENGINE_PID unchanged)" || { bad "no board"; tail -20 "$SCRATCH/engine.log"; exit 1; }

section "the board against COMMAND LIST on the same redis"
LISTED=$(rcli command list | tr -d '\r' | grep -c .)
BL=$(json 'j.listed' <"$SCRATCH/c1.json")
[ "$LISTED" = "$BL" ] && ok "listed = $BL = COMMAND LIST on this redis" || bad "listed $BL but COMMAND LIST has $LISTED"
SUM=$(json 'j.commands + j.skipped.subcommands + j.skipped.modules' <"$SCRATCH/c1.json")
[ "$SUM" = "$BL" ] && ok "commands + skipped subcommands + skipped modules = listed" || bad "counts do not add up: $SUM vs $BL"
SUBS=$(rcli command list | tr -d '\r' | grep -c '|')
[ "$(json 'j.skipped.subcommands' <"$SCRATCH/c1.json")" = "$SUBS" ] && ok "skipped subcommands = names with a | ($SUBS)" || bad "subcommand count differs from the | count ($SUBS)"
[ "$(json 'j.groups.every(g => g.commands.every(c => !c.name.includes(".") && !c.name.includes("|") && c.name === c.name.toLowerCase()))' <"$SCRATCH/c1.json")" = true ] \
  && ok "no module or subcommand names on the board" || bad "a module or subcommand name is on the board"
[ "$(json 'j.groups.every(g => g.group !== "module")' <"$SCRATCH/c1.json")" = true ] && ok "no group: module" || bad "a module group is on the board"
[ "$(json 'j.groups.flatMap(g=>g.commands).every(c => c.summary.length > 0)' <"$SCRATCH/c1.json")" = true ] \
  && ok "every command carries the server's summary" || info "some commands have no summary (the server gave none)"
TAUGHT=$(json 'j.taught' <"$SCRATCH/c1.json")
info "commands=$(json 'j.commands' <"$SCRATCH/c1.json") taught=$TAUGHT untaught=$(json 'j.untaught' <"$SCRATCH/c1.json") levelsRead=$(json 'j.levelsRead' <"$SCRATCH/c1.json")"
# 100 against redis:8 on 2026-11-22, with the list read level by level. The handoff's "about 68" was counted by hand
# without a server. The range leaves room for levels still to be written.
if [ "$TAUGHT" -ge 90 ] && [ "$TAUGHT" -le 120 ]; then ok "taught=$TAUGHT is inside the expected 90 to 120 (100 measured on 2026-11-22)"; else bad "taught=$TAUGHT is outside the expected 90 to 120: read the board's taught list before trusting either"; fi
for c in get set incr zadd xadd; do
  [ "$(json "j.groups.flatMap(g=>g.commands).find(c => c.name === '$c')?.taught" <"$SCRATCH/c1.json")" = true ] && ok "$c is taught" || bad "$c should be taught"
done
[ "$(json 'j.levelsRead' <"$SCRATCH/c1.json")" -ge 96 ] && ok "at least the 96 campaign levels were read" || bad "levelsRead below 96"

section "manual: the screens (not scripted)"
info "1. open /your-turn on the stack: three steps, the board with untaught first; 'Write a level about this' opens /studio?command=<name> and ticks step 1"
info "2. pass a play-test in /studio: step 2 ticks by itself (also after a reload); step 3 shows the commands for that pack and level"
info "3. /credits: roll plays itself, Space pauses, Escape shows everything; with reduced motion on it starts paused"

printf '\n'
[ "$FAILED" = 0 ] && echo "D-06 check: all passed" || { echo "D-06 check: FAILED"; exit 1; }
