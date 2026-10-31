#!/usr/bin/env bash
# C0 acceptance: Chapter 0 content validates, every referenced solution file exists and is
# non-empty, every teach panel has a docs link. Does not run solutions against Redis (P0-09).
# bash 3.2 compatible: no associative arrays, no mapfile.
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
CH="levels/ch0-boot"
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
for f in "$CH"/0[1-5]-*.yaml; do
  [ -f "$f" ] || continue
  COUNT=$((COUNT + 1))
  id=$(sed -n 's/^id: *//p' "$f" | head -n 1)
  echo "level $id"
  # every solutions path in the file: reference line and "path:" lines
  for p in $(grep -E '^[[:space:]]*(reference:|- path:)[[:space:]]+solutions/' "$f" | sed -E 's/.*(solutions\/[^[:space:]]+).*/\1/'); do
    if [ -s "$CH/$p" ]; then pass "  $p exists, non-empty"; else fail "  $p missing or empty ($id)"; fi
  done
  # teach panel has a docs link
  if grep -qE '^docs:' "$f" && grep -qE '^  - https://redis\.io/docs/' "$f"; then
    pass "  docs link present"
  else
    fail "  no docs link ($id)"
  fi
  # teach length 8 to 20 lines
  n=$(awk '/^teach: \|/{t=1;next} t&&/^[^ ]/{exit} t{c++} END{print c+0}' "$f")
  if [ "$n" -ge 8 ] && [ "$n" -le 20 ]; then pass "  teach is $n lines"; else fail "  teach is $n lines, want 8 to 20 ($id)"; fi
done
[ "$COUNT" -eq 5 ] && pass "5 level files" || fail "found $COUNT level files, want 5"

echo
if [ $FAILS -eq 0 ]; then echo "C0 OK"; exit 0; fi
echo "C0 FAILED ($FAILS)"; exit 1
