#!/usr/bin/env bash
# D-04 acceptance: the phone. Never drives Docker or Compose (so it needs no isolation): type check, lint and
# vitest for app and ui, prettier on the D-04 files, static checks that the feature is wired, and, only when
# QUEST_BASE_URL points at a running stack's proxy (for example http://127.0.0.1:3400), one live request that must
# come back with a well-formed x-quest-trace header and one without the request header that must come back
# with none. Bash 3.2 compatible.
set -u
cd "$(dirname "$0")/../.." || exit 1

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }

section "type check and lint"
for pkg in @quest/app @quest/ui; do
  if T=$(pnpm --filter "$pkg" exec tsc --noEmit 2>&1); then ok "$pkg tsc --noEmit"; else printf '%s\n' "$T" | tail -25; bad "$pkg tsc --noEmit"; fi
  if L=$(pnpm --filter "$pkg" lint 2>&1); then ok "$pkg eslint"; else printf '%s\n' "$L" | tail -25; bad "$pkg eslint"; fi
done

section "unit tests"
if V=$(pnpm --filter @quest/app exec vitest run test/trace.test.ts 2>&1); then
  ok "app trace tests: $(printf '%s\n' "$V" | grep -E '^ +Tests ' | sed 's/^ *//')"
else printf '%s\n' "$V" | tail -30; bad "app trace tests"; fi
if V=$(pnpm --filter @quest/ui exec vitest run test/phone.logic.test.ts test/phone.view.test.tsx 2>&1); then
  ok "ui phone tests: $(printf '%s\n' "$V" | grep -E '^ +Tests ' | sed 's/^ *//')"
else printf '%s\n' "$V" | tail -30; bad "ui phone tests"; fi

section "prettier on the D-04 files"
if P=$(pnpm exec prettier --check app/src/trace.ts app/src/slots/runtime.ts app/src/server.ts app/test/trace.test.ts \
  ui/src/features/phone ui/src/app/phone ui/src/level/Workbench.tsx ui/test/phone.logic.test.ts ui/test/phone.view.test.tsx 2>&1); then
  ok "prettier --check"; else printf '%s\n' "$P" | tail -10; bad "prettier --check"; fi

section "wiring"
grep -q "enabled: true" ui/src/features/phone/entry.ts && ok "phone feature is on" || bad "phone feature is still off"
[ -f ui/src/app/phone/page.tsx ] && grep -q "export const instant = false" ui/src/app/phone/page.tsx \
  && ok "/phone route is a static shell with instant = false" || bad "/phone page missing or without instant = false"
grep -q "PhoneScreen" ui/src/level/Workbench.tsx && grep -q "id: 'phone'" ui/src/level/Workbench.tsx \
  && ok "workbench has the Phone tab" || bad "workbench has no Phone tab"
grep -q "TRACE_HEADER = 'x-quest-trace'" app/src/trace.ts && grep -q "TRACE_HEADER = 'x-quest-trace'" ui/src/features/phone/trace.ts \
  && ok "app and ui agree on the header name" || bad "header name differs between app and ui"
grep -q "trace: req.headers\[TRACE_HEADER\] === '1'" app/src/server.ts \
  && ok "the app builds a trace only when the request header is 1" || bad "app/src/server.ts does not gate the trace on the header"
if grep -rnE "https?://" ui/src/features/phone ui/src/app/phone | grep -v "^.*://127.0.0.1" | grep -q .; then
  bad "an external URL in the phone files"; else ok "nothing leaves the origin"; fi

section "live (only with QUEST_BASE_URL)"
if [ -z "${QUEST_BASE_URL:-}" ]; then
  echo "SKIP  QUEST_BASE_URL not set; run against a stack: QUEST_BASE_URL=http://127.0.0.1:3400 scripts/check/D-04.sh"
else
  H=$(curl -s -m 20 -o /dev/null -D - -H 'x-quest-trace: 1' "$QUEST_BASE_URL/app/players/p-028/stats" | tr -d '\r' | grep -i '^x-quest-trace:' | sed 's/^[^:]*: *//')
  if [ -n "$H" ] && printf '%s' "$H" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      const j=JSON.parse(s);
      if (j.v!==1||!Array.isArray(j.e)||j.e.length<1||typeof j.total!=="number") process.exit(1);
      if (s.length>3500||!/^[\x20-\x7e]*$/.test(s)) process.exit(1);
    })'; then ok "traced request carried a well-formed header ($(printf '%s' "$H" | wc -c | tr -d ' ') chars)"
  else bad "traced request had no usable x-quest-trace header: ${H:-none}"; fi
  N=$(curl -s -m 20 -o /dev/null -D - "$QUEST_BASE_URL/app/players/p-028/stats" | tr -d '\r' | grep -ci '^x-quest-trace:')
  [ "$N" = "0" ] && ok "an ordinary request carries no trace header" || bad "an ordinary request carried a trace header"
fi

printf '\n'
if [ "$FAILED" -eq 0 ]; then echo "D-04 OK"; else echo "D-04 FAILED"; fi
exit "$FAILED"
