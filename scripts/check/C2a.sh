#!/usr/bin/env bash
# C2a acceptance: Chapter 2 opening (levels 2.1 to 2.4) validates, chapter.yaml lists exactly the four
# levels, every referenced solution and fixture exists and parses, every solution module is valid
# JavaScript, both scenario files parse with the engine's own scenario parser, and the spec's rule that
# level 2.2's behavior step never checks TTL holds. Does not run solutions live (the verifier does that).
# bash 3.2 compatible: no associative arrays, no mapfile.
set -u

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
CH="levels/ch2-everyone-showed-up"
FAILS=0

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILS=$((FAILS + 1)); }
step() { echo; echo "== $1"; }

step "build @quest/shared"
pnpm --filter @quest/shared build >/dev/null 2>&1 && pass "build" || { fail "build"; exit 1; }

step "validate $CH"
OUT=$(pnpm --silent --filter @quest/shared levels:validate "$CH" 2>&1); RC=$?
if [ $RC -eq 0 ]; then pass "$OUT"; else fail "validate (exit $RC)"; echo "$OUT"; fi

step "chapter.yaml"
if sed -n 's/^id: *//p' "$CH/chapter.yaml" | head -n 1 | grep -qx 'ch2'; then pass "chapter id ch2"; else fail "chapter id is not ch2"; fi
LISTED=$(grep -E '^  - ch2-' "$CH/chapter.yaml" | wc -l | tr -d ' ')
[ "$LISTED" -eq 4 ] && pass "chapter lists exactly 4 levels" || fail "chapter lists $LISTED levels, want 4"

step "levels"
COUNT=0
for f in "$CH"/[0-9][0-9]-*.yaml; do
  [ -f "$f" ] || continue
  COUNT=$((COUNT + 1))
  id=$(sed -n 's/^id: *//p' "$f" | head -n 1)
  echo "level $id"
  grep -qE "^  - $id\$" "$CH/chapter.yaml" && pass "  listed in chapter.yaml" || fail "  not listed in chapter.yaml ($id)"
  for p in $(grep -E '^[[:space:]]*(reference:|- path:)[[:space:]]+solutions/' "$f" | sed -E 's/.*(solutions\/[^[:space:]]+).*/\1/'); do
    if [ -s "$CH/$p" ]; then pass "  $p exists, non-empty"; else fail "  $p missing or empty ($id)"; fi
    case "$p" in
      *.js) node --check "$CH/$p" 2>/dev/null && pass "  $p is valid JavaScript" || fail "  $p does not parse ($id)";;
    esac
  done
  for p in $(grep -E '^[[:space:]]*fixtures:[[:space:]]+fixtures/' "$f" | sed -E 's/.*(fixtures\/[^[:space:]]+).*/\1/' | sort -u); do
    if [ -s "$CH/$p" ]; then pass "  $p exists, non-empty"; else fail "  $p missing or empty ($id)"; fi
  done
  if grep -qE '^docs:' "$f" && grep -qE '^  - https://redis\.io/docs/' "$f"; then pass "  docs link present"; else fail "  no docs link ($id)"; fi
  n=$(awk '/^teach: \|/{t=1;next} t&&/^[^ ]/{exit} t{c++} END{print c+0}' "$f")
  if [ "$n" -ge 8 ] && [ "$n" -le 24 ]; then pass "  teach is $n lines"; else fail "  teach is $n lines, want 8 to 24 ($id)"; fi
  sc=$(sed -n 's/^scenario: *\([A-Za-z0-9-]*\).*/\1/p' "$f" | head -n 1)
  if [ -n "$sc" ]; then
    [ -f "scenarios/$sc.yaml" ] && pass "  scenario $sc exists" || fail "  scenario $sc has no file ($id)"
  fi
  tsc=$(grep -E '^[[:space:]]+scenario: ' "$f" | sed -E 's/.*scenario: *([A-Za-z0-9-]+).*/\1/' | sort -u)
  for s in $tsc; do
    [ -f "scenarios/$s.yaml" ] && pass "  traffic scenario $s exists" || fail "  traffic scenario $s has no file ($id)"
  done
done
[ "$COUNT" -eq 4 ] && pass "4 level files" || fail "found $COUNT level files, want 4"

step "spec rules"
# Level 2.2: the behavior verifier must not check TTL, or a no-TTL cache could never be works-but-wrong.
L2="$CH/02-cache-aside-v1.yaml"
BEH=$(awk '/^  - type: behavior/{b=1;next} /^  - type: /{b=0} b' "$L2")
if echo "$BEH" | grep -q 'TTL'; then fail "02 behavior step checks TTL"; else pass "02 behavior step does not check TTL"; fi
grep -qE 'cmd: \[TTL, "cache:player:p-151"\]' "$L2" && pass "02 antipattern checks TTL on p-151" || fail "02 antipattern does not check TTL on p-151"
# Level 2.4 needs a behavior verifier: a traffic-only level activates no slot (P0-09).
grep -q 'type: behavior' "$CH/04-stampede-at-the-toss.yaml" && pass "04 has a behavior verifier (slot activation)" || fail "04 has no behavior verifier"

step "scenarios"
for s in stats-hot-100 stampede-one-key; do
  R=$(node -e '
    import("./engine/dist/load/scenario.js").then(async (m) => {
      const s = await m.loadScenario("scenarios", process.argv[1]);
      console.log("id=" + s.id + " connections=" + s.connections + " durationSec=" + s.durationSec + " requests=" + s.requests.length);
    }).catch((e) => { console.error(e.message); process.exit(1); });' "$s" 2>&1)
  if [ $? -eq 0 ]; then pass "scenarios/$s.yaml parses: $R"; else fail "scenarios/$s.yaml: $R"; fi
done

echo
if [ $FAILS -eq 0 ]; then echo "C2a OK"; exit 0; fi
echo "C2a FAILED ($FAILS)"; exit 1
