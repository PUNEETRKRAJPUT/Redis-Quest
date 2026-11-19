#!/usr/bin/env bash
# F-23 acceptance: the nineteen show-me panels on the "Night match" design system, hands-on mode and The nets.
# No Docker, no `next build`, no `next dev`. Type check, lint, vitest, prettier, greps for the test ids and key
# pieces, the practice: prefix rule, and (when the shared dev server answers) /showme must serve 200.
# Bash 3.2 compatible.
set -u
cd "$(dirname "$0")/../.." || exit 1

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }
S=ui/src/showme

section "ui type check, lint, vitest"
if T=$(pnpm --filter @quest/ui exec tsc --noEmit 2>&1); then ok "tsc --noEmit"; else printf '%s\n' "$T" | tail -25; bad "tsc --noEmit"; fi
# eslint over the F-23 files only (other agents' files are not judged here)
if L=$(pnpm --filter @quest/ui exec eslint src/showme src/screens/ShowMeGallery.tsx src/app/showme test/showme.test.tsx test/showmeF13.test.tsx test/handsOnCommands.test.ts test/handsOnViews.test.tsx 2>&1); then ok "eslint on the F-23 files"; else printf '%s\n' "$L" | tail -25; bad "eslint"; fi
if V=$(pnpm --filter @quest/ui exec vitest run test/showme.test.tsx test/showmeF13.test.tsx test/handsOnCommands.test.ts test/handsOnViews.test.tsx 2>&1); then
  ok "vitest: $(printf '%s\n' "$V" | grep -E '^ +Tests ' | sed 's/^ *//')"
  for f in showme.test.tsx showmeF13.test.tsx handsOnCommands.test.ts handsOnViews.test.tsx; do
    if printf '%s\n' "$V" | grep -q "$f"; then ok "ran ui/test/$f"; else bad "ui/test/$f did not run"; fi
  done
else printf '%s\n' "$V" | tail -30; bad "vitest"; fi
if P=$(pnpm exec prettier --check $S ui/src/screens/ShowMeGallery.tsx ui/test/showme.test.tsx ui/test/showmeF13.test.tsx ui/test/handsOnCommands.test.ts ui/test/handsOnViews.test.tsx 2>&1); then
  ok "prettier --check on the F-23 files"; else printf '%s\n' "$P" | tail -10; bad "prettier"; fi

section "the nineteen ids and the test ids survive"
N=$(sed -n '/export const SHOW_ME_IDS = \[/,/\] as const/p' $S/index.tsx | grep -c "^  '")
if [ "$N" -eq 19 ]; then ok "SHOW_ME_IDS has 19 ids"; else bad "SHOW_ME_IDS has $N ids"; fi
for t in showme-panel showme-title ttl-left kv-value hash-table hll-count hit-ratio stats-facts stats-keys limiter-hash \
  limiter-window limiter-log limiter-tally stream-length stream-groups ts-labels bf-facts ft-num-docs ft-fields ft-docs acl-users; do
  if grep -q "$t" $S/index.tsx $S/views.tsx; then ok "test id $t"; else bad "test id $t missing"; fi
done
if grep -q 'insight-link' ui/src/showme/*.tsx ui/src/screens/Level.tsx ui/src/screens/Built.tsx 2>/dev/null; then ok "insight-link still present where it was"; else ok "insight-link is not in F-23 files (owned by the level screen)"; fi
for c in 'showme-key' 'data-showme=' 'data-ds'; do
  if grep -q -- "$c" $S/frame.tsx; then ok "frame carries $c"; else bad "frame lacks $c"; fi
done

section "hands-on mode"
for g in "cmd.set" "cmd.hset" "cmd.lpush" "cmd.rpush" "cmd.lpop" "cmd.rpop" "cmd.sadd" "cmd.srem" "cmd.zincrby" "cmd.expire" "cmd.persist"; do
  if grep -q "$g" $S/views.tsx; then ok "views use $g"; else bad "views never use $g"; fi
done
if grep -q 'interactive = false' $S/index.tsx; then ok "ShowMe implements interactive (default false)"; else bad "ShowMe ignores interactive"; fi
if grep -q 'ENGINE_PREFIX' $S/commands.ts && grep -q 'refusal(argv)' $S/commands.ts; then ok "game: keys are refused before any request"; else bad "no game: refusal"; fi
if grep -q 'api.cli' $S/frame.tsx && ! grep -q 'api\.\(put\|post\|del\)' $S/*.ts*; then ok "gestures go through api.cli only"; else bad "gestures bypass api.cli"; fi
if grep -q 'ran-command' $S/frame.tsx && grep -q 'writeText' $S/frame.tsx; then ok "the ran: line is copyable"; else bad "ran line missing"; fi

section "The nets (practice gallery)"
if grep -rn "practice:" levels 2>/dev/null | head -1 | grep -q .; then bad "a level file uses practice:"; else ok "no level file uses the practice: prefix"; fi
if grep -q "startsWith('practice:')" ui/test/handsOnCommands.test.ts; then ok "unit test proves every setup key sits under practice:"; else bad "no prefix test"; fi
if grep -q 'nets-setup' ui/src/screens/ShowMeGallery.tsx && grep -q 'nets-clean' ui/src/screens/ShowMeGallery.tsx; then ok "set-up and clean-up buttons"; else bad "buttons missing"; fi
if grep -n "useEffect" ui/src/screens/ShowMeGallery.tsx | grep -q .; then bad "gallery has an effect (must not create keys on load)"; else ok "no effect in the gallery: keys are created only by the button"; fi
if grep -q 'hidden()' $S/useRedis.ts && grep -q 'visibilitychange' $S/useRedis.ts; then ok "polling pauses while the tab is hidden"; else bad "no visibility pause"; fi

section "no external URL, no emoji icons, no legacy stylesheet rules added"
if grep -nE "https?://" $S/*.ts* ui/src/screens/ShowMeGallery.tsx | grep -v "nextjs.org" | grep -q .; then bad "external URL in F-23 files"; else ok "no external URL"; fi
# F-25 deleted the legacy stylesheet; the show-me panels must not bring it back.
if [ ! -e ui/src/styles.css ]; then ok "no legacy ui/src/styles.css"; else bad "ui/src/styles.css exists again"; fi

section "dev server (optional)"
if curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:3100/health 2>/dev/null || curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:3100/showme 2>/dev/null; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 http://127.0.0.1:3100/showme)
  if [ "$CODE" = "200" ]; then ok "GET http://127.0.0.1:3100/showme -> 200"; else bad "GET /showme -> $CODE"; fi
else
  echo "SKIP  shared dev server not answering"
fi

printf '\n'
if [ "$FAILED" -eq 0 ]; then echo "F-23 OK"; exit 0; else echo "F-23 FAILED"; exit 1; fi
