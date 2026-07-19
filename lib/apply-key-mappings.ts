/**
 * Apply a player-key merge: rewrite every row keyed by `fromKey` to `toKey`
 * across games (all 4 player slots), participation, and player_stats. Player
 * names are left untouched — only the identity key changes. Returns the number
 * of rows updated. Shared by /api/update-player-keys and the nightly sync.
 */
export async function applyKeyMapping(supabase: any, fromKey: string, toKey: string): Promise<number> {
  if (!fromKey || !toKey || fromKey === toKey) return 0
  let total = 0

  // games — one column per player slot
  for (let i = 1; i <= 4; i++) {
    const { data, error } = await supabase
      .from('games')
      .update({ [`player_${i}_key`]: toKey })
      .eq(`player_${i}_key`, fromKey)
      .select('id')
    if (error) console.error(`applyKeyMapping games p${i} ${fromKey}->${toKey}:`, error.message)
    else total += data?.length || 0
  }

  // player_match_participation — UNIQUE(match_key, player_key); a bulk update
  // fails atomically on the rare collision, so tolerate the error and move on.
  {
    const { data, error } = await supabase
      .from('player_match_participation')
      .update({ player_key: toKey })
      .eq('player_key', fromKey)
      .select('id')
    if (error) console.error(`applyKeyMapping participation ${fromKey}->${toKey}:`, error.message)
    else total += data?.length || 0
  }

  // player_stats — key isn't part of any unique constraint here
  {
    const { data, error } = await supabase
      .from('player_stats')
      .update({ player_key: toKey })
      .eq('player_key', fromKey)
      .select('id')
    if (error) console.error(`applyKeyMapping player_stats ${fromKey}->${toKey}:`, error.message)
    else total += data?.length || 0
  }

  return total
}
