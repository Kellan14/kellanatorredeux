-- Quick check: Do we have data in matches table?
SELECT
  COUNT(*) as total_matches,
  MIN(season) as earliest_season,
  MAX(season) as latest_season,
  COUNT(DISTINCT season) as seasons_count,
  MAX(week) as latest_week
FROM matches;

-- Sample of what's in matches table
SELECT season, week, home_team, away_team, state
FROM matches
ORDER BY season DESC, week DESC
LIMIT 10;
