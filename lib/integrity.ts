import { fetchAllRecords } from '@/lib/supabase'
import { applyNameMappings } from '@/lib/apply-name-mappings'
import { applySubLinks } from '@/lib/apply-sub-links'
import { applyAndTrackKeyMapping } from '@/lib/apply-key-mappings'

const ARCHIVE_API = 'https://api.github.com/repos/Invader-Zim/mnp-data-archive/contents'

export interface HealResult {
  healedNames: number
  healedKeys: number
  healedSubLinks: number
}

export type CoverageSource = 'archive' | 'reference' | 'none'

export interface SeasonCoverage {
  season: number
  source: CoverageSource // where this season is validated from
  dbCount: number
  refCount: number // matches in the source (archive or reference)
  missing: string[] // in source, not in DB
  orphan: string[] // in DB matches, not in source
  gameless: string[] // in DB matches but with 0 games (forfeits/byes) — informational
  unverified?: boolean // no source available (e.g. season 13)
}

export interface CoverageResult {
  seasons: SeasonCoverage[]
  duplicateGames: { match_key: string; round_number: number; game_number: number; count: number }[]
  missingTotal: number
  orphanTotal: number
  gamelessTotal: number
}

/** Lowest season the sync/GitHub archive covers. Below this, use the reference. */
const ARCHIVE_MIN_SEASON = 14

interface DbMatch { match_key: string; week: number | null; home_team: string | null; away_team: string | null }
interface RefKey { week: number | null; home_team: string | null; away_team: string | null }

/** Natural key for reference reconciliation (legacy match_keys are irregular). */
function naturalKey(m: { week: number | null; home_team: string | null; away_team: string | null }): string {
  return `${m.week ?? ''}|${(m.home_team ?? '').trim()}|${(m.away_team ?? '').trim()}`
}
function naturalLabel(m: RefKey): string {
  return `wk${m.week ?? '?'} ${m.home_team ?? '?'} vs ${m.away_team ?? '?'}`
}

/** Re-apply every recorded edit so the DB reflects our history. Idempotent. */
export async function healEdits(supabase: any): Promise<HealResult> {
  const healedNames = await applyNameMappings(supabase)

  let healedKeys = 0
  try {
    const { data: keyMaps } = await supabase.from('player_key_mappings').select('from_key, to_key')
    for (const km of keyMaps || []) {
      healedKeys += await applyAndTrackKeyMapping(supabase, km.from_key, km.to_key)
    }
  } catch { /* table may be absent */ }

  const healedSubLinks = await applySubLinks(supabase)

  return { healedNames, healedKeys, healedSubLinks }
}

/** List archive match keys for a season (filename minus .json), or null if the
 *  season folder isn't in the archive repo. */
async function archiveMatchKeys(season: number): Promise<string[] | null> {
  try {
    const res = await fetch(`${ARCHIVE_API}/season-${season}/matches`, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github.v3+json' },
    })
    if (!res.ok) return null
    const files = await res.json()
    if (!Array.isArray(files)) return null
    return files
      .filter((f: any) => typeof f.name === 'string' && f.name.endsWith('.json'))
      .map((f: any) => f.name.replace(/\.json$/, ''))
  } catch {
    return null
  }
}

/**
 * Reconcile DB match coverage per season against the best available source:
 *   - seasons >= 14  → the GitHub archive (by match_key)
 *   - seasons 2-12   → the mnp_reference_games table (by natural key, since
 *                      legacy match_keys are irregular)
 *   - otherwise (e.g. season 13) → no source, reported as `unverified`.
 * Match existence is checked against the `matches` table (NOT games), so
 * forfeit/bye matches that legitimately have no games are reported as
 * `gameless` (informational) rather than falsely "missing".
 */
