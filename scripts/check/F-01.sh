#!/usr/bin/env bash
# F-01 acceptance: Caddy dynamic upstreams balance the scaled app per request, with keep-alive on.
# Isolated compose project quest-f01 (.env.f01 ports 3400/6394/5436/5544); only ever `down -v` on that project. Bash 3.2.
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)
PROJECT=quest-f01
ENVF=.env.f01
FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
info() { printf '      %s\n' "$1"; }
section() { printf '\n== %s\n' "$1"; }

if [ ! -f "$ENVF" ]; then
  printf '# F-01 check only (gitignored): isolated compose project quest-f01 on its own host ports.\nPROXY_PORT=3400\nREDIS_PORT=6394\nPG_PORT=5436\nINSIGHT_PORT=5544\n' > "$ENVF"
fi
PROXY_PORT=$(sed -n 's/^PROXY_PORT=//p' "$ENVF")
BASE="http://127.0.0.1:${PROXY_PORT:-3400}"
DC() { docker compose -p "$PROJECT" --env-file "$ENVF" "$@"; }

# Scratch levels/progress so this project's engine never reads a level another agent is mid-edit on.
SCRATCH="$ROOT/logs/.f-01-check"
rm -rf "$SCRATCH"
mkdir -p "$SCRATCH/levels" "$SCRATCH/progress" logs workspace postgres/init
cp -R levels/_examples/example-cli "$SCRATCH/levels/example-cli" 2>/dev/null
export QUEST_LEVELS_DIR="$SCRATCH/levels"
export QUEST_PROGRESS_DIR="$SCRATCH/progress"
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/f01.XXXXXX")

finish() {
  section "cleanup"
  DC down -v --remove-orphans >/dev/null 2>&1 && echo "docker compose -p $PROJECT down -v: done"
  rm -rf "$SCRATCH" "$TMPD"
  if [ "$FAILED" -eq 0 ]; then printf '\nF-01 OK\n'; exit 0; fi
  printf '\nF-01 FAILED\n'; exit 1
}
trap finish EXIT
die() { bad "$1"; exit 1; }

wait_until() {
  local label=$1 secs=$2 i=0; shift 2
  while [ $i -lt $((secs * 2)) ]; do
    if "$@"; then return 0; fi
    i=$((i + 1)); sleep 0.5
  done
  return 1
}
# split FILE -> "a=N b=M" over the instance values found in the file, one per line
split_of() { grep -o '"instance":"[^"]*"' "$1" | sort | uniq -c | awk '{printf "%s%s=%s", (NR>1?" ":""), $2, $1}'; }
distinct() { grep -o '"instance":"[^"]*"' "$1" | sort -u | wc -l | tr -d ' '; }

section "docker"
docker info >/dev/null 2>&1 && ok "docker is running" || die "docker is not running"

section "caddy config valid"
docker run --rm --platform linux/arm64 -v "$ROOT/docker/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile >"$TMPD/validate.log" 2>&1 \
  && ok "caddy validate" || { tail -10 "$TMPD/validate.log"; bad "caddy validate"; }
grep -q 'dynamic a' docker/Caddyfile && grep -q 'lb_policy round_robin' docker/Caddyfile && ok "Caddyfile uses dynamic a + round_robin" || bad "Caddyfile missing dynamic a / round_robin"

section "up (build retried: the node image is shared and other agents may be mid-edit)"
up_ok=""
for attempt in 1 2 3; do
  if DC up -d --build redis postgres engine app proxy >"$TMPD/up.log" 2>&1; then up_ok=1; break; fi
  echo "compose up attempt $attempt failed:"; tail -8 "$TMPD/up.log"; sleep 20
done
[ -n "$up_ok" ] && ok "services started" || die "compose up"
DC up -d --scale app=2 app >"$TMPD/scale.log" 2>&1 && ok "scaled app to 2" || { cat "$TMPD/scale.log"; bad "scale"; }

health() { curl -s -m 5 -o "$TMPD/h" -w '%{http_code}' "$BASE/app/health" 2>/dev/null; }
up_check() { [ "$(health)" = "200" ]; }
wait_until "app" 90 up_check && ok "GET /app/health through the proxy" || { DC logs --tail 30 app proxy; die "app not healthy"; }
# Caddy re-resolves every second; wait until both instances have answered at least once.
both_seen() { local i=0; : > "$TMPD/warm"; while [ $i -lt 20 ]; do curl -s -m 5 "$BASE/app/health" >> "$TMPD/warm"; echo >> "$TMPD/warm"; i=$((i+1)); done; [ "$(distinct "$TMPD/warm")" = "2" ]; }
wait_until "both instances" 30 both_seen && ok "both app instances reachable" || { DC ps; bad "second instance never answered"; }

section "APP_MAX_REQUESTS_PER_SOCKET in the running app"
for c in $(DC ps -q app); do
  v=$(docker exec "$c" printenv APP_MAX_REQUESTS_PER_SOCKET 2>/dev/null)
  if [ -n "$v" ] && [ "$v" != "1" ]; then ok "container ${c:0:12}: APP_MAX_REQUESTS_PER_SOCKET=$v (not 1)"; else bad "container ${c:0:12}: APP_MAX_REQUESTS_PER_SOCKET='$v'"; fi
done

section "40 sequential requests on ONE connection (single curl, many URLs)"
set --
i=0; while [ $i -lt 40 ]; do set -- "$@" "$BASE/app/health"; i=$((i+1)); done
curl -s -m 30 -w '\n' "$@" > "$TMPD/ka.out" 2> "$TMPD/ka.err"
n=$(grep -c '"instance"' "$TMPD/ka.out")
[ "$n" = "40" ] && ok "40 keep-alive responses" || bad "keep-alive: got $n/40 responses"
curl -sv -m 30 "$BASE/app/health" "$BASE/app/health" -o /dev/null -o /dev/null 2>&1 | grep -qi 're-using existing' \
  && ok "curl reused the connection (Re-using existing connection)" || bad "curl did not reuse the connection"
info "keep-alive split: $(split_of "$TMPD/ka.out")"
[ "$(distinct "$TMPD/ka.out")" = "2" ] && ok "both instances served keep-alive requests" || bad "keep-alive: only $(distinct "$TMPD/ka.out") instance(s)"

section "40 separate curls (new connection each)"
: > "$TMPD/sep.out"
i=0; while [ $i -lt 40 ]; do curl -s -m 10 "$BASE/app/health" >> "$TMPD/sep.out"; echo >> "$TMPD/sep.out"; i=$((i+1)); done
n=$(grep -c '"instance"' "$TMPD/sep.out")
[ "$n" = "40" ] && ok "40 separate responses" || bad "separate: got $n/40 responses"
info "separate-connection split: $(split_of "$TMPD/sep.out")"
[ "$(distinct "$TMPD/sep.out")" = "2" ] && ok "both instances served separate connections" || bad "separate: only $(distinct "$TMPD/sep.out") instance(s)"

section "engine path unaffected"
code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/health")
[ "$code" = "200" ] && ok "GET /health -> engine 200" || bad "GET /health -> $code"
