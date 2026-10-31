-- Nukkad Cricket League fantasy app: the legacy database. Source of truth for the story.
-- Runs once, on first start of an empty data directory (docker-entrypoint-initdb.d).
-- Files run in name order: 001 schema, 002 seed (generated), 003 outbox triggers, 004 the slow query.

CREATE TABLE teams (
  id text PRIMARY KEY,
  name text NOT NULL,
  city text NOT NULL,
  code text NOT NULL UNIQUE,
  primary_colour text NOT NULL,
  secondary_colour text NOT NULL,
  home_ground text NOT NULL,
  personality text NOT NULL
);
COMMENT ON TABLE teams IS 'The eight NCL franchises, ids t-01..t-08 (from fiction/teams.json).';

CREATE TABLE players (
  id text PRIMARY KEY,
  name text NOT NULL,
  team_id text NOT NULL REFERENCES teams (id),
  role text NOT NULL CHECK (role IN ('batter', 'bowler', 'all-rounder', 'keeper')),
  batting_hand text NOT NULL CHECK (batting_hand IN ('left', 'right')),
  bowling_style text,
  age integer NOT NULL,
  bat_avg numeric(6, 2) NOT NULL,
  strike_rate numeric(6, 2) NOT NULL,
  bowl_econ numeric(5, 2),
  bowl_avg numeric(6, 2),
  nickname text,
  fame integer NOT NULL CHECK (fame BETWEEN 1 AND 100)
);
COMMENT ON TABLE players IS 'The 200 league cricketers, p-001..p-200; fame above 95 marks the three hot-key stars.';

CREATE TABLE colleges (
  id text PRIMARY KEY,
  name text NOT NULL,
  short text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  founded integer NOT NULL,
  mascot text NOT NULL,
  story_role text CHECK (story_role IN ('home', 'rival'))
);
COMMENT ON TABLE colleges IS 'The twelve engineering colleges whose students play the fantasy app; c-02 is home, c-06 the rival.';

CREATE TABLE hostels (
  id text PRIMARY KEY,
  college_id text NOT NULL REFERENCES colleges (id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('boys', 'girls')),
  capacity integer NOT NULL
);
COMMENT ON TABLE hostels IS 'Four hostels per college; hostel leaderboards are a Chapter 3 level.';

CREATE TABLE users (
  id text PRIMARY KEY,
  handle text NOT NULL UNIQUE,
  display_name text NOT NULL,
  college_id text NOT NULL REFERENCES colleges (id),
  hostel_id text NOT NULL REFERENCES hostels (id),
  created_at timestamptz NOT NULL
);
COMMENT ON TABLE users IS 'Twenty thousand students, u-000001 onwards; the people hammering the stats page at the toss.';

CREATE TABLE matches (
  id text PRIMARY KEY,
  season integer NOT NULL,
  home_team_id text NOT NULL REFERENCES teams (id),
  away_team_id text NOT NULL REFERENCES teams (id),
  venue text NOT NULL,
  starts_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('scheduled', 'live', 'completed'))
);
COMMENT ON TABLE matches IS 'The 2026 season: 56 league games plus 4 playoff games; 40 completed, 2 live, the rest scheduled.';

CREATE TABLE balls (
  id bigserial PRIMARY KEY,
  match_id text NOT NULL REFERENCES matches (id),
  innings integer NOT NULL CHECK (innings IN (1, 2)),
  "over" integer NOT NULL,
  ball integer NOT NULL,
  batter_id text NOT NULL REFERENCES players (id),
  bowler_id text NOT NULL REFERENCES players (id),
  runs integer NOT NULL,
  extras integer NOT NULL DEFAULT 0,
  extra_type text CHECK (extra_type IN ('wide', 'noball', 'bye', 'legbye')),
  wicket boolean NOT NULL DEFAULT false,
  wicket_type text,
  happened_at timestamptz NOT NULL
);
COMMENT ON TABLE balls IS 'Ball-by-ball record of every delivery (wides and no balls are rows too); over is 0-19, ball 1-6.';
CREATE INDEX balls_match_idx ON balls (match_id); -- the one index balls gets; batter_id and bowler_id stay bare on purpose

CREATE TABLE fantasy_teams (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id),
  match_id text NOT NULL REFERENCES matches (id),
  created_at timestamptz NOT NULL
);
COMMENT ON TABLE fantasy_teams IS 'One eleven a user picked for one match; about ten per user across the completed games.';

CREATE TABLE fantasy_team_players (
  fantasy_team_id bigint NOT NULL REFERENCES fantasy_teams (id),
  player_id text NOT NULL REFERENCES players (id),
  is_captain boolean NOT NULL DEFAULT false,
  is_vice boolean NOT NULL DEFAULT false,
  PRIMARY KEY (fantasy_team_id, player_id)
);
COMMENT ON TABLE fantasy_team_players IS 'The eleven picks inside each fantasy team (about 2.2 million rows); no index on player_id, by design.';

CREATE TABLE contests (
  id bigserial PRIMARY KEY,
  match_id text NOT NULL REFERENCES matches (id),
  name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('hostel', 'college', 'open')),
  scope_id text,
  entry_points integer NOT NULL DEFAULT 0,
  max_entries integer NOT NULL
);
COMMENT ON TABLE contests IS 'A leaderboard to compete on for a match: one open, twelve college and 48 hostel contests per match.';

CREATE TABLE contest_entries (
  id bigserial PRIMARY KEY,
  contest_id bigint NOT NULL REFERENCES contests (id),
  user_id text NOT NULL REFERENCES users (id),
  fantasy_team_id bigint NOT NULL REFERENCES fantasy_teams (id),
  points numeric(8, 1) NOT NULL DEFAULT 0
);
COMMENT ON TABLE contest_entries IS 'A fantasy team entered into a contest, with the points it scored; no index on user_id, by design.';

CREATE TABLE wallet_transactions (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id),
  delta integer NOT NULL,
  reason text NOT NULL,
  ref text,
  created_at timestamptz NOT NULL
);
COMMENT ON TABLE wallet_transactions IS 'Ledger of every credit and debit of a user''s contest points; wallets.balance is the sum of it.';

CREATE TABLE wallets (
  user_id text PRIMARY KEY REFERENCES users (id),
  balance integer NOT NULL
);
COMMENT ON TABLE wallets IS 'Current balance per user; Chapter 3 moves money here and must never let it go negative.';
