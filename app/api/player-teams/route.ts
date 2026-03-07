import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const playerName = searchParams.get('player')

    if (!playerName) {
      return NextResponse.json(
        { error: 'Player name is required' },
        { status: 400 }
      )
    }

    // Get all team associations from player_match_participation
    // IMPORTANT: Must use .order('id') for consistent pagination
    let participationData
    try {
      participationData = await fetchAllRecords<{
        team: string
        season: number
      }>(
        () => supabase
          .from('player_match_participation')
          .select('team, season')
          .eq('player_name', playerName)
          .order('id', { ascending: true })
      )
    } catch (error) {
      console.error('Error fetching player participation:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Group by team and collect seasons
    const teamMap = new Map<string, Set<number>>()
    for (const row of participationData || []) {
      if (!row.team) continue
      if (!teamMap.has(row.team)) {
        teamMap.set(row.team, new Set())
      }
      teamMap.get(row.team)!.add(row.season)
    }

    // Get team names for the team keys
    const teamKeys = Array.from(teamMap.keys())
    const { data: teamsData } = await supabase
      .from('teams')
      .select('team_key, team_name')
      .in('team_key', teamKeys) as { data: { team_key: string; team_name: string }[] | null }

    const teamNameMap: Record<string, string> = {}
    for (const t of teamsData || []) {
      teamNameMap[t.team_key] = t.team_name
    }

    // Build response with team names
    const teams = Array.from(teamMap.entries())
      .map(([teamKey, seasons]) => ({
        team: teamKey,
        teamName: teamNameMap[teamKey] || teamKey,
        seasons: Array.from(seasons).sort((a, b) => b - a) // Most recent first
      }))
      .sort((a, b) => {
        // Sort by most recent season
        const aMax = Math.max(...a.seasons)
        const bMax = Math.max(...b.seasons)
        return bMax - aMax
      })

    return NextResponse.json({ teams })
  } catch (error) {
    console.error('Error fetching player teams:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player teams' },
      { status: 500 }
    )
  }
}
