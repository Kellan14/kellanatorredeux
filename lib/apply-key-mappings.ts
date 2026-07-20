/**
 * Player-key merges: rewrite every row keyed by `fromKey` to `toKey` across
 * games (all 4 player slots), participation, and player_stats. Player names are
 * left untouched — only the identity key changes.
 *
 * Merges must be *undoable*. Seasons below the sync's MIN_SEASON (20) are never
 * re-imported from the GitHub archive, so once their key is rewritten the
 * original is unrecoverable unless we record exactly which rows we touched.
 * `applyAndTrackKeyMapping` therefore stores the affected row ids on the
 * `player_key_mappings` row, and `revertKeyMapping` uses them to un-merge
 * surgically (no full resync). Pre-20 ids are stable (sync never deletes those
 * rows); ≥20 ids can go stale after a re-import, which is harmless — the revert
 * is guarded by `key = toKey`, and the refresh below prunes them.
 */

/** Row ids rewritten by a merge, split by table/slot so revert can target the
 *  exact column. Persisted as player_key_mappings.affected_ids. */
export interface AffectedIds {
  g1: number[]
  g2: number[]
  g3: number[]
  g4: number[]
  part: number[]
  stats: number[]
}

const emptyAffected = (): AffectedIds => ({ g1: [], g2: [], g3: [], g4: [], part: [], stats: [] })

/**
 * Apply a merge and return both the row count and the ids of the rows changed.
 * (Rows changed == the rows that held `fromKey`, now holding `toKey`.)
 */
export async function applyKeyMappingTracked(
  supabase: any,
  fromKey: string,
  toKey: string
): Promise<{ total: number; affected: AffectedIds }> {
  const affected = emptyAffected()
  if (!fromKey || !toKey || fromKey === toKey) return { total: 0, affected }
  let total = 0

  // games — one column per player slot
  for (let i = 1; i <= 4; i++) {
    const { data, error } = await supabase
      .from('games')
      .update({ [`player_${i}_key`]: toKey })
      .eq(`player_${i}_key`, fromKey)
      .select('id')
    if (error) {
      console.error(`applyKeyMapping games p${i} ${fromKey}->${toKey}:`, error.message)
    } else {
      const ids = (data || []).map((r: { id: number }) => r.id)
      affected[`g${i}` as 'g1' | 'g2' | 'g3' | 'g4'] = ids
      total += ids.length
    }
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
    else {
      affected.part = (data || []).map((r: { id: number }) => r.id)
      total += affected.part.length
    }
  }

  // player_stats — key isn't part of any unique constraint here
  {
    const { data, error } = await supabase
      .from('player_stats')
      .update({ player_key: toKey })
      .eq('player_key', fromKey)
      .select('id')
    if (error) console.error(`applyKeyMapping player_stats ${fromKey}->${toKey}:`, error.message)
    else {
      affected.stats = (data || []).map((r: { id: number }) => r.id)
      total += affected.stats.length
    }
  }

  return { total, affected }
}

/**
 * Apply a merge AND persist the affected row ids on the player_key_mappings row
 * so it can be undone later. The stored set is unioned with what was already
 * there (to keep stable pre-20 ids across re-applies) and then pruned to ids
 * that still hold `toKey` (to drop stale ≥20 ids from prior imports). Returns
 * the row count, so it's a drop-in for the old applyKeyMapping.
 */
export async function applyAndTrackKeyMapping(supabase: any, fromKey: string, toKey: string): Promise<number> {
  const { total, affected } = await applyKeyMappingTracked(supabase, fromKey, toKey)

  try {
    const { data: row } = await supabase
      .from('player_key_mappings')
      .select('affected_ids')
      .eq('from_key', fromKey)
      .maybeSingle()

    // No mapping row (e.g. an ad-hoc apply) → nothing to record against.
    if (row) {
      const prev: AffectedIds = { ...emptyAffected(), ...(row.affected_ids || {}) }
      const merged = unionAffected(prev, affected)
      const pruned = await pruneAffected(supabase, toKey, merged)
      await supabase.from('player_key_mappings').update({ affected_ids: pruned }).eq('from_key', fromKey)
    }
  } catch (e) {
    console.error(`applyAndTrackKeyMapping: failed to record affected ids for ${fromKey}:`, e)
  }

  return total
}

