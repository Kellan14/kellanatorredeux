-- Add first_season_with_data column to profiles table
-- Caches the earliest season a player appears in match data
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS first_season_with_data INT;

COMMENT ON COLUMN profiles.first_season_with_data IS 'Cached earliest season this player appears in match lineup data';
