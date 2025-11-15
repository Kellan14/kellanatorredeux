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

    // Query player stats from database for IPR
    const { data: playerData, error: playerError } = await supabase
      .from('player_stats')
      .select('*')
      .eq('player_name', playerName)
      .eq('season', CURRENT_SEASON)
      .single()

    // Query all matches for current season (we'll filter by player in JavaScript)
    const { data: matches, error: matchError } = await supabase
      .from('matches')
      .select('data')
      .eq('season', CURRENT_SEASON)
      .eq('state', 'complete')

    if (playerError && matchError) {
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

    // Filter matches to only those with this player and find their hash key
    const playerMatches = (matches as any[])?.filter((match: any) => {
      const homePlayer = match.data?.home?.lineup?.find((p: any) => p.name === playerName)
      const awayPlayer = match.data?.away?.lineup?.find((p: any) => p.name === playerName)
      return homePlayer || awayPlayer
    }) || []

    // Find player's hash key and count matches
    let playerKey = ''
    let totalPoints = 0
    let totalPossiblePoints = 0
    let matchesPlayedCount = 0

    for (const match of playerMatches) {
      const homePlayer = match.data?.home?.lineup?.find((p: any) => p.name === playerName)
      const awayPlayer = match.data?.away?.lineup?.find((p: any) => p.name === playerName)

      if (homePlayer && !playerKey) playerKey = homePlayer.key
      if (awayPlayer && !playerKey) playerKey = awayPlayer.key

      // Count matches where player was in lineup and played
      if ((homePlayer && homePlayer.num_played > 0) || (awayPlayer && awayPlayer.num_played > 0)) {
        matchesPlayedCount++
      }
    }

    // Calculate points from games
    if (playerKey) {
      for (const match of playerMatches) {
        const rounds = match.data?.rounds || []
        for (const round of rounds) {
          for (const game of round.games || []) {
            const playerPosition = ['player_1', 'player_2', 'player_3', 'player_4']
              .find(pos => game[pos] === playerKey)

            if (playerPosition) {
              const posNum = playerPosition.split('_')[1]
              const points = game[`points_${posNum}`] || 0
              totalPoints += points

              // Each game has max 5 points possible (in best case)
              // More accurate: sum of all points in the game
              const gamePoints = (game.points_1 || 0) + (game.points_2 || 0) +
                                (game.points_3 || 0) + (game.points_4 || 0)
              totalPossiblePoints += gamePoints
            }
          }
        }
      }
    }

    const pointsPerMatch = matchesPlayedCount > 0 ? totalPoints / matchesPlayedCount : 0
    const pops = totalPossiblePoints > 0 ? (totalPoints / totalPossiblePoints) * 100 : 0

    return NextResponse.json({
      name: playerName,
      ipr: playerData?.ipr || 0,
      matchesPlayed: matchesPlayedCount,
      pointsWon: totalPoints,
      pointsPerMatch: pointsPerMatch,
      pops: pops,
      currentSeason: CURRENT_SEASON,
      lastMatchWeek: playerData?.last_match_week,
      team: playerData?.team || 'TWC'
    })
  } catch (error) {
    console.error('Error fetching player stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player stats' },
      { status: 500 }
    )
  }
}
