/** A player_stats row with no real activity — safe to drop as a duplicate. */
const isStatStub = (r: any): boolean => (r?.matches_played || 0) === 0 && (r?.last_match_week || 0) === 0

/**
 * Rename player_stats rows from `alias` to `canonical`, tolerating the
 * UNIQUE(player_name, season) constraint — WITHOUT ever destroying real data.
 *
 * player_stats holds one aggregate row per (player_name, season). When a season
 * already has BOTH spellings as separate rows, a blind rename hits a unique
 * violation, which the old code swallowed silently (the fix only half-applied).
 * Resolution per colliding season:
 *   - one side is an empty stub (0 matches, week 0)  → delete the stub, keep the
 *     row that has data (renaming the alias row up if the stub was the canonical)
 *   - BOTH sides hold real data                       → leave them untouched and
 *     count a conflict; merging real aggregates is a human judgement call, so we
 *     never guess and never delete.
 * Seasons with only the alias row are renamed normally. Returns rows affected.
 */
export async function renamePlayerStats(supabase: any, alias: string, canonical: string): Promise<number> {
  if (!alias || !canonical || alias === canonical) return 0

  const { data: aliasRows, error: aliasErr } = await supabase
    .from('player_stats')
    .select('id, season, matches_played, last_match_week')
    .eq('player_name', alias)
  if (aliasErr) {
    console.error(`renamePlayerStats: load alias rows "${alias}":`, aliasErr.message)
    return 0
  }
  if (!aliasRows || aliasRows.length === 0) return 0

  const seasons = Array.from(new Set(aliasRows.map((r: any) => r.season)))
  const { data: canonRows } = await supabase
    .from('player_stats')
    .select('id, season, matches_played, last_match_week')
    .eq('player_name', canonical)
    .in('season', seasons)
  const canonBySeason = new Map<number, any>()
  for (const r of canonRows || []) canonBySeason.set(r.season, r)

  const renameIds: number[] = []
  const deleteIds: number[] = []
  let conflicts = 0
  for (const ar of aliasRows) {
    const cr = canonBySeason.get(ar.season)
    if (!cr) {
      renameIds.push(ar.id) // no collision — just rename
    } else if (isStatStub(ar)) {
      deleteIds.push(ar.id) // alias is an empty stub → drop it, keep the canonical row
    } else if (isStatStub(cr)) {
      deleteIds.push(cr.id) // canonical is an empty stub → drop it, promote the alias row
      renameIds.push(ar.id)
    } else {
      conflicts++ // real data on both sides → never guess; leave both in place
    }
  }

  let affected = 0
  // Delete stubs first so the renames can't re-collide.
  if (deleteIds.length) {
    const { data, error } = await supabase.from('player_stats').delete().in('id', deleteIds).select('id')
    if (error) console.error(`renamePlayerStats: delete "${alias}"->"${canonical}":`, error.message)
    else affected += data?.length || 0
  }
  if (renameIds.length) {
    const { data, error } = await supabase
      .from('player_stats')
      .update({ player_name: canonical })
      .in('id', renameIds)
      .select('id')
    if (error) console.error(`renamePlayerStats: rename "${alias}"->"${canonical}":`, error.message)
    else affected += data?.length || 0
  }
  if (conflicts > 0) {
    console.warn(
      `renamePlayerStats: "${alias}" -> "${canonical}" left ${conflicts} season(s) unmerged (real stats on both spellings; needs manual review)`
    )
  }
  return affected
}

/**
 * Re-apply all player name mappings to the raw tables (games / participation /
 * player_stats). A "(sub)" alias is NEVER rewritten in games (that suffix is the
 * per-game substitute marker); it is still standardized in the aggregate tables.
 * Returns rows healed (0 when everything was already applied). Idempotent.
 */
export async function applyNameMappings(supabase: any): Promise<number> {
  let healed = 0
  const { data: mappings, error } = await supabase
    .from('player_name_mappings')
    .select('alias, canonical_name')
  if (error) return 0

  for (const m of mappings || []) {
    if (!m.alias || !m.canonical_name) continue
    const isSubAlias = /\(sub\)\s*$/i.test(m.alias)

    if (!isSubAlias) {
      for (let i = 1; i <= 4; i++) {
        const { data } = await supabase
          .from('games')
          .update({ [`player_${i}_name`]: m.canonical_name })
          .eq(`player_${i}_name`, m.alias)
          .select('id')
        healed += data?.length || 0
      }
    }

    const { data: pmp } = await supabase
      .from('player_match_participation')
      .update({ player_name: m.canonical_name })
      .eq('player_name', m.alias)
      .select('id')
    healed += pmp?.length || 0

    healed += await renamePlayerStats(supabase, m.alias, m.canonical_name)
  }
  return healed
}
