#!/usr/bin/env bash
# D-10 acceptance: the launch kit. No Docker, nothing posted, nothing sent to GitHub. Bash 3.2 compatible.
# ci: docker-free
#   - the site builds from the repository and has its five pages, 96 level rows, and no reference to another origin;
#   - the Pages workflow publishes only when PAGES_ENABLED is true;
#   - twenty issue drafts, each well-formed and naming at least one file that exists; the create script's dry run works;
#   - the four posts and the README carry the "not affiliated" line; the thread posts fit in 280 characters; no
#     superlatives; no leftover task ids in the public text;
#   - the checklist puts the name decision first; shell and Node syntax; prettier on the files this task owns.
# Needs `pnpm --filter @quest/shared build` first (CI does that before it runs the docker-free checks).
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
FAILS=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILS=$((FAILS + 1)); }
step() { echo; echo "== $1"; }
ok_if() { # description, command...
  desc=$1; shift
  if "$@" >/dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi
}

step "the site builds"
OUT=$(node scripts/site/build.mjs 2>&1); RC=$?
echo "$OUT"
[ "$RC" -eq 0 ] && pass "node scripts/site/build.mjs exits 0" || fail "site build failed"
for f in index levels commands grading contribute; do
  [ -s "site/$f.html" ] && pass "site/$f.html exists" || fail "site/$f.html missing"
done
[ -s site/style.css ] && pass "site/style.css exists" || fail "site/style.css missing"
for i in map mock-interview show-me-gallery terminal-target what-you-built; do
  [ -s "site/img/$i.jpg" ] && pass "screenshot $i copied" || fail "screenshot $i missing"
done
ROWS=$(grep -c '<tr id="[a-z0-9-]*-[0-9][0-9]-' site/levels.html)
[ "$ROWS" -eq 96 ] && pass "the catalogue has 96 level rows" || fail "the catalogue has $ROWS level rows, expected 96"
if grep -E 'src="https?:|<link[^>]*href="https?:|url\(https?:|@import|<script|<iframe|<video' site/*.html site/style.css >/dev/null; then
  fail "the site references another origin or embeds something"
else
  pass "no script, embed, font or stylesheet from another origin"
fi
grep -q "not affiliated with or endorsed by Redis" site/index.html && pass "site home says it is not affiliated" || fail "site home lacks the affiliation line"
if grep -E '\b[EACFG]-[0-9][0-9]\b' site/grading.html | grep -v 'G-01' >/dev/null; then fail "grading page leaks a task id"; else pass "grading page names no task id"; fi
git check-ignore -q site && pass "site/ is git-ignored" || fail "site/ is not git-ignored"

step "the Pages workflow"
W=.github/workflows/pages.yml
[ -f "$W" ] && pass "$W exists" || fail "$W missing"
grep -q "branches: \[main\]" "$W" && pass "builds on push to main" || fail "does not build on push to main"
grep -q "vars.PAGES_ENABLED == 'true'" "$W" && pass "publishes only when PAGES_ENABLED is true" || fail "publish is not gated on PAGES_ENABLED"
grep -q "actions/deploy-pages" "$W" && pass "deploys with actions/deploy-pages" || fail "no deploy step"

step "starter issues"
N=$(ls docs/launch/issues/[0-9][0-9]-*.md 2>/dev/null | wc -l | tr -d ' ')
[ "$N" -eq 20 ] && pass "twenty drafts" || fail "$N drafts, expected 20"
for f in docs/launch/issues/[0-9][0-9]-*.md; do
  t=$(sed -n 's/^title: *//p' "$f" | head -n 1)
  l=$(sed -n 's/^labels: *//p' "$f" | head -n 1)
  [ -n "$t" ] && [ -n "$l" ] || { fail "$f: no title or labels"; continue; }
  found=0
  for p in $(grep -oE '`[A-Za-z0-9_.][A-Za-z0-9_./-]*/[A-Za-z0-9_./-]+`' "$f" | tr -d '`' | sort -u); do
    [ -e "$p" ] && found=$((found + 1))
  done
  [ "$found" -ge 1 ] && pass "$(basename "$f"): names $found existing file(s)" || fail "$f names no file that exists"
done
DRY=$(scripts/launch/create-issues.sh --dry-run 2>&1); RC=$?
[ "$RC" -eq 0 ] && echo "$DRY" | grep -q "20 drafts are well-formed" && pass "create-issues.sh --dry-run works" || { fail "create-issues.sh --dry-run"; echo "$DRY" | tail -5; }

step "posts, README, checklist"
for f in docs/launch/posts/0[1-4]-*.md README.md; do
  tr '\n' ' ' < "$f" | tr -s ' ' | grep -q "not affiliated with or endorsed by Redis" && pass "$f: not-affiliated line" || fail "$f: no not-affiliated line"
done
if grep -inE 'revolutionar|game-chang|best-in-class|world-class|blazing|amazing|unparalleled|cutting-edge|the best |fastest|greatest|most powerful|#1' docs/launch/posts/0[1-4]-*.md site/index.html >/dev/null; then fail "a superlative is in a post or the home page"; else pass "no superlatives"; fi
if grep -nE '\bD-(0[1-9]|10)\b' docs/launch/posts/0[1-4]-*.md site/index.html site/levels.html >/dev/null; then fail "a post or page names a ten-day task"; else pass "posts and pages name no ten-day task or Phase 0 task"; fi
BAD=$(awk '/^\*\*[0-9]\/7\*\*$/ {getline; getline; if (length($0) > 280) n++} END {print n+0}' docs/launch/posts/03-thread.md)
[ "$BAD" -eq 0 ] && pass "every thread post is 280 characters or fewer" || fail "$BAD thread posts are over 280 characters"
grep -q "Nobody except its author has played it" README.md && pass "README says nobody else has played it" || fail "README does not say so"
FIRST=$(grep -n '^## ' docs/launch/CHECKLIST.md | sed -n 2p)
case "$FIRST" in *"The name"*) pass "the checklist's first step after the preparation is the name" ;; *) fail "the name is not the first step: $FIRST" ;; esac
grep -q "redis.io/legal/trademark-policy" docs/launch/CHECKLIST.md && pass "the checklist links Redis's trademark policy" || fail "no trademark policy link"

step "syntax and formatting"
for f in scripts/site/*.mjs scripts/launch/*.mjs; do ok_if "node --check $f" node --check "$f"; done
for f in scripts/launch/create-issues.sh scripts/check/D-10.sh; do ok_if "bash -n $f" bash -n "$f"; done
ok_if "prettier: site generator, facts script, README" pnpm --silent exec prettier --check scripts/site scripts/launch/facts.mjs
ok_if "prettier: README.md" pnpm --silent exec prettier --check --ignore-path /dev/null README.md
ok_if "C-POL's README rows still hold (levels:validate says 96)" sh -c 'pnpm --silent --filter @quest/shared levels:validate levels | grep -q "8 chapter(s), 96 level(s)"'

echo
if [ "$FAILS" -eq 0 ]; then echo "D-10: ALL CHECKS PASSED"; exit 0; fi
echo "D-10: $FAILS FAILED"
exit 1
