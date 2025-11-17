import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const team = searchParams.get('team')
    const season = searchParams.get('season') || '22'
    const showSubs = searchParams.get('showSubs') === 'true'

    if (!team) {
      return NextResponse.json(
        { error: 'Team parameter is required' },
        { status: 400 }
      )
    }

    // The team parameter might be a team_name (e.g., "Pocketeers") or team_key (e.g., "PKT")
    // First, try to look up the team_key from the teams table
    const { data: teamData } = await supabase
      .from('teams')
      .select('team_key, team_name')
      .or(`team_key.eq.${team},team_name.ilike.${team}`)
      .single<{ team_key: string; team_name: string }>()

    // Use the team_key if found, otherwise use the original team parameter
    const teamKey = teamData?.team_key || team

    console.log('[team-roster] Looking up team:', team, '→ teamKey:', teamKey)

    // Query player_match_participation for this team
    // This table has all players from all teams, not just TWC
    // The 'team' column stores team_key, not team_name
    const { data, error } = await supabase
      .from('player_match_participation')
      .select('*')
      .eq('season', parseInt(season))
      .eq('team', teamKey)

    if (error) {
      console.error('Database error:', error)
      return NextResponse.json({
        players: []
      })
    }

    // Group by player to get unique players with their stats
    const playerMap = new Map<string, any>()

    for (const row of (data as any[]) || []) {
      const existing = playerMap.get(row.player_key)
      if (!existing) {
        playerMap.set(row.player_key, {
          name: row.player_name,
          key: row.player_key,
          ipr: row.ipr_at_match || 0,
          matchesPlayed: 1,
          sub: row.is_sub || false
        })
      } else {
        // Increment match count and update IPR to most recent
        existing.matchesPlayed++
        if (row.ipr_at_match) {
          existing.ipr = row.ipr_at_match
        }
        // If they were ever not a sub, mark as non-sub
        if (!row.is_sub) {
          existing.sub = false
        }
      }
    }

    // Convert map to array and filter by showSubs
    let players = Array.from(playerMap.values())

    if (!showSubs) {
      players = players.filter(p => !p.sub)
    }

    // Sort by IPR descending
    players.sort((a, b) => (b.ipr || 0) - (a.ipr || 0))

    return NextResponse.json({
      players: players
    })
  } catch (error) {
    console.error('Error fetching team roster:', error)
    return NextResponse.json(
      { error: 'Failed to fetch team roster' },
      { status: 500 }
    )
  }
}
