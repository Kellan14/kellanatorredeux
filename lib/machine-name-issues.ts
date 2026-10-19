import { fetchAllRecords } from '@/lib/supabase'
import {
  getMachineCanon,
  invalidateMachineCanon,
  normalizeMachineName,
  resolveWithIndex,
} from '@/lib/machines-canon'
import { loadMnpMachines } from '@/lib/manage-machine-canon'
import { fetchMNPData } from '@/lib/fetch-mnp-data'

/**
 * Scanner for the machine canon, mirroring lib/player-name-issues.ts.
 *
 * Two questions it answers:
 *   1. Does anything stored in the database fail to be a canon key?
 *   2. Has the upstream MNP canon drifted from what we hold?
 *
 * Nothing here mutates. Findings are cached in machine_name_issues and read by
 * the Options dialog and its badge, the same way name issues are.
 */

export type MachineIssueType =
  /** stored value differs from a canon key only by case/whitespace */
  | 'case'
  /** stored value is a canon long form where the key belongs */
  | 'long_form'
  /** stored value resolves only through machine_aliases — fine, but worth seeing */
  | 'alias'
  /** stored value resolves to nothing; needs a canon row or an alias */
  | 'unmapped'
  /** MNP publishes a machine we do not have */
  | 'upstream_added'
  /** MNP changed the long form of a machine we hold */
  | 'upstream_changed'

export interface MachineIssue {
  raw_value: string
  table_name: string
  column_name: string
  occurrences: number
  issue_type: MachineIssueType
  suggested_key: string | null
  confidence: 'exact' | 'likely' | 'unknown'
  seasons: string | null
  venues: string | null
}

/**
 * Tables holding a machine name.
 *
 * `derived` tables are rebuilt from games rather than authored, and they store
 * the canon key case-folded on purpose — so for those only a value that cannot
 * be resolved at all is worth reporting. Reporting case there would bury the
 * real findings under a thousand entries that are working as intended.
 */
const SCANNED: {
  table: string
  column: string
  withContext?: boolean
  derived?: boolean
}[] = [
  { table: 'games', column: 'machine', withContext: true },
  { table: 'score_limits', column: 'machine' },
  { table: 'user_machine_scores', column: 'machine' },
  { table: 'user_machine_inputs', column: 'machine' },
  { table: 'cache_player_machine_stats', column: 'machine', derived: true },
  { table: 'cache_team_machine_stats', column: 'machine', derived: true },
  { table: 'cache_machine_top_scores', column: 'machine', derived: true },
  { table: 'cache_team_pick_games', column: 'machine', derived: true },
  { table: 'custom_backglass_images', column: 'machine_key' },
]

function rangeLabel(values: number[]): string | null {
  const nums = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (nums.length === 0) return null
  const lo = nums[0]
  const hi = nums[nums.length - 1]
  return lo === hi ? `s${lo}` : `s${lo}-${hi}`
}

