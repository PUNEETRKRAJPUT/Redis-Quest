#!/usr/bin/env bash
# Watch the rate limiter from the outside: scripts/hit.sh [count] [userId]
# Sends `count` (default 30) requests one after another to GET /app/limits/ping as `userId` (default
# u-000010), prints one line per request with the status and the instance that answered, then a summary.
# Reads PROXY_PORT from .env if present, else 3000 (a PROXY_PORT in the environment wins).
# Exit 0 whatever the counts; exit 2 when the proxy does not answer.
set -u
cd "$(dirname "$0")/.." || exit 1

COUNT=${1:-30}
USER_ID=${2:-u-000010}
case "$COUNT" in ''|*[!0-9]*) echo "usage: scripts/hit.sh [count] [userId]" >&2; exit 1;; esac

PORT=${PROXY_PORT:-}
if [ -z "$PORT" ] && [ -f .env ]; then
  PORT=$(sed -n 's/^PROXY_PORT=//p' .env | tail -1 | tr -d ' \r')
fi
PORT=${PORT:-3000}
URL="http://127.0.0.1:${PORT}/app/limits/ping"

HDRS=$(mktemp "${TMPDIR:-/tmp}/hit.XXXXXX") || exit 1
SEEN=$(mktemp "${TMPDIR:-/tmp}/hit.XXXXXX") || exit 1
trap 'rm -f "$HDRS" "$SEEN"' EXIT

allowed=0; denied=0; other=0
i=1
while [ "$i" -le "$COUNT" ]; do
  code=$(curl -s -m 10 -o /dev/null -D "$HDRS" -w '%{http_code}' -H "x-user-id: $USER_ID" "$URL")
  if [ "$code" = "000" ]; then
    echo "no answer from $URL (is the game running? try ./scripts/start)" >&2
    exit 2
  fi
  inst=$(tr -d '\r' < "$HDRS" | grep -i '^x-quest-instance:' | head -1 | sed 's/^[^:]*: *//')
  printf '%s\n' "${inst:--}" >> "$SEEN"
  printf '#%s %s instance=%s\n' "$i" "$code" "$(printf '%s' "${inst:--}" | cut -c1-4)"
  case "$code" in
    200) allowed=$((allowed + 1));;
    429) denied=$((denied + 1));;
    *) other=$((other + 1));;
  esac
  i=$((i + 1))
done
instances=$(sort -u "$SEEN" | grep -c . || true)
echo "allowed=$allowed denied=$denied other=$other instances=${instances:-0}"
exit 0
