import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * Returns roster and sub players for a given team, mirroring the TWC roster format.
 * Query params:
 *   - team (required): Team name
 *   - currentSeason (optional): The current/latest season number (default 22)
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const teamName = searchParams.get('team')
  const currentSeason = parseInt(searchParams.get('currentSeason') || '22')

  if (!teamName) {
    return NextResponse.json({ error: 'Team name required' }, { status: 400 })
  }

  try {
    // Find team key
    const { data: teams } = await supabase
      .from('teams')
      .select('team_key, team_name')
      .ilike('team_name', teamName) as { data: { team_key: string; team_name: string }[] | null }

    if (!teams || teams.length === 0) {
      return NextResponse.json({ rosterPlayers: [], subPlayers: [] })
    }

    const teamKey = teams[0].team_key

    // Get current season players
    const { data: currentData } = await supabase
      .from('player_match_participation')
      .select('player_name, is_sub')
      .eq('season', currentSeason)
      .eq('team', teamKey) as { data: { player_name: string; is_sub: boolean }[] | null }

    const currentPlayers = new Set<string>()
    const currentSubs = new Set<string>()

    for (const row of (currentData || [])) {
      const name = (row.player_name || '').trim()
      if (!name) continue
      if (row.is_sub) {
        currentSubs.add(name)
      } else {
        currentPlayers.add(name)
      }
    }

    // Roster takes priority
    Array.from(currentPlayers).forEach(player => currentSubs.delete(player))

    const rosterPlayers = Array.from(currentPlayers).sort()
    const subPlayers = new Set<string>(currentSubs)

    // Add players from previous 2 seasons who didn't play in current season
    const prevSeasons = [currentSeason - 1, currentSeason - 2].filter(s => s > 0)
    if (prevSeasons.length > 0) {
      const { data: oldData } = await supabase
        .from('player_match_participation')
        .select('player_name')
        .in('season', prevSeasons)
        .eq('team', teamKey) as { data: { player_name: string }[] | null }

      for (const row of (oldData || [])) {
        const name = (row.player_name || '').trim()
        if (!name) continue
        if (!currentPlayers.has(name) && !subPlayers.has(name)) {
          subPlayers.add(name)
        }
      }
    }

    return NextResponse.json({
      rosterPlayers,
      subPlayers: Array.from(subPlayers).sort(),
    })
  } catch (error) {
    console.error('Error fetching opponent roster:', error)
    return NextResponse.json(
      { error: 'Failed to fetch opponent roster' },
      { status: 500 }
    )
  }
}
