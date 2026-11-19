#!/usr/bin/env bash
# F-20 acceptance: the chapter chat thread. No Docker, no `next build`, no `next dev`. Type check, lint, vitest for
# ui; prettier on the F-20 files; greps prove the exports, the test ids and the pieces of the spec exist; if the
# shared dev server answers on 127.0.0.1:3100 the home route must serve 200. Bash 3.2 compatible.
set -u
cd "$(dirname "$0")/../.." || exit 1

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }
has() { if grep -qE -- "$2" "$1"; then ok "$3"; else bad "$3 (/$2/ not in $1)"; fi; }

T=ui/src/level/Thread.tsx
L=ui/src/thread/logic.ts

section "ui type check, lint, vitest"
if O=$(pnpm --filter @quest/ui exec tsc --noEmit 2>&1); then ok "tsc --noEmit"; else printf '%s\n' "$O" | tail -25; bad "tsc --noEmit"; fi
# Scoped to the F-20 files: other agents' files may be mid-edit and are not judged here.
if O=$(pnpm --filter @quest/ui exec eslint src/thread src/level/Thread.tsx test/thread.logic.test.ts test/thread.test.tsx 2>&1); then ok "eslint (F-20 files)"; else printf '%s\n' "$O" | tail -25; bad "eslint (F-20 files)"; fi
if V=$(pnpm --filter @quest/ui test 2>&1); then
  ok "vitest: $(printf '%s\n' "$V" | grep -E '^ +Tests ' | sed 's/^ *//')"
  for f in thread.logic.test.ts thread.test.tsx; do
    if printf '%s\n' "$V" | grep -q "$f"; then ok "ran ui/test/$f"; else bad "ui/test/$f did not run"; fi
  done
else printf '%s\n' "$V" | tail -30; bad "vitest"; fi
if O=$(pnpm exec prettier --check ui/src/thread ui/src/level/Thread.tsx ui/test/thread.logic.test.ts ui/test/thread.test.tsx 2>&1); then
  ok "prettier --check on the F-20 files"; else printf '%s\n' "$O" | tail -10; bad "prettier"; fi

section "contract: exports, props, behaviour pieces"
has "$T" 'export function nameOf' "nameOf is still exported"
has "$T" 'export function Thread' "Thread is still exported"
has "$T" 'messages: ThreadMessage\[\]' "Thread keeps the messages prop"
has "$T" 'label: string' "Thread keeps the label prop"
for p in 'title\?' 'animate\?' 'maxRevealMs\?' 'maxHeight\?' 'onRevealed\?' 'rememberSeen\?'; do
  has "$T" "$p:" "optional prop $p"
done
has "$T" 'aria-live="polite"' "message list is a polite live region"
has "$T" 'aria-label=\{label\}' "list is labelled by the label prop"
# F-25 deleted the legacy stylesheet and moved the e2e to the test id, so the .thread/.msg hooks are gone.
has ui/src/thread/parts.tsx 'data-testid="thread-msg"' "messages carry data-testid=thread-msg (the e2e selector)"
grep -q "thread-msg" ui/e2e/chapter0.e2e.ts && ok "ui/e2e finds messages by data-testid=thread-msg" || bad "ui/e2e does not use thread-msg"
has "$T" 'data-ds=""' "data-ds on the root"
has "$T" 'Show all' "Show all action"
has "$T" 'Replay' "Replay action"
has ui/src/thread/useReveal.ts "Escape" "Escape reveals everything"
has ui/src/thread/useReveal.ts "play\('msg'\)" "msg cue per message"
has ui/src/thread/useReveal.ts "useReducedMotion" "reduced motion honoured"
has ui/src/thread/useReveal.ts "IntersectionObserver" "arrival waits until the thread is on screen"
has "$L" 'export function (groupMessages|typingDelay|planReveal|contentHash|avatarTone)' "pure logic functions exported"
has "$L" 'MAX_REVEAL_MS = 8000' "total reveal capped at 8 s"
has "$L" "rq:thread-seen:" "seen flag stored in localStorage per content hash"
for id in thread thread-msg thread-typing thread-avatar thread-action thread-scroll thread-jump; do
  if grep -rqE "data-testid=\"$id\"|data-testid=\"$id\"" ui/src/level/Thread.tsx ui/src/thread; then ok "data-testid=$id"; else bad "data-testid=$id missing"; fi
done
if grep -rn "styles.css\|module.css" ui/src/thread ui/src/level/Thread.tsx | grep -v '^.*://' | grep -q import; then bad "imports a stylesheet"; else ok "no stylesheet imports (Tailwind utilities only)"; fi
if grep -rn "https\?://" ui/src/thread ui/src/level/Thread.tsx | grep -qv "^.*\* "; then bad "external URL"; else ok "no external URL"; fi

section "callers still render"
# The map's thread moved from screens/ChapterMap.tsx to map/FixtureDetail.tsx in F-19; find callers wherever they are.
CALLERS=$(grep -rlE '<Thread messages=' ui/src --include='*.tsx' | grep -v 'ui/src/level/Thread.tsx' || true)
if [ -n "$CALLERS" ]; then
  for f in $CALLERS; do
    if grep -E '<Thread messages=' "$f" | grep -q 'label='; then ok "caller $f passes messages and label"; else bad "caller $f lacks label"; fi
  done
else bad "no caller of <Thread messages=...> found"; fi
has ui/src/screens/Level.tsx '<Thread messages=\{incident\}' "level screen still renders the thread"

section "dev server (optional)"
if curl -s -o /dev/null --max-time 5 http://127.0.0.1:3100/; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 http://127.0.0.1:3100/)
  if [ "$CODE" = "200" ]; then ok "GET http://127.0.0.1:3100/ -> 200"; else bad "GET / -> $CODE"; fi
else
  echo "SKIP  dev server not answering on 127.0.0.1:3100"
fi

echo
if [ "$FAILED" -eq 0 ]; then echo "F-20 OK"; exit 0; else echo "F-20 FAILED"; exit 1; fi
