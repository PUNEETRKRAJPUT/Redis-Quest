#!/usr/bin/env bash
# F-25 acceptance: the rebuilt UI is proven end to end. ui build, lint, unit tests and prettier; no legacy
# stylesheet left; the five README images exist at 800x600; README format and C-POL; then every check that greps
# or builds the UI, one at a time, each in its own isolated compose project (P0-10 first). Never touches the
# owner's `redis-quest` project or the shared `quest-dev` one. Bash 3.2 compatible.
#
#   F25_ONLY_P10=1   run P0-10 only from the stack-based checks (skips F-04, F-05, F-10, F-12, F-UI, F-15)
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)

FAILED=0
RESULTS=""
ok() { printf 'PASS  %s\n' "$1"; }
bad() {
  printf 'FAIL  %s\n' "$1"
  FAILED=1
}
section() { printf '\n== %s\n' "$1"; }
record() { RESULTS="$RESULTS$(printf '%-6s %s' "$1" "$2")
"; }

section "ui build, lint, unit tests, prettier"
if B=$(pnpm --filter @quest/ui build 2>&1); then ok "pnpm --filter @quest/ui build"; else
  printf '%s\n' "$B" | tail -25
  bad "ui build"
fi
if pnpm --filter @quest/ui lint >/dev/null 2>&1; then ok "ui lint"; else
  pnpm --filter @quest/ui lint 2>&1 | tail -20
  bad "ui lint"
fi
if (cd ui && pnpm exec tsc --noEmit >/dev/null 2>&1); then ok "ui tsc --noEmit"; else bad "ui tsc --noEmit"; fi
if T=$(pnpm --filter @quest/ui test 2>&1); then ok "ui vitest: $(printf '%s\n' "$T" | grep -E '^ +Tests ' | sed 's/^ *//')"; else
  printf '%s\n' "$T" | tail -30
  bad "ui vitest"
fi
if (cd ui && pnpm exec prettier --check src test e2e playwright.config.ts >/dev/null 2>&1); then ok "prettier --check ui/src ui/test ui/e2e"; else
  (cd ui && pnpm exec prettier --check src test e2e playwright.config.ts 2>&1 | tail -10)
  bad "prettier --check on ui"
fi

section "the legacy stylesheet is gone"
if [ ! -e ui/src/styles.css ]; then ok "ui/src/styles.css deleted"; else bad "ui/src/styles.css still exists"; fi
if grep -rn "styles\.css['\"]" ui/src >/dev/null 2>&1; then
  grep -rn "styles\.css['\"]" ui/src
  bad "something still imports styles.css"
else ok "no import of styles.css in ui/src"; fi
# The hooks were the list's 'thread' class, the row's 'msg' class and the important (!) resets that fought the old sheet.
if grep -nE "LIST_RESET, 'thread'|^ +'msg',$|(LIST|ROW)_RESET =.*!" ui/src/level/Thread.tsx ui/src/thread/parts.tsx >/dev/null 2>&1; then bad "legacy thread hooks still in the thread markup"; else ok "thread: no legacy .thread/.msg hooks, no !important resets"; fi
if grep -q "\.thread .msg" ui/e2e/*.e2e.ts; then bad "e2e still uses .thread .msg"; else ok "e2e finds messages by data-testid=thread-msg"; fi

section "polish items"
grep -q "startsWith(VERIFY_PREFIX)" ui/src/shell/eventToasts.ts && ok "verify_* events do not toast" || bad "verify_* events still toast"
grep -q "styles.prose" ui/src/markdown.tsx && ! grep -q '\.md>' ui/src/screens/Level.tsx && ok "markdown spaces its own blocks; the level's temporary gap is gone" || bad "markdown spacing"
grep -q "onTerminalWanted" ui/src/level/Workbench.tsx && ok "send-to-terminal opens the workbench's terminal" || bad "workbench does not answer onTerminalWanted"
grep -q "Nukkad Cricket League" ui/src/screens/ChapterMap.tsx && ! grep -q "Hostel league" ui/src/screens/ChapterMap.tsx && ok "map eyebrow names the league" || bad "map eyebrow"
grep -q 'data-testid="editor-files-toggle"' ui/src/panels/EditorPanel.tsx && ok "editor file list is collapsible" || bad "editor file list toggle missing"

section "README images and text"
for f in map mock-interview show-me-gallery terminal-target what-you-built; do
  p="docs/img/$f.jpg"
  if [ -f "$p" ]; then
    W=$(sips -g pixelWidth "$p" 2>/dev/null | awk '/pixelWidth/ {print $2}')
    H=$(sips -g pixelHeight "$p" 2>/dev/null | awk '/pixelHeight/ {print $2}')
    FMT=$(sips -g format "$p" 2>/dev/null | awk '/format/ {print $2}')
    if [ "$W" = 800 ] && [ "$H" = 600 ] && [ "$FMT" = jpeg ]; then ok "$p is an 800x600 JPEG"; else bad "$p is ${W}x${H} $FMT"; fi
  else bad "$p missing"; fi
done
if pnpm exec prettier --check --ignore-path /dev/null README.md >/dev/null 2>&1; then ok "README.md formatted"; else bad "README.md not prettier-formatted"; fi
if bash scripts/check/C-POL.sh >/tmp/f25-cpol.$$ 2>&1; then
  ok "C-POL.sh"
  record C-POL PASS
else
  tail -15 /tmp/f25-cpol.$$
  bad "C-POL.sh"
  record C-POL FAIL
fi
rm -f /tmp/f25-cpol.$$

run_check() { # run_check ID : runs scripts/check/ID.sh, keeps its tail
  id=$1
  section "scripts/check/$id.sh"
  out="/tmp/f25-$id.$$"
  if bash "scripts/check/$id.sh" >"$out" 2>&1; then
    ok "$id.sh"
    record "$id" PASS
  else
    bad "$id.sh"
    record "$id" FAIL
  fi
  grep -E '^(PASS|FAIL|ok|FAIL:)|passed|failed|OK$|FAILED' "$out" | tail -8 | sed 's/^/      /'
  rm -f "$out"
}

# Checks without Docker (some also GET a route from the shared dev server on 3100 when it is up).
# P0-01 is not run here: it is a platform check, not a UI check, and belongs to the full local run. (When this
# script was written P0-01 still acted on the default compose project and stopped a player's Redis and Postgres;
# since G-03 it runs in its own project.)
for id in F-13 F-14 F-16 F-17 F-18 F-19 F-20 F-21 F-22 F-23 F-24; do run_check "$id"; done

# Checks with their own isolated stack (quest-p10 or quest-f15), strictly one at a time; each tears down.
run_check P0-10
if [ -z "${F25_ONLY_P10:-}" ]; then
  for id in F-UI F-04 F-05 F-10 F-12 F-15; do run_check "$id"; done
fi

section "summary"
printf '%s' "$RESULTS"
if [ "$FAILED" -eq 0 ]; then
  printf '\nF-25 OK\n'
  exit 0
fi
printf '\nF-25 FAILED\n'
exit 1
