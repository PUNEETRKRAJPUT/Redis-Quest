#!/usr/bin/env bash
# D-09 check: Match Day, the seeded survival run with an incident deck. WRITTEN, NOT RUN (docs/handoffs/D-09.md).
#   1. static: the deck is in the image recipe, five cards, no card names a game: prefix
#   2. a stack of its own (compose project quest-d09): GET /api/matchday, the same seed gives the same fixture
#   3. refused while a traffic run is going (409), and nothing changed by the refusal
#   4. one whole match: it ends, the scoreboard has overs, the results file has it, `CONFIG GET maxmemory` and a census
#      of every key outside cache:* are the same before and after, and no undo journal is left behind
#   5. a second match stopped half way ends as "stopped" and leaves everything as it was
#   6. the /matchday page answers
# Needs a few minutes (a match is up to six overs of ten seconds). bash 3.2 compatible.
set -u
cd "$(dirname "$0")/../.." || exit 1

. scripts/check/lib/isolate.sh
quest_isolate d09 4390 6590 5690 5790

FAILED=0
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILED=1; }
note() { printf 'NOTE  %s\n' "$1"; }
section() { printf '\n== %s\n' "$1"; }
finish() {
  section "cleanup"
  quest_isolate_down
  if [ "$FAILED" -eq 0 ]; then printf '\nD-09 OK\n'; exit 0; fi
  printf '\nD-09 FAILED\n'; exit 1
}
BASE="http://127.0.0.1:$QUEST_CHECK_PROXY_PORT"
# jx 'expression over d': prints the value of the JS expression over the JSON on stdin (nothing on a parse error)
jx() { node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const d=JSON.parse(s);const v=eval(process.argv[1]);if(v!==undefined)console.log(typeof v==="object"?JSON.stringify(v):v)}catch(e){}})' "$1"; }
rcli() { docker compose exec -T redis redis-cli "$@" | tr -d '\r'; }
census() { rcli --scan | grep -v '^cache:' | sort | tr '\n' ' '; }
post() { curl -s -m 30 -X POST -H 'content-type: application/json' -d "$2" "$BASE$1"; }
code() { curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d "$2" "$BASE$1"; }
get() { curl -s -m 30 "$BASE$1"; }

