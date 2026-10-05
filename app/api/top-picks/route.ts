import { NextRequest, NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { getTeamRoster } from '@/lib/team-roster'
import { rankTeamPicks, type CachedTeamPick } from '@/lib/top-picks-cache'

export const dynamic = 'force-dynamic'

/**
 * Rank an opponent's picks for any season range from the all-time pick cache.
 * The cache holds every picked game, including both players in doubles. Other
 * table columns are calculated live for the ten winning machines so range-
 * dependent averages and venue baselines remain exact.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const opponentName = params.get('opponentName')
  const venue = params.get('venue')
  const seasonStart = Number(params.get('seasonStart'))
  const seasonEnd = Number(params.get('seasonEnd'))
  if (!opponentName || !venue || !Number.isInteger(seasonStart) ||
      !Number.isInteger(seasonEnd) || seasonStart < 1 || seasonEnd < seasonStart) {
    return NextResponse.json({ error: 'Valid opponentName, venue, seasonStart, and seasonEnd are required' }, { status: 400 })
  }

  const { data: teamRow, error: teamError } = await supabase
    .from('teams')
    .select('team_key, team_name')
    .ilike('team_name', opponentName)
    .maybeSingle() as { data: { team_key: string; team_name: string } | null; error: any }
  if (teamError) return NextResponse.json({ error: 'Team lookup failed' }, { status: 500 })
  if (!teamRow) return NextResponse.json({ cached: false, reason: 'team not found' }, { status: 404 })

  try {
    const { data: build, error: buildError } = await supabase.from('cache_team_pick_builds' as any)
      .select('active_generation, refreshed_at')
      .eq('id', true)
      .maybeSingle() as { data: { active_generation: string | null; refreshed_at: string | null } | null; error: any }
    if (buildError) throw buildError
    const generation = build?.active_generation
    if (!generation) {
      return NextResponse.json({ cached: false, reason: 'cache not built' }, { status: 404 })
    }
    const [roster, allPicks] = await Promise.all([
      getTeamRoster(teamRow.team_key),
      fetchAllRecords<CachedTeamPick>(
        () => supabase.from('cache_team_pick_games' as any)
          .select('generation, game_id, team_key, season, machine, player_names')
          .eq('generation', generation)
          .eq('team_key', teamRow.team_key)
          .order('game_id', { ascending: true })
      ),
    ])
    const rosterPlayers = roster.rosterPlayers
    if (allPicks.length === 0) {
      return NextResponse.json({ cached: false, reason: 'cache empty', rosterPlayers }, { status: 404 })
    }

    let venueMachines = params.get('machines')?.split(',').map(m => m.trim()).filter(Boolean)
    if (!venueMachines?.length) {
      const venuesRes = await fetch(new URL('/api/venues', request.url), { cache: 'no-store' })
      if (!venuesRes.ok) throw new Error('Venue machine lookup failed')
      const venuesData = await venuesRes.json() as { venues?: Array<{ name: string; machines: string[] }> }
      venueMachines = venuesData.venues?.find(v => v.name === venue)?.machines || []
    }
    if (venueMachines.length === 0) {
      return NextResponse.json({ cached: false, reason: 'venue machines unavailable', rosterPlayers }, { status: 404 })
    }

    const machineKeyByLower = new Map(venueMachines.map(machine => [machine.toLowerCase(), machine]))
    const ranked = rankTeamPicks(allPicks, seasonStart, seasonEnd, venueMachines, rosterPlayers)
    const topMachines = ranked.map(row => row.machine)

    if (topMachines.length === 0) {
      return NextResponse.json({ cached: true, computedAt: build.refreshed_at, rosterPlayers, picks: [] })
    }

    const seasons = Array.from({ length: seasonEnd - seasonStart + 1 }, (_, i) => seasonStart + i)
    const statsParams = new URLSearchParams({
      seasons: seasons.join(','),
      venue,
      teamName: 'The Wrecking Crew',
      opponentTeam: teamRow.team_name,
      teamVenueSpecific: 'false',
      machines: topMachines.map(machine => machineKeyByLower.get(machine) || machine).join(','),
    })
    if (rosterPlayers.length > 0) statsParams.set('opponentRoster', rosterPlayers.join(','))
    const statsRes = await fetch(new URL(`/api/machine-stats?${statsParams}`, request.url), { cache: 'no-store' })
    if (!statsRes.ok) throw new Error(`Machine stats failed: ${statsRes.status}`)
    const statsData = await statsRes.json() as { stats?: Array<{ machine: string; timesPicked: number }> }
    const statsByMachine = new Map((statsData.stats || []).map(stat => [stat.machine, stat]))
    const picks = ranked.map(({ machine, timesPicked }) => {
      const stat = statsByMachine.get(machine)
      return stat ? { ...stat, timesPicked } : null
    }).filter(Boolean)

    return NextResponse.json({
      cached: true,
      computedAt: build.refreshed_at,
      rosterPlayers,
      opponentTeamName: teamRow.team_name,
      picks,
    })
  } catch (error: any) {
    if (error?.code === 'PGRST205' || error?.code === '42P01') {
      return NextResponse.json({ cached: false, reason: 'cache unavailable' }, { status: 404 })
    }
    console.error('[top-picks] Failed:', error)
    return NextResponse.json({ error: 'Top Picks lookup failed' }, { status: 500 })
  }
}
