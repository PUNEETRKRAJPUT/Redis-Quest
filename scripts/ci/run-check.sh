#!/usr/bin/env bash
# Runs one script (normally scripts/check/<id>.sh) on the hosted Linux arm64 runner under the two conditions it was
# written for on a Mac. Used only by .github/workflows/stack.yml. Not for a Mac: there the checks run as they are.
#
#   scripts/ci/run-check.sh scripts/check/D-09.sh
#   D02_FULL=1 scripts/ci/run-check.sh scripts/check/D-02.sh      (the caller's environment is passed on)
#
# 1. Files. Docker Desktop on a Mac lets a container write to any bind-mounted folder and lets the user delete
#    whatever a container left behind. Native Linux Docker enforces owners: the game's containers run as `node`
#    (uid 1000) and `postgres`, the runner as someone else. So the check runs as root with umask 000: every
#    scratch folder it creates is writable by the containers, and it can remove what they wrote.
# 2. A few Mac commands (scripts/ci/linux-shims.sh), first on PATH for this one script.
set -u

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <script> [args...]"
  exit 2
fi
if [ "$(uname -s)" != "Linux" ]; then
  echo "run-check.sh is for the hosted Linux runner; on a Mac run the check itself: bash $*"
  exit 2
fi

here="$(cd "$(dirname "$0")" && pwd)"
shims="${RUNNER_TEMP:-/tmp}/quest-linux-shims"
bash "$here/linux-shims.sh" "$shims" >/dev/null || exit 2

exec sudo -E env "PATH=$shims:$PATH" "HOME=$HOME" bash -c 'umask 000; exec bash "$@"' run-check "$@"
