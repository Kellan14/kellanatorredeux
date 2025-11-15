import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

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

    // Get player's key from player_stats
    const { data: playerData } = await supabase
      .from('player_stats')
      .select('player_key')
      .eq('player_name', player)
      .limit(1)
      .single<{ player_key: string | null }>()

    if (!playerData?.player_key) {
      return NextResponse.json({
        player,
        totalGames: 0,
        uniqueMachines: 0,
        venuesPlayed: 0,
        machinePerformance: [],
        allVenues
      })
    }

    const playerKey = playerData.player_key

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

    // Analyze performance
    const machineStats = new Map()
    const venuesSet = new Set()
    let totalGames = 0

    for (const game of gamesData || []) {
      if (game.venue) venuesSet.add(game.venue)

      let points = 0
      let score = 0

      if (game.player_1_key === playerKey) {
        points = game.player_1_points || 0
        score = game.player_1_score || 0
      } else if (game.player_2_key === playerKey) {
        points = game.player_2_points || 0
        score = game.player_2_score || 0
      } else if (game.player_3_key === playerKey) {
        points = game.player_3_points || 0
        score = game.player_3_score || 0
      } else if (game.player_4_key === playerKey) {
        points = game.player_4_points || 0
        score = game.player_4_score || 0
      }

      const machine = game.machine

      if (!machineStats.has(machine)) {
        machineStats.set(machine, {
          machine,
          gamesPlayed: 0,
          totalPoints: 0,
          avgPoints: 0,
          bestScore: 0
        })
      }

      const stats = machineStats.get(machine)
      stats.gamesPlayed++
      stats.totalPoints += points
      stats.bestScore = Math.max(stats.bestScore, score)
      totalGames++
    }

    const machinePerformance = Array.from(machineStats.values()).map(stats => ({
      ...stats,
      avgPoints: stats.totalPoints / stats.gamesPlayed
    })).sort((a, b) => b.avgPoints - a.avgPoints)

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
