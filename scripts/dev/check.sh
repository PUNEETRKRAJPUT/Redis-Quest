#!/usr/bin/env bash
# Type-check and lint one workspace package, one run at a time on the whole machine.
#   scripts/dev/check.sh @quest/ui        (or @quest/engine, @quest/app, @quest/runner, @quest/shared)
# Several agents work in parallel worktrees on a 16 GB Mac. A type check of the UI needs about a gigabyte for a
# few seconds, so every caller waits for one lock directory instead of running side by side. This is the only
# local run the ten-day tasks use: no Docker, no dev server, no build, no test suite (docs/DAYS.md).
# bash 3.2 compatible.
set -u
PKG="${1:?usage: scripts/dev/check.sh <package name>}"
cd "$(dirname "$0")/../.." || exit 1
LOCK="${TMPDIR:-/tmp}/redis-quest-check.lock"
waited=0
until mkdir "$LOCK" 2>/dev/null; do
  # A lock older than ten minutes was left by a run that died.
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null; continue; fi
  sleep 3; waited=$((waited + 3))
  [ "$waited" -gt 900 ] && { echo "check.sh: gave up waiting for $LOCK"; exit 2; }
done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
status=0
if [ "$PKG" = "@quest/shared" ]; then
  # The other packages import the shared package's build output, so a change there is rebuilt, not just checked.
  pnpm --filter "$PKG" build || status=1
else
  pnpm --filter "$PKG" exec tsc --noEmit || status=1
fi
pnpm --filter "$PKG" lint || status=1
if [ "$status" -eq 0 ]; then echo "check.sh: $PKG type-checks and lints clean"; else echo "check.sh: $PKG FAILED"; fi
exit "$status"
