#!/usr/bin/env bash
# C1 acceptance: Chapter 1 content validates, 16 level files exist, every referenced solution and
# fixture file exists and is non-empty, every level has a docs link and a teach panel of 8 to 20
# lines. Does not run solutions against Redis (that is P0-09's job).
# bash 3.2 compatible: no associative arrays, no mapfile.
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
CH="levels/ch1-keyspace"
FAILS=0

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILS=$((FAILS + 1)); }
step() { echo; echo "== $1"; }

step "build @quest/shared"
pnpm --filter @quest/shared build >/dev/null 2>&1 && pass "build" || { fail "build"; exit 1; }

step "validate $CH"
OUT=$(pnpm --silent --filter @quest/shared levels:validate "$CH" 2>&1); RC=$?
if [ $RC -eq 0 ]; then pass "$OUT"; else fail "validate (exit $RC)"; echo "$OUT"; fi

step "levels"
COUNT=0
for f in "$CH"/[0-9][0-9]-*.yaml; do
  [ -f "$f" ] || continue
  COUNT=$((COUNT + 1))
  id=$(sed -n 's/^id: *//p' "$f" | head -n 1)
  echo "level $id"
  # every solutions path in the file: reference line and "path:" lines (decision levels name option ids, no files)
  for p in $(grep -E '^[[:space:]]*(reference:|- path:)[[:space:]]+solutions/' "$f" | sed -E 's/.*(solutions\/[^[:space:]]+).*/\1/'); do
    if [ -s "$CH/$p" ]; then pass "  $p exists, non-empty"; else fail "  $p missing or empty ($id)"; fi
  done
  # fixture files used by behavior verifiers
  for p in $(grep -E '^[[:space:]]*fixtures:[[:space:]]+fixtures/' "$f" | sed -E 's/.*(fixtures\/[^[:space:]]+).*/\1/' | sort -u); do
    if [ -s "$CH/$p" ]; then pass "  $p exists, non-empty"; else fail "  $p missing or empty ($id)"; fi
  done
  # docs link
  if grep -qE '^docs:' "$f" && grep -qE '^  - https://redis\.io/docs/' "$f"; then
    pass "  docs link present"
  else
    fail "  no docs link ($id)"
  fi
  # teach length 8 to 20 lines
  n=$(awk '/^teach: \|/{t=1;next} t&&/^[^ ]/{exit} t{c++} END{print c+0}' "$f")
  if [ "$n" -ge 8 ] && [ "$n" -le 20 ]; then pass "  teach is $n lines"; else fail "  teach is $n lines, want 8 to 20 ($id)"; fi
done
[ "$COUNT" -eq 16 ] && pass "16 level files" || fail "found $COUNT level files, want 16"

echo
if [ $FAILS -eq 0 ]; then echo "C1 OK"; exit 0; fi
echo "C1 FAILED ($FAILS)"; exit 1
