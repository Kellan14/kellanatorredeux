import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const machineKey = searchParams.get('machine')
    const context = searchParams.get('context')
    const venue = searchParams.get('venue') || ''

    if (!machineKey || !context) {
      return NextResponse.json(
        { error: 'Machine and context parameters are required' },
        { status: 400 }
      )
    }

    // Build query for top 10 scores
    let query = supabase
      .from('games')
      .select('player_1_name, player_1_score, player_2_name, player_2_score, player_3_name, player_3_score, player_4_name, player_4_score, venue, season, week, match_key, round_number')
      .eq('machine', machineKey)

    // Filter by venue if context is venue-specific
    if (context.includes(' at ') && venue) {
      query = query.eq('venue', venue)
    }

    const { data: games, error } = await query

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Extract all scores from games
    const scores: Array<{ player: string; score: number; venue: string; season: number; week: number; match: string; round: number }> = []

    for (const game of games || []) {
      for (let i = 1; i <= 4; i++) {
        const playerName = game[`player_${i}_name`]
        const playerScore = game[`player_${i}_score`]

        if (playerName && playerScore != null) {
          scores.push({
            player: playerName,
            score: playerScore,
            venue: game.venue || '',
            season: game.season || 0,
            week: game.week || 0,
            match: game.match_key || '',
            round: game.round_number || 0
          })
        }
      }
    }

    // Sort by score descending and take top 10
    const topScores = scores
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)

    return NextResponse.json({
      machine: machineKey,
      machineKey,
      context,
      topScores
    })
  } catch (error) {
    console.error('Error fetching top 10:', error)
    return NextResponse.json(
      { error: 'Failed to fetch top 10' },
      { status: 500 }
    )
  }
}
