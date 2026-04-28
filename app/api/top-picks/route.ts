import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
// Short-circuit cache: rows are refreshed by the weekly cron, so a 5-minute
// edge cache is plenty for the dashboard's read path.
export const revalidate = 300

/**
 * Returns the cached Top Picks rows for a given opponent + venue + season
 * range. Returns 404 when the cache misses; the dashboard then falls back
 * to a live /api/machine-stats call so the user still sees data.
 *
 * Query params:
 *   - opponentName (required): opponent team's display name (the dashboard
 *     already has this from /api/latest-twc-match)
 *   - venue        (required): venue name as stored in cache
 *   - seasonStart  (required): inclusive
 *   - seasonEnd    (required): inclusive
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const opponentName = searchParams.get('opponentName')
  const venue = searchParams.get('venue')
  const seasonStart = parseInt(searchParams.get('seasonStart') || '')
  const seasonEnd = parseInt(searchParams.get('seasonEnd') || '')

  if (!opponentName || !venue || !Number.isFinite(seasonStart) || !Number.isFinite(seasonEnd)) {
    return NextResponse.json(
      { error: 'opponentName, venue, seasonStart, seasonEnd are required' },
      { status: 400 }
    )
  }

  // Resolve display name → team_key. Cheap lookup, and lets the dashboard
  // pass the name it already has rather than fetching the full teams list.
  const { data: teamRow } = await supabase
    .from('teams')
    .select('team_key')
    .ilike('team_name', opponentName)
    .maybeSingle() as { data: { team_key: string } | null }
  if (!teamRow) {
    return NextResponse.json({ cached: false, reason: 'team not found' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('cache_top_picks' as any)
    .select('picks, computed_at, roster_players, opponent_team_name')
    .eq('opponent_team_key', teamRow.team_key)
    .eq('venue', venue)
    .eq('season_start', seasonStart)
    .eq('season_end', seasonEnd)
    .maybeSingle() as { data: {
      picks: any[]
      computed_at: string
      roster_players: string[] | null
      opponent_team_name: string
    } | null; error: any }

  if (error) {
    console.error('[top-picks] DB error:', error)
    return NextResponse.json({ error: 'Cache lookup failed' }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ cached: false }, { status: 404 })
  }

  return NextResponse.json({
    cached: true,
    computedAt: data.computed_at,
    rosterPlayers: data.roster_players || [],
    opponentTeamName: data.opponent_team_name,
    picks: data.picks || [],
  })
}
