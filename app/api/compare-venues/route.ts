import { NextRequest, NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { fetchMNPData } from '@/lib/fetch-mnp-data'
import { applyVenueMachineListOverrides } from '@/lib/venue-machine-lists'
import { getAllMachineVariations } from '@/lib/machine-mappings'
import { getScoreLimits, isScoreValid } from '@/lib/score-limits'

export const dynamic = 'force-dynamic'
// Modest cache — venues + machine lists change rarely; underlying cache
// tables refresh nightly via the sync-data cron.
export const revalidate = 3600

/**
 * Compare a set of venues machine-by-machine.
 *
 * Returns the intersection of machines that appear at every selected venue
 * (after venue-machine-list overrides), and for each (machine, venue) pair
 * surfaces:
 *   - venueAvg + gameCount, sourced from cache_team_machine_stats summed
 *     across teams.
 *   - top N scores + their player/season/match, sourced from
 *     cache_machine_top_scores (season IS NULL = all-time top within the
 *     stored season range).
 *
 * Query params:
 *   - venues        (required): comma-separated venue names. Need >= 2.
 *   - seasonStart   (optional, default 20)
 *   - seasonEnd     (optional, default 23)
 *   - topN          (optional, default 3) — how many top scores per cell
 *   - rosterPlayers (optional): comma-separated names; when present,
 *                   venue averages and top scores are restricted to
 *                   scores by these players (e.g. TWC's current roster).
 *   - metric        (optional, default 'mean'): 'mean' | 'median' | 'trimmed'.
 *                   'trimmed' drops the top + bottom 10% before averaging
 *                   (so the middle 80% defines the value). Median is
 *                   recommended for outlier resistance — pinball scores
 *                   are heavily right-skewed.
 *
 * Cache fast path: used when no roster filter and metric=mean. Otherwise
 * falls back to a live games scan so we have raw scores to filter or
 * compute median/trimmed-mean over.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const venuesParam = searchParams.get('venues')
    const seasonStart = parseInt(searchParams.get('seasonStart') || '20')
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '23')
    const topN = Math.max(1, Math.min(10, parseInt(searchParams.get('topN') || '3')))
    const rosterParam = searchParams.get('rosterPlayers')
    const rosterPlayers = rosterParam
      ? rosterParam.split(',').map(s => s.trim()).filter(Boolean)
      : null
    const metric = (searchParams.get('metric') || 'mean') as 'mean' | 'median' | 'trimmed'
    const liveMode = !!rosterPlayers || metric !== 'mean'

    if (!venuesParam) {
      return NextResponse.json({ error: 'venues param is required (comma-separated)' }, { status: 400 })
    }
    const venues = venuesParam.split(',').map(v => v.trim()).filter(Boolean)
    if (venues.length < 2) {
      return NextResponse.json({ error: 'select at least two venues' }, { status: 400 })
    }

    // 1. Resolve each venue's current machine list (with the same overrides
    //    /api/venues applies). Intersect to find shared machines.
    const venuesObj = await fetchMNPData('venues.json')
    const allVenues = Object.values(venuesObj as Record<string, any>)
    const venueMachineLists = await Promise.all(
      venues.map(async (name) => {
        const v = allVenues.find((x: any) => x.name === name)
        const raw = v?.machines || []
        const machines = await applyVenueMachineListOverrides(name, raw)
        return { name, machines }
      })
    )

    // Intersect machine lists, case-insensitive. Use the casing from the
    // first venue's list as the canonical name for downstream queries.
    const lowerSets = venueMachineLists.map(v => new Set(v.machines.map((m: string) => m.toLowerCase())))
    const sharedLower = Array.from(lowerSets[0]).filter(m => lowerSets.every(s => s.has(m)))
    const firstVenueOrder = venueMachineLists[0].machines as string[]
    const sharedMachines = firstVenueOrder
      .filter(m => sharedLower.includes(m.toLowerCase()))
      .sort((a, b) => a.localeCompare(b))

    if (sharedMachines.length === 0) {
      return NextResponse.json({
        venues,
        seasonStart,
        seasonEnd,
        sharedMachines: [],
        rows: [],
      })
    }

    // 2. Build venue-name variation lookup. The cache stores venue names as
    //    written (e.g. "Ice Box" vs "Icebox"); normalize all variations to
    //    the requested name so downstream code can key by user's selection.
    const { getVenueVariations } = await import('@/lib/venue-mappings')
    const variationToCanonicalVenue = new Map<string, string>()
    const allVenueVariations: string[] = []
    for (const name of venues) {
      for (const variation of getVenueVariations(name)) {
        variationToCanonicalVenue.set(variation, name)
        if (!allVenueVariations.includes(variation)) allVenueVariations.push(variation)
      }
    }

    // 3. Build machine variation lookup so cache rows match the canonical
    //    venues.json name even if stored under an alias.
    const allMachineVars = getAllMachineVariations(sharedMachines).map(v => v.toLowerCase())
    const variationToCanonicalMachine = new Map<string, string>()
    for (const machine of sharedMachines) {
      for (const v of getAllMachineVariations([machine])) {
        variationToCanonicalMachine.set(v.toLowerCase(), machine)
      }
    }

    // 4. Build per-(machine, venue) maps. Two paths:
    //    a) Cache fast path — Mean only, no roster filter, when
    //       cache_team_machine_stats has rows for the *exact* requested
    //       (season_start, season_end). Top scores still come from a small
    //       live query (the cron's top-scores cache doesn't honor score
    //       limits the same way and was missing rows).
    //    b) Live fallback — for non-mean metrics, roster filtering, or
    //       when (a) returns nothing. Pulls raw scores and aggregates
    //       in memory; supports every metric.
    const valueByMV = new Map<string /* `${canonicalMachine}|${canonicalVenue}` */, { value: number; gameCount: number }>()
    const topScoresByMV = new Map<string, Array<{
      rank: number; player: string; team_key: string | null; score: number; matchKey: string | null
    }>>()
    const scoresByMV = new Map<string, number[]>()
    let usedCache = false

    // (a) Cache fast path
    if (metric === 'mean' && !rosterPlayers) {
      const { data: teamStatsRows } = await supabase
        .from('cache_team_machine_stats' as any)
        .select('machine, venue, total_score, game_count')
        .in('machine', allMachineVars)
        .in('venue', allVenueVariations)
        .eq('season_start', seasonStart)
        .eq('season_end', seasonEnd) as { data: Array<{
          machine: string; venue: string | null; total_score: number; game_count: number
        }> | null }

      if (teamStatsRows && teamStatsRows.length > 0) {
        const cacheTotals = new Map<string, { total: number; count: number }>()
        for (const r of teamStatsRows) {
          if (!r.venue) continue
          const canonicalMachine = variationToCanonicalMachine.get(r.machine.toLowerCase())
          const canonicalVenue = variationToCanonicalVenue.get(r.venue)
          if (!canonicalMachine || !canonicalVenue) continue
          const key = `${canonicalMachine}|${canonicalVenue}`
          const existing = cacheTotals.get(key) || { total: 0, count: 0 }
          existing.total += Number(r.total_score)
          existing.count += Number(r.game_count)
          cacheTotals.set(key, existing)
        }
        for (const [key, { total, count }] of Array.from(cacheTotals.entries())) {
          if (count > 0) {
            valueByMV.set(key, { value: total / count, gameCount: count })
          }
        }
        usedCache = valueByMV.size > 0
      }
    }

    // (b) Live path — used for every non-cache scenario, AND to populate
    // top scores for the cache path (the cron's top-scores cache had
    // sparse data + per-variation duplication issues).
    {
      const scoreLimits = await getScoreLimits()
      const rosterSet = rosterPlayers && rosterPlayers.length > 0
        ? new Set(rosterPlayers)
        : null

      // games.machine is stored in original case (e.g. "Tron", "POKEMON"),
      // not lowercase. Build the original-case variation set so the SQL
      // .in() actually matches; in-memory matching below does its own
      // case-fold via variationToCanonicalMachine.
      const machineFilterValues = getAllMachineVariations(sharedMachines)
      const games = await fetchAllRecords<any>(() =>
        supabase
          .from('games')
          .select('machine, venue, player_1_name, player_1_score, player_1_team, player_2_name, player_2_score, player_2_team, player_3_name, player_3_score, player_3_team, player_4_name, player_4_score, player_4_team, match_key, week')
          .in('machine', machineFilterValues)
          .in('venue', allVenueVariations)
          .gte('season', seasonStart)
          .lte('season', seasonEnd)
          .order('id', { ascending: true })
      )

      // Per-(machine, venue) aggregations. Keep raw scores (for median/
      // trimmed) AND a sorted-by-score record list (for the topN list).
      // Top scores get de-duped on (player, score, match) so a row that
      // somehow appears twice (e.g. via venue variations) only counts once.
      const recordsByMV = new Map<string, Array<{
        score: number; player: string; team_key: string | null; matchKey: string | null
      }>>()
      const dedupeByMV = new Map<string, Set<string>>()

      for (const g of games as any[]) {
        const canonicalMachine = variationToCanonicalMachine.get((g.machine || '').toLowerCase())
        const canonicalVenue = variationToCanonicalVenue.get(g.venue)
        if (!canonicalMachine || !canonicalVenue) continue
        const key = `${canonicalMachine}|${canonicalVenue}`
        for (let i = 1; i <= 4; i++) {
          const score = g[`player_${i}_score`]
          const playerName = g[`player_${i}_name`]
          if (!score || !playerName) continue
          if (!isScoreValid(canonicalMachine, score, scoreLimits)) continue
          if (rosterSet && !rosterSet.has(playerName)) continue
          const dedupeKey = `${playerName}|${score}|${g.match_key ?? ''}`
          if (!dedupeByMV.has(key)) dedupeByMV.set(key, new Set())
          if (dedupeByMV.get(key)!.has(dedupeKey)) continue
          dedupeByMV.get(key)!.add(dedupeKey)
          if (!scoresByMV.has(key)) scoresByMV.set(key, [])
          scoresByMV.get(key)!.push(score)
          if (!recordsByMV.has(key)) recordsByMV.set(key, [])
          recordsByMV.get(key)!.push({
            score,
            player: playerName,
            team_key: g[`player_${i}_team`] ?? null,
            matchKey: g.match_key ?? null,
          })
        }
      }

      // Top scores per (machine, venue): sort desc, slice topN, fresh ranks.
      for (const [mvKey, recs] of Array.from(recordsByMV.entries())) {
        const sorted = [...recs].sort((a, b) => b.score - a.score).slice(0, topN)
        topScoresByMV.set(mvKey, sorted.map((rec, idx) => ({
          rank: idx + 1,
          player: rec.player,
          team_key: rec.team_key,
          score: rec.score,
          matchKey: rec.matchKey,
        })))
      }

      // Build valueByMV with the chosen metric. gameCount stays the actual
      // number of underlying scores regardless of metric. Skip when cache
      // already populated valueByMV (mean fast path) — we'd just overwrite
      // with the same value at the cost of double work.
      if (!usedCache) for (const [key, scores] of Array.from(scoresByMV.entries())) {
        if (scores.length === 0) continue
        const sorted = [...scores].sort((a, b) => a - b)
        const n = sorted.length
        let value = 0
        if (metric === 'median') {
          value = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
        } else if (metric === 'trimmed') {
          const drop = Math.floor(n * 0.1)
          const middle = sorted.slice(drop, n - drop)
          if (middle.length === 0) continue
          value = middle.reduce((s, x) => s + x, 0) / middle.length
        } else {
          // mean (live, with roster filter applied to scores)
          value = sorted.reduce((s, x) => s + x, 0) / n
        }
        valueByMV.set(key, { value, gameCount: n })
      }

      // Top-N scores: sort desc, take topN.
      for (const [key, recs] of Array.from(recordsByMV.entries())) {
        const sorted = [...recs].sort((a, b) => b.score - a.score).slice(0, topN)
        topScoresByMV.set(key, sorted.map((r, idx) => ({
          rank: idx + 1,
          player: r.player,
          team_key: r.team_key,
          score: r.score,
          matchKey: r.matchKey,
        })))
      }
    }

    // 6. Assemble rows. Each shared machine gets a perVenue object keyed by
    //    the user's selected venue names, even if the cache stored them
    //    under variations.
    const rows = sharedMachines.map((machine) => {
      const perVenue: Record<string, {
        venueAvg: number
        gameCount: number
        topScores: Array<{ rank: number; player: string; team_key: string | null; score: number; matchKey: string | null }>
      }> = {}
      for (const venue of venues) {
        const cell = valueByMV.get(`${machine}|${venue}`)
        const venueAvg = cell?.value || 0
        const gameCount = cell?.gameCount || 0
        const topScores = (topScoresByMV.get(`${machine}|${venue}`) || [])
          .sort((a, b) => a.rank - b.rank)
          .slice(0, topN)
        perVenue[venue] = { venueAvg, gameCount, topScores }
      }
      return { machine, perVenue }
    })

    return NextResponse.json({
      venues,
      seasonStart,
      seasonEnd,
      topN,
      metric,
      rosterFiltered: !!rosterPlayers,
      // True when the venue-avg numbers came from cache_team_machine_stats
      // (Mean only, no roster filter, season range matches what the cron
      // wrote). Useful for debugging "why is X showing?". Top scores
      // always come from a live query regardless of this flag.
      usedCache,
      sharedMachines,
      rows,
    })
  } catch (error) {
    console.error('[compare-venues] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
