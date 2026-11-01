#!/usr/bin/env bash
# F-12 acceptance: interview mode. Shared build + tests (schema: valid, bad rebuild_of, minutes out of range),
# levels:validate over the examples (and the interview example's cross-chapter rule), engine tests for the
# timer and the hint cost, ui build/lint/vitest, then a Playwright run in compose project quest-p10 (.env.p10)
# that starts the example interview level, sees the countdown, buys a hint and sees XP drop, and ends with
# `docker compose -p quest-p10 down -v`. Bash 3.2 compatible.
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

PROJECT=quest-p10
ENVFILE=.env.p10
PORT=3300
BASE="http://127.0.0.1:$PORT"
SCRATCH="$ROOT/ui/e2e/.scratch"
CASES="$ROOT/ui/e2e/.scratch-f12-cases"
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
  rm -rf "$SCRATCH" "$CASES"
  if [ "$FAILED" -eq 0 ]; then printf '\nF-12 OK\n'; exit 0; fi
  printf '\nF-12 FAILED\n'; exit 1
}
die() { bad "$1"; finish; }

rm -rf "$SCRATCH" "$CASES"
section "pnpm install --frozen-lockfile, shared build + tests"
pnpm install --frozen-lockfile >/dev/null 2>&1 && ok "lockfile matches" || die "pnpm install --frozen-lockfile"
if B=$(pnpm --filter @quest/shared build 2>&1); then ok "pnpm --filter @quest/shared build"; else printf '%s\n' "$B" | tail -25; die "shared build"; fi
if T=$(pnpm --filter @quest/shared test 2>&1); then
  ok "shared vitest: $(printf '%s\n' "$T" | grep -E '^ +Tests ' | sed 's/^ *//')"
else printf '%s\n' "$T" | tail -30; bad "shared vitest"; fi
if printf '%s\n' "${T:-}" | grep -q 'interview.test.ts'; then ok "schema cases ran (interview.test.ts: valid, bad rebuild_of, minutes out of range)"; else bad "interview.test.ts did not run"; fi
pnpm --filter @quest/shared lint >/dev/null 2>&1 && ok "shared lint" || { pnpm --filter @quest/shared lint 2>&1 | tail -20; bad "shared lint"; }

section "levels:validate: the real tree, the examples, the interview example"
O=$(node "$CLI" levels 2>&1) && ok "levels: $O" || { printf '%s\n' "$O"; bad "levels:validate levels"; }
for ch in example-cli example-code example-decision example-ops; do
  O=$(node "$CLI" "levels/_examples/$ch" 2>&1) && ok "_examples/$ch: $O" || { printf '%s\n' "$O"; bad "_examples/$ch"; }
done
O=$(node "$CLI" levels/_examples/example-code levels/_examples/example-interview 2>&1) \
  && ok "example-code + example-interview: $O" || { printf '%s\n' "$O"; bad "example-interview with example-code"; }
O=$(node "$CLI" levels/_examples/example-interview 2>&1); RC=$?
if [ "$RC" -eq 1 ] && printf '%s\n' "$O" | grep -q 'interview.rebuild_of: .*pass the chapter holding it too'; then
  ok "example-interview alone: rebuild_of cannot be resolved without its chapter (exit 1)"
