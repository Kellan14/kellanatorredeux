-- ============================================================================
-- Full first-class reconstruction of MNP seasons 2-12  (EXECUTED 2026-07-21)
-- batch_id: legacy-2to12-reconstruction-2026-07-21   (see table data_provenance)
-- ============================================================================
-- Problem state (before): seasons 2-12 lived as GAMES ONLY (~27,532 rows, 0
-- participation, 0 player_stats). Those games were a LOSSY import: every doubles
-- round stored only 2 of 4 players (player_3/4 NULL), is_pick was uniformly
-- INVERTED, 30 matches were duplicated (2-3x their games), and 31 matches present
-- in the reference were missing entirely.
--
-- Source of truth: the read-only mnp_reference_games table (loaded from
-- MNPhistoryfull.xlsx) — complete 4-player data, picking-lead player listed first.
-- It is PRESERVED, so any rebuilt row can be reconciled to the original.
--
-- Strategy: rebuild each legacy match's games wholesale from the reference. This
-- is lossless (0 DB-only matches — reference is a per-match superset) AND
-- corrective (restores doubles partners, fixes is_pick, de-dups the 30, folds in
-- the 31). Then derive participation + player_stats from the rebuilt games.
--
-- Round format (uniform across 2-12): R1/R4 doubles, R2/R3 singles, R5 doubles
-- tiebreaker. Picking team: away in R1/R3, home in R2/R4. is_pick = (slot team ==
-- picking team); R5 tiebreakers have NO pick data -> is_pick = NULL. The reference
-- lists the picking (lead) player first, so p1/p3 = pick, p2/p4 = response (R1-4).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Provenance infrastructure (durable audit trail — created via migration
--    create_data_provenance). Records every edit with EXACTLY how + why.
-- ---------------------------------------------------------------------------
-- CREATE TABLE data_provenance (id, batch_id, applied_at, category, entity,
--   season_range, description, transformation_rule, reason, source,
--   rows_affected, details jsonb);   -- see supabase migration

-- ---------------------------------------------------------------------------
-- 1. Helper tables (built from CURRENT games, i.e. BEFORE the rebuild)
-- ---------------------------------------------------------------------------
-- _bf_team_key : team_name -> team_key. Authoritative per-match code from the
--   reference match_str (franchise-stable across renames, e.g. DTP spans
--   Down to Pinball / Pinuminati / Stranger Slings), unioned with the teams table.
DROP TABLE IF EXISTS _bf_team_key;
CREATE TABLE _bf_team_key AS
WITH parsed AS (
  SELECT trim(home_team) AS team_name, upper(trim(split_part(match_str,'@',2))) AS code FROM mnp_reference_games WHERE match_str LIKE '%@%'
  UNION ALL
  SELECT trim(away_team), upper(trim((regexp_split_to_array(trim(split_part(match_str,'@',1)),'\s+'))[2])) FROM mnp_reference_games WHERE match_str LIKE '%@%'
),
ranked AS (
  SELECT team_name, code, row_number() OVER (PARTITION BY team_name ORDER BY count(*) DESC, code) rn
  FROM parsed WHERE code ~ '^[A-Z]{2,4}$' GROUP BY team_name, code
)
SELECT team_name, code AS team_key FROM ranked WHERE rn=1
UNION
SELECT team_name, team_key FROM teams t WHERE NOT EXISTS (SELECT 1 FROM ranked r WHERE r.team_name=t.team_name AND r.rn=1);

