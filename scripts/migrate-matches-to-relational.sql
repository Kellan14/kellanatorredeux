-- ========================================
-- FAST SQL MIGRATION: matches → relational tables
-- ========================================
-- Runs entirely on Supabase server (much faster than JavaScript!)
-- Extracts data from matches.data JSONB into games, teams, player_match_participation, player_stats

BEGIN;

-- Step 1: Clear target tables (keep matches as source)
TRUNCATE TABLE games CASCADE;
TRUNCATE TABLE player_match_participation CASCADE;
TRUNCATE TABLE player_stats CASCADE;
-- Don't truncate teams yet - we'll upsert

-- Step 2: Populate teams table from matches
INSERT INTO teams (team_key, team_name, active)
SELECT DISTINCT
  team_key,
  team_name,
  true as active
FROM (
  -- Home teams
  SELECT
    data->'home'->>'key' as team_key,
    data->'home'->>'name' as team_name
  FROM matches
  WHERE data->'home'->>'key' IS NOT NULL

  UNION

  -- Away teams
  SELECT
    data->'away'->>'key' as team_key,
    data->'away'->>'name' as team_name
  FROM matches
  WHERE data->'away'->>'key' IS NOT NULL
) teams_data
WHERE team_key IS NOT NULL AND team_name IS NOT NULL
ON CONFLICT (team_key) DO UPDATE SET
  team_name = EXCLUDED.team_name,
  updated_at = NOW();

-- Step 3: Populate player_match_participation from lineups
-- Use temp table to fully deduplicate before inserting
CREATE TEMP TABLE temp_participations AS
SELECT
  m.id as match_id,
  m.match_key,
  player_data->>'key' as player_key,
  player_data->>'name' as player_name,
  m.season,
  m.week,
  m.home_team as team,
  COALESCE((player_data->>'IPR')::integer, (player_data->>'ipr')::integer) as ipr_at_match,
  COALESCE((player_data->>'num_played')::integer, 0) as num_played,
  COALESCE((player_data->>'sub')::boolean, false) as is_sub
FROM matches m,
LATERAL jsonb_array_elements(m.data->'home'->'lineup') as player_data
WHERE player_data->>'key' IS NOT NULL
  AND player_data->>'key' != ''
  AND player_data->>'name' IS NOT NULL
  AND player_data->>'name' != ''
  AND player_data->>'name' NOT ILIKE '%no player%'
  AND TRIM(player_data->>'name') != ''

UNION ALL

SELECT
  m.id as match_id,
  m.match_key,
  player_data->>'key' as player_key,
  player_data->>'name' as player_name,
  m.season,
  m.week,
  m.away_team as team,
  COALESCE((player_data->>'IPR')::integer, (player_data->>'ipr')::integer) as ipr_at_match,
  COALESCE((player_data->>'num_played')::integer, 0) as num_played,
  COALESCE((player_data->>'sub')::boolean, false) as is_sub
FROM matches m,
LATERAL jsonb_array_elements(m.data->'away'->'lineup') as player_data
WHERE player_data->>'key' IS NOT NULL
  AND player_data->>'key' != ''
  AND player_data->>'name' IS NOT NULL
  AND player_data->>'name' != ''
  AND player_data->>'name' NOT ILIKE '%no player%'
  AND TRIM(player_data->>'name') != '';

-- Now insert from temp table with full deduplication
INSERT INTO player_match_participation (
  match_id, match_key, player_key, player_name,
  season, week, team, ipr_at_match, num_played, is_sub
)
SELECT DISTINCT ON (match_id, player_key)
  match_id, match_key, player_key, player_name,
  season, week, team, ipr_at_match, num_played, is_sub
FROM temp_participations
ORDER BY match_id, player_key, is_sub ASC; -- Prefer non-subs if duplicates exist

DROP TABLE temp_participations;

-- Step 4: Create a temporary table to map player keys to names (for games table)
CREATE TEMP TABLE player_lookup AS
SELECT DISTINCT player_key, player_name
FROM player_match_participation;

-- Step 5: Populate games table by flattening rounds and games
-- Use JOINs instead of subqueries for performance
INSERT INTO games (
  match_id, match_key, season, week, venue,
  round_number, game_number, machine,
  player_1_key, player_1_name, player_1_score, player_1_points, player_1_team, player_1_is_pick,
  player_2_key, player_2_name, player_2_score, player_2_points, player_2_team, player_2_is_pick,
  player_3_key, player_3_name, player_3_score, player_3_points, player_3_team, player_3_is_pick,
  player_4_key, player_4_name, player_4_score, player_4_points, player_4_team, player_4_is_pick,
  home_team, away_team, home_points, away_points
)
SELECT
  m.id as match_id,
  m.match_key,
  m.season,
  m.week,
  m.data->'venue'->>'name' as venue,
  (round_data->>'n')::integer as round_number,
  (game_data->>'n')::integer as game_number,
  game_data->>'machine' as machine,

  -- Player 1
  game_data->>'player_1' as player_1_key,
  p1.player_name as player_1_name,
  (game_data->>'score_1')::bigint as player_1_score,
  (game_data->>'points_1')::decimal as player_1_points,
  pmp1.team as player_1_team,
  pmp1.team IN (m.home_team, m.away_team) as player_1_is_pick,

  -- Player 2
  game_data->>'player_2' as player_2_key,
  p2.player_name as player_2_name,
  (game_data->>'score_2')::bigint as player_2_score,
  (game_data->>'points_2')::decimal as player_2_points,
  pmp2.team as player_2_team,
  pmp2.team IN (m.home_team, m.away_team) as player_2_is_pick,

  -- Player 3
  game_data->>'player_3' as player_3_key,
  p3.player_name as player_3_name,
  (game_data->>'score_3')::bigint as player_3_score,
  (game_data->>'points_3')::decimal as player_3_points,
  pmp3.team as player_3_team,
  pmp3.team IN (m.home_team, m.away_team) as player_3_is_pick,

  -- Player 4
  game_data->>'player_4' as player_4_key,
  p4.player_name as player_4_name,
  (game_data->>'score_4')::bigint as player_4_score,
  (game_data->>'points_4')::decimal as player_4_points,
  pmp4.team as player_4_team,
  pmp4.team IN (m.home_team, m.away_team) as player_4_is_pick,

  -- Teams and points
  m.home_team,
  m.away_team,
  (game_data->>'home_points')::decimal as home_points,
  (game_data->>'away_points')::decimal as away_points

