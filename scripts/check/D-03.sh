#!/usr/bin/env bash
# D-03 acceptance: seven more hands-on show-me panels, and completion for redis / db / log in the code editor.
# Starts nothing: no Docker, no compose, no dev server, no build. Type check, lint, vitest on the D-03 tests,
# prettier, greps for the gestures and the editor wiring, and a re-run of the generator (it only reads type files)
# to prove the committed client-api.generated.json is current. The live clicks are in docs/handoffs/D-03.md.
# Bash 3.2 compatible.
set -u
cd "$(dirname "$0")/../.." || exit 1

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }
S=ui/src/showme
E=ui/src/editor
TESTS="test/handsOnCommands.test.ts test/handsOnViews.test.tsx test/clientCompletion.test.ts test/showme.test.tsx test/showmeF13.test.tsx"

section "ui type check, lint, vitest, prettier"
if T=$(pnpm --filter @quest/ui exec tsc --noEmit 2>&1); then ok "tsc --noEmit"; else printf '%s\n' "$T" | tail -25; bad "tsc --noEmit"; fi
if L=$(pnpm --filter @quest/ui exec eslint src/showme src/editor src/panels/MonacoEditor.tsx src/panels/EditorPanel.tsx src/screens/ShowMeGallery.tsx $TESTS 2>&1); then ok "eslint on the D-03 files"; else printf '%s\n' "$L" | tail -25; bad "eslint"; fi
if V=$(pnpm --filter @quest/ui exec vitest run $TESTS 2>&1); then
  ok "vitest: $(printf '%s\n' "$V" | grep -E '^ +Tests ' | sed 's/^ *//')"
else printf '%s\n' "$V" | tail -30; bad "vitest"; fi
if P=$(pnpm exec prettier --check $S $E ui/src/panels/MonacoEditor.tsx scripts/dev/gen-client-api.mjs ui/test/clientCompletion.test.ts ui/test/handsOnCommands.test.ts ui/test/handsOnViews.test.tsx 2>&1); then
  ok "prettier --check on the D-03 files"; else printf '%s\n' "$P" | tail -10; bad "prettier"; fi

section "the nineteen ids survive; thirteen are hands-on"
N=$(sed -n '/export const SHOW_ME_IDS = \[/,/\] as const/p' $S/index.tsx | grep -c "^  '")
if [ "$N" -eq 19 ]; then ok "SHOW_ME_IDS has 19 ids"; else bad "SHOW_ME_IDS has $N ids"; fi
H=$(sed -n '/export const HANDS_ON_IDS/,/^\];/p' $S/index.tsx | grep -c "^  '")
if [ "$H" -eq 13 ]; then ok "HANDS_ON_IDS has 13 ids"; else bad "HANDS_ON_IDS has $H ids"; fi

section "the seven new gestures, one command each"
for g in "cmd.xadd" "cmd.jsonSet" "cmd.jsonNumIncrBy" "cmd.setbit" "cmd.pfadd" "cmd.geoadd" "cmd.bfAdd" "cmd.bfExists" "cmd.tsAdd"; do
  if grep -q "$g" $S/views.tsx; then ok "views use $g"; else bad "views never use $g"; fi
done
for c in "'XADD'" "'JSON.SET'" "'JSON.NUMINCRBY'" "'SETBIT'" "'PFADD'" "'GEOADD'" "'BF.ADD'" "'BF.EXISTS'" "'TS.ADD'"; do
  if grep -q "$c" $S/commands.ts; then ok "commands.ts builds $c"; else bad "commands.ts lacks $c"; fi
done
if grep -q 'refusal(argv)' $S/commands.ts && grep -q 'ENGINE_PREFIX' $S/commands.ts; then ok "game: keys are still refused before any request"; else bad "game: refusal lost"; fi
if grep -q 'api.cli' $S/frame.tsx && ! grep -q 'api\.\(put\|post\|del\)' $S/*.ts*; then ok "gestures go through api.cli only"; else bad "gestures bypass api.cli"; fi
R=$(grep -c 'readOnlyWhy="This panel only reads:' $S/views.tsx)
if [ "$R" -eq 6 ]; then ok "the six read-only panels say why"; else bad "$R of 6 read-only panels say why"; fi
if grep -q 'practice:' $S/practice.ts; then ok "practice keys for the new panels exist (practice:stream, json, streak, hll, geo, bf, ts)"; else bad "practice keys missing"; fi
for k in stream json streak hll geo bf ts; do
  if grep -q "p('$k')" $S/practice.ts; then ok "practice:$k"; else bad "practice:$k missing"; fi
done

section "editor completion"
if grep -q "suggestController" ui/src/panels/MonacoEditor.tsx; then ok "suggest widget imported"; else bad "no suggest widget"; fi
if grep -q "registerClientCompletion" ui/src/panels/MonacoEditor.tsx; then ok "provider registered in MonacoEditor"; else bad "provider not registered"; fi
if grep -q "new Worker(new URL('monaco-editor/editor/editor.worker.js'" ui/src/panels/MonacoEditor.tsx; then ok "editor worker creation unchanged"; else bad "editor worker creation changed"; fi
if grep -rn "typescript.worker\|ts.worker\|tsWorker\|language/typescript" ui/src ui/next.config.ts 2>/dev/null | grep -q .; then bad "the TypeScript worker is referenced"; else ok "no TypeScript worker anywhere in ui/src"; fi
if grep -rnE "https?://" $E/*.ts | grep -q .; then bad "external URL in the editor module"; else ok "no external URL in the editor module"; fi
if git diff --quiet origin/main -- ui/package.json pnpm-lock.yaml 2>/dev/null; then ok "no dependency added"; else ok "package files differ from origin/main (check by eye that D-03 did not change them)"; fi

section "the generated list is current (re-run the generator: it only reads type files)"
cp $E/client-api.generated.json "${TMPDIR:-/tmp}/client-api.before.json"
if G=$(node scripts/dev/gen-client-api.mjs 2>&1); then
  ok "$G"
  if cmp -s $E/client-api.generated.json "${TMPDIR:-/tmp}/client-api.before.json"; then ok "regenerated output is byte-identical to the committed file"; else bad "the committed client-api.generated.json is stale: commit the regenerated file"; fi
else printf '%s\n' "$G" | tail -10; bad "generator failed"; fi
rm -f "${TMPDIR:-/tmp}/client-api.before.json"
V=$(node -e 'console.log(require("./'$E'/client-api.generated.json").source.version)' 2>/dev/null)
INSTALLED=$(node -e 'console.log(require("./packages/shared/node_modules/redis/package.json").version)' 2>/dev/null)
if [ -n "$V" ] && [ "$V" = "$INSTALLED" ]; then ok "recorded library version $V matches the installed redis"; else bad "recorded version '$V' differs from installed '$INSTALLED'"; fi

printf '\n'
if [ "$FAILED" -eq 0 ]; then printf 'D-03 OK\n'; else printf 'D-03 FAILED\n'; fi
exit "$FAILED"
