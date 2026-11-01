#!/usr/bin/env bash
# F-13 acceptance: show-me panels for streams, time series, Bloom, Search and ACL; the impact log on "What you
# built". No Docker: ui build, ui vitest (the new tests run), ui lint, prettier on the files F-13 owns,
# levels:validate clean with 96 levels, every command a panel reads is on the read-only allowlist, and each of the
# ten level files names the intended component and keys. Bash 3.2 compatible.
set -u
cd "$(dirname "$0")/../.." || exit 1

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }

section "pnpm install --frozen-lockfile, shared build (levels:validate needs it)"
pnpm install --frozen-lockfile >/dev/null 2>&1 && ok "lockfile matches" || bad "pnpm install --frozen-lockfile"
if B=$(pnpm --filter @quest/shared build 2>&1); then ok "pnpm --filter @quest/shared build"; else printf '%s\n' "$B" | tail -25; bad "shared build"; fi

section "ui build, vitest, lint, prettier"
if B=$(pnpm --filter @quest/ui build 2>&1); then ok "pnpm --filter @quest/ui build"; else printf '%s\n' "$B" | tail -25; bad "ui build"; fi
if T=$(pnpm --filter @quest/ui test 2>&1); then
  ok "ui vitest: $(printf '%s\n' "$T" | grep -E '^ +Tests ' | sed 's/^ *//')"
  if printf '%s\n' "$T" | grep -q 'showmeF13.test.tsx'; then ok "the F-13 tests ran (ui/test/showmeF13.test.tsx)"; else bad "showmeF13.test.tsx did not run"; fi
else printf '%s\n' "$T" | tail -30; bad "ui vitest"; fi
if pnpm --filter @quest/ui lint >/dev/null 2>&1; then ok "ui lint"; else pnpm --filter @quest/ui lint 2>&1 | tail -20; bad "ui lint"; fi
if P=$(pnpm exec prettier --check ui 2>&1); then ok "prettier --check ui (every file F-13 owns; prettier ignores levels/)"; else printf '%s\n' "$P" | tail -15; bad "prettier --check ui"; fi

section "levels:validate over every chapter"
if O=$(node packages/shared/dist/levels/cli.js levels 2>&1); then
  ok "$O"
  case "$O" in
    *"8 chapter(s), 96 level(s)"*) ok "8 chapters, 96 levels" ;;
    *) bad "expected 8 chapters, 96 levels" ;;
  esac
else printf '%s\n' "$O"; bad "levels:validate levels"; fi

section "every command a panel reads is on the read-only allowlist"
ALLOW=packages/shared/src/levels/commands.ts
for c in "XLEN" "XINFO GROUPS" "XPENDING" "TS.INFO" "TS.RANGE" "BF.INFO" "BF.CARD" "FT.INFO" "FT.SEARCH" "ACL LIST"; do
  if grep -q "'$c'" "$ALLOW"; then ok "$c is allowlisted"; else bad "$c is not on the allowlist in $ALLOW"; fi
done
for c in "'XLEN'" "'XINFO', 'GROUPS'" "'XPENDING'" "'TS.INFO'" "'TS.RANGE'" "'BF.INFO'" "'BF.CARD'" "'FT.INFO'" "'FT.SEARCH'" "'ACL', 'LIST'"; do
  if grep -q "$c" ui/src/showme/index.tsx; then ok "ui/src/showme/index.tsx reads $c"; else bad "ui/src/showme/index.tsx does not read $c"; fi
done

section "the ten level files name the intended component and keys"
CH4=levels/ch4-work-in-the-background
want() { # file component keys-literal
  f=$(ls $1 2>/dev/null | head -n 1)
  if [ -z "$f" ]; then bad "no file for $1"; return; fi
  if awk '/^show_me:/{f=1;next} f&&/^[^ ]/{f=0} f' "$f" | grep -q "component: $2\$" \
     && awk '/^show_me:/{f=1;next} f&&/^[^ ]/{f=0} f' "$f" | grep -q "keys: $3\$"; then
    ok "$f: $2 $3"
  else
    bad "$f: expected component $2 and keys $3"; awk '/^show_me:/{f=1;next} f&&/^[^ ]/{f=0} f' "$f"
  fi
}
for n in 02 03 04 05 06; do want "$CH4/$n-*.yaml" stream_groups '\["match:m-041:balls"\]'; done
want "$CH4/14-*.yaml" bf_card '\["bf:usernames"\]'
want "$CH4/15-*.yaml" ft_card '\["idx:contest"\]'
want "$CH4/16-*.yaml" ts_chart '\["ts:requests:GET_app_players_:id_stats"\]'
want "$CH4/19-*.yaml" ts_chart '\["ts:requests:GET_app_players_:id_stats"\]'
want "levels/ch5-survive/10-*.yaml" acl_users '\[\]'

section "README table and the impact log wiring"
for id in stream_groups ts_chart bf_card ft_card acl_users; do
  if grep -q "^| \`$id\` |" levels/README.md; then ok "levels/README.md has a row for $id"; else bad "levels/README.md has no row for $id"; fi
done
if grep -q 'data-testid="impact-log"' ui/src/screens/ImpactLog.tsx && grep -q '<ImpactLog' ui/src/screens/Built.tsx; then
  ok "What you built renders the impact log (data-testid=impact-log)"; else bad "impact log not wired into Built.tsx"; fi

if [ "$FAILED" -eq 0 ]; then printf '\nF-13 OK\n'; exit 0; fi
printf '\nF-13 FAILED\n'; exit 1
