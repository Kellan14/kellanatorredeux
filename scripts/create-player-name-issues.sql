-- Cache table for the Player Name standardization scanner.
-- The scan (case/space/(sub)/split-key name inconsistencies) is expensive, so
-- results are stored here and read cheaply by the Options dialog and the nav
-- badge. Rebuilt on demand (?refresh=true) and weekly by the Monday cron.
-- Mirrors the missing_machine_images cache pattern.

CREATE TABLE IF NOT EXISTS player_name_issues (
  id SERIAL PRIMARY KEY,
  -- Normalized identity the variants collapse to (sub-stripped, lowercased, trimmed)
  normalized_name TEXT NOT NULL,
  -- The distinct raw spellings that make up this issue
  variants TEXT[] NOT NULL,
  -- Best canonical spelling to standardize to
  suggested_canonical TEXT NOT NULL,
  -- 'case' | 'sub' | 'split_key'
  issue_type TEXT NOT NULL,
  -- Shared player_key when all variants belong to one key (null for split_key groups)
  player_key TEXT,
  scanned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_name_issues_type ON player_name_issues (issue_type);

-- Enable RLS but allow service role + anon/authenticated read (same model as
-- player_name_mappings, since API routes use the anon/service keys).
ALTER TABLE player_name_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read" ON player_name_issues
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow service role all" ON player_name_issues
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon read" ON player_name_issues
  FOR SELECT TO anon USING (true);

CREATE POLICY "Allow anon write" ON player_name_issues
  FOR ALL TO anon USING (true) WITH CHECK (true);
