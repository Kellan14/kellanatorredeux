import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const CURRENT_SEASON = 22

export async function GET() {
  try {
    // Query latest TWC match from database
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('season', CURRENT_SEASON)
      .or('home_team.eq.TWC,away_team.eq.TWC')
      .order('week', { ascending: false })
      .limit(1)
      .single()

    if (error || !data) {
      return NextResponse.json({
        venue: 'Georgetown Pizza and Arcade',
        opponent: null,
        matchKey: null
      })
    }

    // Determine opponent - TWC could be home or away
    let opponent = ''
    if (data.home_team === 'TWC') {
      opponent = data.data.away?.name || data.away_team
    } else {
      opponent = data.data.home?.name || data.home_team
    }

    return NextResponse.json({
      venue: data.venue_name || 'Georgetown Pizza and Arcade',
      opponent: opponent,
      matchKey: data.match_key,
      week: data.week,
      state: data.state
    })
  } catch (error) {
    console.error('Error finding latest TWC match:', error)
    return NextResponse.json(
      { error: 'Failed to find latest match' },
      { status: 500 }
    )
  }
}
