import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic';

const CURRENT_SEASON = 22

// Cache for 1 hour since latest match info updates weekly
export const revalidate = 3600

export async function GET() {
  try {
    // Query next/latest TWC match from player_match_participation (includes upcoming matches)
    const { data: participationData, error: participationError } = await supabase
      .from('player_match_participation')
      .select('match_key, week, team')
      .eq('season', CURRENT_SEASON)
      .eq('team', 'TWC')
      .order('week', { ascending: false })
      .limit(1)
      .single<{
        match_key: string
        week: number
        team: string
      }>()

    if (participationError || !participationData) {
      return NextResponse.json({
        venue: 'Georgetown Pizza and Arcade',
        opponent: null,
        matchKey: null,
        week: null,
        isUpcoming: false
      })
    }

    // Get match details from matches table for venue and opponent
    const { data: matchData } = await supabase
      .from('matches')
      .select('home_team, away_team, venue_name, state')
      .eq('match_key', participationData.match_key)
      .single<{
        home_team: string
        away_team: string
        venue_name: string | null
        state: string
      }>()

    if (!matchData) {
      return NextResponse.json({
        venue: 'Georgetown Pizza and Arcade',
        opponent: null,
        matchKey: participationData.match_key,
        week: participationData.week,
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

    // Check if match has been played (exists in games table)
    const { data: gamesData } = await supabase
      .from('games')
      .select('id')
      .eq('match_key', participationData.match_key)
      .limit(1)

    const isUpcoming = !gamesData || gamesData.length === 0

    return NextResponse.json({
      venue: matchData.venue_name || 'Georgetown Pizza and Arcade',
      opponent: opponentName,
      matchKey: participationData.match_key,
      week: participationData.week,
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
