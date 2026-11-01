#!/usr/bin/env bash
# P0-02 acceptance: compose config, image build, arm64 images, stack health, Redis 8 modules.
# Bash 3.2 compatible. Leaves the stack down on exit.
set -u
cd "$(dirname "$0")/../.." || exit 1

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }
finish() {
  section "docker compose down"
  docker compose down >/dev/null 2>&1 && echo "stack down"
  if [ "$FAILED" -eq 0 ]; then printf '\nP0-02 OK\n'; exit 0; fi
  printf '\nP0-02 FAILED\n'; exit 1
}

[ -f .env ] || cp .env.example .env
mkdir -p logs .progress workspace postgres/init
envval() {
  local v
  eval "v=\${$1:-}"
  [ -z "$v" ] && v="$(grep -E "^$1=" .env | tail -n 1 | sed 's/^[^=]*=//')"
  printf '%s' "${v:-$2}"
}
PROXY_PORT="$(envval PROXY_PORT 3000)"
INSIGHT_PORT="$(envval INSIGHT_PORT 5540)"
echo "ports in use for this check: proxy=$PROXY_PORT insight=$INSIGHT_PORT redis=$(envval REDIS_PORT 6379) postgres=$(envval PG_PORT 5432)"

section "preflight --quiet (stack down, ports free)"
docker compose down >/dev/null 2>&1
if scripts/preflight.sh --quiet; then ok "preflight exits 0 with --quiet and prints nothing"; else bad "preflight reported problems"; fi
if [ -z "$(scripts/preflight.sh --quiet 2>&1)" ]; then ok "--quiet output is empty when all checks pass"; else bad "--quiet printed something on a clean run"; fi

section "docker compose config -q"
if docker compose config -q && docker compose --profile crash --profile replica --profile sentinel --profile cluster config -q; then
  ok "compose file valid, all profiles included"
else bad "compose config invalid"; fi

section "mem_limit on every service, all arm64"
MISSING="$(docker compose --profile crash --profile replica --profile sentinel --profile cluster config --format json | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);const bad=[];
for(const [n,v] of Object.entries(c.services)){ if(!v.mem_limit) bad.push(n+": no mem_limit"); if(v.platform!=="linux/arm64") bad.push(n+": platform "+v.platform); }
console.log(bad.join("\n")); });')"
if [ -z "$MISSING" ]; then ok "every service has mem_limit and platform linux/arm64"; else bad "$MISSING"; fi

section "docker compose build"
START=$(date +%s)
if docker compose build 2>&1 | tail -n 15; then ok "build finished in $(( $(date +%s) - START )) s"; else bad "build failed"; fi
docker compose pull --ignore-buildable --quiet >/dev/null 2>&1

section "image architecture and size"
for img in $(docker compose --profile crash --profile replica --profile sentinel --profile cluster config --images | sort -u); do
  arch="$(docker image inspect --format '{{.Architecture}}' "$img" 2>/dev/null)"
  size="$(docker image inspect --format '{{.Size}}' "$img" 2>/dev/null | awk '{printf "%.0f MB", $1/1000000}')"
  if [ "$arch" = "arm64" ]; then ok "$img Architecture: arm64 ($size)"; else bad "$img Architecture: '${arch:-missing}'"; fi
done

section "node image contents"
NODE_IMG=redis-quest-node:latest
OUT="$(docker run --rm --platform linux/arm64 "$NODE_IMG" node runner/dist/main.js 2>&1)"
if [ "$OUT" = "@quest/runner" ]; then ok "node runner/dist/main.js prints $OUT"; else bad "engine main printed: $OUT"; fi
for pkg in app runner; do
  OUT="$(docker run --rm --platform linux/arm64 "$NODE_IMG" node $pkg/dist/main.js 2>&1)"
  if [ "$OUT" = "@quest/$pkg" ]; then ok "node $pkg/dist/main.js prints $OUT"; else bad "$pkg main printed: $OUT"; fi
