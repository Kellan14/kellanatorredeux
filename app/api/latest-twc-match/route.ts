import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { standardizeVenueName } from '@/lib/venue-mappings'

export const dynamic = 'force-dynamic';

// Cache for 1 hour since latest match info updates weekly
export const revalidate = 3600

export async function GET() {
  try {
    // Strategy:
    // 1. Look for the earliest "pregame" TWC match (upcoming, not yet started)
    // 2. If none, look for the most recent "playing" match (in progress)
    // 3. If none, fall back to the most recent "complete" match
    // Note: Old seasons may have matches stuck in "playing" state, so we
    // prioritize "pregame" (truly upcoming) over "playing" (may be stale).

    let matchData: {
      match_key: string
      season: number
      week: number
      home_team: string
      away_team: string
      venue_name: string | null
      state: string
    } | null = null

    // Step 1: Find the earliest pregame TWC match (next upcoming)
    const { data: pregameMatches } = await supabase
      .from('matches')
      .select('match_key, season, week, home_team, away_team, venue_name, state')
      .or('home_team.eq.TWC,away_team.eq.TWC')
      .eq('state', 'pregame')
      .order('season', { ascending: true })
      .order('week', { ascending: true })
      .limit(1)

    if (pregameMatches && pregameMatches.length > 0) {
      matchData = pregameMatches[0] as any
    }

    // Step 2: If no pregame, find the most recent playing match
    if (!matchData) {
      const { data: playingMatches } = await supabase
        .from('matches')
        .select('match_key, season, week, home_team, away_team, venue_name, state')
        .or('home_team.eq.TWC,away_team.eq.TWC')
        .eq('state', 'playing')
        .order('season', { ascending: false })
        .order('week', { ascending: false })
        .limit(1)

      if (playingMatches && playingMatches.length > 0) {
        matchData = playingMatches[0] as any
      }
    }

    // Step 3: Fall back to most recent completed match
    if (!matchData) {
      const { data: recentMatches } = await supabase
        .from('matches')
        .select('match_key, season, week, home_team, away_team, venue_name, state')
        .or('home_team.eq.TWC,away_team.eq.TWC')
        .eq('state', 'complete')
        .order('season', { ascending: false })
        .order('week', { ascending: false })
        .limit(1)

      if (recentMatches && recentMatches.length > 0) {
        matchData = recentMatches[0] as any
      }
    }

    if (!matchData) {
      return NextResponse.json({
        venue: 'Georgetown Pizza and Arcade',
        opponent: null,
        matchKey: null,
        week: null,
        isUpcoming: false
      })
    }

    // Determine opponent
    const opponentTeamKey = matchData.home_team === 'TWC' ? matchData.away_team : matchData.home_team

    // Get opponent name from teams table
    let opponentName = opponentTeamKey
    if (opponentTeamKey) {
      const { data: teamData } = await supabase
        .from('teams')
        .select('team_name')
        .eq('team_key', opponentTeamKey)
        .single<{ team_name: string }>()

      if (teamData) {
        opponentName = teamData.team_name
      }
    }

    const isUpcoming = matchData.state !== 'complete'

    return NextResponse.json({
      venue: standardizeVenueName(matchData.venue_name) || 'Georgetown Pizza and Arcade',
      opponent: opponentName,
      matchKey: matchData.match_key,
      week: matchData.week,
      season: matchData.season,
      state: matchData.state,
      isUpcoming
    })
  } catch (error) {
    console.error('Error finding latest TWC match:', error)
    return NextResponse.json(
      { error: 'Failed to find latest match' },
      { status: 500 }
    )
  }
}
