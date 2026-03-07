-- Add team columns to games table if they don't exist
-- Run this in Supabase SQL Editor

-- Add home_team and away_team columns
ALTER TABLE games ADD COLUMN IF NOT EXISTS home_team TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS away_team TEXT;

-- Add player team columns
ALTER TABLE games ADD COLUMN IF NOT EXISTS player_1_team TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS player_2_team TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS player_3_team TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS player_4_team TEXT;

-- Add player is_pick columns
ALTER TABLE games ADD COLUMN IF NOT EXISTS player_1_is_pick BOOLEAN;
ALTER TABLE games ADD COLUMN IF NOT EXISTS player_2_is_pick BOOLEAN;
ALTER TABLE games ADD COLUMN IF NOT EXISTS player_3_is_pick BOOLEAN;
ALTER TABLE games ADD COLUMN IF NOT EXISTS player_4_is_pick BOOLEAN;

-- Add home/away points columns
ALTER TABLE games ADD COLUMN IF NOT EXISTS home_points DECIMAL;
ALTER TABLE games ADD COLUMN IF NOT EXISTS away_points DECIMAL;

-- Create teams table if it doesn't exist
CREATE TABLE IF NOT EXISTS teams (
  team_key TEXT PRIMARY KEY,
  team_name TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create player_stats table if it doesn't exist
CREATE TABLE IF NOT EXISTS player_stats (
  id SERIAL PRIMARY KEY,
  player_name TEXT NOT NULL,
  player_key TEXT,
  season INTEGER NOT NULL,
  team TEXT,
  ipr DECIMAL,
  matches_played INTEGER DEFAULT 0,
  last_match_week INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(player_name, season)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_games_home_team ON games(home_team);
CREATE INDEX IF NOT EXISTS idx_games_away_team ON games(away_team);
CREATE INDEX IF NOT EXISTS idx_games_player_1_team ON games(player_1_team);
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(team_name);
