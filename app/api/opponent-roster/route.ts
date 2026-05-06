import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getTeamRoster } from '@/lib/team-roster'

export const dynamic = 'force-dynamic'

/**
 * Returns roster + sub players for a given team.
 * Subs include every past player for the team, with the (season, week) of
 * their most recent appearance returned in `subPlayerLastSeen`.
 *
 * Query params:
 *   - team (required): Team name
 */
export async function GET(request: NextRequest) {
  const teamName = request.nextUrl.searchParams.get('team')

  if (!teamName) {
    return NextResponse.json({ error: 'Team name required' }, { status: 400 })
  }

  try {
    const { data: teams } = await supabase
      .from('teams')
      .select('team_key, team_name')
      .ilike('team_name', teamName) as { data: { team_key: string; team_name: string }[] | null }

    if (!teams || teams.length === 0) {
      return NextResponse.json({
        rosterPlayers: [],
        subPlayers: [],
        subPlayerLastSeen: {},
        currentSeason: null,
      })
    }

    const roster = await getTeamRoster(teams[0].team_key)
    return NextResponse.json({
      rosterPlayers: roster.rosterPlayers,
      subPlayers: roster.subPlayers,
      subPlayerLastSeen: roster.subPlayerLastSeen,
      currentSeason: roster.currentSeason,
    })
  } catch (error) {
    console.error('Error fetching opponent roster:', error)
    return NextResponse.json(
      { error: 'Failed to fetch opponent roster' },
      { status: 500 }
    )
  }
}
