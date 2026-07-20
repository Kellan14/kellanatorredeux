import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth'
import { fetchAllRecords } from '@/lib/supabase'
import { normalizeName, pickCanonical } from '@/lib/player-name-issues'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const isHashKey = (k: string | null | undefined): boolean => !!k && /^[0-9a-f]{40}$/.test(k)

interface GameRef { id: number; pos: number }

/**
 * Build a resolver that maps any player_key through the recorded key-merges to
 * its canonical key (transitively). Without this, a player who was key-merged
 * (or recorded under several spellings across old keys) shows up as several
 * duplicate candidates for the same sub — see player_key_mappings.
 */
async function loadKeyResolver(supabase: any): Promise<(k: string) => string> {
  const { data } = await supabase.from('player_key_mappings').select('from_key, to_key')
  const map = new Map<string, string>()
  for (const m of data || []) map.set(m.from_key, m.to_key)
  return (k: string) => {
    let cur = k
    const seen = new Set<string>()
    while (map.has(cur) && !seen.has(cur)) {
      seen.add(cur)
      cur = map.get(cur)!
    }
    return cur
  }
}

/** alias -> canonical name, for showing the standardized spelling. */
async function loadNameMap(supabase: any): Promise<Map<string, string>> {
  const { data } = await supabase.from('player_name_mappings').select('alias, canonical_name')
  const m = new Map<string, string>()
  for (const r of data || []) m.set(r.alias, r.canonical_name)
  return m
}

/**
 * GET  → list all sub-links + recent edit log (for the Options tool).
 * POST → { action: 'scan' | 'auto' | 'link' | 'unlink', ... } (admin only).
 *
 * A "link" rewrites the affected games rows' player_N_key from the slug key to
 * the real player's key. The "(sub)" name is preserved, so the substitute
 * marker is never lost, and game_refs makes every link fully reversible.
 */
