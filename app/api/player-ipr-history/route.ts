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

    // Get all matches the player participated in, grouped by match
    const gamesData = await fetchAllRecords<{
      match_key: string
      season: number
      week: number | null
      player_1_key: string | null
      player_1_points: number | null
      player_2_key: string | null
      player_2_points: number | null
      player_3_key: string | null
      player_3_points: number | null
      player_4_key: string | null
      player_4_points: number | null
      created_at: string | null
    }>(
      supabase
        .from('games')
        .select('match_key, season, week, player_1_key, player_1_points, player_2_key, player_2_points, player_3_key, player_3_points, player_4_key, player_4_points, created_at')
        .or(`player_1_key.eq.${playerKey},player_2_key.eq.${playerKey},player_3_key.eq.${playerKey},player_4_key.eq.${playerKey}`)
        .order('season', { ascending: true })
        .order('week', { ascending: true })
    )

    // Group by match and calculate cumulative points
    const matchStats = new Map<string, {
      matchKey: string
      season: number
      week: number | null
      points: number
      date: string
    }>()

    for (const game of gamesData || []) {
      const matchKey = game.match_key
      if (!matchKey) continue

      // Find player's points in this game
      let playerPoints = 0
      if (game.player_1_key === playerKey) playerPoints = game.player_1_points || 0
      else if (game.player_2_key === playerKey) playerPoints = game.player_2_points || 0
      else if (game.player_3_key === playerKey) playerPoints = game.player_3_points || 0
      else if (game.player_4_key === playerKey) playerPoints = game.player_4_points || 0

      // Accumulate points for this match
      if (!matchStats.has(matchKey)) {
        matchStats.set(matchKey, {
          matchKey,
          season: game.season,
          week: game.week || 0,
          points: 0,
          date: game.created_at || new Date().toISOString()
        })
      }

      const stats = matchStats.get(matchKey)!
      stats.points += playerPoints
    }

    // Convert to array and calculate running IPR
    const matches = Array.from(matchStats.values())
      .sort((a, b) => {
        if (a.season !== b.season) return a.season - b.season
        return (a.week || 0) - (b.week || 0)
      })

    // Calculate cumulative points and IPR over time
    let cumulativePoints = 0
    const history = matches.map((match, index) => {
      cumulativePoints += match.points

      // Simple IPR calculation: cumulative points * scaling factor
      // This is a simplified version - actual IFPA IPR is more complex
      const ipr = Math.round(cumulativePoints * 10)

      return {
        season: match.season,
        week: match.week,
        matchNumber: index + 1,
        points: match.points,
        cumulativePoints,
        ipr,
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
