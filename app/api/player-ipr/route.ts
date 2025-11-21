import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'

export const dynamic = 'force-dynamic';

const CURRENT_SEASON = 22

// Cache for 1 hour (3600 seconds) since stats only update weekly
export const revalidate = 3600

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

    // Query games table to get all games and calculate stats (single query, no player_match_participation needed)
    let gamesData
    try {
      gamesData = await fetchAllRecords<{
        match_key: string
        player_1_key: string | null
        player_1_points: number | null
        player_2_key: string | null
        player_2_points: number | null
        player_3_key: string | null
        player_3_points: number | null
        player_4_key: string | null
        player_4_points: number | null
      }>(
        () => supabase
          .from('games')
          .select('match_key, player_1_key, player_1_points, player_2_key, player_2_points, player_3_key, player_3_points, player_4_key, player_4_points')
          .eq('season', CURRENT_SEASON)
          .or(`player_1_key.eq.${playerKey},player_2_key.eq.${playerKey},player_3_key.eq.${playerKey},player_4_key.eq.${playerKey}`)
      )
    } catch (error) {
      console.error('Error fetching player games:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    let totalPoints = 0
    let totalPossiblePoints = 0
    const uniqueMatches = new Set<string>()

    for (const game of gamesData || []) {
      // Track unique matches
      if (game.match_key) {
        uniqueMatches.add(game.match_key)
      }

      // Find this player's points
      let playerPoints = 0
      if (game.player_1_key === playerKey) {
        playerPoints = game.player_1_points || 0
      } else if (game.player_2_key === playerKey) {
        playerPoints = game.player_2_points || 0
      } else if (game.player_3_key === playerKey) {
        playerPoints = game.player_3_points || 0
      } else if (game.player_4_key === playerKey) {
        playerPoints = game.player_4_points || 0
      }

      totalPoints += playerPoints

      // Count how many players in this game to determine if singles or doubles
      let playerCount = 0
      if (game.player_1_key) playerCount++
      if (game.player_2_key) playerCount++
      if (game.player_3_key) playerCount++
      if (game.player_4_key) playerCount++

      // Singles (2 players) = 3 points possible, Doubles (4 players) = 2.5 points possible
      const possiblePoints = playerCount === 4 ? 2.5 : 3
      totalPossiblePoints += possiblePoints
    }

    const matchesPlayedCount = uniqueMatches.size

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
