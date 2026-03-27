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
    const allVenues = searchParams.get('allVenues') === 'true'

    if (!player) {
      return NextResponse.json(
        { error: 'Player parameter is required' },
        { status: 400 }
      )
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
      // Get player stats from cache
      const allMachineVars = getAllMachineVariations(machinesAtVenue).map(v => v.toLowerCase())
      let playerCacheQuery = supabase
        .from('cache_player_machine_stats' as any)
        .select('*')
        .eq('player_name', player)
        .in('machine', allMachineVars)
        .eq('season_start', seasonStart)
        .eq('season_end', seasonEnd)

      if (!allVenues) {
        playerCacheQuery = playerCacheQuery.in('venue', venueVariations)
      } else {
        playerCacheQuery = playerCacheQuery.is('venue', null)
      }

      const { data: playerCache } = await playerCacheQuery as { data: any[] | null }

      // Get venue averages by summing all teams' stats at the venue
      const { data: venueCache } = await (supabase
        .from('cache_team_machine_stats' as any)
        .select('machine, total_score, game_count')
        .in('machine', allMachineVars)
        .in('venue', venueVariations)
        .eq('season_start', seasonStart)
        .eq('season_end', seasonEnd)) as { data: any[] | null }

      if (playerCache && playerCache.length > 0) {
        // Build venue averages from cache
        const venueAvgMap = new Map<string, { total: number; count: number }>()
        if (venueCache) {
          for (const row of venueCache) {
            const existing = venueAvgMap.get(row.machine) || { total: 0, count: 0 }
            existing.total += Number(row.total_score)
            existing.count += Number(row.game_count)
            venueAvgMap.set(row.machine, existing)
          }
        }

        // Map cache rows to machine name from machinesAtVenue
        const machineVarToCanon = new Map<string, string>()
        for (const m of machinesAtVenue) {
          for (const v of getAllMachineVariations([m])) {
            machineVarToCanon.set(v.toLowerCase(), m)
          }
        }

        let totalGames = 0
        const machinePerformance = playerCache.map((row: any) => {
          const canonicalMachine = machineVarToCanon.get(row.machine) || row.machine
          const avgScore = row.game_count > 0 ? Number(row.total_score) / Number(row.game_count) : 0
          const venueEntry = venueAvgMap.get(row.machine)
          const venueAvg = venueEntry && venueEntry.count > 0 ? venueEntry.total / venueEntry.count : 0
          const pctOfVenue = venueAvg > 0 ? (avgScore / venueAvg) * 100 : 0
          totalGames += Number(row.game_count)

          return {
            machine: canonicalMachine,
            avgScore,
            avgPoints: row.possible_points && row.game_count > 0 ? Number(row.total_points) / Number(row.game_count) : 0,
            timesPlayed: Number(row.game_count),
            bestScore: 0, // Not stored in cache
            pctOfVenue,
            venuesPlayed: 0,
            bestVenue: ''
          }
        }).sort((a: any, b: any) => b.pctOfVenue - a.pctOfVenue)

        return NextResponse.json({
          player,
          totalGames,
          uniqueMachines: machinePerformance.length,
          venuesPlayed: 0, // Not available from cache
          machinePerformance,
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

    // Step 5: Calculate venue averages from venue games
    const venueScores = new Map()
    for (const game of venueGamesData || []) {
      // Only process machines at the venue (after applying overrides)
      const venueCanonical = machineVariationToCanonical.get(game.machine)
      if (!venueCanonical) continue
      game.machine = venueCanonical

      if (!venueScores.has(game.machine)) {
        venueScores.set(game.machine, { totalScore: 0, count: 0 })
      }
      const venueData = venueScores.get(game.machine)!

      // Add all player scores to venue average
      if (game.player_1_score) {
        venueData.totalScore += game.player_1_score
        venueData.count++
      }
      if (game.player_2_score) {
        venueData.totalScore += game.player_2_score
        venueData.count++
      }
      if (game.player_3_score) {
        venueData.totalScore += game.player_3_score
        venueData.count++
      }
      if (game.player_4_score) {
        venueData.totalScore += game.player_4_score
        venueData.count++
      }
    }

    // Calculate venue averages and player percentages
    const machinePerformance = Array.from(machineStats.values()).map(stats => {
      const avgScore = stats.totalScore / stats.gamesPlayed
      const venueData = venueScores.get(stats.machine)
      const venueAvg = venueData ? venueData.totalScore / venueData.count : 0
      const pctOfVenue = venueAvg > 0 ? (avgScore / venueAvg) * 100 : 0

      // Find best venue (highest average) for this machine
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

    return NextResponse.json({
      player,
      totalGames,
      uniqueMachines: machineStats.size,
      venuesPlayed: venuesSet.size,
      machinePerformance,
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
