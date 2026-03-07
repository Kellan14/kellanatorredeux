-- Caches the earliest season each player appears in match lineup data
-- Avoids re-scanning all matches on every IPR history request
CREATE TABLE IF NOT EXISTS player_first_season (
  player_name TEXT PRIMARY KEY,
  first_season INT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
