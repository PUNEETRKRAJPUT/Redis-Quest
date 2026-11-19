#!/usr/bin/env bash
# F-24 acceptance: the tools pages (editor, logs, metrics, target switch) and the career page on the "Night match"
# design system. No Docker, no `next build`, no `next dev`. Type check, lint, vitest, prettier, greps that prove the
# test ids, roles and key pieces exist. If the shared dev server answers on 127.0.0.1:3100 the four routes must
# serve 200. Bash 3.2 compatible.
set -u
cd "$(dirname "$0")/../.." || exit 1

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }
has() { if grep -qE -- "$2" "$1"; then ok "$3"; else bad "$3 ($1 lacks: $2)"; fi; }

P=ui/src/panels
S=ui/src/screens

section "ui type check, lint, vitest, prettier"
if T=$(pnpm --filter @quest/ui exec tsc --noEmit 2>&1); then ok "tsc --noEmit"; else printf '%s\n' "$T" | tail -25; bad "tsc --noEmit"; fi
if L=$(pnpm --filter @quest/ui lint 2>&1); then ok "eslint"; else printf '%s\n' "$L" | tail -25; bad "eslint"; fi
if V=$(pnpm --filter @quest/ui test 2>&1); then
  ok "vitest: $(printf '%s\n' "$V" | grep -E '^ +Tests ' | sed 's/^ *//')"
  for f in tools.test.ts portfolio.test.tsx targetSwitch.test.tsx insightLink.test.ts; do
    if printf '%s\n' "$V" | grep -q "$f"; then ok "ran ui/test/$f"; else bad "ui/test/$f did not run"; fi
  done
else printf '%s\n' "$V" | tail -30; bad "vitest"; fi
if PR=$(pnpm exec prettier --check ui/src/career $P/EditorPanel.tsx $P/LogsPanel.tsx $P/MetricsPanel.tsx $P/TargetSwitch.tsx \
  $P/MonacoEditor.tsx $S/Built.tsx $S/Story.tsx $S/ImpactLog.tsx ui/src/impact.ts ui/src/app/editor ui/src/app/logs \
  ui/src/app/metrics ui/src/app/built ui/test/tools.test.ts 2>&1); then ok "prettier --check on the F-24 files"
else printf '%s\n' "$PR" | tail -10; bad "prettier"; fi

section "test ids and roles kept"
has $P/MetricsPanel.tsx 'data-testid="metrics"' "metrics test id"
has $P/MetricsPanel.tsx 'data-testid=\{`metric-\$\{label\}`\}' "metric-<label> test id (metric-p99)"
has $P/MetricsPanel.tsx 'data-testid="pain"' "pain test id"
has $P/MetricsPanel.tsx 'label="p99"' "p99 tile"
has $P/TargetSwitch.tsx 'data-testid="target-select"' "target-select"
for id in target-switch target-dot target-description target-custom target-connect target-message; do
  has $P/TargetSwitch.tsx "data-testid=\"$id\"" "$id"
done
has $P/LogsPanel.tsx 'LOG_SERVICES' "log service tabs from LOG_SERVICES"
has $P/LogsPanel.tsx 'label="Service logs"' "tablist named Service logs (role tab comes from Tabs)"
has $P/LogsPanel.tsx 'data-testid="logbox"' "logbox test id"
has $P/LogsPanel.tsx 'label="Follow"' "follow-tail switch"
has $P/LogsPanel.tsx 'data-testid="log-filter"' "text filter"
has $P/LogsPanel.tsx 'visibleRange' "log feed is windowed by hand"
has $P/EditorPanel.tsx '^ *Save$' "Save button"
has $P/EditorPanel.tsx "aria-label=\"Workspace files\"" "Workspace files nav"
has $P/EditorPanel.tsx "key.toLowerCase\(\) === 's'" "Cmd+S saves from the panel"
has $P/EditorPanel.tsx 'data-testid="editor-bar"' "editor bar test id"
has $P/MonacoEditor.tsx 'defineTheme\(THEME_NAME' "Monaco night theme defined"
has $P/MonacoEditor.tsx "new URL\('monaco-editor/editor/editor.worker.js', import.meta.url\)" "Monaco worker creation unchanged"
has $P/MonacoEditor.tsx "KeyCode.KeyS" "Monaco binds Cmd+S"
has $P/EditorPanel.tsx "lazy\(\(\) => import\('./MonacoEditor'\)\)" "Monaco still lazy"
has $S/Story.tsx 'data-testid="write-portfolio"' "write-portfolio"
has $S/Story.tsx 'data-testid="portfolio-markdown"' "portfolio-markdown"
has $S/ImpactLog.tsx 'data-testid="impact-log"' "impact-log"
has $S/ImpactLog.tsx 'data-testid="impact-summary"' "impact-summary"
has $S/Built.tsx 'data-testid="insight-link"' "insight-link"
has $S/Built.tsx 'data-testid=\{`built-\$\{levelId\}`\}' "built-<level> cards"
has $S/Built.tsx 'PlayerCard' "player card on the career page"
has ui/src/career/PlayerCard.tsx "rankFor" "rank from src/game/rank.ts"
has $S/Built.tsx "onboarding/profile" "jersey colour from the profile store"
for f in ui/src/app/editor ui/src/app/logs ui/src/app/metrics ui/src/app/built; do
  has $f/page.tsx 'export const instant = false' "$f keeps instant = false"
done

section "no legacy class names, no CDN, no new dependency"
if grep -nE 'className="(muted|callout|btn|page|logbox|filelist|editor-bar|metrics|built-card|impact-list|story)\b' \
  ui/src/career/*.tsx $P/EditorPanel.tsx $P/LogsPanel.tsx $P/MetricsPanel.tsx $P/TargetSwitch.tsx $S/Built.tsx $S/Story.tsx $S/ImpactLog.tsx; then
  bad "legacy class names left"; else ok "no legacy class names in the rebuilt markup"; fi
if grep -nE 'https?://' ui/src/career ui/src/panels/MonacoEditor.tsx $P/LogsPanel.tsx $P/EditorPanel.tsx $P/MetricsPanel.tsx 2>/dev/null | grep -v 'http://localhost' | grep -v '^.*://[a-z-]*:' | grep -vE '//.*(https?://)' | grep -q .; then
  bad "external URL found"; else ok "no external URL"; fi

section "dev server routes (skipped when it is not running)"
if curl -s -o /dev/null --max-time 3 http://127.0.0.1:3100/design; then
  for r in editor logs metrics built; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://127.0.0.1:3100/$r")
    if [ "$code" = "200" ]; then ok "GET /$r -> 200"; else bad "GET /$r -> $code"; fi
  done
else printf 'skip  dev server not answering on 3100\n'; fi

printf '\n'
if [ "$FAILED" -eq 0 ]; then echo "F-24 OK"; else echo "F-24 FAILED"; exit 1; fi
