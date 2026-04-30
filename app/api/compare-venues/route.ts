import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { fetchMNPData } from '@/lib/fetch-mnp-data'
import { applyVenueMachineListOverrides } from '@/lib/venue-machine-lists'
import { getAllMachineVariations } from '@/lib/machine-mappings'

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
 *   - venues       (required): comma-separated venue names. Need >= 2.
 *   - seasonStart  (optional, default 20)
 *   - seasonEnd    (optional, default 23)
 *   - topN         (optional, default 3) — how many top scores per cell
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const venuesParam = searchParams.get('venues')
    const seasonStart = parseInt(searchParams.get('seasonStart') || '20')
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '23')
    const topN = Math.max(1, Math.min(10, parseInt(searchParams.get('topN') || '3')))

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

    // 4. Pull per-(team, machine, venue) totals to derive venueAvg per cell.
    //    Summed across teams matches how /api/player-analysis builds its
    //    venue baseline (so percentages here match the rest of the app).
    const { data: teamStatsRows } = await supabase
      .from('cache_team_machine_stats' as any)
      .select('machine, venue, total_score, game_count')
      .in('machine', allMachineVars)
      .in('venue', allVenueVariations)
      .eq('season_start', seasonStart)
      .eq('season_end', seasonEnd) as { data: Array<{
        machine: string; venue: string | null; total_score: number; game_count: number
      }> | null }

    const venueAvgByMV = new Map<string /* `${canonicalMachine}|${canonicalVenue}` */, { total: number; count: number }>()
    for (const r of teamStatsRows || []) {
      if (!r.venue) continue
      const canonicalMachine = variationToCanonicalMachine.get(r.machine.toLowerCase())
      const canonicalVenue = variationToCanonicalVenue.get(r.venue)
      if (!canonicalMachine || !canonicalVenue) continue
      const key = `${canonicalMachine}|${canonicalVenue}`
      const existing = venueAvgByMV.get(key) || { total: 0, count: 0 }
      existing.total += Number(r.total_score)
      existing.count += Number(r.game_count)
      venueAvgByMV.set(key, existing)
    }

    // 5. Pull top-N scores per (machine, venue) — season IS NULL row gives
    //    the all-time top for the cron's stored season range. cache stores
    //    rank 1-10, so we just trim to topN here.
    const { data: topScoreRows } = await supabase
      .from('cache_machine_top_scores' as any)
      .select('machine, venue, rank, player_name, team_key, score, match_key, week')
      .in('machine', allMachineVars)
      .in('venue', allVenueVariations)
      .is('season', null)
      .lte('rank', topN)
      .order('rank', { ascending: true }) as { data: Array<{
        machine: string; venue: string; rank: number; player_name: string;
        team_key: string | null; score: number; match_key: string | null; week: number | null;
      }> | null }

    const topScoresByMV = new Map<string, Array<{
      rank: number; player: string; team_key: string | null; score: number; matchKey: string | null
    }>>()
    for (const r of topScoreRows || []) {
      const canonicalMachine = variationToCanonicalMachine.get(r.machine.toLowerCase())
      const canonicalVenue = variationToCanonicalVenue.get(r.venue)
      if (!canonicalMachine || !canonicalVenue) continue
      const key = `${canonicalMachine}|${canonicalVenue}`
      if (!topScoresByMV.has(key)) topScoresByMV.set(key, [])
      topScoresByMV.get(key)!.push({
        rank: r.rank,
        player: r.player_name,
        team_key: r.team_key,
        score: Number(r.score),
        matchKey: r.match_key,
      })
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
        const baseline = venueAvgByMV.get(`${machine}|${venue}`)
        const venueAvg = baseline && baseline.count > 0 ? baseline.total / baseline.count : 0
        const gameCount = baseline?.count || 0
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
