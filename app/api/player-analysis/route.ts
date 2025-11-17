import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { applyVenueMachineListOverrides } from '@/lib/venue-machine-lists'

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

    // Get machines from the most recent season at this venue (matches machine-stats logic)
    const latestSeason = seasonEnd
    const { data: venueMachinesData } = await supabase
      .from('games')
      .select('machine')
      .eq('venue', venue)
      .eq('season', latestSeason)
      .returns<Array<{ machine: string }>>()

    // Get unique machines and apply venue machine list overrides
    let machinesAtVenue = Array.from(new Set(venueMachinesData?.map(g => g.machine) || []))
    machinesAtVenue = applyVenueMachineListOverrides(venue, machinesAtVenue)

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

    // Step 2: Get player's games (venue-specific or all venues)
    let playerQuery = supabase
      .from('games')
      .select('machine, venue, player_1_key, player_1_score, player_1_points, player_2_key, player_2_score, player_2_points, player_3_key, player_3_score, player_3_points, player_4_key, player_4_score, player_4_points')
      .gte('season', seasonStart)
      .lte('season', seasonEnd)
      .or(`player_1_key.eq.${playerKey},player_2_key.eq.${playerKey},player_3_key.eq.${playerKey},player_4_key.eq.${playerKey}`)

    if (!allVenues) {
      playerQuery = playerQuery.eq('venue', venue)
    }

    const { data: playerGamesData, error: playerError } = await playerQuery.returns<Array<{
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
    }>>()

    if (playerError) {
      console.error('Supabase error:', playerError)
      return NextResponse.json({ error: playerError.message }, { status: 500 })
    }

    // Step 3: Get all games at the venue for calculating venue averages
    const { data: venueGamesData, error: venueError } = await supabase
      .from('games')
      .select('machine, player_1_score, player_2_score, player_3_score, player_4_score')
      .eq('venue', venue)
      .gte('season', seasonStart)
      .lte('season', seasonEnd)
      .returns<Array<{
        machine: string
        player_1_score: number | null
        player_2_score: number | null
        player_3_score: number | null
        player_4_score: number | null
      }>>()

    if (venueError) {
      console.error('Supabase error:', venueError)
      return NextResponse.json({ error: venueError.message }, { status: 500 })
    }

    // Step 4: Process player's games (only for machines at the venue)
    const machineStats = new Map()
    const venuesSet = new Set()
    let totalGames = 0

    for (const game of playerGamesData || []) {
      // Only process machines that exist at the venue (after applying overrides)
      if (!machinesAtVenue.includes(game.machine)) continue

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
            timesPlayed: 0
          })
        }

        const stats = machineStats.get(game.machine)
        stats.gamesPlayed++
        stats.timesPlayed++
        stats.totalPoints += playerPoints
        stats.totalScore += playerScore
        stats.bestScore = Math.max(stats.bestScore, playerScore)
        totalGames++
      }
    }

    // Step 5: Calculate venue averages from venue games
    const venueScores = new Map()
    for (const game of venueGamesData || []) {
      // Only process machines at the venue (after applying overrides)
      if (!machinesAtVenue.includes(game.machine)) continue

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

      return {
        machine: stats.machine,
        avgScore: avgScore,
        avgPoints: stats.totalPoints / stats.gamesPlayed,
        timesPlayed: stats.timesPlayed,
        bestScore: stats.bestScore,
        pctOfVenue: pctOfVenue
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