export async function computeMachineIssues(
  supabase: any,
): Promise<MachineIssue[]> {
  const index = await getMachineCanon()
  const issues: MachineIssue[] = []

  // Canon long forms, for telling "stored the long form" apart from "stored an alias".
  const longForms = new Set<string>()
  for (const m of Array.from(index.byKey.values()))
    longForms.add(normalizeMachineName(m.name))

  for (const { table, column, withContext, derived } of SCANNED) {
    let rows: any[] = []
    try {
      // Order by the machine column, not id: score_limits has no id, and
      // user_machine_scores keys on a uuid. Every scanned table has this column.
      rows = await fetchAllRecords<any>(() =>
        supabase
          .from(table)
          .select(withContext ? `${column}, season, venue` : column)
          .order(column, { ascending: true }),
      )
    } catch (error: any) {
      if (error.code === 'PGRST205' || error.code === '42P01') continue
      throw new Error(`Could not scan ${table}: ${error.message}`)
    }

    // Group by raw value so one bad spelling is one issue, not one per row.
    const groups = new Map<
      string,
      { n: number; seasons: number[]; venues: Set<string> }
    >()
    for (const r of rows) {
      const raw = r?.[column]
      if (!raw) continue
      if (!groups.has(raw))
        groups.set(raw, { n: 0, seasons: [], venues: new Set() })
      const g = groups.get(raw)!
      g.n++
      if (withContext) {
        if (typeof r.season === 'number') g.seasons.push(r.season)
        if (r.venue) g.venues.add(r.venue)
      }
    }

    for (const [raw, g] of Array.from(groups.entries())) {
      // A value that IS a canon key is correct; nothing to report.
      if (index.byKey.has(raw)) continue

      const resolved = resolveWithIndex(index, raw)
      const norm = normalizeMachineName(raw)

      // Derived tables legitimately hold the case-folded key.
      if (derived && resolved) continue

      let issue_type: MachineIssueType
      let confidence: MachineIssue['confidence']
      if (!resolved) {
        issue_type = 'unmapped'
        confidence = 'unknown'
      } else if (normalizeMachineName(resolved) === norm) {
        issue_type = 'case'
        confidence = 'exact'
      } else if (longForms.has(norm)) {
        issue_type = 'long_form'
        confidence = 'exact'
      } else {
        issue_type = 'alias'
        confidence = 'likely'
      }

      issues.push({
        raw_value: raw,
        table_name: table,
        column_name: column,
        occurrences: g.n,
        issue_type,
        suggested_key: resolved,
        confidence,
        seasons: withContext ? rangeLabel(g.seasons) : null,
        venues:
          withContext && g.venues.size > 0
            ? Array.from(g.venues).sort().join(', ')
            : null,
      })
    }
  }

  // A newly installed machine may have venue entries before its first game.
  const { data: overrides, error: overrideError } = await supabase
    .from('venue_machine_lists')
    .select('venue_name,included,excluded')
  if (overrideError) throw overrideError
  for (const column of ['included', 'excluded']) {
    const grouped = new Map<string, { n: number; venues: Set<string> }>()
    for (const row of overrides || [])
      for (const raw of row[column] || []) {
        if (resolveWithIndex(index, raw)) continue
        const group = grouped.get(raw) || { n: 0, venues: new Set<string>() }
        group.n++
        group.venues.add(row.venue_name)
        grouped.set(raw, group)
      }
    for (const [raw, group] of Array.from(grouped.entries()))
      issues.push({
        raw_value: raw,
        table_name: 'venue_machine_lists',
        column_name: column,
        occurrences: group.n,
        issue_type: 'unmapped',
        suggested_key: null,
        confidence: 'unknown',
        seasons: null,
        venues: Array.from(group.venues).sort().join(', '),
      })
  }
  const venueNames = new Map<string, Set<string>>()
  const upstreamVenues = Object.values(await fetchMNPData('venues.json', { fresh: true })) as Array<{name:string;machines?:string[]}>
  for (const venue of upstreamVenues) for (const raw of venue.machines || []) {
    if (resolveWithIndex(index,raw)) continue
    const names = venueNames.get(raw) || new Set<string>()
    names.add(venue.name); venueNames.set(raw,names)
  }
  for (const [raw,names] of Array.from(venueNames.entries())) issues.push({
    raw_value:raw,table_name:'mnp_venues',column_name:'machines',occurrences:names.size,
    issue_type:'unmapped',suggested_key:null,confidence:'unknown',seasons:null,venues:Array.from(names).sort().join(', '),
  })
  issues.push(...(await computeUpstreamDrift(supabase, index)))

  // Actionable first: unmapped, then the rest by how much data they affect.
  const rank: Record<MachineIssueType, number> = {
    unmapped: 0,
    upstream_added: 1,
    upstream_changed: 2,
    long_form: 3,
    case: 4,
    alias: 5,
  }
  issues.sort((a, b) => {
    if (rank[a.issue_type] !== rank[b.issue_type])
      return rank[a.issue_type] - rank[b.issue_type]
    return b.occurrences - a.occurrences
  })
  return issues
}

/**
 * Compare the stored MNP rows against machines.json. Local rows are ignored —
 * they exist precisely because upstream does not list them.
 */
async function computeUpstreamDrift(
  supabase: any,
  index: Awaited<ReturnType<typeof getMachineCanon>>,
): Promise<MachineIssue[]> {
  let upstream: { key: string; name: string }[]
  try {
    upstream = await loadMnpMachines(true)
  } catch {
    throw new Error('Could not compare the canon against current MNP data; previous scan retained')
  }

  const { data: stored } = await supabase
    .from('machine_canon')
    .select('key, name, source, mnp_key, mnp_name')
  const byMnpKey = new Map<string, any>()
  for (const r of stored || []) {
    if (r.source === 'mnp') byMnpKey.set(r.mnp_key ?? r.key, r)
  }

  const out: MachineIssue[] = []
  for (const m of upstream) {
    const row = byMnpKey.get(m.key)
    if (!row) {
      out.push({
        raw_value: `${m.key} — ${m.name}`,
        table_name: 'machine_canon',
        column_name: 'key',
        occurrences: 0,
        issue_type: 'upstream_added',
        suggested_key: m.key,
        confidence: 'exact',
        seasons: null,
        venues: null,
      })
    } else if ((row.mnp_name ?? row.name) !== m.name) {
      out.push({
        raw_value: `${m.key}: "${row.mnp_name ?? row.name}" → "${m.name}"`,
        table_name: 'machine_canon',
        column_name: 'name',
        occurrences: 0,
        issue_type: 'upstream_changed',
        suggested_key: row.key,
        confidence: 'exact',
        seasons: null,
        venues: null,
      })
    }
  }
  return out
}

/** Recompute and replace the cached scan. Returns the fresh findings. */
export async function refreshMachineIssues(
  supabase: any,
): Promise<MachineIssue[]> {
  invalidateMachineCanon()
  const issues = await computeMachineIssues(supabase)
  await supabase.from('machine_name_issues').delete().gte('id', 0)
  if (issues.length > 0) {
    for (let i = 0; i < issues.length; i += 500) {
      const { error } = await supabase
        .from('machine_name_issues')
        .insert(
          issues
            .slice(i, i + 500)
            .map((x) => ({ ...x, scanned_at: new Date().toISOString() })),
        )
      if (error) console.error('[machine-name-issues] insert:', error.message)
    }
  }
  return issues
}
