#!/usr/bin/env bash
# F-18 acceptance: the welcome screen (opening scene, name form, kick-off beat). No Docker, no `next build`, no
# `next dev`. Type check and lint are gated on the F-18 files only (seven other tasks edit the checkout at the same
# time), the full ui suite is reported but only ui/test/welcome.test.tsx gates. Greps prove the test ids and the key
# pieces exist. If the shared dev server answers on 127.0.0.1:3100, / must serve 200. Bash 3.2 compatible.
set -u
cd "$(dirname "$0")/../.." || exit 1

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
info() { printf 'INFO  %s\n' "$1"; }
section() { printf '\n== %s\n' "$1"; }

FILES="ui/src/screens/Welcome.tsx ui/src/onboarding ui/test/welcome.test.tsx"

section "type check, lint, tests, prettier"
T=$(pnpm --filter @quest/ui exec tsc --noEmit 2>&1)
MINE=$(printf '%s\n' "$T" | grep -E 'ui/src/screens/Welcome|ui/src/onboarding|ui/test/welcome|^src/screens/Welcome|^src/onboarding|^test/welcome' || true)
if [ -z "$MINE" ]; then ok "tsc --noEmit: no errors in the F-18 files"; else printf '%s\n' "$MINE"; bad "tsc errors in F-18 files"; fi
OTHER=$(printf '%s\n' "$T" | grep -cE 'error TS' || true)
info "tsc errors anywhere in the checkout: $OTHER"
if L=$(cd ui && pnpm exec eslint src/screens/Welcome.tsx src/onboarding test/welcome.test.tsx 2>&1); then ok "eslint on the F-18 files"; else printf '%s\n' "$L" | tail -25; bad "eslint"; fi
if V=$(cd ui && pnpm exec vitest run test/welcome.test.tsx 2>&1); then
  ok "vitest welcome: $(printf '%s\n' "$V" | grep -E '^ +Tests ' | sed 's/^ *//')"
else printf '%s\n' "$V" | tail -30; bad "vitest welcome"; fi
ALL=$(pnpm --filter @quest/ui test 2>&1 | grep -E '^ +(Tests|Test Files) ' | sed 's/^ *//' | tr '\n' ' ')
info "full ui suite: $ALL"
if P=$(pnpm exec prettier --check $FILES 2>&1); then ok "prettier --check"; else printf '%s\n' "$P" | tail -10; bad "prettier"; fi

section "test ids and key pieces"
W=ui/src/screens/Welcome.tsx
has() { if grep -qE -- "$2" "$3"; then ok "$1"; else bad "$1 (missing /$2/ in $3)"; fi; }
has "welcome test id"            'data-testid="welcome"'            "$W"
has "player-name test id"        'data-testid="player-name"'        ui/src/onboarding/NameForm.tsx
has "player-submit test id"      'data-testid="player-submit"'      ui/src/onboarding/NameForm.tsx
has "Welcome export kept"        'export function Welcome\(\)'      "$W"
has "createPlayer still used"    's\.createPlayer'                  "$W"
has "player_exists falls back to init" "player_exists"              "$W"
has "data-ds on the root"        'data-ds=""'                       "$W"
has "Escape skips the intro"     "e\.key === 'Escape'"              "$W"
has "Skip intro control"         'Skip intro'                       "$W"
has "Floodlights from the design system" 'floodlights\(\)'          "$W"
has "msg cue on arrival"         "'msg'"                            "$W"
has "chapter 0 incident from the API" 'api\s*\.chapters|\.chapters\(\)' "$W"
has "reduced motion = one still" 'instant = reduced'                "$W"
has "jersey store persisted"     "PROFILE_KEY = 'rq:profile'"       ui/src/onboarding/profile.ts
n=$(grep -cE "^  \{ id: '" ui/src/onboarding/profile.ts); if [ "$n" = "6" ]; then ok "six jersey swatches"; else bad "expected 6 jerseys, found $n"; fi
has "sound question sets the design setting" 'setSound'             ui/src/onboarding/NameForm.tsx
has "kick-off beat"              'Welcome to the league'            ui/src/onboarding/Kickoff.tsx
has "kick-off is shown after create" 'showKickoff'                  "$W"
if grep -rn "from '\./Thread'\|level/Thread\|thread/" ui/src/onboarding ui/src/screens/Welcome.tsx >/dev/null 2>&1; then
  bad "scene must not depend on the chat thread component"; else ok "scene is independent of the chat thread component"; fi
if grep -rnE "https?://" ui/src/onboarding ui/src/screens/Welcome.tsx | grep -v "w3.org" >/dev/null; then bad "external URL in the F-18 files"; else ok "no external URL"; fi
if grep -rn "styles.css\|className=\"\(page\|btn\|callout\|field\|lead\)" ui/src/onboarding ui/src/screens/Welcome.tsx >/dev/null; then
  bad "legacy class names in rebuilt markup"; else ok "no legacy class names"; fi

section "dev server (optional)"
if curl -fsS -o /dev/null -m 3 http://127.0.0.1:3100/ 2>/dev/null; then ok "GET http://127.0.0.1:3100/ -> 200"; else info "dev server not answering, skipped"; fi

if [ "$FAILED" = "0" ]; then printf '\nF-18 OK\n'; else printf '\nF-18 FAILED\n'; fi
exit "$FAILED"
