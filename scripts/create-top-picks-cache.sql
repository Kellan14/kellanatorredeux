-- Run once in the Supabase SQL Editor before enabling the all-time pick cache.
-- One row represents one picked game, including all players on the picking team.
-- The nightly data sync and manual refresh rebuild it from the canonical games table.
CREATE TABLE IF NOT EXISTS cache_team_pick_games (
  generation UUID NOT NULL,
  game_id BIGINT NOT NULL,
  team_key TEXT NOT NULL,
  season INT NOT NULL,
  machine TEXT NOT NULL,
  player_names TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (generation, game_id)
);

CREATE INDEX IF NOT EXISTS idx_ctpg_team_season_machine
  ON cache_team_pick_games (generation, team_key, season, machine);

-- A single row points readers at the most recently completed rebuild.
CREATE TABLE IF NOT EXISTS cache_team_pick_builds (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  active_generation UUID,
  refreshed_at TIMESTAMPTZ
);

ALTER TABLE cache_team_pick_games ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read cache_team_pick_games" ON cache_team_pick_games;
CREATE POLICY "Public read cache_team_pick_games"
  ON cache_team_pick_games FOR SELECT USING (true);

ALTER TABLE cache_team_pick_builds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read cache_team_pick_builds" ON cache_team_pick_builds;
CREATE POLICY "Public read cache_team_pick_builds"
  ON cache_team_pick_builds FOR SELECT USING (true);
