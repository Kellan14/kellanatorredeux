import { fetchAllRecords } from '@/lib/supabase'

/**
 * Shared detection logic for the "Standardize Player Names" scanner.
 *
 * Two kinds of name inconsistency are surfaced (see the plan / DB findings):
 *  - `case`      Same person (one player_key) recorded under >1 raw spelling
 *                that collapses to one normalized name — capitalization,
 *                trailing/collapsed whitespace, punctuation, or typos.
 *                Safe to auto-fix via a non-destructive player_name_mappings row.
 *  - `split_key` One normalized name spanning >1 player_key. Usually the SAME
 *                person assigned a different key in older seasons, but it can
 *                also be two genuinely different people who share a name — so
 *                these are surfaced for human review, never auto-merged.
 *
 * Detection is mapping-aware: a group already reconciled by existing
 * player_name_mappings rows is not reported (this is what fixes the old
 * "found 13 / already fixed" contradiction). `(sub)` names are handled by the
 * separate sub-linking subsystem, not here.
 */

export type NameIssueType = 'case' | 'split_key'

export interface KeyRef {
  player_key: string
  count: number
}

export interface NameIssue {
  normalized_name: string
  variants: string[]
  suggested_canonical: string
  issue_type: NameIssueType
  /** Shared player_key when all variants belong to one key; null for split_key. */
  player_key: string | null
  /** split_key only: the distinct keys this name spans (by row count desc). */
  keys?: KeyRef[]
  /** split_key only: suggested canonical key to merge the others into. */
  canonical_key?: string | null
}

/** Normalize a raw name to the identity it should collapse to. */
export function normalizeName(name: string | null | undefined): string {
  if (!name) return ''
  return name
    .replace(/\s*\(sub\)\s*$/i, '') // drop the (sub) suffix
    .replace(/\s+/g, ' ') // collapse internal whitespace
    .trim()
    .toLowerCase()
}

/**
 * Pick the best canonical spelling from a set of variants: prefer non-`(sub)`,
 * clean whitespace (no stray leading/trailing OR doubled internal spaces),
 * Title Case, and penalize ALL CAPS.
 */
export function pickCanonical(names: string[]): string {
  const scored = names.map((name) => {
    let score = 0
    if (/\(sub\)/i.test(name)) score -= 5 // never prefer a (sub) spelling
    // Penalize any non-collapsed whitespace — leading/trailing AND internal
    // doubles ("Evan  Zynda") — so the clean spelling always wins. Otherwise a
    // doubled-space variant can become the canonical and, once whitespace is
    // normalized on save, the fix collapses into an unstorable self-map.
    if (name !== name.replace(/\s+/g, ' ').trim()) score -= 3
    const words = name.trim().split(/\s+/)
    for (const word of words) {
      if (word[0] && word[0] === word[0].toUpperCase()) score += 1 // Title Case start
      if (word.length > 1 && word === word.toUpperCase()) score -= 2 // ALL CAPS word
    }
    return { name, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0].name
}

interface Observation {
  name: string
  key: string | null
}

/**
 * Compute the current set of name issues from the identity tables
 * (player_stats + player_match_participation), excluding anything already
 * reconciled by player_name_mappings.
 */
export async function computeNameIssues(supabase: any): Promise<NameIssue[]> {
  // Existing mappings: alias -> canonical. Used to exclude reconciled groups.
  const mappingMap = new Map<string, string>()
  try {
    const { data: mappings } = await supabase
      .from('player_name_mappings')
      .select('alias, canonical_name')
    for (const m of mappings || []) {
      mappingMap.set(m.alias, m.canonical_name)
    }
  } catch {
    /* mappings table may be empty/absent; treat as no mappings */
  }

  // Gather (name, key) observations from the identity tables.
  const observations: Observation[] = []
  const psRows = await fetchAllRecords<{ player_name: string | null; player_key: string | null }>(
    () => supabase.from('player_stats').select('player_name, player_key').order('id', { ascending: true })
  )
  for (const r of psRows) {
    if (r.player_name) observations.push({ name: r.player_name, key: r.player_key ?? null })
  }
  const pmpRows = await fetchAllRecords<{ player_name: string | null; player_key: string | null }>(
    () => supabase.from('player_match_participation').select('player_name, player_key').order('id', { ascending: true })
  )
  for (const r of pmpRows) {
    if (r.player_name) observations.push({ name: r.player_name, key: r.player_key ?? null })
  }

  // Group by normalized name, counting rows per key.
  const groups = new Map<string, { names: Set<string>; keyCounts: Map<string, number> }>()
  for (const obs of observations) {
    const norm = normalizeName(obs.name)
    if (!norm) continue
    if (!groups.has(norm)) groups.set(norm, { names: new Set(), keyCounts: new Map() })
    const g = groups.get(norm)!
    g.names.add(obs.name)
    if (obs.key) g.keyCounts.set(obs.key, (g.keyCounts.get(obs.key) || 0) + 1)
  }

  const issues: NameIssue[] = []
  Array.from(groups.entries()).forEach(([norm, g]) => {
    const variants = Array.from(g.names)
    const keys = Array.from(g.keyCounts.keys())
    const canonical = pickCanonical(variants)

    if (keys.length > 1) {
      // Same normalized name across multiple keys → needs human review.
      // Rank keys by row count so the most-used key is the merge target.
      const keyRefs: KeyRef[] = Array.from(g.keyCounts.entries())
        .map(([player_key, count]) => ({ player_key, count }))
        .sort((a, b) => b.count - a.count)
      issues.push({
        normalized_name: norm,
        variants,
        suggested_canonical: canonical,
        issue_type: 'split_key',
        player_key: null,
        keys: keyRefs,
        canonical_key: keyRefs[0].player_key,
      })
      return
    }

    if (variants.length > 1) {
      // One key, multiple spellings → auto-fixable, unless already reconciled.
      if (isReconciled(variants, canonical, mappingMap)) return
      issues.push({
        normalized_name: norm,
        variants,
        suggested_canonical: canonical,
        issue_type: 'case',
        player_key: keys[0] ?? null,
      })
    }
  })

  // Stable, useful ordering: actionable case issues first, then alphabetical.
  issues.sort((a, b) => {
    if (a.issue_type !== b.issue_type) return a.issue_type === 'case' ? -1 : 1
    return a.normalized_name.localeCompare(b.normalized_name)
  })
  return issues
}

/** True when every non-canonical variant already maps to the canonical name. */
function isReconciled(variants: string[], canonical: string, mappingMap: Map<string, string>): boolean {
  for (const v of variants) {
    if (v === canonical) continue
    if (mappingMap.get(v) !== canonical) return false
  }
  return true
}
