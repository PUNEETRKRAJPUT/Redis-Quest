#!/usr/bin/env bash
# F-19 acceptance: the season map and the caps shelf. No Docker, no `next build`, no `next dev`.
# Type check (errors in the F-19 files fail; errors elsewhere are reported, since other wave-2 tasks edit the
# tree at the same time), eslint and prettier on the F-19 files, the map unit tests (and the full ui suite,
# reported), greps that prove the kept test ids and the key pieces exist, no external URL, and, if the shared dev
# server answers on 127.0.0.1:3100, `/` serves 200. Bash 3.2 compatible.
set -u
cd "$(dirname "$0")/../.." || exit 1

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
note() { printf 'NOTE  %s\n' "$1"; }
section() { printf '\n== %s\n' "$1"; }

MAP=ui/src/screens/ChapterMap.tsx
FILES="ui/src/screens/ChapterMap.tsx ui/src/map ui/src/app/page.tsx ui/test/map.test.tsx"
OWN_RE='src/(screens/ChapterMap|map/|app/page\.tsx)|test/map\.test'

section "type check, lint, format"
T=$(pnpm --filter @quest/ui exec tsc --noEmit 2>&1)
MINE=$(printf '%s\n' "$T" | grep -E 'error TS' | grep -E "$OWN_RE")
OTHER=$(printf '%s\n' "$T" | grep -E 'error TS' | grep -vE "$OWN_RE" | wc -l | tr -d ' ')
if [ -z "$MINE" ]; then ok "tsc --noEmit: no errors in the F-19 files"; else printf '%s\n' "$MINE"; bad "tsc errors in the F-19 files"; fi
[ "$OTHER" -gt 0 ] && note "tsc: $OTHER error(s) in files other tasks own (not judged here)"
# shellcheck disable=SC2086
if L=$(cd ui && pnpm exec eslint ${FILES//ui\//} 2>&1); then ok "eslint on the F-19 files"; else printf '%s\n' "$L" | tail -20; bad "eslint"; fi
# shellcheck disable=SC2086
if P=$(pnpm exec prettier --check $FILES 2>&1); then ok "prettier --check on the F-19 files"; else printf '%s\n' "$P" | tail -10; bad "prettier"; fi

section "unit tests"
if V=$(cd ui && pnpm exec vitest run test/map.test.tsx 2>&1); then
  ok "vitest test/map.test.tsx: $(printf '%s\n' "$V" | grep -E '^ +Tests ' | sed 's/^ *//')"
else printf '%s\n' "$V" | tail -30; bad "vitest test/map.test.tsx"; fi
A=$(cd ui && pnpm exec vitest run 2>&1)
note "full ui suite: $(printf '%s\n' "$A" | grep -E '^ +(Test Files|Tests) ' | sed 's/^ *//' | tr '\n' ' ')"

section "kept test ids, text and behaviour"
for pat in 'data-testid="chapter-map"' 'data-testid={`chapter-${chapter.id}`}' 'data-testid={`level-${level.id}`}' \
  'data-testid="xp"' 'Hello, {progress.player.name}' 'data-testid="map-error"' 'Read the chapter thread' \
  'aria-disabled="true"' 'Loading the map...'; do
  if grep -rqF -- "$pat" "$MAP" ui/src/map; then ok "has $pat"; else bad "missing $pat"; fi
done
grep -qF 'refreshChapters' "$MAP" && ok "chapters failure is detected and retried through the store" || bad "no retry"
grep -qF 'badges' ui/src/map/CapsShelf.tsx && ok "caps shelf keeps the .badges class the e2e reads" || bad "no .badges"
grep -qF '<Thread messages={chapter.incident}' ui/src/map/FixtureDetail.tsx && ok "chapter thread uses Thread({ messages, label })" || bad "Thread not used"

section "key pieces"
grep -qF "from '../game/outcome'" ui/src/map/BallStrip.tsx && ok "balls come from ballFor (src/game/outcome.ts)" || bad "ballFor not used"
grep -qF "from '../game/rank'" ui/src/map/Scoreboard.tsx && ok "rank comes from rankFor (src/game/rank.ts)" || bad "rankFor not used"
grep -qF 'export function emblemFor' ui/src/map/emblem.ts && ok "emblems generated from the badge name" || bad "no emblemFor"
grep -qF 'export function nextMatch' ui/src/map/model.ts && ok "next match helper" || bad "no nextMatch"
grep -qF 'ResizeObserver' ui/src/map/SeasonPath.tsx && ok "season road measured from the cards" || bad "road not measured"
grep -qF 'data-ds=""' "$MAP" && ok "screen root carries data-ds" || bad "no data-ds"
if grep -rqE 'ds-still' ui/src/map && grep -qF 'useReducedMotion' ui/src/map/SeasonPath.tsx; then
  ok "animations honour reduced motion (ds-still, useReducedMotion)"; else bad "reduced motion"; fi
grep -qF 'export const instant = false' ui/src/app/page.tsx && ok "page keeps instant = false" || bad "page lost instant = false"
if grep -rnE "className=\"[^\"]*\b(page|map-head|xp-card|xp-num|path|chapter-card|chapter-rail|level-link|lv-icon|lv-title|pill|levels)\b" "$MAP" ui/src/map >/dev/null; then
  bad "legacy class names in the rebuilt markup"; else ok "no legacy class names (except .badges, asserted by e2e)"; fi

section "no external requests, no images"
if grep -rnE "https?://" "$MAP" ui/src/map | grep -v 'www.w3.org' >/dev/null; then bad "external URL in the F-19 files"; else ok "no external URL"; fi
if grep -rnE "\.(png|jpe?g|gif|webp)['\"]|<img|canvas|three" "$MAP" ui/src/map >/dev/null; then bad "image, canvas or three.js found"; else ok "SVG and CSS only (no images, canvas or three.js)"; fi

section "dev server"
if code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:3100/ 2>/dev/null) && [ "$code" != "000" ]; then
  [ "$code" = "200" ] && ok "GET http://127.0.0.1:3100/ -> 200" || bad "GET / -> $code"
else note "dev server on 3100 not running; skipped"; fi

echo
if [ "$FAILED" -eq 0 ]; then echo "F-19 OK"; exit 0; else echo "F-19 FAILED"; exit 1; fi
