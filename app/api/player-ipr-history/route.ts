import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 3600

/**
 * GET /api/player-ipr-history
 *
 * Returns historical IPR data for a player across all seasons and matches.
 * Calculates IPR progression by looking at match-by-match performance.
 */
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

    // Get player's key from any game
    const { data: sampleGame } = await supabase
      .from('games')
      .select('player_1_key, player_1_name, player_2_key, player_2_name, player_3_key, player_3_name, player_4_key, player_4_name')
      .or(`player_1_name.eq.${playerName},player_2_name.eq.${playerName},player_3_name.eq.${playerName},player_4_name.eq.${playerName}`)
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

    if (!sampleGame || sampleGame.length === 0) {
      return NextResponse.json({
        playerName,
        history: [],
        message: 'Player not found'
      })
    }

    // Extract player key
    const game = sampleGame[0]
    let playerKey: string | null = null
    if (game.player_1_name === playerName) playerKey = game.player_1_key
    else if (game.player_2_name === playerName) playerKey = game.player_2_key
    else if (game.player_3_name === playerName) playerKey = game.player_3_key
    else if (game.player_4_name === playerName) playerKey = game.player_4_key

    if (!playerKey) {
      return NextResponse.json({
        playerName,
        history: [],
        message: 'Player key not found'
      })
    }

    // Get all games the player participated in
    const gamesData = await fetchAllRecords<{
      match_key: string
      season: number
      week: number | null
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
      created_at: string | null
    }>(
      supabase
        .from('games')
        .select('match_key, season, week, player_1_key, player_1_score, player_1_points, player_2_key, player_2_score, player_2_points, player_3_key, player_3_score, player_3_points, player_4_key, player_4_score, player_4_points, created_at')
        .or(`player_1_key.eq.${playerKey},player_2_key.eq.${playerKey},player_3_key.eq.${playerKey},player_4_key.eq.${playerKey}`)
        .order('season', { ascending: true })
        .order('week', { ascending: true })
    )

    // Group games by match and determine player's placement (IPR) in each match
    const matchStats = new Map<string, {
      matchKey: string
      season: number
      week: number | null
      points: number
      placement: number  // 1-4 based on total match points
      date: string
    }>()

    for (const game of gamesData || []) {
      const matchKey = game.match_key
      if (!matchKey) continue

      // Find player's points in this game and collect all player points for ranking
      let playerPoints = 0
      const allPlayerPoints: number[] = []

      if (game.player_1_key === playerKey) playerPoints = game.player_1_points || 0
      else if (game.player_2_key === playerKey) playerPoints = game.player_2_points || 0
      else if (game.player_3_key === playerKey) playerPoints = game.player_3_points || 0
      else if (game.player_4_key === playerKey) playerPoints = game.player_4_points || 0

      // Collect all players' points for this game
      if (game.player_1_points != null) allPlayerPoints.push(game.player_1_points)
      if (game.player_2_points != null) allPlayerPoints.push(game.player_2_points)
      if (game.player_3_points != null) allPlayerPoints.push(game.player_3_points)
      if (game.player_4_points != null) allPlayerPoints.push(game.player_4_points)

      // Accumulate points for this match
      if (!matchStats.has(matchKey)) {
        matchStats.set(matchKey, {
          matchKey,
          season: game.season,
          week: game.week || 0,
          points: 0,
          placement: 0,
          date: game.created_at || new Date().toISOString()
        })
      }

      const stats = matchStats.get(matchKey)!
      stats.points += playerPoints
    }

    // Now calculate placement for each match based on total points earned
    // We need to fetch all games in each match to determine rankings
    for (const [matchKey, matchData] of Array.from(matchStats.entries())) {
      const matchGames = gamesData.filter(g => g.match_key === matchKey)

      // Sum up points per player in this match
      const playerTotals = new Map<string, number>()
      for (const game of matchGames) {
        for (let i = 1; i <= 4; i++) {
          const key = game[`player_${i}_key` as keyof typeof game] as string | null
          const points = game[`player_${i}_points` as keyof typeof game] as number | null
          if (key && points != null) {
            playerTotals.set(key, (playerTotals.get(key) || 0) + points)
          }
        }
      }

      // Sort by points descending to determine placement
      const sortedPlayers = Array.from(playerTotals.entries())
        .sort((a, b) => b[1] - a[1])

      // Find our player's placement
      const placement = sortedPlayers.findIndex(([key]) => key === playerKey) + 1
      matchData.placement = placement || 1
    }

    // Convert to array
    const matches = Array.from(matchStats.values())
      .sort((a, b) => {
        if (a.season !== b.season) return a.season - b.season
        return (a.week || 0) - (b.week || 0)
      })

    // Build history with actual placement as IPR
    const history = matches.map((match, index) => {
      return {
        season: match.season,
        week: match.week,
        matchNumber: index + 1,
        points: match.points,
        ipr: match.placement,  // IPR is just the placement (1-4)
        date: match.date
      }
    })

    return NextResponse.json({
      playerName,
      history,
      totalMatches: matches.length
    })
  } catch (error) {
    console.error('Error fetching IPR history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch IPR history' },
      { status: 500 }
    )
  }
}
