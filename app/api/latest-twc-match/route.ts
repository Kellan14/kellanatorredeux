import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic';

const CURRENT_SEASON = 22

// Cache for 1 hour since latest match info updates weekly
export const revalidate = 3600

export async function GET() {
  try {
    // Query latest TWC game from games table (faster than matches)
    const { data: gameData, error: gameError } = await supabase
      .from('games')
      .select('match_key, week, venue, home_team, away_team')
      .eq('season', CURRENT_SEASON)
      .or('home_team.eq.TWC,away_team.eq.TWC')
      .order('week', { ascending: false })
      .limit(1)
      .single()

    if (gameError || !gameData) {
      return NextResponse.json({
        venue: 'Georgetown Pizza and Arcade',
        opponent: null,
        matchKey: null
      })
    }

    // Determine opponent from team columns
    const opponentTeamKey = gameData.home_team === 'TWC' ? gameData.away_team : gameData.home_team

    // Get opponent name from teams table (fast indexed lookup)
    const { data: teamData } = await supabase
      .from('teams')
      .select('team_name')
      .eq('team_key', opponentTeamKey)
      .single()

    // Get match state from matches table (only if needed)
    const { data: matchData } = await supabase
      .from('matches')
      .select('data')
      .eq('match_key', gameData.match_key)
      .limit(1)
      .single()

    return NextResponse.json({
      venue: gameData.venue || 'Georgetown Pizza and Arcade',
      opponent: teamData?.team_name || opponentTeamKey || '',
      matchKey: gameData.match_key,
      week: gameData.week,
      state: matchData?.data?.state || 'unknown'
    })
  } catch (error) {
    console.error('Error finding latest TWC match:', error)
    return NextResponse.json(
      { error: 'Failed to find latest match' },
      { status: 500 }
    )
  }
}
