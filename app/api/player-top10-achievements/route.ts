import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic';

// Cache for 1 hour since stats only update weekly
export const revalidate = 3600

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const playerName = searchParams.get('player')

    if (!playerName) {
      return NextResponse.json(
        { error: 'Player parameter is required' },
        { status: 400 }
      )
    }

    // Get player's key from player_stats
    const { data: playerData } = await supabase
      .from('player_stats')
      .select('player_key')
      .eq('player_name', playerName)
      .limit(1)
      .single<{ player_key: string | null }>()

    if (!playerData?.player_key) {
      return NextResponse.json({ achievements: [] })
    }

    const playerKey = playerData.player_key

    // Query games table for all player's games
    const { data: gamesData, error } = await supabase
      .from('games')
      .select('machine, season, week, venue, player_1_key, player_1_score, player_1_points, player_2_key, player_2_score, player_2_points, player_3_key, player_3_score, player_3_points, player_4_key, player_4_score, player_4_points')
      .or(`player_1_key.eq.${playerKey},player_2_key.eq.${playerKey},player_3_key.eq.${playerKey},player_4_key.eq.${playerKey}`)
      .returns<Array<{
        machine: string
        season: number
        week: number
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

    // Collect performances
    const performances = (gamesData || []).map(game => {
      let score = 0
      let points = 0

      if (game.player_1_key === playerKey) {
        score = game.player_1_score || 0
        points = game.player_1_points || 0
      } else if (game.player_2_key === playerKey) {
        score = game.player_2_score || 0
        points = game.player_2_points || 0
      } else if (game.player_3_key === playerKey) {
        score = game.player_3_score || 0
        points = game.player_3_points || 0
      } else if (game.player_4_key === playerKey) {
        score = game.player_4_score || 0
        points = game.player_4_points || 0
      }

      return {
        machine: game.machine,
        score,
        points,
        season: game.season,
        week: game.week,
        venue: game.venue
      }
    })

    // Sort by score and get top 10
    const top10 = performances
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((perf, index) => ({
        rank: index + 1,
        machine: perf.machine,
        score: perf.score,
        points: perf.points,
        season: perf.season,
        week: perf.week,
        venue: perf.venue
      }))

    return NextResponse.json({
      achievements: top10
    })
  } catch (error) {
    console.error('Error fetching player achievements:', error)
    return NextResponse.json(
      { error: 'Failed to fetch achievements' },
      { status: 500 }
    )
  }
}
