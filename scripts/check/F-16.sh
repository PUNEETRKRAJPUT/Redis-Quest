#!/usr/bin/env bash
# F-16 acceptance: the "Night match" design system. No Docker, no `next build`, no `next dev`. Type check, lint and
# vitest for ui; every palette token from docs/design/EXPERIENCE.md is declared in tokens.css with its value; every
# legacy variable in ui/src/styles.css is re-declared; every primitive is exported from ui/src/design/index.ts; no
# external URL or font CDN in ui/src/design; fonts come from the installed npm packages. If the shared dev server
# answers on 127.0.0.1:3100, /design must serve 200. Bash 3.2 compatible.
set -u
cd "$(dirname "$0")/../.." || exit 1

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }

TOKENS=ui/src/design/tokens.css
INDEX=ui/src/design/index.ts
BRIEF=docs/design/EXPERIENCE.md

section "ui type check, lint, vitest"
if T=$(pnpm --filter @quest/ui exec tsc --noEmit 2>&1); then ok "tsc --noEmit"; else printf '%s\n' "$T" | tail -25; bad "tsc --noEmit"; fi
if L=$(pnpm --filter @quest/ui lint 2>&1); then ok "eslint"; else printf '%s\n' "$L" | tail -25; bad "eslint"; fi
if V=$(pnpm --filter @quest/ui test 2>&1); then
  ok "vitest: $(printf '%s\n' "$V" | grep -E '^ +Tests ' | sed 's/^ *//')"
  for f in design.test.ts design.primitives.test.tsx; do
    if printf '%s\n' "$V" | grep -q "$f"; then ok "ran ui/test/$f"; else bad "ui/test/$f did not run"; fi
  done
else printf '%s\n' "$V" | tail -30; bad "vitest"; fi
if P=$(pnpm exec prettier --check ui/src/design ui/src/app/design ui/test/design.test.ts ui/test/design.primitives.test.tsx 2>&1); then
  ok "prettier --check on the F-16 files"; else printf '%s\n' "$P" | tail -10; bad "prettier"; fi

section "palette tokens from the brief are declared with their values"
# Brief rows look like: | `night-950` | `#070A12` | ... ; the flood row lists three names and three values.
grep -E '^\| `[a-z0-9-]+`' "$BRIEF" | while IFS= read -r row; do
  names=$(printf '%s\n' "$row" | cut -d'|' -f2 | grep -oE '`[a-z0-9-]+`' | tr -d '`')
  values=$(printf '%s\n' "$row" | cut -d'|' -f3 | grep -oE '#[0-9A-Fa-f]{6}')
  i=1
  for n in $names; do
    v=$(printf '%s\n' "$values" | sed -n "${i}p" | tr 'A-F' 'a-f')
    i=$((i + 1))
    if grep -qiE -- "--color-$n: *$v;" "$TOKENS"; then echo "PASS  --color-$n: $v"; else echo "FAIL  --color-$n: $v not in $TOKENS"; fi
  done
done > /tmp/f16-palette.$$ 2>&1
cat /tmp/f16-palette.$$
COUNT=$(grep -c '^PASS' /tmp/f16-palette.$$)
if grep -q '^FAIL' /tmp/f16-palette.$$; then bad "palette tokens missing"; fi
if [ "$COUNT" -ge 15 ]; then ok "$COUNT palette tokens declared"; else bad "expected at least 15 palette tokens, found $COUNT"; fi
rm -f /tmp/f16-palette.$$

section "every legacy variable name (from the old ui/src/styles.css, deleted in F-25) is declared in tokens.css"
LEGACY_VARS="--bg --surface --surface-2 --ink --muted --line --accent --accent-ink --accent-soft --ok --ok-soft --warn --warn-soft --bad --bad-soft --info-soft --term-bg --term-fg --radius --gutter --mono --sans"
for v in $LEGACY_VARS; do
  if grep -qE -- "^ *$v:" "$TOKENS"; then ok "$v"; else bad "$v is not re-declared in $TOKENS"; fi
done
if grep -q 'color-scheme: dark' "$TOKENS"; then ok "color-scheme: dark"; else bad "color-scheme: dark missing"; fi

section "every primitive is exported from ui/src/design/index.ts"
for p in Button IconButton Card Panel Pill Kbd Tooltip Dialog Tabs ProgressBar Meter Skeleton EmptyState Toaster toast \
  FlipNumber Confetti Floodlights Scoreline DesignRuntime play celebrate useReducedMotion useSettings fade rise pop listItem; do
  if grep -qE "export \{[^}]*\b$p\b" "$INDEX" || grep -qE "^  $p,$" "$INDEX"; then ok "exports $p"; else bad "$INDEX does not export $p"; fi
done
for f in ui/src/design/motion.ts ui/src/design/sound.ts ui/src/design/settings.ts ui/src/design/fonts.ts ui/src/app/design/page.tsx; do
  if [ -s "$f" ]; then ok "$f exists"; else bad "$f missing"; fi
done
for c in tick msg tock out flip roar pager; do
  if grep -qE "^  $c: \{" ui/src/design/sound.ts; then ok "sound cue $c"; else bad "sound cue $c missing"; fi
done

section "no external URL, no font CDN, fonts from npm packages"
# The SVG namespace inside the grain data URI is an identifier, not a request.
EXT=$(grep -rnoE "https?://[^'\" )]+" ui/src/design ui/src/app/design | grep -v 'http://www.w3.org/2000/svg' || true)
if [ -z "$EXT" ]; then ok "no external URL in ui/src/design or ui/src/app/design"; else printf '%s\n' "$EXT"; bad "external URL found"; fi
if grep -rqE 'fonts\.googleapis|fonts\.gstatic|next/font/google' ui/src/design; then bad "font CDN or next/font/google used"; else ok "no font CDN"; fi
for f in @fontsource/barlow-condensed @fontsource-variable/inter @fontsource-variable/jetbrains-mono; do
  if grep -q "node_modules/$f/files/" ui/src/design/fonts.ts; then ok "fonts.ts self-hosts $f"; else bad "fonts.ts does not load $f"; fi
done
if grep -q 'latin-' ui/src/design/fonts.ts && ! grep -qE 'latin-ext|cyrillic|greek|vietnamese' ui/src/design/fonts.ts; then
  ok "Latin subset only"; else bad "fonts.ts loads a non-Latin subset"; fi

section "the gallery on the shared dev server (skipped when it is not running)"
if code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 http://127.0.0.1:3100/design 2>/dev/null) && [ "$code" != "000" ]; then
  if [ "$code" = "200" ]; then ok "GET http://127.0.0.1:3100/design -> 200"; else bad "GET /design -> $code"; fi
else
  printf 'SKIP  no dev server on 127.0.0.1:3100\n'
fi

if [ "$FAILED" -eq 0 ]; then printf '\nF-16 OK\n'; exit 0; fi
printf '\nF-16 FAILED\n'; exit 1