/**
 * Undo a merge: put the recorded rows back to `fromKey`. Guarded by the current
 * value being `toKey` so stale/reused ids can never clobber a legitimate row.
 * Returns the number of rows restored.
 */
export async function revertKeyMapping(
  supabase: any,
  fromKey: string,
  toKey: string,
  affected: AffectedIds | null | undefined
): Promise<number> {
  if (!fromKey || !toKey || fromKey === toKey || !affected) return 0
  let total = 0

  for (let i = 1; i <= 4; i++) {
    const ids = affected[`g${i}` as 'g1' | 'g2' | 'g3' | 'g4'] || []
    if (ids.length === 0) continue
    const { data, error } = await supabase
      .from('games')
      .update({ [`player_${i}_key`]: fromKey })
      .in('id', ids)
      .eq(`player_${i}_key`, toKey)
      .select('id')
    if (error) console.error(`revertKeyMapping games p${i} ${toKey}->${fromKey}:`, error.message)
    else total += data?.length || 0
  }

  if ((affected.part || []).length > 0) {
    const { data, error } = await supabase
      .from('player_match_participation')
      .update({ player_key: fromKey })
      .in('id', affected.part)
      .eq('player_key', toKey)
      .select('id')
    if (error) console.error(`revertKeyMapping participation ${toKey}->${fromKey}:`, error.message)
    else total += data?.length || 0
  }

  if ((affected.stats || []).length > 0) {
    const { data, error } = await supabase
      .from('player_stats')
      .update({ player_key: fromKey })
      .in('id', affected.stats)
      .eq('player_key', toKey)
      .select('id')
    if (error) console.error(`revertKeyMapping player_stats ${toKey}->${fromKey}:`, error.message)
    else total += data?.length || 0
  }

  return total
}

/** Backward-compatible: apply a merge and return only the row count. */
export async function applyKeyMapping(supabase: any, fromKey: string, toKey: string): Promise<number> {
  return (await applyKeyMappingTracked(supabase, fromKey, toKey)).total
}

/** Merge two AffectedIds, de-duplicating each slot. */
function unionAffected(a: AffectedIds, b: AffectedIds): AffectedIds {
  const keys: (keyof AffectedIds)[] = ['g1', 'g2', 'g3', 'g4', 'part', 'stats']
  const out = emptyAffected()
  for (const k of keys) out[k] = Array.from(new Set([...(a[k] || []), ...(b[k] || [])]))
  return out
}

/** Keep only ids that still exist AND still hold `toKey`, so the stored set
 *  stays bounded and accurate. Small lists (one player's rows), so no chunking. */
async function pruneAffected(supabase: any, toKey: string, ids: AffectedIds): Promise<AffectedIds> {
  const out = emptyAffected()

  for (let i = 1; i <= 4; i++) {
    const slot = `g${i}` as 'g1' | 'g2' | 'g3' | 'g4'
    if ((ids[slot] || []).length === 0) continue
    const { data, error } = await supabase
      .from('games')
      .select('id')
      .in('id', ids[slot])
      .eq(`player_${i}_key`, toKey)
    if (!error) out[slot] = (data || []).map((r: { id: number }) => r.id)
    else out[slot] = ids[slot] // on error, keep unpruned (revert is still guarded)
  }

  if ((ids.part || []).length > 0) {
    const { data, error } = await supabase
      .from('player_match_participation')
      .select('id')
      .in('id', ids.part)
      .eq('player_key', toKey)
    out.part = !error ? (data || []).map((r: { id: number }) => r.id) : ids.part
  }

  if ((ids.stats || []).length > 0) {
    const { data, error } = await supabase
      .from('player_stats')
      .select('id')
      .in('id', ids.stats)
      .eq('player_key', toKey)
    out.stats = !error ? (data || []).map((r: { id: number }) => r.id) : ids.stats
  }

  return out
}
