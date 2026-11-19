#!/usr/bin/env bash
# F-17 acceptance: the scoreboard shell. No Docker, no `next build`, no `next dev`. Type check, lint and vitest for
# ui; prettier on the F-17 files; greps that prove the test ids, texts, commands and key pieces exist; if the shared
# dev server answers on 127.0.0.1:3100, the routes serve 200. Bash 3.2 compatible.
set -u
cd "$(dirname "$0")/../.." || exit 1

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }
has() { # has <file-or-dir> <fixed string> <label>
  if grep -rqF -- "$2" "$1"; then ok "$3"; else bad "$3 (missing: $2 in $1)"; fi
}

SH=ui/src/shell

section "ui type check, lint, vitest"
if T=$(pnpm --filter @quest/ui exec tsc --noEmit 2>&1); then ok "tsc --noEmit"; else printf '%s\n' "$T" | tail -25; bad "tsc --noEmit"; fi
if L=$(pnpm --filter @quest/ui lint 2>&1); then ok "eslint"; else printf '%s\n' "$L" | tail -25; bad "eslint"; fi
if V=$(pnpm --filter @quest/ui test 2>&1); then
  ok "vitest: $(printf '%s\n' "$V" | grep -E '^ +Tests ' | sed 's/^ *//')"
  for f in shell.test.ts shell.test.tsx; do
    if printf '%s\n' "$V" | grep -q "$f"; then ok "ran ui/test/$f"; else bad "ui/test/$f did not run"; fi
  done
else printf '%s\n' "$V" | tail -30; bad "vitest"; fi
if P=$(pnpm exec prettier --check ui/src/shell ui/src/app/layout.tsx ui/test/shell.test.ts ui/test/shell.test.tsx 2>&1); then
  ok "prettier --check on the F-17 files"; else printf '%s\n' "$P" | tail -10; bad "prettier"; fi

section "root layout and shell wiring (kept from F-14 and F-16)"
has ui/src/app/layout.tsx "import { DesignRuntime } from '@/design/components/feedback'" "layout imports DesignRuntime from its client module"
has ui/src/app/layout.tsx "<DesignRuntime>" "layout mounts DesignRuntime"
has ui/src/app/layout.tsx "<GameShell>" "layout mounts GameShell"
has ui/src/app/layout.tsx "shell/shell.css" "layout imports shell.css"
has $SH/GameShell.tsx "import { Welcome } from '../screens/Welcome'" "GameShell imports Welcome without props"
has $SH/GameShell.tsx "<Welcome />" "GameShell renders <Welcome /> on boot=welcome"
has $SH/GameShell.tsx "startWs()" "GameShell starts the socket"
has $SH/GameShell.tsx "2500" "GameShell retries init every 2.5 s while offline"
has $SH/GameShell.tsx "useLegacyHashRedirect" "legacy hash redirect kept"

section "test ids, texts and roles the old shell had"
has $SH/Hud.tsx 'data-testid="conn-state"' "conn-state test id"
has $SH/rain.ts "'reconnecting'" "status word: reconnecting"
has $SH/rain.ts "'redis down'" "status word: redis down"
has $SH/rain.ts "'Connected to the engine and Redis'" "aria label: connected"
has $SH/rain.ts "'Reconnecting to the engine'" "aria label: reconnecting"
has $SH/rain.ts "'Redis is down'" "aria label: redis down"
has $SH/MirrorBanner.tsx 'data-testid="mirror-banner"' "mirror-banner test id"
has $SH/MirrorBanner.tsx 'role="alert"' "mirror banner is an alert"
has $SH/MirrorBanner.tsx "Restore my save file" "restore button text"
has $SH/BootScreens.tsx 'testId="offline"' "offline test id"
has $SH/BootScreens.tsx 'testId="levels-invalid"' "levels-invalid test id"
has $SH/BootScreens.tsx "The game engine is not answering" "offline heading"
has $SH/BootScreens.tsx "The level files have errors" "invalid heading"
has $SH/BootScreens.tsx "Starting..." "loading text"
has $SH/GameShell.tsx "Skip to content" "skip link"
has $SH/Hud.tsx 'aria-label="Main"' "nav landmark named Main"
has $SH/Hud.tsx "aria-current" "aria-current on the active link"
has $SH/nav.ts "label: 'Terminal'" "Terminal link"
has $SH/nav.ts "label: 'What you built'" "What you built link"

