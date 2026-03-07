import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Find TWC team key
    const { data: teams } = await supabase
      .from('teams')
      .select('team_key, team_name')
      .ilike('team_name', '%wrecking%') as { data: { team_key: string; team_name: string }[] | null }

    if (!teams || teams.length === 0) {
      return NextResponse.json({ error: 'TWC team not found' }, { status: 404 })
    }

    const twcKey = teams[0].team_key

    // Get season 22 players (current roster)
    const { data: season22Data } = await supabase
      .from('player_match_participation')
      .select('player_name, is_sub')
      .eq('season', 22)
      .eq('team', twcKey) as { data: { player_name: string; is_sub: boolean }[] | null }

    const season22Players = new Set<string>()
    const season22Subs = new Set<string>()

    for (const row of (season22Data || [])) {
      const name = (row.player_name || '').trim()
      if (!name) continue
      if (row.is_sub) {
        season22Subs.add(name)
      } else {
        season22Players.add(name)
      }
    }

    // Roster takes priority - remove from subs if they're on the roster
    Array.from(season22Players).forEach(player => season22Subs.delete(player))

    const rosterPlayers = Array.from(season22Players).sort()
    const subPlayers = new Set<string>(season22Subs)

    // Also add players from seasons 20-21 who didn't play in season 22
    const { data: oldSeasonsData } = await supabase
      .from('player_match_participation')
      .select('player_name')
      .in('season', [20, 21])
      .eq('team', twcKey) as { data: { player_name: string }[] | null }

    for (const row of (oldSeasonsData || [])) {
      const name = (row.player_name || '').trim()
      if (!name) continue
      if (!season22Players.has(name) && !subPlayers.has(name)) {
        subPlayers.add(name)
      }
    }

    const subPlayersList = Array.from(subPlayers).sort()

    return NextResponse.json({
      rosterPlayers,
      subPlayers: subPlayersList,
    })
  } catch (error) {
    console.error('Error fetching TWC roster:', error)
    return NextResponse.json(
      { error: 'Failed to fetch TWC roster' },
      { status: 500 }
    )
  }
}