-- _bf_name_key : normalized-name -> resolved player_key (40-hex hash preferred,
--   else existing slug). Built from ALL current games so it captures every legacy
--   identity BEFORE the games are deleted.
DROP TABLE IF EXISTS _bf_name_key;
CREATE TABLE _bf_name_key AS
WITH identraw AS (
  SELECT lower(trim(regexp_replace(regexp_replace(player_1_name,'\s*\(sub\)\s*$','','i'),'\s+',' ','g'))) n, player_1_key k FROM games WHERE player_1_key IS NOT NULL
  UNION ALL SELECT lower(trim(regexp_replace(regexp_replace(player_2_name,'\s*\(sub\)\s*$','','i'),'\s+',' ','g'))), player_2_key FROM games WHERE player_2_key IS NOT NULL
  UNION ALL SELECT lower(trim(regexp_replace(regexp_replace(player_3_name,'\s*\(sub\)\s*$','','i'),'\s+',' ','g'))), player_3_key FROM games WHERE player_3_key IS NOT NULL
  UNION ALL SELECT lower(trim(regexp_replace(regexp_replace(player_4_name,'\s*\(sub\)\s*$','','i'),'\s+',' ','g'))), player_4_key FROM games WHERE player_4_key IS NOT NULL
)
SELECT n, coalesce(max(k) FILTER (WHERE k ~ '^[0-9a-f]{40}$'), min(k)) AS player_key FROM identraw GROUP BY n;

