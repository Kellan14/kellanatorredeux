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

    // Query player stats from database
    const { data, error } = await supabase
      .from('player_stats')
      .select('*')
      .eq('player_name', playerName)
      .eq('season', CURRENT_SEASON)
      .single()

    if (error || !data) {
      return NextResponse.json({
        name: playerName,
        ipr: 0,
        matchesPlayed: 0,
        currentSeason: CURRENT_SEASON,
        message: 'Player not found in season ' + CURRENT_SEASON
      })
    }

    return NextResponse.json({
      name: data.player_name,
      ipr: data.ipr || 0,
      matchesPlayed: data.matches_played || 0,
      currentSeason: CURRENT_SEASON,
      lastMatchWeek: data.last_match_week,
      team: data.team
    })
  } catch (error) {
    console.error('Error fetching player stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player stats' },
      { status: 500 }
    )
  }
}
