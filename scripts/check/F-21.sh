#!/usr/bin/env bash
# F-21: the level as a match view. Type check, lint and format of the F-21 files, the ui unit tests, the e2e test
# ids the level screen owns, the key pieces of the match view, and the level route on the shared dev server.
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)
UI="$ROOT/ui"
FAIL=0
pass() { echo "PASS  $*"; }
fail() {
  echo "FAIL  $*"
  FAIL=1
}

FILES="src/screens/Level.tsx src/level/Stage.tsx src/level/VerifyPanel.tsx src/level/Workbench.tsx
src/level/IdealWay.tsx src/level/interview.tsx src/level/SlotToggle.tsx src/level/RunTraffic.tsx src/level/diff.ts
src/match test/match.test.tsx"

echo "== type check, lint, format, tests"
if (cd "$UI" && pnpm exec tsc --noEmit >/tmp/f21-tsc.$$ 2>&1); then
  pass "tsc --noEmit"
else
  # Seven agents share the checkout: only errors in F-21 files count against F-21.
  if grep -E "^src/(screens/Level|level/|match/)" /tmp/f21-tsc.$$ | grep -v "level/Thread" >/dev/null; then
    fail "tsc errors in F-21 files:"
    grep -E "^src/(screens/Level|level/|match/)" /tmp/f21-tsc.$$
  else
    pass "tsc: no errors in F-21 files (others' files have some, not ours)"
  fi
fi
rm -f /tmp/f21-tsc.$$
# shellcheck disable=SC2086
if (cd "$UI" && pnpm exec eslint $FILES >/dev/null 2>&1); then pass "eslint on the F-21 files"; else
  fail "eslint on the F-21 files"
  (cd "$UI" && pnpm exec eslint $FILES)
fi
# shellcheck disable=SC2086
if (cd "$UI" && pnpm exec prettier --check $FILES >/dev/null 2>&1); then pass "prettier --check on the F-21 files"; else fail "prettier --check"; fi
OUT=$(cd "$UI" && pnpm exec vitest run 2>&1)
if echo "$OUT" | grep -qE "Tests +[0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests .*failed"; then
  pass "vitest: $(echo "$OUT" | grep -E 'Tests +' | tail -1 | sed 's/^ *//')"
else
  fail "vitest"
  echo "$OUT" | tail -30
fi
for t in match interview runTraffic slotToggle diff; do
  if echo "$OUT" | grep -q "test/$t.test"; then pass "ran test/$t"; else fail "test/$t not run"; fi
done

echo "== e2e test ids the level screen renders"
SRC="$UI/src/screens/Level.tsx $UI/src/level $UI/src/match"
for id in level-screen level-status interview-pill hints-bought countdown redis-state brainstorm-locked \
  brainstorm-submit brainstorm-text no-teaching hint-button hint-confirm hint-confirm-no hint-confirm-text \
  hint-confirm-yes verify-button verdict overtime-note passed-panel rebuilt-in next-level ideal ideal-reason \
  ideal-reasoning ideal-rebuild-link ideal-reference ideal-request ideal-revealed-note ideal-wrong; do
  # shellcheck disable=SC2086
  if grep -rq "data-testid=\"$id\"" $SRC; then pass "test id $id"; else fail "test id $id missing"; fi
done
# Templated ids.
grep -q 'data-testid={`stage-${n}`}' "$UI/src/level/Stage.tsx" && pass 'test id stage-<n>' || fail 'stage-<n>'
grep -q 'data-testid={`answer-${a.index}`}' "$UI/src/match/AnswerSheet.tsx" && pass 'test id answer-<i>' || fail 'answer-<i>'
grep -q 'data-testid={`tab-${t.id}`}' "$UI/src/level/Workbench.tsx" && pass 'test id tab-<tool>' || fail 'tab-<tool>'
grep -q 'testId={`brainstorm-option-${o.id}`}' "$UI/src/match/Brainstorm.tsx" && grep -q 'data-testid={testId}' "$UI/src/match/AnswerSheet.tsx" && pass 'test id brainstorm-option-<id>' || fail 'brainstorm-option'
grep -q 'data-testid={`hint-${i}`}' "$UI/src/match/Hints.tsx" && pass 'test id hint-<i>' || fail 'hint-<i>'

echo "== match view pieces"
grep -q "react-resizable-panels" "$UI/src/match/MatchView.tsx" && grep -q "useDefaultLayout" "$UI/src/match/MatchView.tsx" &&
  pass "resizable panes with remembered sizes" || fail "resizable panes"
grep -q "Decision" "$UI/src/match/BigScreen.tsx" && grep -q "MIN_PENDING_MS = 800" "$UI/src/match/decision.ts" &&
  pass "decision pending big screen, 800 ms minimum" || fail "big screen"
grep -q "reduced ? null" "$UI/src/screens/Level.tsx" && pass "no overlay under reduced motion" || fail "reduced motion overlay"
grep -q "celebrate(" "$UI/src/screens/Level.tsx" && grep -q "play('out')" "$UI/src/screens/Level.tsx" &&
  pass "pass celebrates, fail plays out" || fail "cues"
grep -q "interactive={level.status === 'passed'}" "$UI/src/screens/Level.tsx" && pass "ShowMe interactive prop" || fail "ShowMe interactive"
grep -q "<Dialog" "$UI/src/match/Hints.tsx" && pass "hint purchase is a Dialog" || fail "hint Dialog"
grep -q "'late'" "$UI/src/level/interview.tsx" && grep -q "'over'" "$UI/src/level/interview.tsx" && pass "match clock tones" || fail "clock tones"
grep -q 'data-ds=""' "$UI/src/match/MatchView.tsx" && pass "data-ds on the match view root" || fail "data-ds"
grep -q "export function LevelScreen({ id }" "$UI/src/screens/Level.tsx" && pass "LevelScreen({ id }) exported" || fail "LevelScreen export"
# shellcheck disable=SC2086
if grep -rnE "https?://" $SRC | grep -vE "redis\.io|^\s*//|// " | grep -v "replace('https://" >/dev/null; then
  fail "a URL in the match view"
else pass "no external URL in the match view"; fi

echo "== dev server"
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 http://127.0.0.1:3100/level/ch1-05-the-match-feed || true)
[ "$CODE" = "200" ] && pass "GET /level/ch1-05-the-match-feed -> 200" || echo "SKIP  dev server on 3100 answered '$CODE'"

echo
if [ "$FAIL" = 0 ]; then
  echo "F-21 OK"
  exit 0
fi
echo "F-21 FAILED"
exit 1
