#!/usr/bin/env bash
# P0-01 acceptance: workspace installs, builds, lints and tests; layout exists.
set -eu
cd "$(dirname "$0")/../.."

step() { printf '\n== %s\n' "$1"; }
assert() { # assert <description> <test-args...>
  desc="$1"; shift
  if test "$@"; then printf 'PASS  %s\n' "$desc"; else printf 'FAIL  %s\n' "$desc"; exit 1; fi
}

step "pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile
step "pnpm -r build"
pnpm -r build
step "pnpm -r lint"
pnpm -r lint
# The runner and app unit tests talk to a live Redis and Postgres (the compose services, host ports from
# .env). Start them for the test step and stop them afterwards.
RP=$(grep -E '^REDIS_PORT=' .env 2>/dev/null | cut -d= -f2); RP=${RP:-6379}
PP=$(grep -E '^PG_PORT=' .env 2>/dev/null | cut -d= -f2); PP=${PP:-5432}
step "docker compose up -d redis postgres (for the workspace tests)"
docker compose up -d redis postgres >/dev/null
i=0; until docker compose exec -T postgres pg_isready -U quest -d quest -h 127.0.0.1 >/dev/null 2>&1 && docker compose exec -T redis redis-cli PING >/dev/null 2>&1; do
  i=$((i + 1)); [ $i -gt 60 ] && { echo "FAIL  redis/postgres not healthy after 2 minutes"; exit 1; }; sleep 2
done
echo "PASS  redis on 127.0.0.1:$RP and postgres on 127.0.0.1:$PP are up"
step "pnpm -r test"
REDIS_URL="redis://127.0.0.1:$RP" DATABASE_URL="postgres://quest:quest@127.0.0.1:$PP/quest" pnpm -r test
docker compose stop redis postgres >/dev/null 2>&1 || true

step "assertions"
for d in packages/shared engine app runner ui; do
  assert "package dir exists: $d" -f "$d/package.json"
done
for d in levels scenarios workspace; do
  assert "README exists: $d/README.md" -f "$d/README.md"
done
assert "ui/dist/index.html produced" -f ui/dist/index.html
assert "shared dist produced" -f packages/shared/dist/index.js
# app and runner print their name and exit when PORT is unset; the engine always serves, so it only
# gets a syntax check here (its behaviour is covered by scripts/check/P0-06.sh).
for p in app runner; do
  out=$(node "$p/dist/main.js")
  assert "$p/dist/main.js prints @quest/$p" "$out" = "@quest/$p"
done
node --check engine/dist/main.js && printf 'PASS  engine/dist/main.js parses (server entrypoint, not run here)\n'

printf '\nP0-01 OK\n'
