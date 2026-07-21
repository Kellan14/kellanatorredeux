-- Read-only historical reference, loaded from MNPhistoryfull.xlsx (one row per
-- game). The data-integrity check uses it to validate pre-archive seasons
-- (2-12), reconciling by the natural key (season, week, home_team, away_team)
-- because legacy match_keys are irregular. Populated once by
-- scripts/import-mnp-reference.py; never written by the app.
--
-- "Uneditable": RLS enabled with a read-only policy and NO write policy — only
-- the service role (used by the one-time upload) can insert.

CREATE TABLE IF NOT EXISTS mnp_reference_games (
  id SERIAL PRIMARY KEY,
  season INTEGER NOT NULL,
  week INTEGER,
  match_str TEXT,           -- raw "match" column, e.g. "S2 WK1 ELL @ SWL"
  match_key TEXT,           -- normalized (may be irregular for legacy)
  game_date TEXT,
  venue TEXT,
  home_team TEXT,
  away_team TEXT,
  round_number INTEGER,
  game_number INTEGER,      -- sequence within the match
  machine TEXT,
  away_points NUMERIC,
  home_points NUMERIC,
  p1_name TEXT, p1_score BIGINT, p1_points NUMERIC,
  p2_name TEXT, p2_score BIGINT, p2_points NUMERIC,
  p3_name TEXT, p3_score BIGINT, p3_points NUMERIC,
  p4_name TEXT, p4_score BIGINT, p4_points NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mnp_reference_natural
  ON mnp_reference_games (season, week, home_team, away_team);
CREATE INDEX IF NOT EXISTS idx_mnp_reference_season ON mnp_reference_games (season);

ALTER TABLE mnp_reference_games ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON mnp_reference_games
  FOR SELECT TO anon, authenticated USING (true);
-- No INSERT/UPDATE/DELETE policy: writes only via the service role.