section "static: the deck, the image recipe, the reserved prefix"
if grep -qE '^COPY incidents' docker/node.Dockerfile; then ok "docker/node.Dockerfile copies incidents/"; else bad "docker/node.Dockerfile does not COPY incidents: the engine image has no deck (add 'COPY incidents incidents' next to the scenarios line)"; fi
n="$(ls incidents/*.yaml 2>/dev/null | wc -l | tr -d ' ')"
if [ "$n" = "5" ]; then ok "five cards in incidents/"; else bad "expected 5 cards, found $n"; fi
if grep -nE 'prefixes:.*game:' incidents/*.yaml >/dev/null; then bad "a card names a game: prefix"; else ok "no card names a game: prefix"; fi

section "docker compose up -d --build (own project)"
if docker compose up -d --build redis postgres engine app runner proxy ui >/dev/null 2>&1; then ok "stack started"; else bad "compose up failed"; finish; fi
i=0
while [ $i -lt 120 ]; do
  h="$(get /health || true)"
  case "$h" in *'"redis":"up"'*'"postgres":"up"'*) break ;; esac
  sleep 2; i=$((i + 1))
done
case "${h:-}" in *'"redis":"up"'*) ok "engine healthy" ;; *) bad "engine not healthy: ${h:-none}"; finish ;; esac

section "GET /api/matchday"
o="$(get /api/matchday)"
[ "$(printf '%s' "$o" | jx 'd.fixture.overs.length')" = "6" ] && ok "today's fixture has six overs" || bad "fixture overs: $(printf '%s' "$o" | jx 'd.fixture.overs.length')"
[ "$(printf '%s' "$o" | jx 'String(d.today.seed) === d.today.date.replace(/-/g,"")')" = "true" ] && ok "the seed is the date" || bad "seed and date disagree"
[ "$(printf '%s' "$o" | jx 'd.fixture.overs.some(x => "cardId" in x)')" = "false" ] && ok "the fixture does not reveal which incident comes" || bad "the fixture names its cards"
[ "$(printf '%s' "$o" | jx 'd.canStart.ok')" = "true" ] && ok "canStart" || bad "canStart: $(printf '%s' "$o" | jx 'd.canStart.reason') / deck: $(printf '%s' "$o" | jx 'd.deckErrors')"
a="$(get '/api/matchday?seed=777' | jx 'd.fixture')"; b="$(get '/api/matchday?seed=777' | jx 'd.fixture')"
[ -n "$a" ] && [ "$a" = "$b" ] && ok "seed 777 gives the same fixture twice" || bad "fixture for a seed is not stable"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/matchday?seed=abc")" = "400" ] && ok "a bad seed is 400" || bad "a bad seed was not 400"

section "refused while a traffic run is going"
rcli SET cache:player:d09-probe x >/dev/null
rcli SET census:keep 1 >/dev/null
MM_BEFORE="$(rcli CONFIG GET maxmemory | tail -n 1)"
CENSUS_BEFORE="$(census)"
post /api/load/start '{"scenario":"toss-time-100","durationSec":6}' >/dev/null
c="$(code /api/matchday/start '{"seed":777}')"
[ "$c" = "409" ] && ok "start refused with 409 while a traffic run is going" || bad "start answered $c during a traffic run"
[ "$(get /api/matchday/status | jx 'd.state')" = "idle" ] && ok "a refused start left no match behind" || bad "status after a refusal: $(get /api/matchday/status | jx 'd.state')"
post /api/load/stop '{}' >/dev/null
sleep 6

section "one whole match (seed chosen so that the maxmemory card is among the first overs when the deck has it)"
SEED="$(node -e '
  import("./packages/shared/dist/index.js").then(async (m) => {
    const deck = await m.loadDeck("incidents");
    const info = deck.cards.map(m.cardInfo);
    for (let s = 1; s < 500; s++) {
      const f = m.buildFixture(s, info);
      const i = f.overs.findIndex((o) => o.cardId === "the-box-is-full");
      if (i >= 1 && i <= 2) { console.log(s); return; }
    }
    console.log(20261120);
  });' 2>/dev/null)"
SEED="${SEED:-20261120}"
echo "seed $SEED"
c="$(code /api/matchday/start "{\"seed\":$SEED}")"
[ "$c" = "202" ] && ok "match started (202)" || { bad "start answered $c"; finish; }
LOWERED=0
i=0
while [ $i -lt 120 ]; do
  s="$(get /api/matchday/status | jx 'd.state')"
  [ "$s" = "finished" ] && break
  mm="$(rcli CONFIG GET maxmemory | tail -n 1)"
  [ "$mm" != "$MM_BEFORE" ] && LOWERED=1
  sleep 2; i=$((i + 1))
done
[ "$s" = "finished" ] && ok "the match finished" || { bad "the match did not finish in time"; post /api/matchday/stop '{}' >/dev/null; finish; }
st="$(get /api/matchday/status)"
echo "ended by: $(printf '%s' "$st" | jx 'd.result.endedBy'), score $(printf '%s' "$st" | jx 'd.runs + "/" + d.wickets'), overs bowled $(printf '%s' "$st" | jx 'd.scores.length')"
case "$(printf '%s' "$st" | jx 'd.result.endedBy')" in complete|all_out) ok "ended as complete or all out" ;; *) bad "ended by $(printf '%s' "$st" | jx 'd.result.endedBy'): $(printf '%s' "$st" | jx 'd.result.note')" ;; esac
[ "$(printf '%s' "$st" | jx 'd.scores.length >= 3')" = "true" ] && ok "at least three overs were scored" || bad "too few overs scored"
[ "$(printf '%s' "$st" | jx 'd.result.text.indexOf("your own machine") >= 0')" = "true" ] && ok "the scorecard text says whose machine it is" || bad "scorecard text lacks the machine note"
if [ "$LOWERED" = "1" ]; then ok "maxmemory was seen lowered during the match"; else note "maxmemory was not seen lowered (the card may not have been played, or the policy is not noeviction)"; fi
MM_AFTER="$(rcli CONFIG GET maxmemory | tail -n 1)"
[ "$MM_AFTER" = "$MM_BEFORE" ] && ok "maxmemory is back to $MM_BEFORE" || bad "maxmemory was $MM_BEFORE, is now $MM_AFTER"
CENSUS_AFTER="$(census)"
[ "$CENSUS_AFTER" = "$CENSUS_BEFORE" ] && ok "the census of keys outside cache:* is unchanged" || { bad "census differs"; echo "before: $CENSUS_BEFORE"; echo "after:  $CENSUS_AFTER"; }
if docker compose exec -T engine ls /progress 2>/dev/null | grep -q 'matchday-undo.json'; then bad "the undo journal is still there"; else ok "no undo journal left behind"; fi
if docker compose exec -T engine cat /progress/matchday-results.json 2>/dev/null | grep -q "\"seed\": $SEED"; then ok "matchday-results.json has the match"; else bad "the results file does not have seed $SEED"; fi
[ "$(get /api/matchday | jx 'd.results.best.length >= 1 && d.results.recent.length >= 1')" = "true" ] && ok "GET /api/matchday lists the result" || bad "the result is not listed"
if docker compose exec -T engine cat /progress/progress.json 2>/dev/null | grep -qi 'matchday'; then bad "progress.json mentions matchday (results belong in their own file)"; else ok "progress.json does not hold match results"; fi

section "a match stopped half way"
c="$(code /api/matchday/start '{"seed":777}')"
[ "$c" = "202" ] && ok "second match started" || { bad "second start answered $c"; finish; }
sleep 12
post /api/matchday/stop '{}' >/dev/null
st="$(get /api/matchday/status)"
[ "$(printf '%s' "$st" | jx 'd.result.endedBy')" = "stopped" ] && ok "ended as stopped" || bad "after a stop: $(printf '%s' "$st" | jx 'd.result.endedBy')"
MM_AFTER="$(rcli CONFIG GET maxmemory | tail -n 1)"
[ "$MM_AFTER" = "$MM_BEFORE" ] && ok "maxmemory is still $MM_BEFORE" || bad "maxmemory is now $MM_AFTER"
[ "$(census)" = "$CENSUS_BEFORE" ] && ok "census unchanged after a stop" || bad "census differs after a stop"
[ "$(rcli EXISTS census:keep)" = "1" ] && ok "census:keep survived both matches" || bad "census:keep is gone"
[ "$(code /api/matchday/stop '{}')" = "200" ] && ok "stop with no match is not an error" || bad "stop with no match failed"

section "the page"
[ "$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/matchday")" = "200" ] && ok "GET /matchday answers 200" || bad "GET /matchday did not answer 200"

finish
