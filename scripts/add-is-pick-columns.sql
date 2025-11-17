-- Add missing player_x_is_pick columns to games table
-- These columns indicate if a player is playing for their own team (pick) vs being a substitute

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS player_1_is_pick BOOLEAN,
  ADD COLUMN IF NOT EXISTS player_2_is_pick BOOLEAN,
  ADD COLUMN IF NOT EXISTS player_3_is_pick BOOLEAN,
  ADD COLUMN IF NOT EXISTS player_4_is_pick BOOLEAN;

-- Add indexes for filtering by picks (optional but useful for performance)
CREATE INDEX IF NOT EXISTS idx_games_home_team ON games(home_team) WHERE home_team IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_away_team ON games(away_team) WHERE away_team IS NOT NULL;

-- Note: You can also add partial indexes for picks if you frequently filter by them:
-- CREATE INDEX IF NOT EXISTS idx_games_player_1_is_pick ON games(player_1_is_pick) WHERE player_1_is_pick = true;
-- CREATE INDEX IF NOT EXISTS idx_games_player_2_is_pick ON games(player_2_is_pick) WHERE player_2_is_pick = true;
-- CREATE INDEX IF NOT EXISTS idx_games_player_3_is_pick ON games(player_3_is_pick) WHERE player_3_is_pick = true;
-- CREATE INDEX IF NOT EXISTS idx_games_player_4_is_pick ON games(player_4_is_pick) WHERE player_4_is_pick = true;
