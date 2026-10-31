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
step "pnpm -r test"
pnpm -r test

step "assertions"
for d in packages/shared engine app runner ui; do
  assert "package dir exists: $d" -f "$d/package.json"
done
for d in levels scenarios workspace; do
  assert "README exists: $d/README.md" -f "$d/README.md"
done
assert "ui/dist/index.html produced" -f ui/dist/index.html
assert "shared dist produced" -f packages/shared/dist/index.js
for p in engine app runner; do
  out=$(node "$p/dist/main.js")
  assert "$p/dist/main.js prints @quest/$p" "$out" = "@quest/$p"
done

printf '\nP0-01 OK\n'
