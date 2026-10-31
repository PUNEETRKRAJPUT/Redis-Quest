-- SLOW BY DESIGN. Do not "fix" this file by adding indexes.
--
-- The legacy database is deliberately missing these indexes, so the Chapter 2 incident is real:
--   fantasy_team_players (player_id)    no index: "selected by %" scans about 2.2 million rows
--   contest_entries (user_id)           no index
--   balls (batter_id), balls (bowler_id) no index
-- (Primary keys and balls(match_id) exist; nothing that helps a per-player lookup.)
--
-- player_stats(p_id) is the exact query behind GET /app/players/:id/stats. The app (P0-07) calls it
-- and nothing else. One row: season batting and bowling aggregates from balls, "selected by % of
-- teams", "points in the last 5 completed matches" and the average points of the teams that picked him
-- (a join into contest_entries, which has no index on fantasy_team_id either) (fantasy points, same formula the seed used:
-- runs + fours + 2*sixes - 2 for a duck, 25 per wicket excluding run outs + 1 per dot ball).
--
-- The planner is told not to parallelise: the target is "slow single-threaded", so the figure does
-- not depend on how many cores Docker Desktop was given. jit is off so the first call is not worse
-- than the fifth. Measured p50 is recorded in postgres/README.md.

CREATE FUNCTION player_stats(p_id text)
RETURNS TABLE (
  player_id text, name text, team_id text, role text,
  matches_played bigint, innings_batted bigint, runs bigint, balls_faced bigint, fours bigint, sixes bigint,
  dismissals bigint, batting_avg numeric, strike_rate numeric,
  balls_bowled bigint, runs_conceded bigint, wickets bigint, economy numeric,
  selected_count bigint, selected_pct numeric, captain_pct numeric,
  last5_selected_pct numeric, last5_points bigint, avg_team_points numeric, last5_avg_team_points numeric
)
LANGUAGE sql STABLE
SET max_parallel_workers_per_gather = 0
SET jit = off
AS $$
  WITH p AS (
    SELECT * FROM players WHERE id = p_id
  ),
  bat AS (
    SELECT match_id, innings,
           sum(runs) AS runs,
           count(*) FILTER (WHERE extra_type IS DISTINCT FROM 'wide') AS faced,
           count(*) FILTER (WHERE runs = 4) AS fours,
           count(*) FILTER (WHERE runs = 6) AS sixes,
           bool_or(wicket) AS out
    FROM balls WHERE batter_id = p_id GROUP BY match_id, innings
  ),
  bowl AS (
    SELECT match_id,
           count(*) FILTER (WHERE extra_type IS NULL OR extra_type IN ('bye', 'legbye')) AS legal,
           sum(runs + CASE WHEN extra_type IN ('wide', 'noball') THEN extras ELSE 0 END) AS conceded,
           count(*) FILTER (WHERE wicket AND wicket_type <> 'run out') AS wkts,
           count(*) FILTER (WHERE runs = 0 AND extra_type IS NULL AND NOT wicket) AS dots
    FROM balls WHERE bowler_id = p_id GROUP BY match_id
  ),
  last5 AS (
    SELECT id FROM matches WHERE status = 'completed' ORDER BY starts_at DESC LIMIT 5
  ),
  pts AS (
    SELECT coalesce(sum(b.r + b.f + 2 * b.s - CASE WHEN b.o AND b.r = 0 THEN 2 ELSE 0 END), 0) AS batting
    FROM (SELECT match_id, sum(runs) AS r, count(*) FILTER (WHERE runs = 4) AS f, count(*) FILTER (WHERE runs = 6) AS s, bool_or(wicket) AS o
          FROM balls WHERE batter_id = p_id AND match_id IN (SELECT id FROM last5) GROUP BY match_id) b
  ),
  bpts AS (
    SELECT coalesce(sum(25 * wkts + dots), 0) AS bowling FROM bowl WHERE match_id IN (SELECT id FROM last5)
  ),
  sel AS (
    SELECT count(*) AS n, count(*) FILTER (WHERE ftp.is_captain) AS caps, avg(ce.points) AS avg_pts
    FROM fantasy_team_players ftp LEFT JOIN contest_entries ce ON ce.fantasy_team_id = ftp.fantasy_team_id
    WHERE ftp.player_id = p_id
  ),
  sel5 AS (
    SELECT count(*) AS n, avg(ce.points) AS avg_pts
    FROM fantasy_team_players ftp
    JOIN fantasy_teams ft ON ft.id = ftp.fantasy_team_id
    LEFT JOIN contest_entries ce ON ce.fantasy_team_id = ft.id
    WHERE ftp.player_id = p_id AND ft.match_id IN (SELECT id FROM last5)
  ),
  tot AS (
    SELECT count(*) AS n FROM fantasy_teams
  ),
  tot5 AS (
    SELECT count(*) AS n FROM fantasy_teams WHERE match_id IN (SELECT id FROM last5)
  )
  SELECT p.id, p.name, p.team_id, p.role,
         (SELECT count(DISTINCT match_id) FROM (SELECT match_id FROM bat UNION ALL SELECT match_id FROM bowl) m),
         (SELECT count(*) FROM bat),
         (SELECT coalesce(sum(runs), 0) FROM bat),
         (SELECT coalesce(sum(faced), 0) FROM bat),
         (SELECT coalesce(sum(fours), 0) FROM bat),
         (SELECT coalesce(sum(sixes), 0) FROM bat),
         (SELECT count(*) FROM bat WHERE out),
         round((SELECT sum(runs) FROM bat)::numeric / nullif((SELECT count(*) FROM bat WHERE out), 0), 2),
         round(100.0 * (SELECT sum(runs) FROM bat) / nullif((SELECT sum(faced) FROM bat), 0), 2),
         (SELECT coalesce(sum(legal), 0) FROM bowl),
         (SELECT coalesce(sum(conceded), 0) FROM bowl),
         (SELECT coalesce(sum(wkts), 0) FROM bowl),
         round(6.0 * (SELECT sum(conceded) FROM bowl) / nullif((SELECT sum(legal) FROM bowl), 0), 2),
         sel.n,
         round(100.0 * sel.n / nullif(tot.n, 0), 1),
         round(100.0 * sel.caps / nullif(tot.n, 0), 1),
         round(100.0 * sel5.n / nullif(tot5.n, 0), 1),
         (SELECT batting FROM pts)::bigint + (SELECT bowling FROM bpts)::bigint,
         round(sel.avg_pts, 1),
         round(sel5.avg_pts, 1)
  FROM p, sel, sel5, tot, tot5
$$;

COMMENT ON FUNCTION player_stats(text) IS 'GET /app/players/:id/stats: season aggregates plus selected-by % and last-5 points. Slow by design.';
