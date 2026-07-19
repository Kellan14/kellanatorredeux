-- Data-integrity report history.
--
-- Each run of /api/integrity-check re-applies our recorded edits (name mappings,
-- key merges, sub-links — "auto-heal") and reconciles the DB against the GitHub
-- mnp-data-archive, then records the outcome here. Read by the Options badge and
-- the integrity dialog.

CREATE TABLE IF NOT EXISTS integrity_reports (
  id SERIAL PRIMARY KEY,
  ran_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  scope TEXT NOT NULL,                 -- current | full | manual
  healed_names INTEGER DEFAULT 0,
  healed_keys INTEGER DEFAULT 0,
  healed_sublinks INTEGER DEFAULT 0,
  missing_total INTEGER DEFAULT 0,     -- matches in archive but not the DB
  orphan_total INTEGER DEFAULT 0,      -- matches in DB but not the archive
  duplicate_total INTEGER DEFAULT 0,   -- duplicate games
  ok BOOLEAN DEFAULT TRUE,
  seasons JSONB DEFAULT '[]',          -- per-season coverage summary
  missing JSONB DEFAULT '[]',
  orphan JSONB DEFAULT '[]',
  duplicates JSONB DEFAULT '[]',
  triggered_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_integrity_reports_ran_at ON integrity_reports (ran_at DESC);

ALTER TABLE integrity_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated read" ON integrity_reports FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow service role all" ON integrity_reports FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon read" ON integrity_reports FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon write" ON integrity_reports FOR ALL TO anon USING (true) WITH CHECK (true);
