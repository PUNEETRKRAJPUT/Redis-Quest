#!/usr/bin/env bash
# F-05 acceptance: show_me carries its keys. Shared build + tests, levels:validate over every chapter and the
# examples, no level on the bare string form, ui build/lint/vitest, then the Chapter 0 Playwright run (which
# asserts the passed level's show-me panel renders the declared key) in compose project quest-p10, ended with
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
  if [ "$FAILED" -eq 0 ]; then printf '\nF-05 OK\n'; exit 0; fi
  printf '\nF-05 FAILED\n'; exit 1
}
die() { bad "$1"; finish; }

rm -rf "$SCRATCH"
section "pnpm install --frozen-lockfile, shared build + tests"
pnpm install --frozen-lockfile >/dev/null 2>&1 && ok "lockfile matches" || die "pnpm install --frozen-lockfile"
if B=$(pnpm --filter @quest/shared build 2>&1); then ok "pnpm --filter @quest/shared build"; else printf '%s\n' "$B" | tail -25; die "shared build"; fi
if T=$(pnpm --filter @quest/shared test 2>&1); then
  ok "shared vitest: $(printf '%s\n' "$T" | grep -E '^ +Tests ' | sed 's/^ *//')"
else printf '%s\n' "$T" | tail -30; bad "shared vitest"; fi
pnpm --filter @quest/shared lint >/dev/null 2>&1 && ok "shared lint" || { pnpm --filter @quest/shared lint 2>&1 | tail -20; bad "shared lint"; }

section "levels:validate over every chapter and the examples"
O=$(node "$CLI" levels 2>&1) && ok "levels (ch0, ch1, ch2): $O" || { printf '%s\n' "$O"; bad "levels:validate levels"; }
for ch in example-cli example-code example-decision example-ops; do
  O=$(node "$CLI" "levels/_examples/$ch" 2>&1) && ok "_examples/$ch: $O" || { printf '%s\n' "$O"; bad "_examples/$ch"; }
done
# The invalid examples must still fail, only with positioned file:line:col errors.
INV=0; INVBAD=0
for d in levels/_examples/invalid/*/; do
  [ -d "$d" ] || continue
  INV=$((INV + 1))
  O=$(node "$CLI" "$d" 2>&1); RC=$?
  if [ "$RC" -eq 1 ] && printf '%s\n' "$O" | grep -qE '\.yaml:[0-9]+:[0-9]+'; then :; else INVBAD=$((INVBAD + 1)); printf '%s\n' "$O" | head -5; fi
done
if [ "$INV" -gt 0 ] && [ "$INVBAD" -eq 0 ]; then ok "$INV invalid examples still fail with positioned errors"; else bad "invalid examples ($INVBAD of $INV did not fail with file:line:col)"; fi

section "no level uses the bare string show_me"
BARE=$(grep -rnE '^show_me:[[:space:]]*[^[:space:]#]' levels/ch0-boot levels/ch1-keyspace levels/ch2-everyone-showed-up levels/_examples 2>/dev/null | grep -v '/invalid/' || true)
if [ -z "$BARE" ]; then ok "every show_me is the object form"; else printf '%s\n' "$BARE"; bad "bare string show_me still present"; fi
if grep -q 'defaultKey' ui/src/showme/index.tsx; then bad "defaultKey() table still in ui/src/showme/index.tsx"; else ok "defaultKey() table removed"; fi
# normalisation of the string form is covered by packages/shared/src/levels/__tests__/show-me.test.ts (part of the shared vitest run above)

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

section "playwright: Chapter 0 end to end, show-me panel shows the declared key"
( cd ui && npx --no-install playwright install chromium >/dev/null 2>&1 ) || echo "      (playwright install chromium reported a problem; trying the run anyway)"
( cd ui && P10_BASE_URL="$BASE" npx --no-install playwright test e2e/chapter0.e2e.ts 2>&1 ) | tee "$OUT"
if [ "${PIPESTATUS[0]}" -eq 0 ]; then ok "playwright: Chapter 0 played end to end"; else bad "playwright run failed"; fi
grep -q "showme-panel" ui/e2e/chapter0.e2e.ts && grep -q 'data-key' ui/e2e/chapter0.e2e.ts && ok "e2e asserts the declared key (game:player:<id>) in the show-me panel" || bad "e2e key assertion missing"

section "GET /api/levels/:id returns the object form"
curl -fsS --max-time 5 -X POST "$BASE/api/player" >/dev/null 2>&1 || true
L=$(curl -fsS --max-time 5 "$BASE/api/levels/ch0-03-find-your-save-file" 2>/dev/null || true)
case "$L" in *'"showMe":{"component":"hash_card","keys":["'*) ok "showMe is an object with keys: $(printf '%s' "$L" | grep -o '"showMe":{[^}]*}')";; *) printf 'last reply: %s\n' "$(printf '%s' "$L" | cut -c1-200)"; bad "GET /api/levels/ch0-03 did not return showMe as { component, keys }";; esac

finish
