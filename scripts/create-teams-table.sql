-- Create a teams reference table for efficient lookups
-- This is better than repeating team names in every game row

CREATE TABLE IF NOT EXISTS teams (
  team_key TEXT PRIMARY KEY,
  team_name TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index on team_name for reverse lookups
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(team_name);

-- Populate teams table from matches data
INSERT INTO teams (team_key, team_name)
SELECT DISTINCT
  (data->>'home')::jsonb->>'key' as team_key,
  (data->>'home')::jsonb->>'name' as team_name
FROM matches
WHERE (data->>'home')::jsonb->>'key' IS NOT NULL
ON CONFLICT (team_key) DO NOTHING;

INSERT INTO teams (team_key, team_name)
SELECT DISTINCT
  (data->>'away')::jsonb->>'key' as team_key,
  (data->>'away')::jsonb->>'name' as team_name
FROM matches
WHERE (data->>'away')::jsonb->>'key' IS NOT NULL
ON CONFLICT (team_key) DO NOTHING;