else printf '%s\n' "$O"; bad "example-interview alone should report an unresolved rebuild_of"; fi
INV=0; INVBAD=0
for d in levels/_examples/invalid/*/; do
  [ -d "$d" ] || continue
  INV=$((INV + 1))
  O=$(node "$CLI" "$d" 2>&1); RC=$?
  if [ "$RC" -eq 1 ] && printf '%s\n' "$O" | grep -qE '\.yaml:[0-9]+:[0-9]+'; then :; else INVBAD=$((INVBAD + 1)); printf '%s\n' "$O" | head -5; fi
done
if [ "$INV" -gt 0 ] && [ "$INVBAD" -eq 0 ]; then ok "$INV invalid examples still fail with positioned errors"; else bad "invalid examples ($INVBAD of $INV did not fail with file:line:col)"; fi

# The three schema cases through the real command line: each must exit 1 with a positioned error on the right field.
mkdir -p "$CASES"
mk_case() { # name sed-expression
  mkdir -p "$CASES/$1"
  cp -R levels/_examples/example-code "$CASES/$1/example-code"
  cp -R levels/_examples/example-interview "$CASES/$1/example-interview"
  sed -i '' -e "$2" "$CASES/$1/example-interview/01-cache-aside-rebuild.yaml"
}
expect_fail() { # name field-regex
  O=$(node "$CLI" "$CASES/$1" 2>&1); RC=$?
  if [ "$RC" -eq 1 ] && printf '%s\n' "$O" | grep -qE "01-cache-aside-rebuild\.yaml:[0-9]+:[0-9]+ $2"; then
    ok "case $1 -> $(printf '%s\n' "$O" | grep -E "$2" | head -1 | sed "s#$CASES/##" | cut -c1-170)"
  else printf '%s\n' "$O"; bad "case $1 should exit 1 with an error on $2"; fi
}
mk_case valid 's/minutes: 10/minutes: 5/'
O=$(node "$CLI" "$CASES/valid" 2>&1) && ok "case valid (minutes: 5): $O" || { printf '%s\n' "$O"; bad "case valid"; }
mk_case bad-rebuild 's/rebuild_of: example-code-01-cache-aside/rebuild_of: example-code-09-nothing/'
expect_fail bad-rebuild 'interview\.rebuild_of: example-code-09-nothing is not a level'
mk_case minutes-low 's/minutes: 10/minutes: 4/'
expect_fail minutes-low 'interview\.minutes: .*at least 5'
mk_case minutes-high 's/minutes: 10/minutes: 61/'
expect_fail minutes-high 'interview\.minutes: .*at most 60'
mk_case no-interview 's/^interview:/xinterview:/'
expect_fail no-interview 'xinterview: unknown key'
rm -rf "$CASES"

section "engine: build, lint, interview tests (timer, hint cost, routes)"
if B=$(pnpm --filter @quest/engine build 2>&1); then ok "pnpm --filter @quest/engine build"; else printf '%s\n' "$B" | tail -25; die "engine build"; fi
pnpm --filter @quest/engine lint >/dev/null 2>&1 && ok "engine lint" || { pnpm --filter @quest/engine lint 2>&1 | tail -20; bad "engine lint"; }
if T=$(cd engine && npx --no-install vitest run test/interview.test.ts 2>&1); then
  ok "engine interview tests: $(printf '%s\n' "$T" | grep -E '^ +Tests ' | sed 's/^ *//')"
else printf '%s\n' "$T" | tail -40; bad "engine interview tests"; fi

section "ui build, lint, unit tests"
if B=$(pnpm --filter @quest/ui build 2>&1); then ok "pnpm --filter @quest/ui build"; else printf '%s\n' "$B" | tail -25; die "ui build"; fi
pnpm --filter @quest/ui lint >/dev/null 2>&1 && ok "ui lint" || { pnpm --filter @quest/ui lint 2>&1 | tail -20; bad "ui lint"; }
if T=$(pnpm --filter @quest/ui test 2>&1); then
  ok "ui vitest: $(printf '%s\n' "$T" | grep -E '^ +Tests ' | sed 's/^ *//')"
else printf '%s\n' "$T" | tail -30; bad "ui vitest"; fi

section "format (CI runs pnpm format:check; here only the files this task touches, other agents' files are theirs)"
FILES="packages/shared/src/levels/schema.ts packages/shared/src/levels/loader.ts packages/shared/src/levels/cli.ts packages/shared/src/levels/__tests__/interview.test.ts engine/src/interview.ts engine/src/progress.ts engine/src/levels.ts engine/src/server.ts engine/test/interview.test.ts ui/src/types.ts ui/src/api.ts ui/src/styles.css ui/src/level/interview.tsx ui/src/level/IdealWay.tsx ui/src/screens/Level.tsx ui/src/screens/Built.tsx ui/test/interview.test.tsx ui/e2e/interview.e2e.ts"
# shellcheck disable=SC2086
if npx --no-install prettier --check $FILES >/dev/null 2>&1; then ok "prettier --check on the files this task touches"; else npx --no-install prettier --check $FILES 2>&1 | tail -15; bad "prettier --check"; fi

