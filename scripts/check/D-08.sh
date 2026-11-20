#!/usr/bin/env bash
# D-08 acceptance: the arcade and its first cabinet, "Be the Redis". Written without being run (docs/DAYS.md: code
# only). Type check and lint, the D-08 vitest files, prettier on the D-08 files, and greps that prove the pieces, the
# rules and the constraints exist: no new dependency, no external URL, no canvas library, the feature is on, the
# page opts out of instant validation like every page. It starts nothing and uses no Docker, so it needs no
# isolation from the owner's real game. If a dev server answers on UI_URL (default http://127.0.0.1:3100), /arcade
# must serve 200. Bash 3.2 compatible.
set -u
cd "$(dirname "$0")/../.." || exit 1

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }

SRC="ui/src/features/arcade ui/src/app/arcade"
TESTS="ui/test/arcadeKit.test.ts ui/test/arcadeBeTheRedis.test.ts ui/test/arcadeFacts.test.ts ui/test/arcadeScreens.test.tsx"
CAB=ui/src/features/arcade/cabinets/be-the-redis

section "ui type check and lint"
if T=$(pnpm --filter @quest/ui exec tsc --noEmit 2>&1); then ok "tsc --noEmit"; else printf '%s\n' "$T" | tail -25; bad "tsc --noEmit"; fi
if L=$(pnpm --filter @quest/ui lint 2>&1); then ok "eslint"; else printf '%s\n' "$L" | tail -25; bad "eslint"; fi

section "vitest (the D-08 files)"
if V=$(cd ui && pnpm exec vitest run test/arcadeKit.test.ts test/arcadeBeTheRedis.test.ts test/arcadeFacts.test.ts test/arcadeScreens.test.tsx 2>&1); then
  ok "vitest: $(printf '%s\n' "$V" | grep -E '^ +Tests ' | sed 's/^ *//')"
  for f in arcadeKit arcadeBeTheRedis arcadeFacts arcadeScreens; do
    if printf '%s\n' "$V" | grep -q "$f"; then ok "ran $f"; else bad "$f did not run"; fi
  done
else printf '%s\n' "$V" | tail -40; bad "vitest"; fi

section "prettier"
if P=$(pnpm exec prettier --check $SRC $TESTS docs/arcade.md 2>&1); then ok "prettier --check on the D-08 files"; else printf '%s\n' "$P" | tail -10; bad "prettier"; fi

section "pieces exist"
for f in \
  ui/src/features/arcade/kit/random.ts ui/src/features/arcade/kit/loop.ts ui/src/features/arcade/kit/best.ts \
  ui/src/features/arcade/kit/types.ts ui/src/features/arcade/kit/Frame.tsx ui/src/features/arcade/kit/FactList.tsx \
  ui/src/features/arcade/kit/useFixedLoop.ts ui/src/features/arcade/cabinets/registry.ts \
  ui/src/features/arcade/ArcadeScreen.tsx ui/src/app/arcade/page.tsx docs/arcade.md docs/handoffs/D-08.md \
  $CAB/cards.ts $CAB/logic.ts $CAB/facts.ts $CAB/meta.ts $CAB/BeTheRedis.tsx $CAB/Belt.tsx $CAB/useDeck.ts $CAB/controls.ts; do
  if [ -f "$f" ]; then ok "$f"; else bad "$f missing"; fi
done

section "the feature is on and the page follows the house pattern"
if grep -q 'enabled: true' ui/src/features/arcade/entry.ts; then ok "arcade entry enabled"; else bad "arcade entry not enabled"; fi
if grep -q 'export const instant = false' ui/src/app/arcade/page.tsx; then ok "page sets instant = false"; else bad "page lacks instant = false"; fi
if grep -q 'data-ds=""' ui/src/features/arcade/ArcadeScreen.tsx && grep -q 'data-ds=""' ui/src/features/arcade/kit/Frame.tsx; then ok "data-ds on the screen roots"; else bad "data-ds missing"; fi

section "constraints"
if git diff --quiet e706f0b -- ui/package.json package.json pnpm-lock.yaml 2>/dev/null; then ok "no dependency added (package.json files and lockfile unchanged since the base)"; else bad "a package.json or the lockfile changed"; fi
if grep -rnE 'https?://' $SRC | grep -v '^\S*:[0-9]*:\s*(//|\*)' | grep -q .; then grep -rnE 'https?://' $SRC | head; bad "an external URL in the arcade code"; else ok "no external URL in the arcade code"; fi
if grep -rniE "<canvas|from '(pixi|phaser|three|konva)" $SRC | grep -q .; then bad "canvas or a game engine in the arcade code"; else ok "no canvas, no game engine"; fi
if grep -rnE 'api\.cli|/api/cli' $SRC | grep -q .; then bad "the arcade sends something through /api/cli"; else ok "nothing goes through /api/cli (docs come from the read-only reader)"; fi
if grep -rn "game:" $SRC | grep -v '^\S*:[0-9]*:\s*\(//\|\*\)' | grep -q "'game:"; then bad "the arcade touches the game:* prefix"; else ok "no game:* key"; fi
if node -e "const fs=require('fs'),p=require('path');const w=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?w(p.join(d,e.name)):[p.join(d,e.name)]);const bad=['ui/src/features/arcade','ui/src/app/arcade'].flatMap(w).filter(f=>/\\p{Extended_Pictographic}/u.test(fs.readFileSync(f,'utf8')));if(bad.length){console.log(bad.join('\\n'));process.exit(1)}"; then ok "no emoji"; else bad "an emoji in the arcade code"; fi
if grep -q "from '@/terminal/docs'" $CAB/useDeck.ts; then ok "docs come from the terminal's reader (no second reader)"; else bad "useDeck does not use the terminal's docs reader"; fi

section "the cabinet's honesty"
if grep -q 'simulation, not a measurement' $CAB/BeTheRedis.tsx; then ok "the screen says it is a simulation"; else bad "no simulation note"; fi
n=$(grep -c "id: '" $CAB/facts.ts)
if [ "$n" -ge 10 ]; then ok "$n rules listed in facts.ts, each with a source (a test checks the digest lines)"; else bad "too few rules in facts.ts ($n)"; fi
if grep -q 'reduced' $CAB/Belt.tsx; then ok "the belt has a reduced-motion branch"; else bad "belt ignores reduced motion"; fi

section "dev server (only if one answers)"
URL="${UI_URL:-http://127.0.0.1:3100}"
code=$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$URL/arcade" 2>/dev/null || true)
if [ "$code" = "200" ]; then ok "GET $URL/arcade -> 200"; elif [ -z "$code" ] || [ "$code" = "000" ]; then printf 'SKIP  no dev server at %s\n' "$URL"; else bad "GET $URL/arcade -> $code"; fi

printf '\n'
if [ "$FAILED" -eq 0 ]; then echo "D-08 OK"; else echo "D-08 FAILED"; exit 1; fi
