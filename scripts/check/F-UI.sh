#!/usr/bin/env bash
# F-UI acceptance: three UI fixes (terminal scroll jump, Insight link port, e2e through real verify only). Same stack as P0-10. Build, lint and unit-test @quest/ui, bring up the full stack in its own compose
# project (quest-p10, ports 3300/6393/5435/5543, never the default project), play Chapter 0 end to end in a
# real browser with Playwright, screenshot every screen, then `docker compose -p quest-p10 down -v`.
# Bash 3.2 compatible.
#
# The engine, progress file, workspace and logs all live in a scratch tree under ui/e2e/.scratch, and the
# engine is given a copy of levels/ch0-boot only, so another agent's half-written chapter cannot break this run.
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

PROJECT=quest-p10
ENVFILE=.env.p10
PORT=3300
BASE="http://127.0.0.1:$PORT"
SCRATCH="$ROOT/ui/e2e/.scratch"
OUT="$SCRATCH/playwright.out"

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }

compose() {
  docker compose -p "$PROJECT" --env-file "$ENVFILE" -f docker-compose.yml -f ui/e2e/compose.p10.yml "$@"
}

finish() {
  if [ -n "${P10_KEEP_STACK:-}" ]; then
    # Debugging aid for whoever works on the UI: leave the stack and scratch tree up. Not used by the real check.
    printf '\nP10_KEEP_STACK set: leaving project %s up at %s (stop it with docker compose -p %s down -v)\n' "$PROJECT" "$BASE" "$PROJECT"
    if [ "$FAILED" -eq 0 ]; then printf '\nF-UI OK (stack kept)\n'; exit 0; fi
    printf '\nF-UI FAILED (stack kept)\n'; exit 1
  fi
  section "cleanup: docker compose -p $PROJECT down -v"
  if [ -f "$ENVFILE" ]; then compose down -v --remove-orphans 2>&1 | tail -n 12; fi
  if [ -f "$OUT" ] && grep -q 'NOTE: verify not implemented yet' "$OUT"; then bad "dev-complete fallback was used"; fi
  rm -rf "$SCRATCH"
  if [ "$FAILED" -eq 0 ]; then printf '\nF-UI OK\n'; exit 0; fi
  printf '\nF-UI FAILED\n'; exit 1
}
die() { bad "$1"; finish; }

rm -rf "$SCRATCH"   # a scratch tree left by an earlier run must not reach eslint
section "pnpm install --frozen-lockfile, ui build, lint, unit tests"
pnpm install --frozen-lockfile >/dev/null 2>&1 && ok "lockfile matches" || die "pnpm install --frozen-lockfile"
if B=$(pnpm --filter @quest/ui build 2>&1); then
  ok "pnpm --filter @quest/ui build"
  printf '%s\n' "$B" | grep -E 'dist/(index|assets/index)' | sed 's/^/      /'
else printf '%s\n' "$B" | tail -25; die "pnpm --filter @quest/ui build"; fi
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
ok "wrote $ENVFILE (gitignored): ports 3300 6393 5435 5543, ENGINE_DEV=1, scratch dirs, levels/ch0-boot only"
for p in 3300 6393 5435 5543; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    if [ -z "$(compose ps -q 2>/dev/null)" ]; then die "port $p is already in use by something that is not the $PROJECT stack"; fi
  fi
done

section "docker compose -p $PROJECT up -d --build (full stack)"
compose down -v --remove-orphans >/dev/null 2>&1
if compose up -d --build 2>&1 | tail -n 24; then ok "stack started"; else die "compose up"; fi

section "wait for the engine through the proxy"
READY=""
i=0
while [ $i -lt 90 ]; do
  H=$(curl -fsS --max-time 2 "$BASE/health" 2>/dev/null || true)
  case "$H" in *'"redis":"up","postgres":"up"'*'"levels":"ok"'*) READY=1; break;; esac
  i=$((i + 1)); sleep 2
done
if [ -n "$READY" ]; then ok "GET $BASE/health: $H"; else compose logs --tail 40 engine 2>&1 | tail -40; die "engine did not become healthy at $BASE/health (last: ${H:-nothing})"; fi
case "$(curl -fsS --max-time 5 "$BASE/" 2>/dev/null)" in *'<div id="root">'*) ok "GET / serves the built UI";; *) die "GET / did not serve ui/dist/index.html";; esac
case "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/api/progress")" in 404) ok "no player yet (fresh progress): GET /api/progress -> 404";; *) die "expected a fresh game (GET /api/progress -> 404)";; esac

section "engine restart (stands in for the learner's docker compose down / ./scripts/start in level 5)"
# Level 5 asks for game:engine:boots >= 2. A browser test cannot run docker, so the script restarts the engine
# once before the run. Redis keeps its data, exactly as in the level's lesson.
compose restart engine >/dev/null 2>&1 || die "compose restart engine"
READY=""; i=0
while [ $i -lt 60 ]; do
  H=$(curl -fsS --max-time 2 "$BASE/health" 2>/dev/null || true)
  case "$H" in *'"boots":2'*'"levels":"ok"'*) READY=1; break;; esac
  i=$((i + 1)); sleep 2
done
if [ -n "$READY" ]; then ok "engine rebooted: $H"; else die "engine did not come back with boots 2 (last: ${H:-nothing})"; fi

section "playwright: Chapter 0 end to end against $BASE"
( cd ui && npx --no-install playwright --version ) | sed 's/^/      /'
( cd ui && npx --no-install playwright install chromium >/dev/null 2>&1 ) || echo "      (playwright install chromium reported a problem; trying the run anyway)"
( cd ui && P10_BASE_URL="$BASE" npx --no-install playwright test e2e/chapter0.e2e.ts 2>&1 ) | tee "$OUT"
if [ "${PIPESTATUS[0]}" -eq 0 ]; then ok "playwright: Chapter 0 played end to end"; else bad "playwright run failed"; fi

section "fix assertions present"
grep -q 'ALLOW_DEV_COMPLETE_FALLBACK = false' ui/e2e/chapter0.e2e.ts && ok "F-08: dev-complete fallback disabled" || bad "F-08: fallback not disabled"
grep -q 'scrollY' ui/e2e/chapter0.e2e.ts && ok "F-06: scroll position assertion present" || bad "F-06: scroll assertion missing"
if grep -q 'dispatchEvent' ui/e2e/chapter0.e2e.ts; then bad "F-06: e2e still uses dispatchEvent click"; else ok "F-06: e2e clicks stages normally"; fi

section "screenshots"
N=$(ls ui/e2e/screenshots/*.png 2>/dev/null | wc -l | tr -d ' ')
if [ "$N" -ge 20 ]; then ok "$N screenshots in ui/e2e/screenshots/"; else bad "expected at least 20 screenshots, found $N"; fi
ls ui/e2e/screenshots | sed 's/^/      /'

finish
