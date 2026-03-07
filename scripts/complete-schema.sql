-- Complete MNP Database Schema
-- Consolidated from all migration files
-- Date: November 22, 2025
--
-- This schema is the single source of truth for the database structure.
-- Run this in Supabase SQL Editor to create/update the schema.

-- ============================================================================
-- MATCHES TABLE - Original JSONB storage (backup/reference)
-- ============================================================================
CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  match_key TEXT UNIQUE NOT NULL,
  season INT NOT NULL,
  week INT NOT NULL,
  home_team TEXT,
  away_team TEXT,
  venue_name TEXT,
  state TEXT,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matches_season_week ON matches(season, week);
CREATE INDEX IF NOT EXISTS idx_matches_match_key ON matches(match_key);
CREATE INDEX IF NOT EXISTS idx_matches_teams ON matches(home_team, away_team);

-- ============================================================================
-- TEAMS TABLE - Team reference lookup
-- ============================================================================
CREATE TABLE IF NOT EXISTS teams (
  team_key TEXT PRIMARY KEY,
  team_name TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(team_name);

-- ============================================================================
-- GAMES TABLE - Flattened individual games (PRIMARY DATA SOURCE)
-- ============================================================================
CREATE TABLE IF NOT EXISTS games (
  id BIGSERIAL PRIMARY KEY,

  -- Match context (denormalized for query performance)
  -- NOTE: match_id is optional - unified-import.js doesn't set it
  match_id INTEGER REFERENCES matches(id) ON DELETE CASCADE,
  match_key TEXT NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  venue TEXT,

  -- Game identification
  round_number INTEGER NOT NULL,
  game_number INTEGER NOT NULL,
  machine TEXT NOT NULL,

  -- Player 1
  player_1_key TEXT,
  player_1_name TEXT,
  player_1_score BIGINT,
  player_1_points DECIMAL,
  player_1_team TEXT,
  player_1_is_pick BOOLEAN,

  -- Player 2
  player_2_key TEXT,
  player_2_name TEXT,
  player_2_score BIGINT,
  player_2_points DECIMAL,
  player_2_team TEXT,
  player_2_is_pick BOOLEAN,

  -- Player 3 (optional - 2-player games won't have this)
  player_3_key TEXT,
  player_3_name TEXT,
  player_3_score BIGINT,
  player_3_points DECIMAL,
  player_3_team TEXT,
  player_3_is_pick BOOLEAN,

  -- Player 4 (optional - 2-player games won't have this)
  player_4_key TEXT,
  player_4_name TEXT,
  player_4_score BIGINT,
  player_4_points DECIMAL,
  player_4_team TEXT,
  player_4_is_pick BOOLEAN,

  -- Match teams
  home_team TEXT,
  away_team TEXT,

  -- Team scoring
  away_points DECIMAL,
  home_points DECIMAL,

  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_games_match_id ON games(match_id);
CREATE INDEX IF NOT EXISTS idx_games_match_key ON games(match_key);
CREATE INDEX IF NOT EXISTS idx_games_season ON games(season);
CREATE INDEX IF NOT EXISTS idx_games_season_week ON games(season, week);
CREATE INDEX IF NOT EXISTS idx_games_machine ON games(machine);
CREATE INDEX IF NOT EXISTS idx_games_venue ON games(venue);

-- Player key indexes (most important for performance)
CREATE INDEX IF NOT EXISTS idx_games_player_1_key ON games(player_1_key) WHERE player_1_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_player_2_key ON games(player_2_key) WHERE player_2_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_player_3_key ON games(player_3_key) WHERE player_3_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_player_4_key ON games(player_4_key) WHERE player_4_key IS NOT NULL;

-- Team indexes for filtering by team
CREATE INDEX IF NOT EXISTS idx_games_home_team ON games(home_team) WHERE home_team IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_away_team ON games(away_team) WHERE away_team IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_player_1_team ON games(player_1_team) WHERE player_1_team IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_player_2_team ON games(player_2_team) WHERE player_2_team IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_player_3_team ON games(player_3_team) WHERE player_3_team IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_player_4_team ON games(player_4_team) WHERE player_4_team IS NOT NULL;

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_games_season_machine ON games(season, machine);
CREATE INDEX IF NOT EXISTS idx_games_season_venue ON games(season, venue);

-- ============================================================================
-- PLAYER_MATCH_PARTICIPATION TABLE - Player lineups per match
-- ============================================================================
CREATE TABLE IF NOT EXISTS player_match_participation (
  id BIGSERIAL PRIMARY KEY,

  -- Match reference (match_id is optional - unified-import.js doesn't set it)
  match_id INTEGER REFERENCES matches(id) ON DELETE CASCADE,
  match_key TEXT NOT NULL,

  -- Player info
  player_key TEXT NOT NULL,
  player_name TEXT NOT NULL,

  -- Match context
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  team TEXT NOT NULL,

  -- Player stats at time of match
  ipr_at_match DECIMAL,
  num_played INTEGER DEFAULT 0,
  is_sub BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP DEFAULT NOW(),

  -- Unique constraint: one row per player per match (using match_key, not match_id)
  UNIQUE(match_key, player_key)
);

-- Indexes for player participation queries
CREATE INDEX IF NOT EXISTS idx_pmp_match_key ON player_match_participation(match_key);
CREATE INDEX IF NOT EXISTS idx_pmp_player_key ON player_match_participation(player_key);
CREATE INDEX IF NOT EXISTS idx_pmp_season ON player_match_participation(season);
CREATE INDEX IF NOT EXISTS idx_pmp_team ON player_match_participation(team);
CREATE INDEX IF NOT EXISTS idx_pmp_player_season ON player_match_participation(player_key, season);
CREATE INDEX IF NOT EXISTS idx_pmp_player_team ON player_match_participation(player_key, team);

-- ============================================================================
-- PLAYER_STATS TABLE - Pre-calculated aggregate statistics (cache)
-- ============================================================================
CREATE TABLE IF NOT EXISTS player_stats (
  id SERIAL PRIMARY KEY,
  player_name TEXT NOT NULL,
  player_key TEXT,
  season INT NOT NULL,
  team TEXT,
  ipr DECIMAL,
  matches_played INT DEFAULT 0,
  last_match_week INT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(player_name, season)
);

CREATE INDEX IF NOT EXISTS idx_player_stats_name ON player_stats(player_name);
CREATE INDEX IF NOT EXISTS idx_player_stats_season ON player_stats(season);
CREATE INDEX IF NOT EXISTS idx_player_stats_key ON player_stats(player_key);

-- ============================================================================
-- USER_MACHINE_SCORES TABLE - Manually added scores by users
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_machine_scores (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  machine TEXT NOT NULL,
  score BIGINT NOT NULL,
  venue TEXT,
  played_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ums_user_id ON user_machine_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_ums_player_name ON user_machine_scores(player_name);
CREATE INDEX IF NOT EXISTS idx_ums_machine ON user_machine_scores(machine);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_match_participation ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_machine_scores ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Allow public read access on matches" ON matches FOR SELECT USING (true);
CREATE POLICY "Allow public read access on teams" ON teams FOR SELECT USING (true);
CREATE POLICY "Allow public read access on games" ON games FOR SELECT USING (true);
CREATE POLICY "Allow public read access on player_match_participation" ON player_match_participation FOR SELECT USING (true);
CREATE POLICY "Allow public read access on player_stats" ON player_stats FOR SELECT USING (true);

-- User machine scores - users can read all, but only write their own
CREATE POLICY "Allow public read access on user_machine_scores" ON user_machine_scores FOR SELECT USING (true);
CREATE POLICY "Allow users to insert their own scores" ON user_machine_scores FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Allow users to update their own scores" ON user_machine_scores FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Allow users to delete their own scores" ON user_machine_scores FOR DELETE USING (auth.uid() = user_id);

-- Service role write access for import scripts
CREATE POLICY "Allow service role write on matches" ON matches FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role write on teams" ON teams FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role write on games" ON games FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role write on player_match_participation" ON player_match_participation FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role write on player_stats" ON player_stats FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE matches IS 'Original match data as JSONB - backup/reference only';
COMMENT ON TABLE teams IS 'Team reference table - team_key to team_name mapping';
COMMENT ON TABLE games IS 'Individual pinball games - flattened from matches.data.rounds[].games[] - PRIMARY DATA SOURCE';
COMMENT ON TABLE player_match_participation IS 'Player lineup data - flattened from matches.data.home/away.lineup[]';
COMMENT ON TABLE player_stats IS 'Pre-calculated player statistics per season - cache for fast lookups';
COMMENT ON TABLE user_machine_scores IS 'Manually added scores by authenticated users';
