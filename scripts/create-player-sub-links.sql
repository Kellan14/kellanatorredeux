-- Sub-player linking.
--
-- Legacy seasons (5-12) recorded some substitute appearances in `games` under a
-- synthetic slug key like "max-gorbman-sub" instead of the person's real hash
-- key, so those games don't count toward the real player. These tables let an
-- admin link each slug-sub identity to a real player. The link is applied by
-- rewriting the affected games rows' player_N_key (the "(sub)" name is kept, so
-- the substitute marker is never lost) and is fully reversible via the stored
-- game_refs.

-- Current state: one row per slug-sub identity.
CREATE TABLE IF NOT EXISTS player_sub_links (
  id SERIAL PRIMARY KEY,
  slug_key TEXT NOT NULL UNIQUE,
  sub_name TEXT NOT NULL,           -- display name incl. "(sub)"
  stripped_name TEXT NOT NULL,      -- normalized name (for search / matching)
  linked_player_key TEXT,           -- real hash key it's linked to (null if not linked)
  linked_player_name TEXT,          -- canonical name of the linked player
  status TEXT NOT NULL DEFAULT 'unlinked', -- unlinked | linked | no_match | ambiguous
  auto BOOLEAN DEFAULT FALSE,       -- was the current link applied automatically
  game_count INTEGER DEFAULT 0,     -- number of (sub) games for this identity
  game_refs JSONB DEFAULT '[]',     -- [{id,pos}] rows changed by the current link (for revert)
  candidates JSONB DEFAULT '[]',    -- [{player_key,player_name}] possible matches (for ambiguous)
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_player_sub_links_status ON player_sub_links (status);
CREATE INDEX IF NOT EXISTS idx_player_sub_links_stripped ON player_sub_links (stripped_name);

-- Append-only history of every link/unlink/relink edit.
CREATE TABLE IF NOT EXISTS player_sub_link_log (
  id SERIAL PRIMARY KEY,
  slug_key TEXT NOT NULL,
  sub_name TEXT,
  action TEXT NOT NULL,             -- auto_link | link | relink | unlink | scan
  from_player_key TEXT,
  from_player_name TEXT,
  to_player_key TEXT,
  to_player_name TEXT,
  games_updated INTEGER DEFAULT 0,
  performed_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_sub_link_log_slug ON player_sub_link_log (slug_key);
CREATE INDEX IF NOT EXISTS idx_player_sub_link_log_created ON player_sub_link_log (created_at DESC);

-- RLS: readable by all API keys, writable by service/anon (routes are admin-gated
-- in application code via requireAdmin).
ALTER TABLE player_sub_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_sub_link_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read" ON player_sub_links FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "Allow service all" ON player_sub_links FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon write" ON player_sub_links FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow read" ON player_sub_link_log FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "Allow service all" ON player_sub_link_log FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon write" ON player_sub_link_log FOR ALL TO anon USING (true) WITH CHECK (true);
