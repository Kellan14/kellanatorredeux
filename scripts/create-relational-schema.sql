-- Migration: Flatten JSONB match data into relational tables for performance
-- Date: November 15, 2025
-- Purpose: Enable SQL queries/indexes instead of JavaScript JSONB parsing

-- Games table: One row per game (flattened from matches.data.rounds[].games[])
CREATE TABLE IF NOT EXISTS games (
  id BIGSERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,

  -- Match context (denormalized for query performance)
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  venue TEXT,
  match_key TEXT NOT NULL,

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

-- Player match participation table (flattened from matches.data.home/away.lineup[])
CREATE TABLE IF NOT EXISTS player_match_participation (
  id BIGSERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,

  -- Player info
  player_key TEXT NOT NULL,
  player_name TEXT NOT NULL,

  -- Match context
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  team TEXT NOT NULL,
  match_key TEXT NOT NULL,

  -- Player stats at time of match
  ipr_at_match INTEGER,
  num_played INTEGER DEFAULT 0,
  is_sub BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP DEFAULT NOW(),

  -- Unique constraint: one row per player per match
  UNIQUE(match_id, player_key)
);

-- Indexes for player participation queries
CREATE INDEX IF NOT EXISTS idx_pmp_player_key ON player_match_participation(player_key);
CREATE INDEX IF NOT EXISTS idx_pmp_season ON player_match_participation(season);
CREATE INDEX IF NOT EXISTS idx_pmp_team ON player_match_participation(team);
CREATE INDEX IF NOT EXISTS idx_pmp_player_season ON player_match_participation(player_key, season);
CREATE INDEX IF NOT EXISTS idx_pmp_player_team ON player_match_participation(player_key, team);

-- Helper view: All games for a player (joins all 4 player positions)
CREATE OR REPLACE VIEW player_games AS
SELECT
  g.id as game_id,
  g.match_id,
  g.season,
  g.week,
  g.venue,
  g.round_number,
  g.game_number,
  g.machine,
  CASE
    WHEN g.player_1_key = p.player_key THEN 1
    WHEN g.player_2_key = p.player_key THEN 2
    WHEN g.player_3_key = p.player_key THEN 3
    WHEN g.player_4_key = p.player_key THEN 4
  END as player_position,
  p.player_key,
  p.player_name,
  CASE
    WHEN g.player_1_key = p.player_key THEN g.player_1_score
    WHEN g.player_2_key = p.player_key THEN g.player_2_score
    WHEN g.player_3_key = p.player_key THEN g.player_3_score
    WHEN g.player_4_key = p.player_key THEN g.player_4_score
  END as score,
  CASE
    WHEN g.player_1_key = p.player_key THEN g.player_1_points
    WHEN g.player_2_key = p.player_key THEN g.player_2_points
    WHEN g.player_3_key = p.player_key THEN g.player_3_points
    WHEN g.player_4_key = p.player_key THEN g.player_4_points
  END as points
FROM games g
CROSS JOIN LATERAL (
  SELECT player_1_key as player_key, player_1_name as player_name FROM games WHERE id = g.id AND player_1_key IS NOT NULL
  UNION ALL
  SELECT player_2_key, player_2_name FROM games WHERE id = g.id AND player_2_key IS NOT NULL
  UNION ALL
  SELECT player_3_key, player_3_name FROM games WHERE id = g.id AND player_3_key IS NOT NULL
  UNION ALL
  SELECT player_4_key, player_4_name FROM games WHERE id = g.id AND player_4_key IS NOT NULL
) p
WHERE (
  g.player_1_key = p.player_key OR
  g.player_2_key = p.player_key OR
  g.player_3_key = p.player_key OR
  g.player_4_key = p.player_key
);

-- Comments for documentation
COMMENT ON TABLE games IS 'Individual pinball games - flattened from matches.data.rounds[].games[]';
COMMENT ON TABLE player_match_participation IS 'Player lineup data - flattened from matches.data.home/away.lineup[]';
COMMENT ON VIEW player_games IS 'Helper view that returns all games for all players with their scores/points';
