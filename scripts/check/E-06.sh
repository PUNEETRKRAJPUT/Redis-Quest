#!/usr/bin/env bash
# E-06 acceptance: the engine serves Redis's own command docs from one in-memory snapshot.
# Starts ONE throwaway redis:8 container (quest-e06-redis, 127.0.0.1:6396) and the built engine as a plain Node
# process on a free port with scratch directories. Never touches a compose project. Bash 3.2.
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

NAME=quest-e06-redis
RPORT=6396
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
# One field of INFO commandstats, e.g. calls_of command\|docs
calls_of() { rcli info commandstats | tr -d '\r' | sed -n "s/^cmdstat_$1:calls=\([0-9]*\),.*/\1/p"; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }

section "setup"
docker rm -f "$NAME" >/dev/null 2>&1
if ! docker run -d --name "$NAME" --platform linux/arm64 -p 127.0.0.1:$RPORT:6379 redis:8 >/dev/null; then
  bad "could not start $NAME"; exit 1
fi
i=0; until rcli ping 2>/dev/null | grep -q PONG; do i=$((i+1)); [ $i -gt 40 ] && { bad "redis did not start"; exit 1; }; sleep 0.5; done
info "$(rcli --version)"

pnpm --silent --filter @quest/shared build && pnpm --silent --filter @quest/engine build || { bad "build failed"; exit 1; }
ok "engine built"

SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/quest-e06.XXXXXX")
mkdir -p "$SCRATCH/levels" "$SCRATCH/progress" "$SCRATCH/workspace" "$SCRATCH/logs"
cp -R levels/_examples/example-code "$SCRATCH/levels/example-code"
PORT=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
case "$PORT" in 3000|3100|3400|6394|5436) bad "picked a forbidden port $PORT"; exit 1;; esac
BASE="http://127.0.0.1:$PORT"

# ---- 5a: Redis stopped before the engine starts ----------------------------------------------------------------
section "redis down at engine start"
docker stop "$NAME" >/dev/null
PORT=$PORT REDIS_URL="redis://127.0.0.1:$RPORT" DATABASE_URL="postgres://nobody@127.0.0.1:1/x" \
  LOG_DIR="$SCRATCH/logs" PROGRESS_DIR="$SCRATCH/progress" WORKSPACE_DIR="$SCRATCH/workspace" \
  LEVELS_DIR="$SCRATCH/levels" UI_DIST_DIR="$SCRATCH/ui" \
  node engine/dist/main.js >"$SCRATCH/engine.log" 2>&1 &
ENGINE_PID=$!
i=0; until curl -fsS "$BASE/health" >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 60 ] && { bad "engine did not listen"; tail -20 "$SCRATCH/engine.log"; exit 1; }; sleep 0.5; done
CODE=$(curl -s -o "$SCRATCH/n.json" -w '%{http_code}' "$BASE/api/command-docs/names")
[ "$CODE" = 200 ] && [ "$(json 'j.available' <"$SCRATCH/n.json")" = false ] && ok "names while redis is down: 200 { available: false }" || bad "names while down: $CODE $(cat "$SCRATCH/n.json")"
CODE=$(curl -s -o "$SCRATCH/d.json" -w '%{http_code}' "$BASE/api/command-docs?names=get")
[ "$CODE" = 200 ] && [ "$(json 'j.available' <"$SCRATCH/d.json")" = false ] && ok "docs while redis is down: 200 { available: false }" || bad "docs while down: $CODE $(cat "$SCRATCH/d.json")"
[ "$(curl -fsS "$BASE/health" | json 'j.commandDocs')" = true ] && ok "/health reports commandDocs: true (even while redis is down)" || bad "health commandDocs"

section "redis comes up: recovery without restarting the engine"
docker start "$NAME" >/dev/null
i=0; until curl -fsS "$BASE/api/command-docs/names" 2>/dev/null | grep -q '"names"'; do i=$((i+1)); [ $i -gt 120 ] && break; sleep 0.5; done
if curl -fsS "$BASE/api/command-docs/names" | grep -q '"names"'; then ok "names recovered after redis started (engine pid $ENGINE_PID unchanged)"; else bad "no recovery"; tail -20 "$SCRATCH/engine.log"; exit 1; fi
kill -0 "$ENGINE_PID" 2>/dev/null || bad "engine died"

# ---- 1, 2 ------------------------------------------------------------------------------------------------------
section "health and names"
[ "$(curl -fsS "$BASE/health" | json 'j.commandDocs')" = true ] && ok "/health commandDocs: true" || bad "health commandDocs"
curl -fsS "$BASE/api/command-docs/names" >"$SCRATCH/n.json"
N=$(json 'j.names.length' <"$SCRATCH/n.json")
[ "$N" -ge 300 ] && ok "names: $N entries (several hundred)" || bad "names: only $N"
for want in get zadd 'client|list'; do
  [ "$(json "j.names.includes('$want')" <"$SCRATCH/n.json")" = true ] && ok "names include $want" || bad "names lack $want"