FROM matches m,
LATERAL jsonb_array_elements(m.data->'rounds') as round_data,
LATERAL jsonb_array_elements(round_data->'games') as game_data
LEFT JOIN player_lookup p1 ON p1.player_key = game_data->>'player_1'
LEFT JOIN player_lookup p2 ON p2.player_key = game_data->>'player_2'
LEFT JOIN player_lookup p3 ON p3.player_key = game_data->>'player_3'
LEFT JOIN player_lookup p4 ON p4.player_key = game_data->>'player_4'
LEFT JOIN player_match_participation pmp1 ON pmp1.match_id = m.id AND pmp1.player_key = game_data->>'player_1'
LEFT JOIN player_match_participation pmp2 ON pmp2.match_id = m.id AND pmp2.player_key = game_data->>'player_2'
LEFT JOIN player_match_participation pmp3 ON pmp3.match_id = m.id AND pmp3.player_key = game_data->>'player_3'
LEFT JOIN player_match_participation pmp4 ON pmp4.match_id = m.id AND pmp4.player_key = game_data->>'player_4'
WHERE game_data->>'machine' IS NOT NULL;

-- Step 6: Calculate and populate player_stats
-- FIXED: Aggregate at player-season level BEFORE inserting to avoid duplicate key violations
WITH player_season_games AS (
  -- Get all games for each player-season combination
  SELECT
    pmp.player_key,
    pmp.player_name,
    pmp.season,
    pmp.match_key,
    pmp.week,
    pmp.team,
    pmp.is_sub,
    COALESCE(
      SUM(
        CASE
          WHEN g.player_1_key = pmp.player_key THEN g.player_1_points
          WHEN g.player_2_key = pmp.player_key THEN g.player_2_points
          WHEN g.player_3_key = pmp.player_key THEN g.player_3_points
          WHEN g.player_4_key = pmp.player_key THEN g.player_4_points
          ELSE 0
        END
      ), 0
    ) as match_points
  FROM player_match_participation pmp
  LEFT JOIN games g ON g.match_key = pmp.match_key
    AND (g.player_1_key = pmp.player_key
      OR g.player_2_key = pmp.player_key
      OR g.player_3_key = pmp.player_key
      OR g.player_4_key = pmp.player_key)
  GROUP BY pmp.player_key, pmp.player_name, pmp.season, pmp.match_key, pmp.week, pmp.team, pmp.is_sub
),
player_season_aggregated AS (
  -- Aggregate to player-season level, keeping the most recent team
  SELECT
    player_key,
    player_name,
    season,
    -- Get the team from the most recent week they played
    FIRST_VALUE(team) OVER (
      PARTITION BY player_name, season
      ORDER BY week DESC
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) as team,
    COUNT(DISTINCT match_key) FILTER (WHERE NOT is_sub) as matches_played,
    SUM(match_points) as total_points,
    MAX(week) as last_match_week
  FROM player_season_games
  GROUP BY player_key, player_name, season
)
INSERT INTO player_stats (
  player_key, player_name, season, team,
  ipr, matches_played, last_match_week
)
SELECT DISTINCT ON (player_name, season)
  player_key,
  player_name,
  season,
  team,
  CASE
    WHEN matches_played > 0
    THEN ROUND((total_points / matches_played)::numeric, 2)
    ELSE 0
  END as ipr,
  matches_played,
  last_match_week
FROM player_season_aggregated
ORDER BY player_name, season, last_match_week DESC;

-- Step 7: Report results
DO $$
DECLARE
  games_count INTEGER;
  teams_count INTEGER;
  participation_count INTEGER;
  stats_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO games_count FROM games;
  SELECT COUNT(*) INTO teams_count FROM teams;
  SELECT COUNT(*) INTO participation_count FROM player_match_participation;
  SELECT COUNT(*) INTO stats_count FROM player_stats;

  RAISE NOTICE '✅ Migration Complete!';
  RAISE NOTICE '   Games created: %', games_count;
  RAISE NOTICE '   Teams tracked: %', teams_count;
  RAISE NOTICE '   Player participations: %', participation_count;
  RAISE NOTICE '   Player stats calculated: %', stats_count;
END $$;

COMMIT;
