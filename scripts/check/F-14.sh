#!/usr/bin/env bash
# F-14: the UI runs on Next.js (App Router). Builds, lints and tests the ui package, then checks that the build
# lists every game route, that the Vite app is gone and that no hash link is left in ui/src. No Docker, no stack.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UI="$ROOT/ui"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cd "$ROOT"

echo "== Vite app removed"
for f in index.html vite.config.ts src/main.tsx src/App.tsx src/router.ts src/vite-env.d.ts; do
  [ ! -e "$UI/$f" ] || fail "ui/$f still exists"
done
[ -f "$UI/vitest.config.ts" ] || fail "ui/vitest.config.ts is missing"
echo "ok: index.html, vite.config.ts, main.tsx, App.tsx, router.ts, vite-env.d.ts gone; vitest.config.ts present"

echo "== no hash links in ui/src"
# An href (or a QuestLink `to`) whose value starts with #/ is a link into the old hash router.
if grep -rnE "(href|to)=\{?['\"\`]#/" "$UI/src" >"$TMP/hash.txt"; then
  cat "$TMP/hash.txt" >&2
  fail "hash links remain in ui/src"
fi
if grep -rn "hrefFor\|from '\.\./router'\|from '\./router'" "$UI/src" >"$TMP/router.txt"; then
  cat "$TMP/router.txt" >&2
  fail "references to the old hash router remain"
fi
echo "ok: no href=\"#/...\", no hrefFor, no router imports"

echo "== shell and routes in place"
for f in src/shell/GameShell.tsx src/shell/QuestLink.tsx src/routes.ts; do
  [ -f "$UI/$f" ] || fail "ui/$f is missing"
done
grep -q "<GameShell>" "$UI/src/app/layout.tsx" || fail "the root layout does not mount GameShell"
grep -q "NEXT_PUBLIC_QUEST_WS_PORT" "$UI/next.config.ts" || fail "next.config.ts does not expose the dev socket port"
echo "ok: GameShell mounted from the root layout, QuestLink and routes.ts present, dev socket port exposed"

echo "== lint"
pnpm --filter @quest/ui lint >"$TMP/lint.txt" 2>&1 || {
  cat "$TMP/lint.txt" >&2
  fail "lint"
}
echo "ok: eslint clean"

echo "== unit tests"
pnpm --filter @quest/ui test >"$TMP/test.txt" 2>&1 || {
  cat "$TMP/test.txt" >&2
  fail "unit tests"
}
TESTS="$(grep -E '^ +Tests ' "$TMP/test.txt" | tail -1 | sed -E 's/^ +//')"
PASSED="$(echo "$TESTS" | sed -E 's/^Tests +([0-9]+) passed.*/\1/')"
case "$PASSED" in
  '' | *[!0-9]*) fail "could not read the test count from: $TESTS" ;;
esac
[ "$PASSED" -ge 84 ] || fail "expected at least 84 tests, got $PASSED"
echo "ok: $TESTS"

echo "== next build"
pnpm --filter @quest/ui build >"$TMP/build.txt" 2>&1 || {
  cat "$TMP/build.txt" >&2
  fail "next build"
}
for r in '/' '/level/\[id\]' '/terminal' '/editor' '/logs' '/metrics' '/built' '/showme'; do
  # Route lines look like "├ ○ /terminal"; match on the path at the end of the line.
  grep -qE " ${r}\$" "$TMP/build.txt" || {
    sed -n '/^Route (app)/,$p' "$TMP/build.txt" >&2
    fail "route $r is not in the build output"
  }
done
[ -f "$UI/.next/standalone/ui/server.js" ] || fail "standalone server missing at ui/.next/standalone/ui/server.js"
# The dev-only socket port must not leak into the production bundle: there the socket is same-origin.
if grep -rqE 'NEXT_PUBLIC_QUEST_WS_PORT' "$UI/.next/static"; then
  fail "the production bundle still reads NEXT_PUBLIC_QUEST_WS_PORT"
fi
echo "ok: build lists / /level/[id] /terminal /editor /logs /metrics /built /showme; standalone server.js present"
sed -n '/^Route (app)/,/^$/p' "$TMP/build.txt"

echo "F-14 check passed"