done

# ---- 4: zero commands to Redis while serving (measured before asking Redis directly) -------------------------------
section "fifty requests send nothing to redis"
D0=$(calls_of 'command\|docs'); L0=$(calls_of 'command\|list')
info "before: command|docs calls=$D0, command|list calls=$L0"
i=0; while [ $i -lt 25 ]; do
  curl -fsS "$BASE/api/command-docs/names" >/dev/null
  curl -fsS "$BASE/api/command-docs?names=get,zadd,xadd,nosuchcommand" >/dev/null
  i=$((i+1))
done
D1=$(calls_of 'command\|docs'); L1=$(calls_of 'command\|list')
info "after:  command|docs calls=$D1, command|list calls=$L1"
{ [ "$D0" = "$D1" ] && [ "$L0" = "$L1" ] && [ "$D0" = 1 ] && [ "$L0" = 1 ]; } \
  && ok "50 requests: counts unchanged (docs=1, list=1: the one snapshot)" || bad "commandstats moved or snapshot count is not 1"

# ---- 3: docs equal COMMAND DOCS itself ---------------------------------------------------------------------------
section "docs for get,zadd,xadd,nosuchcommand"
curl -fsS "$BASE/api/command-docs?names=get,zadd,xadd,nosuchcommand" >"$SCRATCH/d.json"
KEYS=$(json 'j.reply.filter((x,i)=>i%2==0).join(",")' <"$SCRATCH/d.json")
[ "$KEYS" = "get,zadd,xadd" ] && ok "returns get, zadd, xadd and omits nosuchcommand" || bad "returned: $KEYS"
for c in get zadd xadd; do
  # in redis-cli's raw output the summary text is the line after the line "summary"
  RS=$(rcli command docs "$c" | tr -d '\r' | awk '$0=="summary"{getline; print; exit}')
  ES=$(json "j.reply[j.reply.indexOf('$c')+1][1]" <"$SCRATCH/d.json")
  [ -n "$RS" ] && [ "$RS" = "$ES" ] && ok "$c summary equals redis-cli COMMAND DOCS: $RS" || bad "$c summary differs: redis='$RS' engine='$ES'"
done
RN=$(rcli command list | tr -d '\r' | grep -c .)
[ "$RN" = "$N" ] && ok "names count equals redis-cli COMMAND LIST ($RN)" || bad "names $N vs COMMAND LIST $RN"

# ---- 6: same shape as the UI fixtures ----------------------------------------------------------------------------
section "shape matches ui/test/terminal.fixtures.ts"
SHAPE=$(ENGINE_REPLY="$SCRATCH/d.json" node --input-type=module -e '
import { readFileSync } from "node:fs";
import { formatReply } from "./engine/dist/cli.js";
const src = readFileSync("ui/test/terminal.fixtures.ts", "utf8");
const fixtures = new Function(src.replace(/export const REPLIES[^=]*=/, "return ").replace(/;\s*$/, ""))();
const reply = JSON.parse(readFileSync(process.env.ENGINE_REPLY, "utf8")).reply;
const i = reply.indexOf("get");
// What POST /api/cli prints for COMMAND DOCS get is exactly what the UI fixture holds; render ours the same way.
const ours = formatReply([reply[i], reply[i + 1]]).text;
console.log(ours === fixtures.get ? "identical" : "different");
if (ours !== fixtures.get) { console.log(ours.slice(0, 300)); console.log(fixtures.get.slice(0, 300)); }
')
case "$SHAPE" in identical*) ok "get rendered redis-cli style is byte-identical to the UI fixture";; *) bad "fixture mismatch: $SHAPE";; esac

# ---- 400s and log ------------------------------------------------------------------------------------------------
section "bad input and snapshot size"
for q in "" "?names=" "?names=a,,b" "?names=a%20b" "?names=$(printf 'c,%.0s' $(seq 1 20))c"; do
  CODE=$(curl -s -o "$SCRATCH/e.json" -w '%{http_code}' "$BASE/api/command-docs$q")
  [ "$CODE" = 400 ] && ok "400 for names='$q' -> $(cat "$SCRATCH/e.json")" || bad "names='$q' gave $CODE"
done
info "engine log, snapshot: $(grep 'command docs snapshot taken' "$SCRATCH/engine.log" | head -1)"

printf '\n'
if [ "$FAILED" = 0 ]; then echo "E-06 check: all passed"; exit 0; fi
echo "E-06 check: FAILED"; exit 1
