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

    const { data: ps } = await supabase
      .from('player_stats')
      .update({ player_name: m.canonical_name })
      .eq('player_name', m.alias)
      .select('id')
    healed += ps?.length || 0
  }
  return healed
}
