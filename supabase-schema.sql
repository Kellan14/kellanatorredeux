-- Supabase schema for MNP data
-- Run this in Supabase SQL Editor

-- Table to store all match data
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

-- Table to store player stats (denormalized for fast queries)
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

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_matches_season_week ON matches(season, week);
CREATE INDEX IF NOT EXISTS idx_matches_match_key ON matches(match_key);
CREATE INDEX IF NOT EXISTS idx_player_stats_name ON player_stats(player_name);
CREATE INDEX IF NOT EXISTS idx_player_stats_season ON player_stats(season);
CREATE INDEX IF NOT EXISTS idx_matches_teams ON matches(home_team, away_team);

-- Enable RLS (Row Level Security)
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_stats ENABLE ROW LEVEL SECURITY;

-- Create policies to allow public read access
CREATE POLICY "Allow public read access on matches" ON matches
  FOR SELECT USING (true);

CREATE POLICY "Allow public read access on player_stats" ON player_stats
  FOR SELECT USING (true);

-- Create policies to allow service role write access
CREATE POLICY "Allow service role write on matches" ON matches
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow service role write on player_stats" ON player_stats
  FOR ALL USING (auth.role() = 'service_role');