section "HUD, palette, shortcuts, rain delay, toasts, transitions"
has $SH/Hud.tsx "rankFor" "HUD takes the rank from game/rank.ts"
has $SH/Hud.tsx "FlipNumber" "XP is a FlipNumber"
has $SH/Hud.tsx "XP to " "tooltip: N XP to the next rank"
has $SH/Hud.tsx "Keyboard shortcuts" "shortcuts button"
has $SH/Hud.tsx "toggleSound" "sound toggle"
has $SH/CommandPalette.tsx "from 'cmdk'" "palette is cmdk"
has $SH/CommandPalette.tsx "disabled={locked}" "locked levels are disabled in the palette"
has $SH/CommandPalette.tsx "Toggle reduced motion" "palette: reduced motion"
has $SH/CommandPalette.tsx "Toggle sound" "palette: sound"
has $SH/CommandPalette.tsx "play('tick')" "palette plays tick on move"
has $SH/shortcuts.ts "CHORD_MS" "g-then-letter chord"
has $SH/shortcuts.ts "'.xterm" "never fires inside the terminal"
has $SH/shortcuts.ts "monaco-editor" "never fires inside Monaco"
has $SH/RainDelay.tsx "from 'next/offline'" "useOffline is an extra rain-delay signal"
has $SH/rain.ts "'./scripts/start'" "stack command"
has $SH/rain.ts "'docker compose start redis'" "redis command"
has $SH/RainDelay.tsx "Play resumes" "Play resumes confirmation"
has $SH/BootScreens.tsx "Floodlights warming up" "loading state"
has $SH/eventToasts.ts "cue: 'pager'" "dangerous command toast uses pager"
has $SH/eventToasts.ts "createCollapser" "toast repeats collapse"
has $SH/useShellEffects.ts "useQuest.subscribe" "level.event and dangerous reach toasts through the store"
has $SH/GameShell.tsx "ViewTransition" "route cross-fade uses React ViewTransition"
has $SH/shell.css "view-transition" "view-transition CSS"
has $SH/shell.css "data-motion='reduce'" "view transition off under reduced motion"
has $SH/QuestLink.tsx "transitionTypes" "links carry a transition type"
if grep -rn 'href="#/' $SH >/dev/null 2>&1; then bad "hash link in shell"; else ok "no hash links in the shell"; fi
if grep -rnE "className=\"[^\"]*\b(topbar|who-chip|dot-live|banner warn|btn)\b" $SH >/dev/null 2>&1; then bad "legacy class names in the shell"; else ok "no legacy class names in the shell"; fi
if [ "$(grep -rl 'data-ds=""' $SH | wc -l | tr -d ' ')" -ge 6 ]; then ok "data-ds on the rebuilt roots"; else bad "data-ds missing on rebuilt roots"; fi

section "dev server (skipped when it is not running)"
if curl -fsS -o /dev/null --max-time 3 http://127.0.0.1:3100/design 2>/dev/null; then
  for r in / /terminal /editor /logs /metrics /built /design; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://127.0.0.1:3100$r")
    if [ "$code" = "200" ]; then ok "GET http://127.0.0.1:3100$r -> 200"; else bad "GET $r -> $code"; fi
  done
else
  printf 'skip  shared dev server is not answering on 127.0.0.1:3100\n'
fi

printf '\n'
if [ "$FAILED" -eq 0 ]; then echo "F-17 OK"; else echo "F-17 FAILED"; exit 1; fi
