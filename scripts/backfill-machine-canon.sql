-- ============================================================================
-- Backfill games.machine to canon short keys.
-- batch_id: machine-canon-backfill-2026-07-26   (see table data_provenance)
--
-- Order matters:
--   1. machine_raw preserves exactly what the import delivered. Written only
--      where NULL, so re-running never overwrites the true original.
--   2. Two per-row corrections that no alias can express (bare "Star Wars"
--      disambiguated by the venue's known machine that season).
--   3. Set-based rewrite through the same three-step ladder the application
--      resolver uses: canon key -> canon long form -> machine_aliases.
--   4. Provenance derived from machine_raw vs machine, so the log reflects
--      what actually changed rather than what was intended.
--
-- Fully reversible:  UPDATE games SET machine = machine_raw WHERE machine_raw IS NOT NULL;
-- ============================================================================

BEGIN;

-- 1. Preserve the source value ------------------------------------------------
UPDATE games
SET machine_raw = machine
WHERE machine_raw IS NULL
  AND machine IS NOT NULL;

-- 2. Per-row corrections -------------------------------------------------------
-- Bare "Star Wars" appears twice. Canon has five Star Wars machines, so there is
-- no alias that fits; each is resolved to the machine that venue demonstrably ran
-- that season (The Goat -> StarWarsSega s7-8; Shorty's -> SternWars s8).
UPDATE games SET machine = 'StarWarsSega'
WHERE machine = 'Star Wars' AND season = 7 AND venue = 'The Goat';

UPDATE games SET machine = 'SternWars'
WHERE machine = 'Star Wars' AND season = 8 AND venue = 'Shorty''s';

-- 3. Rewrite every remaining spelling to its canon key -------------------------
WITH resolution AS (
  SELECT lower(regexp_replace(btrim(key), '\s+', ' ', 'g')) AS n, key FROM machine_canon
  UNION
  SELECT lower(regexp_replace(btrim(name), '\s+', ' ', 'g')), key FROM machine_canon
  UNION
  SELECT alias, canon_key FROM machine_aliases
)
UPDATE games g
SET machine = r.key
FROM resolution r
WHERE r.n = lower(regexp_replace(btrim(g.machine), '\s+', ' ', 'g'))
  AND g.machine <> r.key;

-- 4. Record every distinct deviation from source -------------------------------
INSERT INTO data_provenance (
  batch_id, category, entity, description, transformation_rule, reason, source,
  rows_affected, details
)
SELECT
  'machine-canon-backfill-2026-07-26',
  'machine_canon',
  'games.machine',
  'Normalized games.machine to canon short keys',
  'normalize(raw) = lower/trim/collapse-whitespace, matched against canon key, then canon long form, then machine_aliases; two rows corrected individually by venue. Original preserved in games.machine_raw.',
  'The machine column held 439 distinct spellings for 340 machines — case variants, long forms, typos and venue-local names — so the same machine did not aggregate together.',
  'https://mondaynightpinball.com/machines via machine_canon; approved by Kellan 2026-07-26',
  (SELECT count(*) FROM games WHERE machine_raw IS DISTINCT FROM machine),
  (SELECT jsonb_agg(jsonb_build_object('from', t.machine_raw, 'to', t.machine, 'rows', t.n) ORDER BY t.n DESC)
   FROM (
     SELECT machine_raw, machine, count(*) AS n
     FROM games
     WHERE machine_raw IS DISTINCT FROM machine
     GROUP BY machine_raw, machine
   ) t);

COMMIT;
