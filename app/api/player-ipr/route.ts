import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const CURRENT_SEASON = 22

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const playerName = searchParams.get('name')

    if (!playerName) {
      return NextResponse.json(
        { error: 'Player name is required' },
        { status: 400 }
      )
    }

    // Query player stats from database for IPR and player_key
    const { data: playerData, error: playerError } = await supabase
      .from('player_stats')
      .select('*')
      .eq('player_name', playerName)
      .eq('season', CURRENT_SEASON)
      .single<{
        player_key: string | null
        ipr: number | null
        last_match_week: number | null
        team: string | null
      }>()

    if (playerError || !playerData?.player_key) {
      return NextResponse.json({
        name: playerName,
        ipr: 0,
        matchesPlayed: 0,
        pointsWon: 0,
        pointsPerMatch: 0,
        pops: 0,
        currentSeason: CURRENT_SEASON,
        message: 'Player not found in season ' + CURRENT_SEASON
      })
    }

    const playerKey = playerData.player_key

    // Get matches played count from player_match_participation
    const { data: participationData } = await supabase
      .from('player_match_participation')
      .select('match_id')
      .eq('player_key', playerKey)
      .eq('season', CURRENT_SEASON)
      .gt('num_played', 0)

    const matchesPlayedCount = participationData?.length || 0

    // Calculate total points won by this player using SQL aggregation
    // We need to check all 4 player positions
    const { data: gamesData } = await supabase
      .from('games')
      .select('player_1_key, player_1_points, player_2_key, player_2_points, player_3_key, player_3_points, player_4_key, player_4_points')
      .eq('season', CURRENT_SEASON)
      .or(`player_1_key.eq.${playerKey},player_2_key.eq.${playerKey},player_3_key.eq.${playerKey},player_4_key.eq.${playerKey}`)
      .returns<Array<{
        player_1_key: string | null
        player_1_points: number | null
        player_2_key: string | null
        player_2_points: number | null
        player_3_key: string | null
        player_3_points: number | null
        player_4_key: string | null
        player_4_points: number | null
      }>>()

    let totalPoints = 0
    let totalPossiblePoints = 0

    for (const game of gamesData || []) {
      // Calculate total possible points in this game
      const gameTotal = (game.player_1_points || 0) + (game.player_2_points || 0) +
                       (game.player_3_points || 0) + (game.player_4_points || 0)
      totalPossiblePoints += gameTotal

      // Add this player's points
      if (game.player_1_key === playerKey) totalPoints += game.player_1_points || 0
      if (game.player_2_key === playerKey) totalPoints += game.player_2_points || 0
      if (game.player_3_key === playerKey) totalPoints += game.player_3_points || 0
      if (game.player_4_key === playerKey) totalPoints += game.player_4_points || 0
    }

    const pointsPerMatch = matchesPlayedCount > 0 ? totalPoints / matchesPlayedCount : 0
    const pops = totalPossiblePoints > 0 ? (totalPoints / totalPossiblePoints) * 100 : 0

    return NextResponse.json({
      name: playerName,
      ipr: playerData.ipr || 0,
      matchesPlayed: matchesPlayedCount,
      pointsWon: totalPoints,
      pointsPerMatch: pointsPerMatch,
      pops: pops,
      currentSeason: CURRENT_SEASON,
      lastMatchWeek: playerData.last_match_week,
      team: playerData.team || 'TWC'
    })
  } catch (error) {
    console.error('Error fetching player stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player stats' },
      { status: 500 }
    )
  }
}
