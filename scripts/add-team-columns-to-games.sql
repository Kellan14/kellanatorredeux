-- Add team columns to games table for faster queries
-- This eliminates the need to join with player_match_participation

ALTER TABLE games ADD COLUMN IF NOT EXISTS player_1_team TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS player_2_team TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS player_3_team TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS player_4_team TEXT;

-- Add home/away team columns for is_pick calculation
ALTER TABLE games ADD COLUMN IF NOT EXISTS home_team TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS away_team TEXT;

-- Create indexes on team columns for faster filtering
CREATE INDEX IF NOT EXISTS idx_games_player_1_team ON games(player_1_team) WHERE player_1_team IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_player_2_team ON games(player_2_team) WHERE player_2_team IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_player_3_team ON games(player_3_team) WHERE player_3_team IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_player_4_team ON games(player_4_team) WHERE player_4_team IS NOT NULL;

-- Populate the team columns from existing data
UPDATE games g
SET
  player_1_team = pmp.team
FROM player_match_participation pmp
WHERE g.player_1_key = pmp.player_key
  AND g.season = pmp.season
  AND g.week = pmp.week
  AND g.player_1_team IS NULL;

UPDATE games g
SET
  player_2_team = pmp.team
FROM player_match_participation pmp
WHERE g.player_2_key = pmp.player_key
  AND g.season = pmp.season
  AND g.week = pmp.week
  AND g.player_2_team IS NULL;

UPDATE games g
SET
  player_3_team = pmp.team
FROM player_match_participation pmp
WHERE g.player_3_key = pmp.player_key
  AND g.season = pmp.season
  AND g.week = pmp.week
  AND g.player_3_team IS NULL;

UPDATE games g
SET
  player_4_team = pmp.team
FROM player_match_participation pmp
WHERE g.player_4_key = pmp.player_key
  AND g.season = pmp.season
  AND g.week = pmp.week
  AND g.player_4_team IS NULL;

-- Populate home/away team from matches
UPDATE games g
SET
  home_team = m.home_team,
  away_team = m.away_team
FROM matches m
WHERE g.match_id = m.id
  AND g.home_team IS NULL;
