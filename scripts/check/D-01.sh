#!/usr/bin/env bash
# ci: docker-free
# D-01 check: the contributor front door and the machine verdict on a pull request.
#
# Docker-free and GitHub-free on purpose: it reads the files, parses the scripts, runs the unit tests of scripts/ci
# and exercises scripts/review-pr's file classifier. What it cannot prove (the workflow's first real run, stack.mjs
# against a real Redis and Postgres, review-pr against a real pull request) is listed under "How to verify" in
# docs/handoffs/D-01.md. It never calls `docker compose`. bash 3.2 compatible.
set -u
cd "$(dirname "$0")/../.." || exit 1

FAILED=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
has() { grep -qF -- "$2" "$1" && pass "$1 contains '$2'" || fail "$1 lacks '$2'"; }
hasnt() { if grep -qF -- "$2" "$1"; then fail "$1 contains '$2'"; else pass "$1 does not contain '$2'"; fi; }

echo "== contributor files"
for f in CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md .github/PULL_REQUEST_TEMPLATE.md \
  .github/ISSUE_TEMPLATE/bug.md .github/ISSUE_TEMPLATE/level-idea.md .github/ISSUE_TEMPLATE/playtest-finding.md; do
  [ -s "$f" ] && pass "$f exists" || fail "$f is missing or empty"
done
has CONTRIBUTING.md "Apple Silicon"
has CONTRIBUTING.md "16 GB"
has CONTRIBUTING.md "default compose project"
has CONTRIBUTING.md "quest_isolate"
has CONTRIBUTING.md "docs/handoffs/G-03.md"
has CONTRIBUTING.md "scripts/review-pr"
has README.md "CONTRIBUTING.md"
has SECURITY.md "127.0.0.1"
for f in .github/ISSUE_TEMPLATE/bug.md .github/ISSUE_TEMPLATE/level-idea.md .github/ISSUE_TEMPLATE/playtest-finding.md; do
  head -n 1 "$f" | grep -qx -- '---' && grep -q '^name: ' "$f" && pass "$f has issue-template front matter" || fail "$f lacks front matter"
done

echo
echo "== scripts parse"
for f in scripts/ci/stack.mjs scripts/ci/stack-lib.mjs scripts/ci/deterministic.mjs scripts/ci/verdict-summary.mjs \
  scripts/grade/grade.mjs; do
  node --check "$f" && pass "node --check $f" || fail "node --check $f"
done
for f in scripts/review-pr scripts/check/D-01.sh; do
  bash -n "$f" && pass "bash -n $f" || fail "bash -n $f"
done
[ -x scripts/review-pr ] && pass "scripts/review-pr is executable" || fail "scripts/review-pr is not executable"

echo
echo "== unit tests of the pure logic (node:test)"
if node --test scripts/ci/stack-lib.test.mjs scripts/ci/deterministic.test.mjs scripts/ci/verdict-summary.test.mjs; then
  pass "scripts/ci unit tests"
else
  fail "scripts/ci unit tests"
fi

echo
echo "== scripts/grade/grade.mjs --deterministic"
has scripts/grade/grade.mjs "--deterministic"
has scripts/grade/grade.mjs "deterministicSkipReason"
has scripts/grade/grade.mjs "cannot be combined with --run-ops"

echo
echo "== scripts/review-pr refuses code that runs on the Mac"
sens="$(printf '%s\n' levels/ch1-keyspace/01-x.yaml docs/a.md ui/src/a.tsx | bash scripts/review-pr --classify-stdin)"
[ $? -eq 0 ] && [ -z "$sens" ] && pass "level, doc and ui files are not sensitive" || fail "a harmless file was classed as sensitive: $sens"
for path in scripts/check/G-01.sh scripts/grade/grade.mjs .github/workflows/ci.yml docker-compose.yml docker/Caddyfile \
  package.json engine/package.json pnpm-lock.yaml .npmrc levels/ch5-survive/solutions/09-reference.sh; do
  out="$(printf '%s\n' "$path" | bash scripts/review-pr --classify-stdin)"
  [ $? -eq 1 ] && [ "$out" = "$path" ] && pass "$path is sensitive" || fail "$path was not classed as sensitive"
done
has scripts/review-pr "--i-read-the-diff"
has scripts/review-pr "REFUSING to run this pull request"
has scripts/review-pr "G01_RUN_OPS=1"
has scripts/review-pr "compose project \$PROJECT already exist"
# Every docker compose call in review-pr must name its project.
if grep -nE 'docker compose' scripts/review-pr | grep -vE 'docker compose -p|^[0-9]+:[[:space:]]*#|echo ' | grep -q .; then
  fail "scripts/review-pr has a docker compose call without -p"
else
  pass "every docker compose call in scripts/review-pr is scoped with -p"
fi
# `--comment` is the only thing that posts.
n="$(grep -c 'gh pr comment "\$PR"' scripts/review-pr)"
[ "$n" -ge 1 ] && grep -n 'gh pr comment "\$PR" --body-file' scripts/review-pr | grep -q . && pass "gh pr comment is used (behind --comment)" || fail "gh pr comment not found"
out="$(bash scripts/review-pr abc 2>&1)"; rc=$?
[ "$rc" -eq 2 ] && pass "a non-numeric pull request number exits 2" || fail "non-numeric number exited $rc: $out"

echo
echo "== .github/workflows/pr-verdict.yml"
W=.github/workflows/pr-verdict.yml
[ -f "$W" ] && pass "$W exists" || fail "$W is missing"
has "$W" "pull_request:"
hasnt "$W" "pull_request_target"
hasnt "$W" "secrets."
has "$W" "contents: read"
has "$W" "image: redis:8"
has "$W" "image: postgres:16"
has "$W" "postgres/init/004-slow-by-design.sql"
has "$W" "scripts/ci/stack.mjs"
has "$W" "--deterministic"
has "$W" "GITHUB_STEP_SUMMARY"
# Nothing from a pull request's text may be interpolated into a script: no github.event.* or head_ref in run blocks.
hasnt "$W" "github.event.pull_request.title"
hasnt "$W" "github.head_ref"
if grep -nE '^permissions:' "$W" | grep -q .; then pass "$W declares permissions"; else fail "$W declares no permissions"; fi
if grep -nE '(write|admin)' "$W" | grep -E 'permissions|: write' | grep -q .; then fail "$W asks for a write permission"; else pass "$W asks for no write permission"; fi

echo
echo "== no check in this task acts on Compose"
if grep -nE 'docker compose' scripts/check/D-01.sh | grep -vE '^[0-9]+:[[:space:]]*(#|has|hasnt|if grep|echo|pass|fail)' | grep -vE "grep" | grep -q .; then
  fail "D-01.sh calls docker compose"
else
  pass "D-01.sh never calls docker compose"
fi

if [ "$FAILED" -eq 0 ]; then echo; echo "D-01 OK"; exit 0; fi
echo; echo "D-01 FAILED"; exit 1
