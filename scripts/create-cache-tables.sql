-- Cache tables for pre-computed statistics
-- Run once in Supabase SQL Editor to create tables
-- Data is populated by the cron import (sync-data) after each weekly sync

-- 1. Team-level machine stats (per team, per machine, venue-specific + all-venues)
CREATE TABLE IF NOT EXISTS cache_team_machine_stats (
  id SERIAL PRIMARY KEY,
  team_key TEXT NOT NULL,
  machine TEXT NOT NULL,
  venue TEXT,                          -- NULL = all-venues rollup
  season_start INT NOT NULL,
  season_end INT NOT NULL,
  total_score BIGINT DEFAULT 0,
  game_count INT DEFAULT 0,
  avg_score DECIMAL,
  pick_count INT DEFAULT 0,
  pick_total_points DECIMAL DEFAULT 0,
  resp_count INT DEFAULT 0,
  resp_total_points DECIMAL DEFAULT 0,
  total_points DECIMAL DEFAULT 0,
  possible_points DECIMAL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(team_key, machine, venue, season_start, season_end)
);

CREATE INDEX IF NOT EXISTS idx_ctms_team_machine ON cache_team_machine_stats(team_key, machine);
CREATE INDEX IF NOT EXISTS idx_ctms_venue ON cache_team_machine_stats(venue);
CREATE INDEX IF NOT EXISTS idx_ctms_season ON cache_team_machine_stats(season_start, season_end);

-- Enable RLS with public read
ALTER TABLE cache_team_machine_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read cache_team_machine_stats" ON cache_team_machine_stats;
CREATE POLICY "Public read cache_team_machine_stats" ON cache_team_machine_stats FOR SELECT USING (true);

-- 2. Player-level machine stats (per player, per machine, venue-specific + all-venues)
CREATE TABLE IF NOT EXISTS cache_player_machine_stats (
  id SERIAL PRIMARY KEY,
  player_name TEXT NOT NULL,
  player_key TEXT,
  team_key TEXT,
  machine TEXT NOT NULL,
  venue TEXT,                          -- NULL = all-venues rollup
  season_start INT NOT NULL,
  season_end INT NOT NULL,
  total_score BIGINT DEFAULT 0,
  game_count INT DEFAULT 0,
  avg_score DECIMAL,
  total_points DECIMAL DEFAULT 0,
  possible_points DECIMAL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(player_name, machine, venue, season_start, season_end)
);

CREATE INDEX IF NOT EXISTS idx_cpms_player ON cache_player_machine_stats(player_name);
CREATE INDEX IF NOT EXISTS idx_cpms_machine ON cache_player_machine_stats(machine);
CREATE INDEX IF NOT EXISTS idx_cpms_team ON cache_player_machine_stats(team_key);
CREATE INDEX IF NOT EXISTS idx_cpms_venue ON cache_player_machine_stats(venue);

ALTER TABLE cache_player_machine_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read cache_player_machine_stats" ON cache_player_machine_stats;
CREATE POLICY "Public read cache_player_machine_stats" ON cache_player_machine_stats FOR SELECT USING (true);

-- 3. Top 10 scores per machine per context
CREATE TABLE IF NOT EXISTS cache_machine_top_scores (
  id SERIAL PRIMARY KEY,
  machine TEXT NOT NULL,
  venue TEXT,                          -- NULL = league-wide
  season INT,                          -- NULL = all-time
  rank INT NOT NULL,
  player_name TEXT NOT NULL,
  player_key TEXT,
  team_key TEXT,
  score BIGINT NOT NULL,
  match_key TEXT,
  week INT,
  round_number INT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(machine, venue, season, rank)
);

CREATE INDEX IF NOT EXISTS idx_cmts_machine ON cache_machine_top_scores(machine);
CREATE INDEX IF NOT EXISTS idx_cmts_player ON cache_machine_top_scores(player_name);
CREATE INDEX IF NOT EXISTS idx_cmts_venue_season ON cache_machine_top_scores(venue, season);

ALTER TABLE cache_machine_top_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read cache_machine_top_scores" ON cache_machine_top_scores;
CREATE POLICY "Public read cache_machine_top_scores" ON cache_machine_top_scores FOR SELECT USING (true);

-- 4. Pre-built dashboard payload for TWC's current matchup
CREATE TABLE IF NOT EXISTS cache_dashboard (
  id SERIAL PRIMARY KEY,
  match_key TEXT UNIQUE NOT NULL,
  season INT NOT NULL,
  week INT NOT NULL,
  venue TEXT NOT NULL,
  opponent TEXT NOT NULL,
  opponent_team_key TEXT,
  machine_advantages JSONB,
  least_unique_players JSONB,
  player_achievements JSONB,
  computed_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cd_match ON cache_dashboard(match_key);
CREATE INDEX IF NOT EXISTS idx_cd_season_week ON cache_dashboard(season, week);

ALTER TABLE cache_dashboard ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read cache_dashboard" ON cache_dashboard;
CREATE POLICY "Public read cache_dashboard" ON cache_dashboard FOR SELECT USING (true);

-- 5. Distinct canonical player names (drives every player picker)
CREATE TABLE IF NOT EXISTS cache_players (
  player_name TEXT PRIMARY KEY,
  player_key TEXT,
  first_season INT,
  last_season INT,
  game_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cache_players_lower_name ON cache_players (lower(player_name));
CREATE INDEX IF NOT EXISTS idx_cache_players_last_season ON cache_players (last_season);

ALTER TABLE cache_players ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read cache_players" ON cache_players;
CREATE POLICY "Public read cache_players" ON cache_players FOR SELECT USING (true);

-- Rebuild helper: one server-side statement instead of paging every game row.
-- Called by the sync-data cron and scripts/rebuild-caches.ts via supabase.rpc().
CREATE OR REPLACE FUNCTION rebuild_cache_players()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted INTEGER;
BEGIN
  DELETE FROM cache_players;

  INSERT INTO cache_players (player_name, player_key, first_season, last_season, game_count, updated_at)
  WITH slots AS (
    SELECT btrim(regexp_replace(n.name, '\s*\(sub\)\s*$', '', 'i')) AS player_name,
           n.key AS player_key,
           g.season
    FROM games g
    CROSS JOIN LATERAL (VALUES
      (g.player_1_name, g.player_1_key),
      (g.player_2_name, g.player_2_key),
      (g.player_3_name, g.player_3_key),
      (g.player_4_name, g.player_4_key)
    ) AS n(name, key)
    WHERE g.season >= 2
      AND n.name IS NOT NULL
      AND btrim(regexp_replace(n.name, '\s*\(sub\)\s*$', '', 'i')) <> ''
  )
  SELECT player_name,
         (array_remove(array_agg(player_key ORDER BY season DESC), NULL))[1],
         min(season),
         max(season),
         count(*)::INT,
         NOW()
  FROM slots
  GROUP BY player_name;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

REVOKE ALL ON FUNCTION rebuild_cache_players() FROM PUBLIC, anon, authenticated;