section "isolated stack settings ($ENVFILE, project $PROJECT)"
rm -rf "$SCRATCH"
mkdir -p "$SCRATCH/levels" "$SCRATCH/progress" "$SCRATCH/workspace" "$SCRATCH/logs" ui/e2e/screenshots
rm -f ui/e2e/screenshots/F-12-*.png
cp -R levels/_examples/example-code "$SCRATCH/levels/example-code"
cp -R levels/_examples/example-interview "$SCRATCH/levels/example-interview"
mkdir -p "$SCRATCH/workspace/ch2"
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
ok "wrote $ENVFILE (gitignored): ports 3300 6393 5435 5543, scratch dirs, example-code + example-interview only"
for p in 3300 6393 5435 5543; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    if [ -z "$(compose ps -q 2>/dev/null)" ]; then die "port $p is already in use by something that is not the $PROJECT stack"; fi
  fi
done

section "docker compose -p $PROJECT up -d --build (full stack)"
compose down -v --remove-orphans >/dev/null 2>&1
UP=""
for attempt in 1 2 3; do
  compose up -d --build 2>&1 | tail -n 24
  if [ "${PIPESTATUS[0]}" -eq 0 ]; then UP=1; break; fi
  echo "      (compose up failed, attempt $attempt of 3; the node image build is shared, retrying)"
  sleep 5
done
if [ -n "$UP" ]; then ok "stack started"; else die "compose up"; fi

section "wait for the engine through the proxy"
READY=""; i=0
while [ $i -lt 90 ]; do
  H=$(curl -fsS --max-time 2 "$BASE/health" 2>/dev/null || true)
  case "$H" in *'"redis":"up","postgres":"up"'*'"levels":"ok"'*) READY=1; break;; esac
  i=$((i + 1)); sleep 2
done
if [ -n "$READY" ]; then ok "GET $BASE/health: $H"; else compose logs --tail 40 engine 2>&1 | tail -40; die "engine did not become healthy"; fi

section "playwright: the example interview level end to end"
( cd ui && npx --no-install playwright install chromium >/dev/null 2>&1 ) || echo "      (playwright install chromium reported a problem; trying the run anyway)"
( cd ui && P10_BASE_URL="$BASE" npx --no-install playwright test e2e/interview.e2e.ts 2>&1 ) | tee "$OUT"
if [ "${PIPESTATUS[0]}" -eq 0 ]; then ok "playwright: countdown, no teaching, hint cost, XP drop, rebuilt in m:ss"; else bad "playwright run failed"; fi
for f in F-12-countdown F-12-hint-cost-prompt; do
  if [ -s "ui/e2e/screenshots/$f.png" ]; then ok "screenshot ui/e2e/screenshots/$f.png"; else bad "missing screenshot $f.png"; fi
done

section "the engine's own answers"
P=$(curl -fsS --max-time 5 "$BASE/api/progress" 2>/dev/null || true)
L=$(curl -fsS --max-time 5 "$BASE/api/levels/example-interview-01-cache-aside-rebuild" 2>/dev/null || true)
case "$L" in *'"interview":{"minutes":10,"hintXpCost":10'*'"remainingMs":'*) ok "GET /api/levels/:id carries interview and remainingMs";; *) printf 'last reply: %s\n' "$(printf '%s' "$L" | cut -c1-300)"; bad "interview / remainingMs missing from GET /api/levels/:id";; esac
case "$P" in *'"hintsBought":1'*'"interviewElapsedMs"'*|*'"interviewElapsedMs"'*'"hintsBought":1'*) ok "progress.json records hintsBought and interviewElapsedMs";; *) printf 'progress: %s\n' "$(printf '%s' "$P" | cut -c1-400)"; bad "progress fields missing";; esac

finish
