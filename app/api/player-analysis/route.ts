import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

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

    // Query games table directly with SQL filters
    let query = supabase
      .from('games')
      .select('machine, venue, player_1_key, player_1_score, player_1_points, player_2_key, player_2_score, player_2_points, player_3_key, player_3_score, player_3_points, player_4_key, player_4_score, player_4_points')
      .gte('season', seasonStart)
      .lte('season', seasonEnd)
      .or(`player_1_key.eq.${playerKey},player_2_key.eq.${playerKey},player_3_key.eq.${playerKey},player_4_key.eq.${playerKey}`)

    if (!allVenues && venue) {
      query = query.eq('venue', venue)
    }

    const { data: gamesData, error } = await query.returns<Array<{
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

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Analyze performance and calculate venue averages
    const machineStats = new Map()
    const venuesSet = new Set()
    const venueScores = new Map() // For calculating venue averages
    let totalGames = 0

    // First pass: collect player stats and all scores for venue averages
    for (const game of gamesData || []) {
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

      const machine = game.machine

      // Track player stats
      if (isPlayerGame) {
        if (!machineStats.has(machine)) {
          machineStats.set(machine, {
            machine,
            gamesPlayed: 0,
            totalPoints: 0,
            totalScore: 0,
            avgPoints: 0,
            avgScore: 0,
            bestScore: 0,
            timesPlayed: 0
          })
        }

        const stats = machineStats.get(machine)
        stats.gamesPlayed++
        stats.timesPlayed++
        stats.totalPoints += playerPoints
        stats.totalScore += playerScore
        stats.bestScore = Math.max(stats.bestScore, playerScore)
        totalGames++
      }

      // Track all scores for venue averages (from all players)
      const venueKey = `${machine}`
      if (!venueScores.has(venueKey)) {
        venueScores.set(venueKey, { totalScore: 0, count: 0 })
      }
      const venueData = venueScores.get(venueKey)!

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
