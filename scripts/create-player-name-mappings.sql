-- Create player_name_mappings table for storing alias → canonical name mappings
-- These are applied automatically after each data import

CREATE TABLE IF NOT EXISTS player_name_mappings (
  id SERIAL PRIMARY KEY,
  alias TEXT NOT NULL UNIQUE,
  canonical_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookup by alias
CREATE INDEX IF NOT EXISTS idx_player_name_mappings_alias ON player_name_mappings (alias);

-- Enable RLS but allow service role full access
ALTER TABLE player_name_mappings ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read mappings
CREATE POLICY "Allow authenticated read" ON player_name_mappings
  FOR SELECT TO authenticated USING (true);

-- Allow service role full access (for import script)
CREATE POLICY "Allow service role all" ON player_name_mappings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow anon read access (for API routes using anon key)
CREATE POLICY "Allow anon read" ON player_name_mappings
  FOR SELECT TO anon USING (true);

-- Allow anon insert/update/delete (for API routes)
CREATE POLICY "Allow anon write" ON player_name_mappings
  FOR ALL TO anon USING (true) WITH CHECK (true);
