import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getTeamRoster } from '@/lib/team-roster'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { data: teams } = await supabase
      .from('teams')
      .select('team_key, team_name')
      .ilike('team_name', '%wrecking%') as { data: { team_key: string; team_name: string }[] | null }

    if (!teams || teams.length === 0) {
      return NextResponse.json({ error: 'TWC team not found' }, { status: 404 })
    }

    const roster = await getTeamRoster(teams[0].team_key)
    return NextResponse.json({
      rosterPlayers: roster.rosterPlayers,
      subPlayers: roster.subPlayers,
      subPlayerLastSeen: roster.subPlayerLastSeen,
      currentSeason: roster.currentSeason,
    })
  } catch (error) {
    console.error('Error fetching TWC roster:', error)
    return NextResponse.json(
      { error: 'Failed to fetch TWC roster' },
      { status: 500 }
    )
  }
}
