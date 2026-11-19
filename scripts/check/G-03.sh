#!/usr/bin/env bash
# ci: docker-free
# G-03: no check script may act on the default compose project.
#
# docker-compose.yml names its project `redis-quest`: a bare `docker compose up|down|stop|exec ...` acts on the
# stack a learner plays on. On 2026-11-19 an older check did exactly that to a real player's game (it stopped
# their Redis and Postgres and ran unit tests against them). Every check that drives Compose must therefore
# either scope each call (`docker compose -p <own project> ...`, usually through a small wrapper function) or
# call `quest_isolate` from scripts/check/lib/isolate.sh before its first call, which exports
# COMPOSE_PROJECT_NAME, COMPOSE_FILE and COMPOSE_ENV_FILES and refuses to run on the default project.
#
# This is a static tripwire, not a proof: it reads every scripts/check/*.sh file and fails
# when it finds a state-changing compose call that is neither scoped nor preceded by quest_isolate.
# Bash 3.2 compatible. No Docker.
set -u
cd "$(dirname "$0")/../.." || exit 1

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }

# Prints "<line>:<text>" for every bare, state-changing compose call in a shell script. A call is `docker compose`
# at a command position (start of a line, or after ; & | $( then do if while until !), so the same words inside
# a message or inside the JavaScript that inspects level text do not count. A wrapper function that hands its
# arguments to an unscoped `docker compose "$@"` counts as a bare call too.
bare_calls() {
  awk '
    /^[[:space:]]*#/ { next }
    /docker compose -p / { next }
    /docker compose/ && /\$@/ { print FNR ":" $0; next }      # a wrapper that passes its arguments on, unscoped
    /(^|[;&|]|\$\(|then |do |if |while |until |! )[[:space:]]*docker compose( --profile [a-z]+)*( -f [^ ]+)* (up|down|stop|start|restart|build|run|rm|kill|exec|pull|create|pause|unpause)([[:space:]]|$)/ {
      print FNR ":" $0
    }
  ' "$1"
}

checked=0
for f in scripts/check/*.sh; do
  [ -f "$f" ] || continue
  case "$f" in scripts/check/G-03.sh) continue ;; esac
  checked=$((checked + 1))
  calls="$(bare_calls "$f")"
  [ -z "$calls" ] && continue
  first="$(printf '%s\n' "$calls" | head -n 1 | cut -d: -f1)"
  iso="$(grep -nE '^[[:space:]]*quest_isolate [a-zA-Z0-9-]+ [0-9]+ [0-9]+ [0-9]+ [0-9]+' "$f" | head -n 1 | cut -d: -f1)"
  env="$(grep -nE 'COMPOSE_PROJECT_NAME=' "$f" | head -n 1 | cut -d: -f1)"
  guard="${iso:-${env:-}}"
  if [ -n "$guard" ] && [ "$guard" -lt "$first" ]; then
    ok "$f: bare compose calls from line $first on, isolated at line $guard"
  else
    bad "$f: bare compose call with no isolation before it:"
    printf '%s\n' "$calls" | head -n 5 | sed 's/^/        /'
  fi
done
ok "read $checked check scripts"

# The grading harness runs solution scripts that call `docker compose` themselves: it must hand them its own project.
grep -q 'COMPOSE_PROJECT_NAME' scripts/grade/grade.mjs \
  && ok "scripts/grade/grade.mjs sets COMPOSE_PROJECT_NAME for the solution scripts it runs" \
  || bad "scripts/grade/grade.mjs no longer sets COMPOSE_PROJECT_NAME"

# The helper itself must keep failing closed.
grep -q 'REFUSING TO RUN' scripts/check/lib/isolate.sh && grep -q 'exit 99' scripts/check/lib/isolate.sh \
  && ok "scripts/check/lib/isolate.sh refuses the default project" || bad "isolate.sh lost its guard"
grep -q 'QUEST_CHECK_IMAGE' scripts/check/compose.isolated.yml \
  && ok "compose.isolated.yml gives the Node services their own image tag" || bad "compose.isolated.yml lost the image override"

# The learner-facing scripts are the only ones allowed to act on the default project.
for f in scripts/start scripts/stop scripts/reset; do
  [ -f "$f" ] && ok "$f acts on the default project by design (the learner runs it)"
done

if [ "$FAILED" -eq 0 ]; then printf '\nG-03 OK\n'; exit 0; fi
printf '\nG-03 FAILED\n'; exit 1
