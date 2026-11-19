#!/usr/bin/env bash
# F-22 acceptance: the terminal that helps. No Docker, no `next build`, no `next dev`. Type check and lint (errors in
# the F-22 files only: other tasks edit other files at the same time), vitest for the F-22 test files plus the
# existing markdown/redisReply/panels tests, prettier on the F-22 files, and greps that prove the pieces and test ids
# exist and that the safety decision holds: no helper command goes through POST /api/cli by default. If the shared dev
# server answers on 127.0.0.1:3100, /terminal must serve 200. Bash 3.2 compatible.
set -u
cd "$(dirname "$0")/../.." || exit 1

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }

OWNED_SRC="ui/src/panels/TerminalPanel.tsx ui/src/panels/terminalText.ts ui/src/terminal ui/src/markdown.tsx ui/src/redisReply.ts ui/src/app/terminal"
OWNED_TEST="ui/test/markdown.test.tsx ui/test/redisReply.test.ts ui/test/panels.test.ts ui/test/terminal.fixtures.ts ui/test/terminalBus.test.ts ui/test/terminalComplete.test.ts ui/test/terminalDocs.test.ts ui/test/terminalHistory.test.ts ui/test/terminalView.test.tsx"
PATTERN='ui/src/(panels/TerminalPanel|panels/terminalText|terminal/|markdown|redisReply|app/terminal)|ui/test/(markdown|redisReply|panels|terminal)'

section "ui type check and lint (F-22 files)"
T=$(pnpm --filter @quest/ui exec tsc --noEmit 2>&1)
MINE=$(printf '%s\n' "$T" | grep -E "^($PATTERN)" || true)
if [ -z "$MINE" ]; then ok "tsc --noEmit: no errors in the F-22 files"; else printf '%s\n' "$MINE" | tail -25; bad "tsc --noEmit"; fi
OTHERS=$(printf '%s\n' "$T" | grep -cE '^[^ ].*error TS' || true)
[ "$OTHERS" -gt 0 ] && printf 'note: %s type error(s) elsewhere (other tasks), not counted\n' "$OTHERS"
FILES=$(printf '%s\n' $OWNED_SRC $OWNED_TEST | sed 's#^ui/##')
if L=$(cd ui && pnpm exec eslint $FILES 2>&1); then ok "eslint on the F-22 files"; else printf '%s\n' "$L" | tail -25; bad "eslint"; fi

section "vitest"
if V=$(cd ui && pnpm exec vitest run test/markdown.test.tsx test/redisReply.test.ts test/panels.test.ts test/terminalBus.test.ts test/terminalComplete.test.ts test/terminalDocs.test.ts test/terminalHistory.test.ts test/terminalView.test.tsx 2>&1); then
  ok "vitest: $(printf '%s\n' "$V" | grep -E '^ +Tests ' | sed 's/^ *//')"
  for f in markdown redisReply panels terminalBus terminalComplete terminalDocs terminalHistory terminalView; do
    if printf '%s\n' "$V" | grep -q "$f"; then ok "ran $f"; else bad "$f did not run"; fi
  done
else printf '%s\n' "$V" | tail -30; bad "vitest"; fi

section "prettier"
if pnpm exec prettier --check $OWNED_SRC $OWNED_TEST >/tmp/f22-prettier.$$ 2>&1; then ok "prettier --check on the F-22 files"; else tail -10 /tmp/f22-prettier.$$; bad "prettier"; fi
rm -f /tmp/f22-prettier.$$

section "test ids, roles and pieces exist"
PANEL=ui/src/panels/TerminalPanel.tsx
for id in 'data-testid="terminal"' 'data-testid="terminal-frame"' 'data-testid="terminal-light"' 'data-testid="terminal-target-toggle"'; do
  if grep -q "$id" "$PANEL"; then ok "$PANEL has $id"; else bad "$PANEL lacks $id"; fi
