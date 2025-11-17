-- Add player_name column to profiles table for TWC player association
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS player_name TEXT;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS profiles_player_name_idx ON profiles(player_name);

-- Add comment to explain the column
COMMENT ON COLUMN profiles.player_name IS 'The player name as it appears in TWC game data (player_stats table)';
