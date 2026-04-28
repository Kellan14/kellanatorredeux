-- Cache of pre-computed Top Picks rows for the dashboard.
-- One row per (opponent_team_key, venue, season_start, season_end) snapshot.
-- Refreshed weekly by /api/cron/refresh-top-picks (Tue 13:00 UTC), and read
-- by /api/top-picks. The dashboard falls back to a live /api/machine-stats
-- call if the cache misses, so this table is purely a perf optimization.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS cache_top_picks (
  id SERIAL PRIMARY KEY,
  opponent_team_key TEXT NOT NULL,
  opponent_team_name TEXT NOT NULL,
  venue TEXT NOT NULL,
  season_start INT NOT NULL,
  season_end INT NOT NULL,
  -- Snapshot of the opponent roster used at compute time, so the dashboard
  -- can detect a roster drift and force a live refresh if needed.
  roster_players TEXT[] DEFAULT '{}',
  -- Array of objects: { machine, timesPicked, teamAverage, percentOfVenueAvg, pops, venueAverage, ... }
  picks JSONB NOT NULL,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (opponent_team_key, venue, season_start, season_end)
);

CREATE INDEX IF NOT EXISTS idx_ctp_lookup
  ON cache_top_picks (opponent_team_key, venue, season_start, season_end);

-- Public read; writes are server-side only via the service-role key.
ALTER TABLE cache_top_picks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read cache_top_picks" ON cache_top_picks;
CREATE POLICY "Public read cache_top_picks" ON cache_top_picks FOR SELECT USING (true);
