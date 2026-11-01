#!/usr/bin/env bash
# Full local CI: runs scripts/check/all.sh on this Mac and appends the result to docs/ci-local.log.
# GitHub's runners cannot run the arm64 Docker stacks, so this log is the evidence for Docker-backed checks.
# Takes many minutes and starts Docker stacks. bash 3.2 compatible.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
LOG="docs/ci-local.log"

if [ ! -f "$LOG" ]; then
  echo "# ci-local log: one line per scripts/check/ci-local.sh run: <UTC timestamp> <git sha> PASS|FAIL" > "$LOG"
fi

status=0
# all.sh also runs P0-12.sh; clear the flag so that nested run only validates the workflow instead of
# starting this script again (it did, once).
P0_12_RUN_LOCAL= bash scripts/check/all.sh || status=1

# ---- HOOK (P0-10): Playwright run of Chapter 0 in the browser goes here. ----
# On failure set status=1, e.g.: pnpm --filter @quest/ui e2e || status=1
# ---- end hook ----

sha=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
if [ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then sha="${sha}-dirty"; fi
if [ "$status" -eq 0 ]; then result=PASS; else result=FAIL; fi
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $sha $result" >> "$LOG"

echo
echo "ci-local: $result (sha $sha), appended to $LOG"
exit "$status"