done
for id in 'data-testid="terminal-popup"' 'data-testid="terminal-option"' 'data-testid="terminal-assist"' 'data-testid="terminal-syntax"'; do
  if grep -q "$id" ui/src/terminal/Assist.tsx; then ok "Assist.tsx has $id"; else bad "Assist.tsx lacks $id"; fi
done
if grep -q 'role="group"' "$PANEL" && grep -q 'aria-label="Redis terminal. Click, then type a command and press Enter."' "$PANEL"; then ok "terminal keeps its role and label"; else bad "terminal role/label changed"; fi
if grep -q 'data-ds=""' "$PANEL" && grep -q 'data-ds=""' ui/src/app/terminal/page.tsx; then ok "data-ds on the rebuilt roots"; else bad "data-ds missing"; fi
if grep -q "cssHeight\|height === 'fill'" "$PANEL" || grep -q "const fill = height === 'fill'" "$PANEL"; then ok "height supports pixels and 'fill'"; else bad "height handling missing"; fi
if grep -q 'pinScrollOnOutsidePress' "$PANEL"; then ok "F-06 focus fix kept"; else bad "F-06 focus fix missing"; fi
if grep -q '\[warning\]' ui/src/panels/terminalText.ts && grep -q 'dangerNote' "$PANEL"; then ok "danger warning kept ([warning] text, same trigger)"; else bad "danger warning changed"; fi
for f in bus.ts complete.ts docs.ts history.ts Assist.tsx useDocs.ts terminal.module.css markdown.module.css; do
  [ -f "ui/src/terminal/$f" ] && ok "ui/src/terminal/$f" || bad "ui/src/terminal/$f missing"
done
if grep -q 'registerTerminal' "$PANEL" && grep -q 'sendToTerminal' ui/src/markdown.tsx; then ok "markdown sends through the bus, the panel listens"; else bad "bus not wired"; fi

section "the safety decision holds: no helper command through POST /api/cli"
if grep -nE 'api\.cli\(' $OWNED_SRC -r | grep -v 'TerminalPanel.tsx' | grep -q .; then
  grep -nE 'api\.cli\(' -r ui/src/terminal ui/src/markdown.tsx; bad "api.cli( used outside the panel's own Enter path"
else ok "api.cli( appears only in the terminal's Enter path"; fi
if [ "$(grep -c 'api\.cli(' "$PANEL")" = "1" ]; then ok "TerminalPanel has exactly one api.cli call (the player's command)"; else bad "TerminalPanel api.cli count is not 1"; fi
if grep -q 'active ??= new DocsStore(engineSource)' ui/src/terminal/docs.ts; then ok "default docs source is the read-only engine endpoint"; else bad "default docs source is not engineSource"; fi
if grep -nE "from '(\.\./)+api'|from '\./api'" ui/src/terminal/*.ts ui/src/terminal/*.tsx ui/src/markdown.tsx | grep -q .; then bad "ui/src/terminal or markdown imports api.ts"; else ok "ui/src/terminal and markdown never import api.ts"; fi
if grep -nE "COMMAND (DOCS|LIST)" ui/src/panels/TerminalPanel.tsx ui/src/markdown.tsx | grep -q .; then bad "COMMAND DOCS/LIST sent from the panel or markdown"; else ok "no COMMAND DOCS/LIST in the panel or markdown"; fi

section "dev server (optional)"
if curl -s -o /dev/null -m 3 http://127.0.0.1:3100/terminal; then
  CODE=$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:3100/terminal)
  if [ "$CODE" = "200" ]; then ok "GET http://127.0.0.1:3100/terminal -> 200"; else bad "GET /terminal -> $CODE"; fi
else
  echo "skip  dev server not reachable on 127.0.0.1:3100"
fi

echo
if [ "$FAILED" = 0 ]; then echo "F-22 OK"; else echo "F-22 FAILED"; exit 1; fi