export async function checkCoverage(supabase: any, seasons: number[]): Promise<CoverageResult> {
  const result: CoverageResult = { seasons: [], duplicateGames: [], missingTotal: 0, orphanTotal: 0, gamelessTotal: 0 }

  for (const season of seasons) {
    // DB matches for this season (authoritative "the DB has this match").
    const dbMatches = await fetchAllRecords<DbMatch>(
      () => supabase.from('matches').select('match_key, week, home_team, away_team').eq('season', season).order('id', { ascending: true })
    )
    const dbMatchKeys = new Set<string>()
    const dbNatural = new Set<string>()
    for (const m of dbMatches) {
      if (m.match_key) dbMatchKeys.add(m.match_key)
      dbNatural.add(naturalKey(m))
    }

    // Games: which match_keys have games (for gameless) + duplicate detection.
    const gameRows = await fetchAllRecords<{ match_key: string; round_number: number; game_number: number }>(
      () => supabase.from('games').select('match_key, round_number, game_number').eq('season', season).order('id', { ascending: true })
    )
    const keysWithGames = new Set<string>()
    const gameSeen = new Map<string, number>()
    for (const r of gameRows) {
      if (r.match_key) keysWithGames.add(r.match_key)
      const gk = `${r.match_key}|${r.round_number}|${r.game_number}`
      gameSeen.set(gk, (gameSeen.get(gk) || 0) + 1)
    }
    Array.from(gameSeen.entries()).forEach(([gk, count]) => {
      if (count > 1) {
        const [match_key, round_number, game_number] = gk.split('|')
        result.duplicateGames.push({ match_key, round_number: +round_number, game_number: +game_number, count })
      }
    })

    // Matches present in the DB but with no games — forfeits/byes (informational).
    const gameless = Array.from(dbMatchKeys).filter((k) => !keysWithGames.has(k))

    let source: CoverageSource
    let refCount = 0
    let missing: string[] = []
    let orphan: string[] = []
    let unverified = false

    const archiveKeys = season >= ARCHIVE_MIN_SEASON ? await archiveMatchKeys(season) : null
    if (archiveKeys !== null) {
      source = 'archive'
      refCount = archiveKeys.length
      const archiveSet = new Set(archiveKeys)
      missing = archiveKeys.filter((k) => !dbMatchKeys.has(k))
      orphan = Array.from(dbMatchKeys).filter((k) => !archiveSet.has(k))
    } else {
      const refKeys = await referenceKeys(supabase, season)
      if (refKeys !== null) {
        source = 'reference'
        refCount = refKeys.size
        missing = Array.from(refKeys.values())
          .filter((r) => !dbNatural.has(naturalKey(r)))
          .map(naturalLabel)
        const refSet = new Set(Array.from(refKeys.values()).map(naturalKey))
        orphan = dbMatches.filter((m) => !refSet.has(naturalKey(m))).map(naturalLabel)
      } else {
        source = 'none'
        unverified = true
      }
    }

    result.missingTotal += missing.length
    result.orphanTotal += orphan.length
    result.gamelessTotal += gameless.length
    result.seasons.push({ season, source, dbCount: dbMatchKeys.size, refCount, missing, orphan, gameless, unverified })
  }

  return result
}

/** Distinct reference matches for a season (natural keys), or null if the
 *  reference table has no rows for that season. */
async function referenceKeys(supabase: any, season: number): Promise<Map<string, RefKey> | null> {
  const rows = await fetchAllRecords<RefKey>(
    () => supabase.from('mnp_reference_games').select('week, home_team, away_team').eq('season', season).order('id', { ascending: true })
  )
  if (!rows || rows.length === 0) return null
  const map = new Map<string, RefKey>()
  for (const r of rows) map.set(naturalKey(r), { week: r.week, home_team: r.home_team, away_team: r.away_team })
  return map
}

/** Seasons present in the games table (min..max). */
export async function getDbSeasons(supabase: any): Promise<number[]> {
  const { data: maxRow } = await supabase.from('games').select('season').order('season', { ascending: false }).limit(1)
  const { data: minRow } = await supabase.from('games').select('season').order('season', { ascending: true }).limit(1)
  const max = maxRow?.[0]?.season ?? 0
  const min = minRow?.[0]?.season ?? max
  const seasons: number[] = []
  for (let s = min; s <= max; s++) seasons.push(s)
  return seasons
}
