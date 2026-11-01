#!/usr/bin/env bash
# The drill for level 3.11 (Pub/Sub forgets): scripts/ticker-drill.sh
# Publishes balls 1 to 4 on score:match:m-041 straight to Redis (it does not need your code), and while ball 1 is
# in, makes the app's subscriber drop off the channel for two seconds, so balls 2 and 3 go out while nobody on that
# copy is listening. Then it prints what each app copy received and the ticker_gap events the game recorded.
# Needs the game running (./scripts/start). Reads PROXY_PORT from the environment, then .env, else 3000.
# Exit 0 when it ran, 2 when the app does not answer.
set -u
cd "$(dirname "$0")/.." || exit 1

MATCH=m-041
CHANNEL="score:match:${MATCH}"
PORT=${PROXY_PORT:-}
if [ -z "$PORT" ] && [ -f .env ]; then
  PORT=$(sed -n 's/^PROXY_PORT=//p' .env | tail -1 | tr -d ' \r')
fi
PORT=${PORT:-3000}
BASE="http://127.0.0.1:${PORT}"

# field <json> <name>: the value of a flat "name":value pair, without quotes.
field() { printf '%s' "$1" | sed -n "s/.*\"$2\":\([^,}]*\).*/\1/p" | tr -d '"'; }

publish() {
  n=$1
  msg="{\"seq\":${n},\"over\":1,\"ball\":${n},\"runs\":1,\"batter\":\"p-028\",\"matchId\":\"${MATCH}\"}"
  got=$(docker compose exec -T redis redis-cli PUBLISH "$CHANNEL" "$msg" | tr -d '\r')
  echo "  PUBLISH seq ${n} -> ${got:-?} receiver(s)"
}

code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "${BASE}/app/ticker/${MATCH}")
if [ "$code" != "200" ]; then
  echo "the app did not answer GET /app/ticker/${MATCH} (HTTP ${code}); is the game running? try ./scripts/start" >&2
  exit 2
fi

echo "ticker drill on ${CHANNEL}"
echo "-- ball 1: everyone is listening"
publish 1

echo "-- the subscriber on one app copy unsubscribes for 2 seconds (POST /app/ticker/resubscribe)"
curl -s -m 20 -o /dev/null -X POST "${BASE}/app/ticker/resubscribe" \
  -H 'content-type: application/json' \
  -d "{\"matchId\":\"${MATCH}\",\"pauseMs\":2000}" &
RESUB=$!
sleep 0.5
echo "-- balls 2 and 3 are published during the pause"
publish 2
publish 3
wait "$RESUB"

echo "-- the subscriber is back; ball 4"
publish 4
sleep 1

echo
echo "what each app copy saw (GET /app/ticker/${MATCH}, asked six times so both copies answer):"
i=0
: > "${TMPDIR:-/tmp}/ticker-drill.$$"
while [ "$i" -lt 6 ]; do
  body=$(curl -s -m 5 "${BASE}/app/ticker/${MATCH}")
  printf 'instance=%s received=%s lastSeq=%s gaps=%s\n' \
    "$(field "$body" instance | cut -c1-4)" "$(field "$body" received)" \
    "$(field "$body" lastSeq)" "$(field "$body" gaps)" >> "${TMPDIR:-/tmp}/ticker-drill.$$"
  i=$((i + 1))
done
sort -u "${TMPDIR:-/tmp}/ticker-drill.$$" | sed 's/^/  /'
rm -f "${TMPDIR:-/tmp}/ticker-drill.$$"

echo
echo "ticker_gap events the game recorded (GET /api/events):"
events=$(curl -s -m 5 "${BASE}/api/events")
gaps=$(printf '%s' "$events" | grep -o '"name":"ticker_gap","data":{[^}]*}' | tail -3)
if [ -z "$gaps" ]; then
  echo "  none yet: wait a second and run: curl -s ${BASE}/api/events"
else
  printf '%s\n' "$gaps" | sed 's/^/  /'
fi
exit 0
