#!/usr/bin/env bash
# P0-04 check: throwaway postgres:16 (arm64) loads postgres/init, then verifies seed sizes, hot players,
# the slow query, outbox triggers and generator determinism. Never touches the compose project.
# bash 3.2 compatible; psql runs inside the container (none on the host).
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
C="quest-p0-04-check-$$"
TMP="$(mktemp -d)"
FAILS=0
ok()   { echo "ok   $1"; }
bad()  { echo "FAIL $1"; FAILS=$((FAILS + 1)); }
cleanup() { docker rm -f "$C" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || { echo "FAIL docker not found"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "FAIL node not found"; exit 1; }
if ! docker info >/dev/null 2>&1; then
  echo "docker not answering, starting Docker Desktop"
  open -a Docker >/dev/null 2>&1 || true
  i=0; until docker info >/dev/null 2>&1; do i=$((i + 1)); [ $i -gt 60 ] && { echo "FAIL docker did not come up in 2 minutes"; exit 1; }; sleep 2; done
fi
for f in 001-schema.sql 002-seed.sql.gz 003-outbox.sql 004-slow-by-design.sql; do
  [ -f "$ROOT/postgres/init/$f" ] || { echo "FAIL postgres/init/$f missing"; exit 1; }
done
[ -f "$ROOT/postgres/init/002-seed.sql" ] && { echo "FAIL raw postgres/init/002-seed.sql present; only the .gz is committed"; exit 1; }
ok "init files present (seed $(du -m "$ROOT/postgres/init/002-seed.sql.gz" | cut -f1) MB gzipped)"

q() { docker exec "$C" psql -U quest -d quest -v ON_ERROR_STOP=1 -At -c "$1"; }
# expect_range "label" actual target  (within 5% of target)
within5() {
  local label="$1" actual="$2" target="$3"
  if awk -v a="$actual" -v t="$target" 'BEGIN { d = a - t; if (d < 0) d = -d; exit !(d <= t * 0.05) }'; then
    ok "$label = $actual (target $target, within 5%)"
  else
    bad "$label = $actual, target $target +/- 5%"
  fi
}

# --- start throwaway container on a random free host port (Docker picks it)
START=$(date +%s)
docker run -d --name "$C" --platform linux/arm64 \
  -e POSTGRES_USER=quest -e POSTGRES_PASSWORD=quest -e POSTGRES_DB=quest \
  -p 127.0.0.1::5432 -v "$ROOT/postgres/init:/docker-entrypoint-initdb.d:ro" postgres:16 >/dev/null \
  || { echo "FAIL could not start postgres:16"; exit 1; }
PORT=$(docker port "$C" 5432/tcp | head -n1 | sed 's/.*://')
# The init-time server listens on the unix socket only; a TCP answer means init finished and the real server is up.
i=0
until docker exec "$C" pg_isready -h 127.0.0.1 -U quest -d quest >/dev/null 2>&1; do
  i=$((i + 1)); [ $i -gt 240 ] && { echo "FAIL postgres not ready after 120 s"; docker logs "$C" 2>&1 | tail -20; exit 1; }
  sleep 0.5
done
LOAD=$(( $(date +%s) - START ))
# "FATAL: the database system is starting up" is the readiness probe hitting the init-time restart; benign.
if docker logs "$C" 2>&1 | grep -E "ERROR|FATAL" | grep -qv "is starting up"; then bad "errors in init log"; docker logs "$C" 2>&1 | grep -E "ERROR|FATAL" | grep -v "is starting up" | head -5; else ok "no errors in init log"; fi
echo "container $C on 127.0.0.1:$PORT"
echo "seed load time (container start to ready, schema + seed + outbox + vacuum analyze) = ${LOAD} s"
[ "$LOAD" -lt 60 ] && ok "load under 60 s" || bad "load took ${LOAD} s, limit 60"

# --- row counts
echo "row counts:"
for t in teams players colleges hostels users matches balls fantasy_teams fantasy_team_players contests contest_entries wallet_transactions wallets outbox; do
  echo "     $t = $(q "SELECT count(*) FROM $t")"
done
[ "$(q 'SELECT count(*) FROM teams')" = 8 ] && ok "8 teams" || bad "teams != 8"
[ "$(q 'SELECT count(*) FROM players')" = 200 ] && ok "200 players" || bad "players != 200"
[ "$(q 'SELECT count(*) FROM colleges')" = 12 ] && ok "12 colleges" || bad "colleges != 12"
[ "$(q 'SELECT count(*) FROM hostels')" = 48 ] && ok "48 hostels" || bad "hostels != 48"
within5 "users" "$(q 'SELECT count(*) FROM users')" 20000
[ "$(q 'SELECT count(*) FROM wallets')" = "$(q 'SELECT count(*) FROM users')" ] && ok "every user has a wallet" || bad "wallets != users"
[ "$(q 'SELECT count(*) FROM matches')" = 60 ] && ok "60 matches" || bad "matches != 60"
[ "$(q "SELECT count(*) FROM matches WHERE status='completed'")" = 40 ] && ok "40 completed" || bad "completed != 40"
[ "$(q "SELECT count(*) FROM matches WHERE status='live'")" = 2 ] && ok "2 live" || bad "live != 2"
within5 "balls in completed matches (40 x 240)" "$(q "SELECT count(*) FROM balls b JOIN matches m ON m.id=b.match_id WHERE m.status='completed'")" 9600
within5 "fantasy_teams" "$(q 'SELECT count(*) FROM fantasy_teams')" 200000
within5 "fantasy_team_players" "$(q 'SELECT count(*) FROM fantasy_team_players')" 2200000
within5 "contest_entries" "$(q 'SELECT count(*) FROM contest_entries')" 200000
within5 "wallet_transactions" "$(q 'SELECT count(*) FROM wallet_transactions')" 100000
[ "$(q 'SELECT count(*) FROM outbox')" = 0 ] && ok "outbox empty after seed" || bad "outbox not empty after seed"
[ "$(q "SELECT count(*) FROM wallets w WHERE w.balance <> (SELECT coalesce(sum(delta),0) FROM wallet_transactions t WHERE t.user_id = w.user_id) OR w.balance < 0 LIMIT 1")" = 0 ] \
  && ok "wallet balances equal ledger sums and none negative" || bad "wallet balances inconsistent"
[ "$(q 'SELECT count(*) FROM (SELECT fantasy_team_id FROM fantasy_team_players GROUP BY 1 HAVING count(*) <> 11 OR count(*) FILTER (WHERE is_captain) <> 1 OR count(*) FILTER (WHERE is_vice) <> 1) x')" = 0 ] \
  && ok "every fantasy team has 11 players, one captain, one vice" || bad "fantasy team shape wrong"

# --- hot players
TOTAL_TEAMS=$(q 'SELECT count(*) FROM fantasy_teams')
for p in p-028 p-101 p-151; do
  PCT=$(q "SELECT round(100.0 * count(*) / $TOTAL_TEAMS, 1) FROM fantasy_team_players WHERE player_id = '$p'")
  if awk -v v="$PCT" 'BEGIN { exit !(v >= 60 && v <= 80) }'; then ok "hot player $p selected by ${PCT}% of teams (60 to 80)"; else bad "hot player $p selected by ${PCT}%, expected 60 to 80"; fi
done
[ "$(q "SELECT string_agg(id, ',' ORDER BY id) FROM players WHERE fame > 95")" = "p-028,p-101,p-151" ] && ok "fame > 95 are exactly p-028, p-101, p-151" || bad "fame > 95 set differs"

# --- slow query: five timed runs of player_stats for a hot player
printf '\\timing on\n' > "$TMP/t.sql"
i=0; while [ $i -lt 5 ]; do echo "SELECT * FROM player_stats('p-028');" >> "$TMP/t.sql"; i=$((i + 1)); done
docker exec -i "$C" psql -U quest -d quest -At < "$TMP/t.sql" > "$TMP/t.out" 2>&1
TIMES=$(grep '^Time:' "$TMP/t.out" | sed 's/^Time: *//; s/ ms.*//')
N=$(echo "$TIMES" | grep -c .)
[ "$N" = 5 ] || bad "expected 5 timings, got $N"
echo "player_stats('p-028') timings (ms): $(echo $TIMES)"
P50=$(echo "$TIMES" | sort -n | sed -n '3p')
[ "$(grep -c '^p-028|' "$TMP/t.out")" = 5 ] && ok "player_stats returns one row per call" || bad "player_stats rows wrong"
if awk -v v="$P50" 'BEGIN { exit !(v > 150) }'; then ok "player_stats p50 = ${P50} ms (> 150 ms, slow by design)"; else bad "player_stats p50 = ${P50} ms, must be over 150"; fi
[ "$(q "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND ((tablename='fantasy_team_players' AND indexdef ~ '\\(player_id') OR (tablename='contest_entries' AND indexdef ~ '\\(user_id') OR (tablename='balls' AND indexdef ~ '\\((batter_id|bowler_id)'))")" = 0 ] \
  && ok "no index on fantasy_team_players.player_id, contest_entries.user_id, balls.batter_id/bowler_id" || bad "a deliberately missing index exists"

# --- outbox triggers
q "UPDATE players SET age = age + 1 WHERE id = 'p-028'" >/dev/null
[ "$(q "SELECT count(*) FROM outbox")" = 1 ] && ok "one outbox row after updating a player" || bad "outbox row count != 1 after update"
[ "$(q "SELECT op || '|' || aggregate || '|' || aggregate_id || '|' || (payload->>'id') || '|' || (payload->>'age') FROM outbox")" = "update|players|p-028|p-028|32" ] \
  && ok "outbox row: op=update, aggregate=players, payload id p-028, new age in payload" || bad "outbox update row wrong: $(q 'SELECT op, aggregate, payload->>$$id$$ FROM outbox')"
q "UPDATE teams SET city = city WHERE id = 't-01'" >/dev/null
q "UPDATE matches SET status = status WHERE id = 'm-001'" >/dev/null
q "INSERT INTO contests (match_id, name, scope, entry_points, max_entries) VALUES ('m-050', 'check', 'open', 0, 1)" >/dev/null
q "DELETE FROM contests WHERE name = 'check'" >/dev/null
[ "$(q "SELECT string_agg(aggregate || ':' || op, ',' ORDER BY id) FROM outbox")" = "players:update,teams:update,matches:update,contests:insert,contests:delete" ] \
  && ok "triggers fire on teams, matches, contests insert and delete" || bad "outbox sequence wrong: $(q "SELECT string_agg(aggregate || ':' || op, ',' ORDER BY id) FROM outbox")"
[ "$(q "SELECT count(*) FROM pg_indexes WHERE tablename='outbox' AND indexdef ~ 'WHERE \\(published_at IS NULL\\)'")" = 1 ] && ok "partial index on outbox(published_at) WHERE published_at IS NULL" || bad "outbox partial index missing"

# --- determinism: regenerate and diff against the committed seed
node "$ROOT/postgres/seed/generate.mjs" --out "$TMP/seed.sql.gz" 2>/dev/null
if cmp -s "$TMP/seed.sql.gz" "$ROOT/postgres/init/002-seed.sql.gz"; then ok "generator output byte-identical to committed 002-seed.sql.gz"; else bad "generator output differs from committed 002-seed.sql.gz"; fi

docker rm -f "$C" >/dev/null 2>&1 && ok "throwaway container removed"
echo
if [ "$FAILS" = 0 ]; then echo "P0-04 PASSED"; exit 0; else echo "P0-04 FAILED ($FAILS)"; exit 1; fi