done
UID_OUT="$(docker run --rm "$NODE_IMG" id -u)"
if [ "$UID_OUT" != "0" ]; then ok "runs as non-root (uid $UID_OUT)"; else bad "image runs as root"; fi
WD="$(docker run --rm "$NODE_IMG" pwd)"
if [ "$WD" = "/srv" ]; then ok "WORKDIR /srv"; else bad "WORKDIR is $WD"; fi
if docker run --rm "$NODE_IMG" sh -c 'test ! -e node_modules/typescript && test ! -e node_modules/vitest'; then ok "no dev dependencies (typescript, vitest) in runtime image"; else bad "dev dependencies leaked into runtime image"; fi
if docker run --rm "$NODE_IMG" sh -c 'test -f ui/dist/index.html'; then ok "ui/dist/index.html present"; else bad "ui/dist missing"; fi

section "docker compose up -d redis postgres insight proxy"
if docker compose up -d redis postgres insight proxy 2>&1 | tail -n 12; then ok "services started"; else bad "up failed"; fi

wait_healthy() {
  local i=0 cid st
  while [ "$i" -lt 60 ]; do
    cid="$(docker compose ps -q "$1" 2>/dev/null)"
    st="$([ -n "$cid" ] && docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null)"
    [ "$st" = "healthy" ] && return 0
    sleep 2; i=$((i + 1))
  done
  return 1
}
if wait_healthy redis; then ok "redis healthy"; else bad "redis not healthy"; fi
if wait_healthy postgres; then ok "postgres healthy"; else bad "postgres not healthy"; fi

section "MODULE LIST (redis:8, linux/arm64)"
ML="$(docker compose exec -T redis redis-cli MODULE LIST 2>&1)"
printf '%s\n' "$ML"
MODS_OK=1
for m in search ReJSON timeseries bf; do
  if printf '%s\n' "$ML" | grep -qx "$m"; then ok "module $m loaded"; else bad "module $m MISSING from MODULE LIST"; MODS_OK=0; fi
done
[ "$MODS_OK" -eq 1 ] && echo "MODULE LIST result: search, ReJSON, timeseries, bf all present"
echo "redis_version: $(docker compose exec -T redis redis-cli INFO server | tr -d '\r' | grep '^redis_version')"
echo "maxmemory: $(docker compose exec -T redis redis-cli CONFIG GET maxmemory | tr '\n' ' ')"
echo "FT._LIST: $(docker compose exec -T redis redis-cli FT._LIST 2>&1 | tr '\n' ' ')"

section "Redis Insight health"
i=0; H=""
while [ "$i" -lt 45 ]; do
  H="$(curl -fs "http://localhost:${INSIGHT_PORT}/api/health/" 2>/dev/null)" && break
  H=""; sleep 2; i=$((i + 1))
done
if [ -n "$H" ]; then ok "GET /api/health/ answered: $H"; else bad "insight /api/health/ did not answer in 90 s"; fi

section "proxy answers 502 or 503 (no engine or app yet) or 200"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PROXY_PORT}/")"
if [ "$CODE" = "502" ] || [ "$CODE" = "503" ] || [ "$CODE" = "200" ]; then ok "http://localhost:${PROXY_PORT}/ returned $CODE"; else bad "proxy returned '$CODE'"; fi
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PROXY_PORT}/app/ping")"
if [ "$CODE" = "502" ] || [ "$CODE" = "503" ] || [ "$CODE" = "200" ] || [ "$CODE" = "404" ]; then ok "http://localhost:${PROXY_PORT}/app/ping returned $CODE"; else bad "proxy /app returned '$CODE'"; fi
sleep 1
if [ -s logs/proxy/access.log ] && head -n 1 logs/proxy/access.log | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{JSON.parse(s)})'; then ok "logs/proxy/access.log has JSON lines"; else bad "logs/proxy/access.log missing or not JSON"; fi
if [ -d logs/postgres ] && [ -n "$(ls logs/postgres 2>/dev/null)" ]; then ok "postgres writes logs to logs/postgres ($(ls logs/postgres | head -n 1))"; else bad "logs/postgres is empty"; fi

finish
