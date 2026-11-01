#!/usr/bin/env bash
# Thin wrapper for the level grading harness (G-01). bash 3.2 compatible.
# usage: scripts/grade/grade.sh [--engine URL] [--workspace DIR] [--levels DIR] [--run-ops] [--json FILE] <chapter-dir|level-id>...
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

if ! command -v node >/dev/null 2>&1; then echo "grade: node is not installed" >&2; exit 2; fi
# The tool reads levels with the built @quest/shared loader.
if [ ! -f packages/shared/dist/index.js ]; then
  echo "grade: building @quest/shared first" >&2
  pnpm --filter @quest/shared build >&2 || { echo "grade: could not build @quest/shared" >&2; exit 2; }
fi
exec node "$ROOT/scripts/grade/grade.mjs" "$@"
