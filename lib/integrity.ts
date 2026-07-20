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

export interface SeasonCoverage {
  season: number
  dbCount: number
  archiveCount: number
  missing: string[] // in archive, not in DB
  orphan: string[] // in DB, not in archive
  skipped?: boolean // season not present in the archive repo
}

export interface CoverageResult {
  seasons: SeasonCoverage[]
  duplicateGames: { match_key: string; round_number: number; game_number: number; count: number }[]
  missingTotal: number
  orphanTotal: number
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

/** Compare DB match coverage against the GitHub archive for the given seasons. */
export async function checkArchiveCoverage(supabase: any, seasons: number[]): Promise<CoverageResult> {
  const result: CoverageResult = { seasons: [], duplicateGames: [], missingTotal: 0, orphanTotal: 0 }

  for (const season of seasons) {
    // DB match keys + per-(match,round,game) counts for duplicate detection.
    const rows = await fetchAllRecords<{ match_key: string; round_number: number; game_number: number }>(
      () => supabase
        .from('games')
        .select('match_key, round_number, game_number')
        .eq('season', season)
        .order('id', { ascending: true })
    )
    const dbKeys = new Set<string>()
    const gameSeen = new Map<string, number>()
    for (const r of rows) {
      if (r.match_key) dbKeys.add(r.match_key)
      const gk = `${r.match_key}|${r.round_number}|${r.game_number}`
      gameSeen.set(gk, (gameSeen.get(gk) || 0) + 1)
    }
    Array.from(gameSeen.entries()).forEach(([gk, count]) => {
      if (count > 1) {
        const [match_key, round_number, game_number] = gk.split('|')
        result.duplicateGames.push({ match_key, round_number: +round_number, game_number: +game_number, count })
      }
    })

    const archiveKeys = await archiveMatchKeys(season)
    if (archiveKeys === null) {
      result.seasons.push({ season, dbCount: dbKeys.size, archiveCount: 0, missing: [], orphan: [], skipped: true })
      continue
    }
    const archiveSet = new Set(archiveKeys)
    const missing = archiveKeys.filter((k) => !dbKeys.has(k))
    const orphan = Array.from(dbKeys).filter((k) => !archiveSet.has(k))
    result.missingTotal += missing.length
    result.orphanTotal += orphan.length
    result.seasons.push({ season, dbCount: dbKeys.size, archiveCount: archiveKeys.length, missing, orphan })
  }

  return result
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
