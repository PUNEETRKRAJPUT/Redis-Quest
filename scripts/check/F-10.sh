#!/usr/bin/env bash
# F-10 acceptance: stats_latency_panel and otp_limiter_panel render. ui build, lint, vitest (unit tests for both on
# sample data), then the Playwright run in compose project quest-p10 whose #/showme gallery step asserts 14 views
# and no "Unknown show-me component", and shoots both new cards into ui/e2e/screenshots. Ended with
# `docker compose -p quest-p10 down -v`. Bash 3.2 compatible.
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

PROJECT=quest-p10
ENVFILE=.env.p10
PORT=3300
BASE="http://127.0.0.1:$PORT"
SCRATCH="$ROOT/ui/e2e/.scratch"
OUT="$SCRATCH/playwright.out"
CLI="packages/shared/dist/levels/cli.js"

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }

compose() {
  docker compose -p "$PROJECT" --env-file "$ENVFILE" -f docker-compose.yml -f ui/e2e/compose.p10.yml "$@"
}

finish() {
  section "cleanup: docker compose -p $PROJECT down -v"
  if [ -f "$ENVFILE" ]; then compose down -v --remove-orphans 2>&1 | tail -n 12; fi
  if [ -f "$OUT" ] && grep -q 'NOTE: verify not implemented yet' "$OUT"; then bad "dev-complete fallback was used"; fi
  rm -rf "$SCRATCH"
  if [ "$FAILED" -eq 0 ]; then printf '\nF-10 OK\n'; exit 0; fi
  printf '\nF-10 FAILED\n'; exit 1
}
die() { bad "$1"; finish; }

rm -rf "$SCRATCH"
section "pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile >/dev/null 2>&1 && ok "lockfile matches" || die "pnpm install --frozen-lockfile"
if B=$(pnpm --filter @quest/shared build 2>&1); then ok "pnpm --filter @quest/shared build"; else printf '%s\n' "$B" | tail -25; die "shared build"; fi

section "ui build, lint, unit tests"
if B=$(pnpm --filter @quest/ui build 2>&1); then ok "pnpm --filter @quest/ui build"; else printf '%s\n' "$B" | tail -25; die "ui build"; fi
pnpm --filter @quest/ui lint >/dev/null 2>&1 && ok "ui lint" || { pnpm --filter @quest/ui lint 2>&1 | tail -20; bad "ui lint"; }
if T=$(pnpm --filter @quest/ui test 2>&1); then
  ok "ui vitest: $(printf '%s\n' "$T" | grep -E '^ +Tests ' | sed 's/^ *//')"
else printf '%s\n' "$T" | tail -30; bad "ui vitest"; fi

section "isolated stack settings ($ENVFILE, project $PROJECT)"
rm -rf "$SCRATCH"
mkdir -p "$SCRATCH/levels" "$SCRATCH/progress" "$SCRATCH/workspace" "$SCRATCH/logs" ui/e2e/screenshots
rm -f ui/e2e/screenshots/*.png
cp -R levels/ch0-boot "$SCRATCH/levels/ch0-boot"
if [ -d workspace/_examples ]; then cp -R workspace/_examples "$SCRATCH/workspace/_examples"; fi
mkdir -p "$SCRATCH/workspace/ch0"
printf '// scratch file for the editor check\nexport default async function (deps) {\n  return deps.redis.ping();\n}\n' > "$SCRATCH/workspace/ch0/scratch.js"
mkdir -p postgres/init
cat > "$ENVFILE" <<ENVEOF
PROXY_PORT=$PORT
REDIS_PORT=6393
PG_PORT=5435
INSIGHT_PORT=5543
ENGINE_DEV=1
QUEST_LEVELS_DIR=$SCRATCH/levels
QUEST_PROGRESS_DIR=$SCRATCH/progress
QUEST_WORKSPACE_DIR=$SCRATCH/workspace
P10_LOGS_DIR=$SCRATCH/logs
ENVEOF
ok "wrote $ENVFILE (gitignored): ports 3300 6393 5435 5543, scratch dirs, levels/ch0-boot only"
for p in 3300 6393 5435 5543; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    if [ -z "$(compose ps -q 2>/dev/null)" ]; then die "port $p is already in use by something that is not the $PROJECT stack"; fi
  fi
done

section "docker compose -p $PROJECT up -d --build (full stack)"
compose down -v --remove-orphans >/dev/null 2>&1
if compose up -d --build 2>&1 | tail -n 24; then ok "stack started"; else die "compose up"; fi

section "wait for the engine through the proxy"
READY=""; i=0
while [ $i -lt 90 ]; do
  H=$(curl -fsS --max-time 2 "$BASE/health" 2>/dev/null || true)
  case "$H" in *'"redis":"up","postgres":"up"'*'"levels":"ok"'*) READY=1; break;; esac
  i=$((i + 1)); sleep 2
done
if [ -n "$READY" ]; then ok "GET $BASE/health: $H"; else compose logs --tail 40 engine 2>&1 | tail -40; die "engine did not become healthy"; fi
case "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/api/progress")" in 404) ok "fresh progress: GET /api/progress -> 404";; *) die "expected a fresh game";; esac

section "engine restart (stands in for the learner's docker compose down / ./scripts/start in level 5)"
compose restart engine >/dev/null 2>&1 || die "compose restart engine"
READY=""; i=0
while [ $i -lt 60 ]; do
  H=$(curl -fsS --max-time 2 "$BASE/health" 2>/dev/null || true)
  case "$H" in *'"boots":2'*'"levels":"ok"'*) READY=1; break;; esac
  i=$((i + 1)); sleep 2
done
if [ -n "$READY" ]; then ok "engine rebooted: $H"; else die "engine did not come back with boots 2"; fi

section "playwright: gallery renders both components, no unknown-component fallback"
( cd ui && npx --no-install playwright install chromium >/dev/null 2>&1 ) || echo "      (playwright install chromium reported a problem; trying the run anyway)"
( cd ui && P10_BASE_URL="$BASE" npx --no-install playwright test 2>&1 ) | tee "$OUT"
if [ "${PIPESTATUS[0]}" -eq 0 ]; then ok "playwright run passed"; else bad "playwright run failed"; fi
grep -q 'toHaveCount(14)' ui/e2e/chapter0.e2e.ts && grep -q 'Unknown show-me component' ui/e2e/chapter0.e2e.ts && ok "e2e asserts 14 gallery views and no unknown fallback" || bad "e2e gallery assertions missing"
for id in stats_latency_panel otp_limiter_panel; do
  [ -s "ui/e2e/screenshots/showme-$id.png" ] && ok "screenshot ui/e2e/screenshots/showme-$id.png" || bad "missing screenshot showme-$id.png"
done

finish
