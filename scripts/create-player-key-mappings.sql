-- Player KEY merges.
--
-- A single person is sometimes assigned more than one player_key across seasons
-- (the "split_key" issue surfaced by the standardization scanner). This table
-- records from_key -> to_key merges. Applying a merge rewrites player_N_key in
-- games and player_key in participation/player_stats, unifying the identity.
-- Mirrors player_name_mappings (non-destructive record; applied on the nightly
-- sync and via the "Apply now" path). Editable/removable in the Options dialog.

CREATE TABLE IF NOT EXISTS player_key_mappings (
  id SERIAL PRIMARY KEY,
  from_key TEXT NOT NULL UNIQUE,   -- the key being merged away
  to_key TEXT NOT NULL,            -- the canonical key it merges into
  display_name TEXT,               -- human label (the shared player name)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_key_mappings_from ON player_key_mappings (from_key);

ALTER TABLE player_key_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read" ON player_key_mappings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow service role all" ON player_key_mappings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon read" ON player_key_mappings
  FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon write" ON player_key_mappings
  FOR ALL TO anon USING (true) WITH CHECK (true);