export async function GET(request: Request) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const includePlayers = new URL(request.url).searchParams.get('players') === 'true'
  try {
    const { data: links, error } = await supabase
      .from('player_sub_links')
      .select('*')
      .order('status', { ascending: true })
      .order('sub_name', { ascending: true })
    if (error) {
      return NextResponse.json({ links: [], log: [], players: [], needsMigration: true })
    }
    const { data: log } = await supabase
      .from('player_sub_link_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)

    // Distinct real (hash-keyed) players for the manual-link picker — resolved
    // through key-merges and name-mappings so each identity appears once with
    // its canonical spelling.
    let players: { player_key: string; player_name: string }[] = []
    if (includePlayers) {
      const resolveKey = await loadKeyResolver(supabase)
      const nameMap = await loadNameMap(supabase)
      const psRows = await fetchAllRecords<{ player_name: string | null; player_key: string | null }>(
        () => supabase.from('player_stats').select('player_name, player_key').order('id', { ascending: true })
      )
      const seen = new Map<string, string>()
      for (const r of psRows) {
        if (!r.player_name || !isHashKey(r.player_key)) continue
        const rKey = resolveKey(r.player_key as string)
        const cName = nameMap.get(r.player_name) || r.player_name
        const prev = seen.get(rKey)
        seen.set(rKey, prev ? pickCanonical([prev, cName]) : cName)
      }
      players = Array.from(seen.entries())
        .map(([player_key, player_name]) => ({ player_key, player_name }))
        .sort((a, b) => a.player_name.localeCompare(b.player_name))
    }

    return NextResponse.json({ links: links || [], log: log || [], players })
  } catch (error) {
    console.error('Error listing sub-links:', error)
    return NextResponse.json({ error: 'Failed to list sub-links' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  const performedBy = auth.user.email || auth.user.id

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const body = await request.json().catch(() => ({}))
  const action = body.action as string

  try {
    if (action === 'scan') return await handleScan(supabase, performedBy)
    if (action === 'auto') return await handleAuto(supabase, performedBy)
    if (action === 'link') return await handleLink(supabase, body, performedBy)
    if (action === 'unlink') return await handleUnlink(supabase, body, performedBy)
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error(`Error in sub-links action "${action}":`, error)
    return NextResponse.json({ error: 'Sub-link operation failed' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------

/** Rebuild the slug-sub inventory, preserving already-applied links. */
async function handleScan(supabase: any, performedBy: string) {
  // 1. Gather every legacy "(sub)" game row and collect slug-keyed identities.
  const rows = await fetchAllRecords<any>(() =>
    supabase
      .from('games')
      .select('id, player_1_name, player_1_key, player_2_name, player_2_key, player_3_name, player_3_key, player_4_name, player_4_key')
      // Values are double-quoted because "(sub)" contains parentheses, which are
      // grammar characters in a PostgREST .or() string (see lib/pg-filter.ts).
      .or('player_1_name.ilike."*(sub)*",player_2_name.ilike."*(sub)*",player_3_name.ilike."*(sub)*",player_4_name.ilike."*(sub)*"')
      .order('id', { ascending: true })
  )

  // slug_key -> { sub_name, refs, count }
  const inventory = new Map<string, { sub_name: string; refs: GameRef[] }>()
  for (const row of rows) {
    for (let pos = 1; pos <= 4; pos++) {
      const name = row[`player_${pos}_name`]
      const key = row[`player_${pos}_key`]
      if (!name || !/\(sub\)/i.test(name)) continue
      if (isHashKey(key)) continue // hash-keyed subs already attach to the real player
      if (!key) continue
      if (!inventory.has(key)) inventory.set(key, { sub_name: name, refs: [] })
      inventory.get(key)!.refs.push({ id: row.id, pos })
    }
  }

  // 2. Build candidate lookup: normalized name -> real (hash-keyed) players.
  //    Keys are resolved through key-merges and names through name-mappings, so
  //    a single person recorded under several spellings or old (merged) keys
  //    collapses to ONE candidate with the canonical spelling — not a pile of
  //    duplicates.
  const resolveKey = await loadKeyResolver(supabase)
  const nameMap = await loadNameMap(supabase)
  const psRows = await fetchAllRecords<{ player_name: string | null; player_key: string | null }>(
    () => supabase.from('player_stats').select('player_name, player_key').order('id', { ascending: true })
  )
  const realByNorm = new Map<string, Map<string, string>>() // norm -> (resolvedKey -> bestName)
  for (const r of psRows) {
    if (!r.player_name || !isHashKey(r.player_key)) continue
    const norm = normalizeName(r.player_name)
    const rKey = resolveKey(r.player_key as string)
    const cName = nameMap.get(r.player_name) || r.player_name
    if (!realByNorm.has(norm)) realByNorm.set(norm, new Map())
    const byKey = realByNorm.get(norm)!
    const prev = byKey.get(rKey)
    byKey.set(rKey, prev ? pickCanonical([prev, cName]) : cName)
  }

  // 3. Load existing rows to preserve applied links.
  const { data: existingRows } = await supabase.from('player_sub_links').select('*')
  const existing = new Map<string, any>()
  for (const e of existingRows || []) existing.set(e.slug_key, e)

  // 4. Upsert inventory.
  const upserts: any[] = []
  Array.from(inventory.entries()).forEach(([slugKey, info]) => {
    const stripped = normalizeName(info.sub_name)
    const candMap = realByNorm.get(stripped) || new Map<string, string>()
    const candidates = Array.from(candMap.entries()).map(([player_key, player_name]) => ({ player_key, player_name }))
    const prev = existing.get(slugKey)

    if (prev && prev.status === 'linked' && prev.linked_player_key) {
      // Preserve the applied link; just refresh counts/refs/candidates.
      upserts.push({
        slug_key: slugKey,
        sub_name: info.sub_name,
        stripped_name: stripped,
        linked_player_key: prev.linked_player_key,
        linked_player_name: prev.linked_player_name,
        status: 'linked',
        auto: prev.auto,
        game_count: info.refs.length,
        game_refs: prev.game_refs && prev.game_refs.length ? prev.game_refs : info.refs,
        candidates,
        updated_at: prev.updated_at,
        updated_by: prev.updated_by,
      })
    } else {
      upserts.push({
        slug_key: slugKey,
        sub_name: info.sub_name,
        stripped_name: stripped,
        linked_player_key: null,
        linked_player_name: null,
        status: candidates.length === 0 ? 'no_match' : 'unlinked',
        auto: false,
        game_count: info.refs.length,
        game_refs: info.refs,
        candidates,
        updated_at: new Date().toISOString(),
        updated_by: null,
      })
    }
  })

  if (upserts.length > 0) {
    const { error } = await supabase.from('player_sub_links').upsert(upserts, { onConflict: 'slug_key' })
    if (error) throw error
  }

  await logAction(supabase, {
    slug_key: '*', sub_name: null, action: 'scan',
    to_player_key: null, to_player_name: null, games_updated: 0, performed_by: performedBy,
  })

  const counts = summarize(upserts)
  return NextResponse.json({ scanned: upserts.length, ...counts })
}

/** Auto-link every unlinked identity that has exactly one candidate. */
async function handleAuto(supabase: any, performedBy: string) {
  const resolveKey = await loadKeyResolver(supabase)
  const { data: rows } = await supabase.from('player_sub_links').select('*').eq('status', 'unlinked')
  let linked = 0
  let gamesUpdated = 0
  for (const row of rows || []) {
    const cands = row.candidates || []
    if (cands.length !== 1) continue
    const target = cands[0]
    const updated = await applyLink(supabase, row, resolveKey(target.player_key), target.player_name, true, 'auto_link', performedBy)
    linked++
    gamesUpdated += updated
  }
  return NextResponse.json({ linked, gamesUpdated })
}

/** Manually link/relink one identity to a chosen player. */
async function handleLink(supabase: any, body: any, performedBy: string) {
  const { slug_key, player_key, player_name } = body
  if (!slug_key || !player_key || !player_name) {
    return NextResponse.json({ error: 'slug_key, player_key, player_name required' }, { status: 400 })
  }
  const { data: row } = await supabase.from('player_sub_links').select('*').eq('slug_key', slug_key).single()
  if (!row) return NextResponse.json({ error: 'Sub-link not found' }, { status: 404 })
  // Resolve the chosen key through key-merges so a stale/merged candidate still
  // lands on the canonical identity rather than a dead key.
  const resolveKey = await loadKeyResolver(supabase)
  const targetKey = resolveKey(player_key)
  const action = row.status === 'linked' ? 'relink' : 'link'
  const updated = await applyLink(supabase, row, targetKey, player_name, false, action, performedBy)
  return NextResponse.json({ success: true, gamesUpdated: updated })
}

/** Revert a link: restore the slug key on the affected games rows. */
async function handleUnlink(supabase: any, body: any, performedBy: string) {
  const { slug_key } = body
  if (!slug_key) return NextResponse.json({ error: 'slug_key required' }, { status: 400 })
  const { data: row } = await supabase.from('player_sub_links').select('*').eq('slug_key', slug_key).single()
  if (!row) return NextResponse.json({ error: 'Sub-link not found' }, { status: 404 })
  if (row.status !== 'linked' || !row.linked_player_key) {
    return NextResponse.json({ error: 'Not currently linked' }, { status: 400 })
  }

  const currentKey = row.linked_player_key as string
  const refs: GameRef[] = row.game_refs || []
  const updated = await rewriteRefs(supabase, refs, currentKey, slug_key)

  await supabase
    .from('player_sub_links')
    .update({
      linked_player_key: null,
      linked_player_name: null,
      status: (row.candidates || []).length === 0 ? 'no_match' : 'unlinked',
      auto: false,
      updated_at: new Date().toISOString(),
      updated_by: performedBy,
    })
    .eq('slug_key', slug_key)

  await logAction(supabase, {
    slug_key, sub_name: row.sub_name, action: 'unlink',
    from_player_key: currentKey, from_player_name: row.linked_player_name,
    to_player_key: null, to_player_name: null, games_updated: updated, performed_by: performedBy,
  })

  return NextResponse.json({ success: true, gamesUpdated: updated })
}

// ---------------------------------------------------------------------------

/**
 * Apply a link (or relink) by rewriting each affected games row's player key
 * from its current value (slug key, or the previous linked key when relinking)
 * to the target key. Preserves the "(sub)" name. Returns rows updated.
 */
async function applyLink(
  supabase: any, row: any, targetKey: string, targetName: string,
  auto: boolean, action: string, performedBy: string
): Promise<number> {
  const currentKey = (row.linked_player_key as string) || (row.slug_key as string)
  const refs: GameRef[] = row.game_refs || []
  const updated = await rewriteRefs(supabase, refs, currentKey, targetKey)

  await supabase
    .from('player_sub_links')
    .update({
      linked_player_key: targetKey,
      linked_player_name: targetName,
      status: 'linked',
      auto,
      updated_at: new Date().toISOString(),
      updated_by: performedBy,
    })
    .eq('slug_key', row.slug_key)

  await logAction(supabase, {
    slug_key: row.slug_key, sub_name: row.sub_name, action,
    from_player_key: row.linked_player_key || row.slug_key, from_player_name: row.linked_player_name,
    to_player_key: targetKey, to_player_name: targetName, games_updated: updated, performed_by: performedBy,
  })

  return updated
}

/** Rewrite a set of (id,pos) refs from one key to another, guarded on the current key. */
async function rewriteRefs(supabase: any, refs: GameRef[], fromKey: string, toKey: string): Promise<number> {
  let updated = 0
  for (const ref of refs) {
    const col = `player_${ref.pos}_key`
    const { data } = await supabase
      .from('games')
      .update({ [col]: toKey })
      .eq('id', ref.id)
      .eq(col, fromKey)
      .select('id')
    updated += data?.length || 0
  }
  return updated
}

async function logAction(supabase: any, entry: Record<string, any>) {
  try {
    await supabase.from('player_sub_link_log').insert(entry)
  } catch (e) {
    console.error('Failed to write sub-link log:', e)
  }
}

function summarize(rows: any[]) {
  let linked = 0, unlinked = 0, no_match = 0, autoLinkable = 0
  for (const r of rows) {
    if (r.status === 'linked') linked++
    else if (r.status === 'no_match') no_match++
    else {
      unlinked++
      if ((r.candidates || []).length === 1) autoLinkable++
    }
  }
  return { linked, unlinked, no_match, autoLinkable }
}
