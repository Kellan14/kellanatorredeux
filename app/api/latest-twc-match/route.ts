import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic';

const CURRENT_SEASON = 22

// Cache for 1 hour since latest match info updates weekly
export const revalidate = 3600

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

    // Type assertion for the match data
    const match = data as any

    // Determine opponent - TWC could be home or away
    let opponent = ''
    if (match.home_team === 'TWC') {
      opponent = match.data?.away?.name || match.away_team
    } else {
      opponent = match.data?.home?.name || match.home_team
    }

    return NextResponse.json({
      venue: match.venue_name || 'Georgetown Pizza and Arcade',
      opponent: opponent,
      matchKey: match.match_key,
      week: match.week,
      state: match.state
    })
  } catch (error) {
    console.error('Error finding latest TWC match:', error)
    return NextResponse.json(
      { error: 'Failed to find latest match' },
      { status: 500 }
    )
  }
}
