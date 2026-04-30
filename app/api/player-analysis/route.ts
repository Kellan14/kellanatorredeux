import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { getVenueVariations } from '@/lib/venue-mappings'
import { getAllMachineVariations } from '@/lib/machine-mappings'

export const dynamic = 'force-dynamic';

// Cache for 1 hour since stats only update weekly
export const revalidate = 3600

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const player = searchParams.get('player')
    const venue = searchParams.get('venue')
    const seasonStart = parseInt(searchParams.get('seasonStart') || '20')
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '22')
    // Player vs opponent venue scopes are independent. The legacy
    // `allVenues` param is still honored for back-compat — when present
    // it sets BOTH sides to the inverse. The new params override.
    const legacyAllVenues = searchParams.get('allVenues') === 'true'
    const playerVenueParam = searchParams.get('playerVenueSpecific')
    const opponentVenueParam = searchParams.get('opponentVenueSpecific')
    const playerVenueSpecific = playerVenueParam !== null
      ? playerVenueParam === 'true'
      : !legacyAllVenues
    const opponentVenueSpecific = opponentVenueParam !== null
      ? opponentVenueParam === 'true'
      : !legacyAllVenues
    // Player-side scope is what controls the existing player query/cache.
    const allVenues = !playerVenueSpecific
    // Optional opponent context: when provided, each per-machine row gets
    // oppAvg/oppPctOfVenue/edge fields so the UI can highlight where the
    // selected player has the biggest matchup edge over the opponent's
    // current roster. Mirrors how /api/machine-advantages applies the
    // opponentPlayers filter.
    const opponentTeam = searchParams.get('opponentTeam')
    const opponentPlayersParam = searchParams.get('opponentPlayers')
    const opponentPlayers = opponentPlayersParam
      ? opponentPlayersParam.split(',').map(p => p.trim()).filter(Boolean)
      : []

    if (!player) {
      return NextResponse.json(
        { error: 'Player parameter is required' },
        { status: 400 }
      )
    }

    /**
     * For each machine in `rows`, compute the opponent roster's
     * per-game-normalized pctOfVenue, plus oppAvg / edge / oppGamesPlayed.
     * No-ops when no opponent context was supplied.
     *
     * Per-game-normalized means each opponent game's score is judged
     * against the venue average for THAT venue, then those venue-relative
     * percentages are pooled across the roster — same definition we use
     * for the player's pctOfVenue, so subtracting them (= edge) is fair
     * even when player and opponent venue scopes differ.
     *
     * `venueByMachineVenueMap` keys are `${machineLower}|${venue}` and
     * values are { total, count } summed across all teams at that venue
     * (i.e. enough to derive the venue average for that exact machine).
     * `machineVarToCanon` maps any machine variation to the canonical
     * venues.json name used as the row key.
     */
    const enrichWithOpponent = async (
      rows: Array<{ machine: string; pctOfVenue: number; [k: string]: any }>,
      venueByMachineVenueMap: Map<string, { total: number; count: number }>,
      machineVarToCanon: Map<string, string>
    ) => {
      if (!opponentTeam || opponentPlayers.length === 0 || rows.length === 0) return rows

      const allMachineVars = getAllMachineVariations(rows.map(r => r.machine)).map(v => v.toLowerCase())

      // Pull opponent's per-(machine, venue) rows. Always venue-specific
      // because per-game normalization needs to know which venue each row
      // came from. The opponentVenueSpecific flag controls scope (which
      // venues are included) but not the row granularity.
      let oppQuery = supabase
        .from('cache_player_machine_stats' as any)
        .select('player_name, machine, venue, total_score, game_count')
        .in('player_name', opponentPlayers)
        .in('machine', allMachineVars)
        .eq('season_start', seasonStart)
        .eq('season_end', seasonEnd)
        .not('venue', 'is', null)
      if (opponentVenueSpecific && venue) {
        oppQuery = oppQuery.in('venue', getVenueVariations(venue))
      }
      const { data: oppRows } = await oppQuery as { data: Array<{
        machine: string; venue: string; total_score: number; game_count: number
      }> | null }

      // If opponent scope is "all venues" we may need venue averages for
      // venues not already in venueByMachineVenueMap. Top up the map.
      const missingVenues = new Set<string>()
      for (const r of (oppRows || [])) {
        if (!venueByMachineVenueMap.has(`${r.machine.toLowerCase()}|${r.venue}`)) {
          missingVenues.add(r.venue)
        }
      }
      if (missingVenues.size > 0) {
        const { data: extra } = await (supabase
          .from('cache_team_machine_stats' as any)
          .select('machine, venue, total_score, game_count')
          .in('machine', allMachineVars)
          .in('venue', Array.from(missingVenues))
          .eq('season_start', seasonStart)
          .eq('season_end', seasonEnd)) as { data: Array<{
            machine: string; venue: string | null; total_score: number; game_count: number
          }> | null }
        for (const row of extra || []) {
          if (!row.venue) continue
          const key = `${row.machine.toLowerCase()}|${row.venue}`
          const existing = venueByMachineVenueMap.get(key) || { total: 0, count: 0 }
          existing.total += Number(row.total_score)
          existing.count += Number(row.game_count)
          venueByMachineVenueMap.set(key, existing)
        }
      }

      // Aggregate opponent roster per canonical machine: sumPct + games
      // (for per-game-normalized pctOfVenue) plus totalScore/games (for
      // raw avg). Skip rows where we lack a venue baseline.
      const oppAgg = new Map<string, { sumPct: number; games: number; totalScore: number }>()
      for (const r of oppRows || []) {
        const canon = machineVarToCanon.get(r.machine.toLowerCase())
        if (!canon) continue
        const games = Number(r.game_count)
        if (!games) continue
        const total = Number(r.total_score)
        const venueAvgEntry = venueByMachineVenueMap.get(`${r.machine.toLowerCase()}|${r.venue}`)
        const venueAvg = venueAvgEntry && venueAvgEntry.count > 0 ? venueAvgEntry.total / venueAvgEntry.count : 0
        const sumPctContribution = venueAvg > 0 ? (total / venueAvg) * 100 : 0

        const existing = oppAgg.get(canon) || { sumPct: 0, games: 0, totalScore: 0 }
        existing.sumPct += sumPctContribution
        existing.games += games
        existing.totalScore += total
        oppAgg.set(canon, existing)
      }

      return rows.map(row => {
        const agg = oppAgg.get(row.machine)
        const oppAvg = agg && agg.games > 0 ? agg.totalScore / agg.games : 0
        const oppPctOfVenue = agg && agg.games > 0 ? agg.sumPct / agg.games : 0
        const edge = oppPctOfVenue > 0 ? row.pctOfVenue - oppPctOfVenue : 0
        return { ...row, oppAvg, oppPctOfVenue, edge, oppGamesPlayed: agg?.games || 0 }
      })
    }

    // Get player's key from games table (works for all players, not just TWC)
    const { data: sampleGames } = await supabase
      .from('games')
      .select('player_1_key, player_1_name, player_2_key, player_2_name, player_3_key, player_3_name, player_4_key, player_4_name')
      .or(`player_1_name.eq.${player},player_2_name.eq.${player},player_3_name.eq.${player},player_4_name.eq.${player}`)
      .limit(1)
      .returns<Array<{
        player_1_key: string | null
        player_1_name: string | null
        player_2_key: string | null
        player_2_name: string | null
        player_3_key: string | null
        player_3_name: string | null
        player_4_key: string | null
        player_4_name: string | null
      }>>()

    let playerKey: string | null = null

    if (sampleGames && sampleGames.length > 0) {
      const game = sampleGames[0]
      if (game.player_1_name === player) playerKey = game.player_1_key
      else if (game.player_2_name === player) playerKey = game.player_2_key
      else if (game.player_3_name === player) playerKey = game.player_3_key
      else if (game.player_4_name === player) playerKey = game.player_4_key
    }

    if (!playerKey) {
      return NextResponse.json({
        player,
        totalGames: 0,
        uniqueMachines: 0,
        venuesPlayed: 0,
        machinePerformance: [],
        allVenues
      })
    }

    // Step 1: Get list of machines at the specific venue
    // Use the same approach as machine-stats: get machines from LATEST SEASON at venue,
    // then apply venue machine list overrides to respect "modify venue machine list" settings
    if (!venue) {
      return NextResponse.json({
        player,
        totalGames: 0,
        uniqueMachines: 0,
        venuesPlayed: 0,
        machinePerformance: [],
        allVenues
      })
    }

    // Use machines passed from client (sourced from venues.json with overrides already applied)
    const machinesParam = searchParams.get('machines')
    const machinesAtVenue = machinesParam ? machinesParam.split(',') : []
    const venueVariations = getVenueVariations(venue)

    // Build a lookup from any variation of a machine name to its canonical (venues.json) name
    const machineVariationToCanonical = new Map<string, string>()
    for (const machine of machinesAtVenue) {
      for (const variation of getAllMachineVariations([machine])) {
        machineVariationToCanonical.set(variation, machine)
      }
    }

    if (machinesAtVenue.length === 0) {
      return NextResponse.json({
        player,
        totalGames: 0,
        uniqueMachines: 0,
        venuesPlayed: 0,
        machinePerformance: [],
        allVenues
      })
    }

    // --- Try cache-first path ---
    {
      const allMachineVars = getAllMachineVariations(machinesAtVenue).map(v => v.toLowerCase())

      // Pull the player's per-venue rows. Per-game-normalized pctOfVenue
      // requires per-(machine, venue) totals, not the venue=NULL rollup.
      // Filtered by venue when scope is venue-specific; otherwise fetch
      // every venue the player has played at.
      let playerVenueQuery = supabase
        .from('cache_player_machine_stats' as any)
        .select('machine, venue, total_score, game_count, total_points, possible_points')
        .eq('player_name', player)
        .in('machine', allMachineVars)
        .eq('season_start', seasonStart)
        .eq('season_end', seasonEnd)
        .not('venue', 'is', null)
      if (!allVenues) {
        playerVenueQuery = playerVenueQuery.in('venue', venueVariations)
      }
      const { data: playerVenueRows } = await playerVenueQuery as { data: Array<{
        machine: string; venue: string; total_score: number; game_count: number;
        total_points: number | null; possible_points: number | null
      }> | null }

      // Map any machine variation back to its canonical (venues.json) name.
      const machineVarToCanon = new Map<string, string>()
      for (const m of machinesAtVenue) {
        for (const v of getAllMachineVariations([m])) {
          machineVarToCanon.set(v.toLowerCase(), m)
        }
      }

      // Build the set of venues we need a per-machine average for. For
      // venue-specific scope it's just the selected venue's variations;
      // for all-venues we need the venue average for every venue the
      // player has data in (so per-game normalization works).
      const venuesToFetch = new Set<string>()
      if (!allVenues) {
        for (const v of venueVariations) venuesToFetch.add(v)
      } else {
        for (const r of playerVenueRows || []) venuesToFetch.add(r.venue)
      }

      let venueByMachineVenueMap = new Map<string /* `${machineLower}|${venue}` */, { total: number; count: number }>()
      if (venuesToFetch.size > 0) {
        const { data: venueCache } = await (supabase
          .from('cache_team_machine_stats' as any)
          .select('machine, venue, total_score, game_count')
          .in('machine', allMachineVars)
          .in('venue', Array.from(venuesToFetch))
          .eq('season_start', seasonStart)
          .eq('season_end', seasonEnd)) as { data: Array<{
            machine: string; venue: string | null; total_score: number; game_count: number
          }> | null }
        for (const row of venueCache || []) {
          if (!row.venue) continue
          const key = `${row.machine.toLowerCase()}|${row.venue}`
          const existing = venueByMachineVenueMap.get(key) || { total: 0, count: 0 }
          existing.total += Number(row.total_score)
          existing.count += Number(row.game_count)
          venueByMachineVenueMap.set(key, existing)
        }
      }

      if (playerVenueRows && playerVenueRows.length > 0) {
        // Per-machine accumulators. sumPct is the running sum of every
        // game's (score / venueAvgForThatVenue) * 100; dividing by games
        // gives the per-game-normalized pctOfVenue. avgScore stays a raw
        // mean (sum scores / games) since that field is unrelated.
        const perMachine = new Map<string, {
          sumPct: number; games: number; totalScore: number;
          totalPoints: number; possiblePoints: number;
          venues: Set<string>; bestVenue: string; bestAvg: number;
        }>()

        for (const row of playerVenueRows) {
          const games = Number(row.game_count)
          if (!games) continue
          const total = Number(row.total_score)
          const canon = machineVarToCanon.get(row.machine.toLowerCase()) || row.machine
          const venueAvgEntry = venueByMachineVenueMap.get(`${row.machine.toLowerCase()}|${row.venue}`)
          const venueAvg = venueAvgEntry && venueAvgEntry.count > 0 ? venueAvgEntry.total / venueAvgEntry.count : 0
          // Sum-of-per-game-pcts contribution from this venue collapses to
          // (total_score / venueAvg * 100) without needing per-row scores.
          const sumPctContribution = venueAvg > 0 ? (total / venueAvg) * 100 : 0
          const rowAvg = total / games

          const acc = perMachine.get(canon) || {
            sumPct: 0, games: 0, totalScore: 0,
            totalPoints: 0, possiblePoints: 0,
            venues: new Set<string>(), bestVenue: '', bestAvg: 0,
          }
          acc.sumPct += sumPctContribution
          acc.games += games
          acc.totalScore += total
          acc.totalPoints += Number(row.total_points || 0)
          acc.possiblePoints += Number(row.possible_points || 0)
          acc.venues.add(row.venue)
          if (rowAvg > acc.bestAvg) {
            acc.bestAvg = rowAvg
            acc.bestVenue = row.venue
          }
          perMachine.set(canon, acc)
        }

        const allVenuesSet = new Set<string>()
        let totalGames = 0
        const machinePerformance = Array.from(perMachine.entries()).map(([canon, acc]) => {
          for (const v of Array.from(acc.venues)) allVenuesSet.add(v)
          totalGames += acc.games
          return {
            machine: canon,
            avgScore: acc.totalScore / acc.games,
            avgPoints: acc.possiblePoints > 0 ? acc.totalPoints / acc.games : 0,
            timesPlayed: acc.games,
            bestScore: 0, // Not stored in cache
            // Per-game-normalized: sum of per-game (score / venueAvg) percentages
            // divided by total games. Equivalent to the legacy avg/avg ratio
            // when there is exactly one venue in scope; differs (correctly)
            // when the player's data spans multiple venues.
            pctOfVenue: acc.games > 0 ? acc.sumPct / acc.games : 0,
            venuesPlayed: acc.venues.size,
            bestVenue: acc.bestVenue,
          }
        }).sort((a: any, b: any) => b.pctOfVenue - a.pctOfVenue)

        // The opponent enrichment compares opponent's pctOfVenue against
        // the same venue baseline. Pass the per-(machine,venue) map so
        // enrichWithOpponent can normalize per-game too.
        const enriched = await enrichWithOpponent(machinePerformance, venueByMachineVenueMap, machineVarToCanon)

        return NextResponse.json({
          player,
          totalGames,
          uniqueMachines: machinePerformance.length,
          venuesPlayed: allVenuesSet.size,
          machinePerformance: enriched,
          allVenues
        })
      }
    }

    // --- Fallback: full games scan ---
    // Step 2: Get player's games (venue-specific or all venues)
    let playerQuery = supabase
      .from('games')
      .select('machine, venue, player_1_key, player_1_score, player_1_points, player_2_key, player_2_score, player_2_points, player_3_key, player_3_score, player_3_points, player_4_key, player_4_score, player_4_points')
      .gte('season', seasonStart)
      .lte('season', seasonEnd)
      .or(`player_1_key.eq.${playerKey},player_2_key.eq.${playerKey},player_3_key.eq.${playerKey},player_4_key.eq.${playerKey}`)

    if (!allVenues) {
      playerQuery = playerQuery.in('venue', venueVariations)
    }

    // IMPORTANT: Must use .order('id') for consistent pagination
    playerQuery = playerQuery.order('id', { ascending: true })

    let playerGamesData
    try {
      playerGamesData = await fetchAllRecords<{
        machine: string
        venue: string | null
        player_1_key: string | null
        player_1_score: number | null
        player_1_points: number | null
        player_2_key: string | null
        player_2_score: number | null
        player_2_points: number | null
        player_3_key: string | null
        player_3_score: number | null
        player_3_points: number | null
        player_4_key: string | null
        player_4_score: number | null
        player_4_points: number | null
      }>(() => playerQuery)
    } catch (error) {
      console.error('Error fetching player games:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Step 3: Get all games at the venue for calculating venue averages
    // IMPORTANT: Must use .order('id') for consistent pagination
    let venueGamesData
    try {
      venueGamesData = await fetchAllRecords<{
        machine: string
        player_1_score: number | null
        player_2_score: number | null
        player_3_score: number | null
        player_4_score: number | null
      }>(
        () => supabase
          .from('games')
          .select('machine, player_1_score, player_2_score, player_3_score, player_4_score')
          .in('venue', venueVariations)
          .gte('season', seasonStart)
          .lte('season', seasonEnd)
          .order('id', { ascending: true })
      )
    } catch (error) {
      console.error('Error fetching venue games:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Step 4: Process player's games (only for machines at the venue)
    const machineStats = new Map()
    const venuesSet = new Set()
    let totalGames = 0

    for (const game of playerGamesData || []) {
      // Only process machines that exist at the venue (after applying overrides)
      const canonical = machineVariationToCanonical.get(game.machine)
      if (!canonical) continue
      game.machine = canonical

      if (game.venue) venuesSet.add(game.venue)

      let playerPoints = 0
      let playerScore = 0
      let isPlayerGame = false

      if (game.player_1_key === playerKey) {
        playerPoints = game.player_1_points || 0
        playerScore = game.player_1_score || 0
        isPlayerGame = true
      } else if (game.player_2_key === playerKey) {
        playerPoints = game.player_2_points || 0
        playerScore = game.player_2_score || 0
        isPlayerGame = true
      } else if (game.player_3_key === playerKey) {
        playerPoints = game.player_3_points || 0
        playerScore = game.player_3_score || 0
        isPlayerGame = true
      } else if (game.player_4_key === playerKey) {
        playerPoints = game.player_4_points || 0
        playerScore = game.player_4_score || 0
        isPlayerGame = true
      }

      if (isPlayerGame) {
        if (!machineStats.has(game.machine)) {
          machineStats.set(game.machine, {
            machine: game.machine,
            gamesPlayed: 0,
            totalPoints: 0,
            totalScore: 0,
            avgPoints: 0,
            avgScore: 0,
            bestScore: 0,
            timesPlayed: 0,
            venues: new Set(),
            venueScores: new Map() // Track score per venue for "best venue" calculation
          })
        }

        const stats = machineStats.get(game.machine)
        stats.gamesPlayed++
        stats.timesPlayed++
        stats.totalPoints += playerPoints
        stats.totalScore += playerScore
        stats.bestScore = Math.max(stats.bestScore, playerScore)

        // Track venues for this machine
        if (game.venue) {
          stats.venues.add(game.venue)

          // Track score per venue
          if (!stats.venueScores.has(game.venue)) {
            stats.venueScores.set(game.venue, { totalScore: 0, count: 0 })
          }
          const venueData = stats.venueScores.get(game.venue)
          venueData.totalScore += playerScore
          venueData.count++
        }

        totalGames++
      }
    }

    // Step 5a: Build per-(machine, venue) venue averages. Use the live
    // venueGamesData for the selected venue (already loaded above) and
    // top up with cache_team_machine_stats for any other venues the
    // player has games in (only relevant when scope = all venues).
    const venueByMachineVenueMap = new Map<string /* `${machineLower}|${venue}` */, { total: number; count: number }>()
    for (const game of venueGamesData || []) {
      const canonical = machineVariationToCanonical.get(game.machine)
      if (!canonical) continue
      // venueGamesData is already filtered to selected venue's variations,
      // so bucket each row under (canonical, selectedVenue).
      const key = `${canonical.toLowerCase()}|${venue}`
      const venueData = venueByMachineVenueMap.get(key) || { total: 0, count: 0 }
      for (const score of [game.player_1_score, game.player_2_score, game.player_3_score, game.player_4_score]) {
        if (score) {
          venueData.total += score
          venueData.count++
        }
      }
      venueByMachineVenueMap.set(key, venueData)
    }
    if (allVenues) {
      const otherVenues = new Set<string>()
      for (const stats of Array.from(machineStats.values()) as any[]) {
        for (const v of Array.from(stats.venues) as string[]) {
          if (v !== venue) otherVenues.add(v)
        }
      }
      if (otherVenues.size > 0) {
        const allMachineVars = getAllMachineVariations(machinesAtVenue).map(v => v.toLowerCase())
        const { data: extraVenueCache } = await (supabase
          .from('cache_team_machine_stats' as any)
          .select('machine, venue, total_score, game_count')
          .in('machine', allMachineVars)
          .in('venue', Array.from(otherVenues))
          .eq('season_start', seasonStart)
          .eq('season_end', seasonEnd)) as { data: Array<{
            machine: string; venue: string | null; total_score: number; game_count: number
          }> | null }
        for (const row of extraVenueCache || []) {
          if (!row.venue) continue
          const canonical = machineVariationToCanonical.get(row.machine.toLowerCase()) || row.machine
          const key = `${canonical.toLowerCase()}|${row.venue}`
          const existing = venueByMachineVenueMap.get(key) || { total: 0, count: 0 }
          existing.total += Number(row.total_score)
          existing.count += Number(row.game_count)
          venueByMachineVenueMap.set(key, existing)
        }
      }
    }

    // Step 5b: For each machine, compute per-game-normalized pctOfVenue
    // from the player's per-venue tallies (collected during the games
    // loop). For each (machine, venue) the player has data, the sum of
    // per-game (score / venueAvg) percentages collapses to
    // (sum_score_v / venueAvg_v) * 100 — same as in the cache path.
    const machinePerformance = Array.from(machineStats.values()).map((stats: any) => {
      const avgScore = stats.totalScore / stats.gamesPlayed

      let sumPct = 0
      let coveredGames = 0
      for (const [venueName, venueStats] of stats.venueScores.entries()) {
        const venueAvgEntry = venueByMachineVenueMap.get(`${stats.machine.toLowerCase()}|${venueName}`)
        const venueAvg = venueAvgEntry && venueAvgEntry.count > 0 ? venueAvgEntry.total / venueAvgEntry.count : 0
        if (venueAvg > 0) {
          sumPct += (venueStats.totalScore / venueAvg) * 100
          coveredGames += venueStats.count
        }
      }
      const pctOfVenue = coveredGames > 0 ? sumPct / coveredGames : 0

      let bestVenue = ''
      let bestVenueAvg = 0
      for (const [venueName, venueStats] of stats.venueScores.entries()) {
        const venueAverage = venueStats.totalScore / venueStats.count
        if (venueAverage > bestVenueAvg) {
          bestVenueAvg = venueAverage
          bestVenue = venueName
        }
      }

      return {
        machine: stats.machine,
        avgScore: avgScore,
        avgPoints: stats.totalPoints / stats.gamesPlayed,
        timesPlayed: stats.timesPlayed,
        bestScore: stats.bestScore,
        pctOfVenue: pctOfVenue,
        venuesPlayed: stats.venues.size,
        bestVenue: bestVenue
      }
    }).sort((a, b) => b.pctOfVenue - a.pctOfVenue)

    // machineVarToCanon for the fallback path: any variation → canonical.
    const fallbackMachineVarToCanon = new Map<string, string>()
    for (const m of machinesAtVenue) {
      for (const v of getAllMachineVariations([m])) {
        fallbackMachineVarToCanon.set(v.toLowerCase(), m)
      }
    }
    const enriched = await enrichWithOpponent(machinePerformance, venueByMachineVenueMap, fallbackMachineVarToCanon)

    return NextResponse.json({
      player,
      totalGames,
      uniqueMachines: machineStats.size,
      venuesPlayed: venuesSet.size,
      machinePerformance: enriched,
      allVenues
    })
  } catch (error) {
    console.error('Error fetching player analysis:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player analysis' },
      { status: 500 }
    )
  }
}
