/**
 * Re-apply linked sub-links: rewrite any games rows still keyed by a slug key
 * back to the real player's key. A nightly re-import re-introduces the original
 * slug keys from the archive, so this keeps legacy substitute games attached to
 * the real player. The "(sub)" name is preserved. Returns rows healed (0 when
 * nothing had drifted). Idempotent.
 */
export async function applySubLinks(supabase: any): Promise<number> {
  let healed = 0
  const { data: links, error } = await supabase
    .from('player_sub_links')
    .select('slug_key, linked_player_key, status')
    .eq('status', 'linked')
  if (error) return 0 // table may not exist yet

  for (const l of links || []) {
    if (!l.linked_player_key || !l.slug_key) continue
    for (let i = 1; i <= 4; i++) {
      const { data } = await supabase
        .from('games')
        .update({ [`player_${i}_key`]: l.linked_player_key })
        .eq(`player_${i}_key`, l.slug_key)
        .select('id')
      healed += data?.length || 0
    }
  }
  return healed
}
