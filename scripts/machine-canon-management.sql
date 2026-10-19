-- Atomic canon edits, aliases, source rewrites and provenance. Only the server
-- service role can call this function; HTTP callers must pass the admin guard.
CREATE OR REPLACE FUNCTION public.manage_machine_canon(p_change jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  target_key text := btrim(p_change->>'key');
  target_name text := btrim(p_change->>'name');
  target_source text := p_change->>'source';
  previous_key text := nullif(p_change->>'previousKey', '');
  reason_text text := btrim(p_change->>'reason');
  before_row jsonb;
  target_before jsonb;
  previous_row jsonb;
  raw_values text[];
  norms text[];
  spelling text;
  table_spec record;
  affected integer;
  total_affected integer := 0;
  changes jsonb := '[]';
  snapshots jsonb := '{}';
  batch text := 'machine-canon-' || gen_random_uuid()::text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('machine-canon-management'));
  IF target_key IS NULL OR target_key !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
     OR coalesce(length(target_name),0) NOT BETWEEN 1 AND 200
     OR target_source IS NULL OR target_source NOT IN ('local','mnp')
     OR coalesce(length(reason_text),0) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'A valid short form, long form, source and reason are required';
  END IF;
  SELECT to_jsonb(m) INTO before_row FROM machine_canon m WHERE key=target_key FOR UPDATE;
  target_before:=before_row;
  IF previous_key IS NOT NULL THEN
    SELECT to_jsonb(m) INTO previous_row FROM machine_canon m WHERE key=previous_key FOR UPDATE;
    IF previous_row IS NULL OR previous_row->>'source' <> 'local' OR target_source <> 'mnp' THEN
      RAISE EXCEPTION 'Only a provisional machine can be adopted into the MNP canon';
    END IF;
  END IF;
  IF before_row IS NOT NULL AND target_source='local' THEN
    RAISE EXCEPTION 'That short form already exists; select the existing canon instead';
  END IF;
  IF target_before->>'source'='local' AND target_source='mnp' AND previous_key IS DISTINCT FROM target_key THEN
    RAISE EXCEPTION 'Select the provisional record to replace before adopting this MNP key';
  END IF;
  IF target_source='mnp' AND (nullif(p_change->>'mnpKey','') IS NULL OR nullif(p_change->>'mnpName','') IS NULL) THEN
    RAISE EXCEPTION 'Published MNP evidence is required';
  END IF;

  SELECT array_agg(DISTINCT v) INTO raw_values FROM (
    SELECT jsonb_array_elements_text(coalesce(p_change->'rawValues','[]')) v
    UNION SELECT target_key UNION SELECT target_name
    UNION SELECT target_before->>'key' WHERE target_before IS NOT NULL
    UNION SELECT target_before->>'name' WHERE target_before IS NOT NULL
    UNION SELECT previous_row->>'key' WHERE previous_row IS NOT NULL
    UNION SELECT previous_row->>'name' WHERE previous_row IS NOT NULL
    UNION SELECT alias_raw FROM machine_aliases WHERE canon_key=previous_key
    UNION SELECT alias FROM machine_aliases WHERE canon_key=previous_key
  ) s WHERE v IS NOT NULL AND length(btrim(v))>0;
  SELECT array_agg(DISTINCT lower(regexp_replace(btrim(v),'\s+',' ','g'))) INTO norms FROM unnest(raw_values) v;
  IF EXISTS (SELECT 1 FROM machine_canon m WHERE m.key <> target_key AND m.key IS DISTINCT FROM previous_key
      AND (lower(regexp_replace(btrim(m.key),'\s+',' ','g'))=ANY(norms)
        OR lower(regexp_replace(btrim(m.name),'\s+',' ','g'))=ANY(norms)))
    OR EXISTS (SELECT 1 FROM machine_aliases a WHERE a.alias=ANY(norms)
      AND a.canon_key <> target_key AND a.canon_key IS DISTINCT FROM previous_key) THEN
    RAISE EXCEPTION 'A selected spelling already belongs to another machine; no entries were combined';
  END IF;

  INSERT INTO machine_canon(key,name,source,mnp_key,mnp_name,note,active)
  VALUES(target_key,target_name,target_source,p_change->>'mnpKey',p_change->>'mnpName',reason_text,true)
  ON CONFLICT(key) DO UPDATE SET name=excluded.name,source=excluded.source,
    mnp_key=excluded.mnp_key,mnp_name=excluded.mnp_name,active=true,updated_at=now(),
    display_override=CASE WHEN machine_canon.source='local' THEN NULL ELSE machine_canon.display_override END,
    note=concat_ws(E'\n',machine_canon.note,reason_text);

  SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') INTO snapshots FROM machine_aliases a
    WHERE canon_key=previous_key OR alias=ANY(norms);
  snapshots := jsonb_build_object('canon',target_before,'aliases',snapshots);
  UPDATE machine_aliases SET canon_key=target_key WHERE canon_key=previous_key;
  FOREACH spelling IN ARRAY raw_values LOOP
    INSERT INTO machine_aliases(alias,alias_raw,canon_key,origin,reason)
    VALUES(lower(regexp_replace(btrim(spelling),'\s+',' ','g')),spelling,target_key,'manual',reason_text)
    ON CONFLICT(alias) DO UPDATE SET canon_key=excluded.canon_key;
  END LOOP;

  SELECT coalesce(jsonb_agg(row_to_json(s)),'[]') INTO changes FROM (
    SELECT machine AS from_value,count(*) AS rows FROM games
    WHERE lower(regexp_replace(btrim(machine),'\s+',' ','g'))=ANY(norms) AND machine<>target_key GROUP BY machine
  ) s;
  UPDATE games SET machine_raw=coalesce(machine_raw,machine),machine=target_key
    WHERE lower(regexp_replace(btrim(machine),'\s+',' ','g'))=ANY(norms) AND machine<>target_key;
  GET DIAGNOSTICS affected=ROW_COUNT;
  total_affected:=total_affected+affected;
  changes:=jsonb_build_object('games',changes);

  -- Authored data is never discarded to resolve a uniqueness conflict. Such a
  -- conflict aborts the whole transaction and asks the user to resolve it.
  FOR table_spec IN SELECT * FROM (VALUES
    ('score_limits','machine'),('user_machine_scores','machine'),
    ('user_machine_inputs','machine'),('custom_backglass_images','machine_key')
  ) t(table_name,column_name) LOOP
    IF to_regclass('public.'||table_spec.table_name) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]'') FROM %I t WHERE lower(regexp_replace(btrim(%I),''\s+'','' '',''g''))=ANY($1) AND %I<>$2',table_spec.table_name,table_spec.column_name,table_spec.column_name)
      INTO before_row USING norms,target_key;
    snapshots:=snapshots||jsonb_build_object(table_spec.table_name,before_row);
    EXECUTE format('UPDATE %I SET %I=$1 WHERE lower(regexp_replace(btrim(%I),''\s+'','' '',''g''))=ANY($2) AND %I<>$1',table_spec.table_name,table_spec.column_name,table_spec.column_name,table_spec.column_name)
      USING target_key,norms;
    GET DIAGNOSTICS affected=ROW_COUNT;
    total_affected:=total_affected+affected;
    changes:=changes||jsonb_build_object(table_spec.table_name,affected);
  END LOOP;

  IF to_regclass('public.venue_machine_lists') IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') INTO before_row FROM venue_machine_lists v
      WHERE EXISTS(SELECT 1 FROM unnest(coalesce(v.included,'{}')||coalesce(v.excluded,'{}')) x
        WHERE lower(regexp_replace(btrim(x),'\s+',' ','g'))=ANY(norms) AND x<>target_key);
    GET DIAGNOSTICS affected=ROW_COUNT;
    total_affected:=total_affected+affected;
    changes:=changes||jsonb_build_object('venue_machine_lists',affected);
    snapshots:=snapshots||jsonb_build_object('venue_machine_lists',before_row);
    UPDATE venue_machine_lists v SET
      included=ARRAY(SELECT DISTINCT CASE WHEN lower(regexp_replace(btrim(x),'\s+',' ','g'))=ANY(norms) THEN target_key ELSE x END FROM unnest(v.included) x),
      excluded=ARRAY(SELECT DISTINCT CASE WHEN lower(regexp_replace(btrim(x),'\s+',' ','g'))=ANY(norms) THEN target_key ELSE x END FROM unnest(v.excluded) x)
      WHERE EXISTS(SELECT 1 FROM unnest(coalesce(v.included,'{}')||coalesce(v.excluded,'{}')) x
        WHERE lower(regexp_replace(btrim(x),'\s+',' ','g'))=ANY(norms) AND x<>target_key);
  END IF;

  IF to_regclass('public.cache_team_pick_games') IS NOT NULL THEN
    UPDATE cache_team_pick_games SET machine=lower(target_key) WHERE lower(regexp_replace(btrim(machine),'\s+',' ','g'))=ANY(norms);
  END IF;
  -- These aggregates cannot be summed safely after a merge. Drop affected
  -- buckets; nightly sync rebuilds them from the canonical games.
  IF total_affected>0 OR (previous_key IS NOT NULL AND previous_key<>target_key) THEN
    FOREACH spelling IN ARRAY ARRAY['cache_team_machine_stats','cache_player_machine_stats','cache_machine_top_scores'] LOOP
      IF to_regclass('public.'||spelling) IS NOT NULL THEN
        EXECUTE format('DELETE FROM %I WHERE lower(regexp_replace(btrim(machine),''\s+'','' '',''g''))=ANY($1)',spelling) USING norms;
        GET DIAGNOSTICS affected=ROW_COUNT;
        changes:=changes||jsonb_build_object(spelling,affected);
      END IF;
    END LOOP;
  END IF;
  IF previous_key IS NOT NULL AND previous_key<>target_key THEN
    DELETE FROM machine_canon WHERE key=previous_key;
  END IF;
  DELETE FROM machine_name_issues WHERE lower(regexp_replace(btrim(raw_value),'\s+',' ','g'))=ANY(norms)
    OR (issue_type IN ('upstream_added','upstream_changed') AND suggested_key IN (target_key,p_change->>'mnpKey',previous_key));

  INSERT INTO data_provenance(batch_id,category,entity,description,transformation_rule,reason,source,rows_affected,details)
  VALUES(batch,'machine_canon','machine_canon',
    CASE WHEN previous_row IS NOT NULL THEN 'Adopted provisional machine into MNP canon' ELSE 'Saved machine canon and combined selected spellings' END,
    'Explicit source spellings -> canonical short key; games.machine_raw preserved; conflicting authored settings abort; affected aggregates invalidated',
    reason_text,CASE WHEN target_source='mnp' THEN 'https://mondaynightpinball.com/machines (machines.json mirror)' ELSE 'Provisional canon from reviewed source entries' END,total_affected,
    jsonb_build_object('actor',p_change->>'actor','previous',previous_row,'canon',p_change,'source_values',raw_values,'changes',changes,'before',snapshots));
  RETURN jsonb_build_object('key',target_key,'name',target_name,'source',target_source,'rowsAffected',total_affected,'batchId',batch);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Conflicting saved settings or images exist for these spellings. Resolve them before combining; nothing was changed.';
END $$;
REVOKE ALL ON FUNCTION public.manage_machine_canon(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_machine_canon(jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