-- _bf_merges : slug player_key -> real hash key (same normalized name carries both;
--   the 29 split identities, incl. typo slugs lucas-arais / travis-echart and
--   Peter Schatzer's two slugs). Scope-confirmed legacy-only (seasons 2-12).
DROP TABLE IF EXISTS _bf_merges;
CREATE TABLE _bf_merges AS
WITH identraw AS (
  SELECT lower(trim(regexp_replace(regexp_replace(player_1_name,'\s*\(sub\)\s*$','','i'),'\s+',' ','g'))) n, player_1_key k FROM games WHERE player_1_key IS NOT NULL
  UNION ALL SELECT lower(trim(regexp_replace(regexp_replace(player_2_name,'\s*\(sub\)\s*$','','i'),'\s+',' ','g'))), player_2_key FROM games WHERE player_2_key IS NOT NULL
  UNION ALL SELECT lower(trim(regexp_replace(regexp_replace(player_3_name,'\s*\(sub\)\s*$','','i'),'\s+',' ','g'))), player_3_key FROM games WHERE player_3_key IS NOT NULL
  UNION ALL SELECT lower(trim(regexp_replace(regexp_replace(player_4_name,'\s*\(sub\)\s*$','','i'),'\s+',' ','g'))), player_4_key FROM games WHERE player_4_key IS NOT NULL
),
per_norm AS (
  SELECT n, max(k) FILTER (WHERE k ~ '^[0-9a-f]{40}$') hash_key, array_agg(DISTINCT k) FILTER (WHERE k !~ '^[0-9a-f]{40}$') slug_keys FROM identraw GROUP BY n
)
SELECT n AS norm, unnest(slug_keys) AS from_key, hash_key AS to_key FROM per_norm WHERE hash_key IS NOT NULL AND slug_keys IS NOT NULL;

-- _bf_missing : the 31 reference matches absent from the DB (all seasons 7-12).
DROP TABLE IF EXISTS _bf_missing;
CREATE TABLE _bf_missing AS
WITH db AS (SELECT DISTINCT season, coalesce(week,-1) wk, trim(home_team) h, trim(away_team) a FROM matches WHERE season BETWEEN 2 AND 12),
ref AS (SELECT DISTINCT season, coalesce(week,-1) wk, trim(home_team) h, trim(away_team) a FROM mnp_reference_games WHERE season BETWEEN 2 AND 12)
SELECT r.season, r.wk AS week, r.h AS home_team, r.a AS away_team FROM ref r LEFT JOIN db d USING (season,wk,h,a) WHERE d.season IS NULL;

-- name -> key resolver (hash-preferred, 2 spelling-variant remaps, else mint slug)
CREATE OR REPLACE FUNCTION _bf_resolve(nm text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH x AS (SELECT lower(trim(regexp_replace(regexp_replace(nm,'\s*\(sub\)\s*$','','i'),'\s+',' ','g'))) n)
  SELECT coalesce(
    (SELECT player_key FROM _bf_name_key k, x WHERE k.n = CASE x.n WHEN 'elliott johnson' THEN 'elliot johnson' WHEN 'tim kitchen' THEN 'timothy kitchen' ELSE x.n END),
    regexp_replace((SELECT n FROM x),'[^a-z0-9]+','-','g'));
$$;

-- ---------------------------------------------------------------------------
-- 2. Insert the 31 missing matches (season-qualified keys avoid the reused-key
--    collision, e.g. wc-ibl-pbr spans s7/s8/s11). Then map every reference match
--    (2-12) to its matches.id.
-- ---------------------------------------------------------------------------
WITH mk AS (
  SELECT m.season, m.week, m.home_team, m.away_team,
         's'||m.season||'-'||min(gr.match_key) AS match_key, max(gr.venue) AS venue
  FROM _bf_missing m
  JOIN mnp_reference_games gr ON gr.season=m.season AND coalesce(gr.week,-1)=coalesce(m.week,-1)
    AND trim(gr.home_team)=m.home_team AND trim(gr.away_team)=m.away_team
  GROUP BY m.season, m.week, m.home_team, m.away_team
)
INSERT INTO matches (match_key, season, week, home_team, away_team, venue_name, state, data)
SELECT match_key, season, week, home_team, away_team, venue, NULL,
  jsonb_build_object('home', jsonb_build_object('team',home_team,'lineup','[]'::jsonb,'rounds','[]'::jsonb),
                     'away', jsonb_build_object('team',away_team,'lineup','[]'::jsonb,'rounds','[]'::jsonb))
FROM mk ON CONFLICT (match_key) DO NOTHING;

DROP TABLE IF EXISTS _bf_refmatch;
CREATE TABLE _bf_refmatch AS
SELECT DISTINCT ON (r.season, coalesce(r.week,-1), trim(r.home_team), trim(r.away_team))
  r.season, coalesce(r.week,-1) AS week, trim(r.home_team) AS home_team, trim(r.away_team) AS away_team,
  mt.id AS match_id, mt.match_key
FROM mnp_reference_games r
JOIN matches mt ON mt.season=r.season AND coalesce(mt.week,-1)=coalesce(r.week,-1)
  AND trim(mt.home_team)=trim(r.home_team) AND trim(mt.away_team)=trim(r.away_team)
WHERE r.season BETWEEN 2 AND 12;

-- ---------------------------------------------------------------------------
-- 3. Rebuild ALL seasons 2-12 games from the reference (delete + reinsert).
--    Restores doubles partners, corrects is_pick, de-dups the 30, folds in 31.
-- ---------------------------------------------------------------------------
DELETE FROM games WHERE season BETWEEN 2 AND 12;

INSERT INTO games (
  match_id, season, week, venue, match_key, round_number, game_number, machine,
  player_1_key, player_1_name, player_1_score, player_1_points, player_1_team, player_1_is_pick,
  player_2_key, player_2_name, player_2_score, player_2_points, player_2_team, player_2_is_pick,
  player_3_key, player_3_name, player_3_score, player_3_points, player_3_team, player_3_is_pick,
  player_4_key, player_4_name, player_4_score, player_4_points, player_4_team, player_4_is_pick,
  home_team, away_team, home_points, away_points)
SELECT
  rm.match_id, gr.season, gr.week, gr.venue, rm.match_key, gr.round_number,
  row_number() OVER (PARTITION BY rm.match_id ORDER BY gr.round_number, gr.game_number, gr.machine) AS game_number,
  gr.machine,
  _bf_resolve(gr.p1_name), gr.p1_name, gr.p1_score, gr.p1_points, p.p1_team,
    CASE WHEN gr.round_number=5 THEN NULL WHEN gr.p1_name IS NULL THEN NULL ELSE (p.p1_team = p.picker) END,
  _bf_resolve(gr.p2_name), gr.p2_name, gr.p2_score, gr.p2_points, p.p2_team,
    CASE WHEN gr.round_number=5 THEN NULL WHEN gr.p2_name IS NULL THEN NULL ELSE (p.p2_team = p.picker) END,
  _bf_resolve(gr.p3_name), gr.p3_name, gr.p3_score, gr.p3_points,
    CASE WHEN gr.p3_name IS NULL THEN NULL ELSE p.p1_team END,
    CASE WHEN gr.round_number=5 THEN NULL WHEN gr.p3_name IS NULL THEN NULL ELSE (p.p1_team = p.picker) END,
  _bf_resolve(gr.p4_name), gr.p4_name, gr.p4_score, gr.p4_points,
    CASE WHEN gr.p4_name IS NULL THEN NULL ELSE p.p2_team END,
    CASE WHEN gr.round_number=5 THEN NULL WHEN gr.p4_name IS NULL THEN NULL ELSE (p.p2_team = p.picker) END,
  rm.home_team, rm.away_team, gr.home_points, gr.away_points
FROM mnp_reference_games gr
JOIN _bf_refmatch rm ON rm.season=gr.season AND rm.week=coalesce(gr.week,-1)
  AND rm.home_team=trim(gr.home_team) AND rm.away_team=trim(gr.away_team)
CROSS JOIN LATERAL (SELECT
  CASE gr.round_number WHEN 1 THEN rm.away_team WHEN 2 THEN rm.home_team WHEN 3 THEN rm.away_team WHEN 4 THEN rm.home_team ELSE rm.home_team END AS p1_team,
  CASE gr.round_number WHEN 1 THEN rm.home_team WHEN 2 THEN rm.away_team WHEN 3 THEN rm.home_team WHEN 4 THEN rm.away_team ELSE rm.away_team END AS p2_team,
  CASE WHEN gr.round_number IN (1,3) THEN rm.away_team WHEN gr.round_number IN (2,4) THEN rm.home_team ELSE NULL END AS picker
) p
WHERE gr.season BETWEEN 2 AND 12;

-- ---------------------------------------------------------------------------
-- 4. Record identity edits (these tables are themselves durable provenance and
--    make nightly sync re-heal the same way).
-- ---------------------------------------------------------------------------
INSERT INTO player_key_mappings (from_key, to_key, display_name)
SELECT m.from_key, m.to_key, (SELECT player_1_name FROM games WHERE player_1_key=m.to_key AND player_1_name !~* '\(sub\)' LIMIT 1)
FROM _bf_merges m ON CONFLICT (from_key) DO NOTHING;

INSERT INTO player_name_mappings (alias, canonical_name) VALUES
  ('Elliott Johnson','Elliot Johnson'), ('Tim Kitchen','Timothy Kitchen') ON CONFLICT (alias) DO NOTHING;
UPDATE games SET player_1_name='Elliot Johnson'  WHERE player_1_name='Elliott Johnson';
UPDATE games SET player_2_name='Elliot Johnson'  WHERE player_2_name='Elliott Johnson';
UPDATE games SET player_3_name='Elliot Johnson'  WHERE player_3_name='Elliott Johnson';
UPDATE games SET player_4_name='Elliot Johnson'  WHERE player_4_name='Elliott Johnson';
UPDATE games SET player_1_name='Timothy Kitchen' WHERE player_1_name='Tim Kitchen';
UPDATE games SET player_2_name='Timothy Kitchen' WHERE player_2_name='Tim Kitchen';
UPDATE games SET player_3_name='Timothy Kitchen' WHERE player_3_name='Tim Kitchen';
UPDATE games SET player_4_name='Timothy Kitchen' WHERE player_4_name='Tim Kitchen';

-- ---------------------------------------------------------------------------
-- 5. Backfill participation (2-12) from the rebuilt games. Slots whose team has
--    no team_key (s8-eos-1 all-star "Home 1"/"Away 1") are excluded from rosters.
-- ---------------------------------------------------------------------------
INSERT INTO player_match_participation
  (match_id, player_key, player_name, season, week, team, match_key, ipr_at_match, num_played, is_sub)
WITH slots AS (
  SELECT match_id, match_key, season, week, player_1_key key, player_1_name nm, player_1_team team FROM games WHERE season BETWEEN 2 AND 12 AND player_1_key IS NOT NULL
  UNION ALL SELECT match_id, match_key, season, week, player_2_key, player_2_name, player_2_team FROM games WHERE season BETWEEN 2 AND 12 AND player_2_key IS NOT NULL
  UNION ALL SELECT match_id, match_key, season, week, player_3_key, player_3_name, player_3_team FROM games WHERE season BETWEEN 2 AND 12 AND player_3_key IS NOT NULL
  UNION ALL SELECT match_id, match_key, season, week, player_4_key, player_4_name, player_4_team FROM games WHERE season BETWEEN 2 AND 12 AND player_4_key IS NOT NULL
),
agg AS (
  SELECT s.match_id, s.match_key, s.season, s.week, s.key AS player_key, tk.team_key,
    bool_or(s.nm ~* '\(sub\)') AS is_sub, count(*) AS num_played,
    (array_agg(trim(regexp_replace(s.nm,'\s*\(sub\)\s*$','','i')) ORDER BY 1))[1] AS player_name
  FROM slots s JOIN _bf_team_key tk ON tk.team_name = trim(s.team)
  GROUP BY s.match_id, s.match_key, s.season, s.week, s.key, tk.team_key
)
SELECT match_id, player_key, player_name, season, week, team_key, match_key, NULL::int, num_played, is_sub
FROM agg ON CONFLICT (match_id, player_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Backfill player_stats (2-12). One row per (player_name, season). ipr=NULL
--    (the reference carries no IPR). Pure-substitute seasons get matches_played=0.
-- ---------------------------------------------------------------------------
INSERT INTO player_stats (player_name, player_key, season, team, ipr, matches_played, last_match_week)
WITH base AS (
  SELECT match_id, player_name, player_key, season, team, week, is_sub FROM player_match_participation WHERE season BETWEEN 2 AND 12
),
team_pick AS (
  SELECT player_name, season, team,
    row_number() OVER (PARTITION BY player_name, season ORDER BY count(*) FILTER (WHERE NOT is_sub) DESC, count(*) DESC) rn
  FROM base GROUP BY player_name, season, team
),
agg AS (
  SELECT player_name, season, (array_agg(player_key ORDER BY player_key))[1] AS player_key,
    count(DISTINCT match_id) FILTER (WHERE NOT is_sub) AS matches_played,
    max(week) FILTER (WHERE NOT is_sub) AS last_match_week
  FROM base GROUP BY player_name, season
)
SELECT a.player_name, a.player_key, a.season, tp.team, NULL::numeric, coalesce(a.matches_played,0), a.last_match_week
FROM agg a LEFT JOIN team_pick tp ON tp.player_name=a.player_name AND tp.season=a.season AND tp.rn=1
ON CONFLICT (player_name, season) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. Cleanup scratch + provenance entries logged to data_provenance
--    (batch_id legacy-2to12-reconstruction-2026-07-21).
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS _bf_team_key, _bf_name_key, _bf_merges, _bf_missing, _bf_refmatch;
DROP FUNCTION IF EXISTS _bf_resolve(text);

-- ---------------------------------------------------------------------------
-- 8. REMAINING STEP (not SQL): rebuild the cache_* tables via a full sync-data
--    run. It rescans the whole games table (now corrected) and applies the app's
--    machine/venue/name standardization + score limits. Legacy cache rows are
--    stale until then. Deliberately NOT replicated in SQL to avoid diverging from
--    the app's standardization bucketing.
-- ============================================================================
