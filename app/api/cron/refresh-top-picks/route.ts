import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// Default season range — keep aligned with the dashboard's defaults so the
// cache hit rate is high in the common case. If the user picks a different
// range on the dashboard, the dashboard falls back to a live compute.
const DEFAULT_SEASON_START = 20
const TOP_PICKS_LIMIT = 10

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

function getBaseUrl() {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  return 'http://localhost:3000'
}

/**
 * Weekly cron: pre-compute Top Picks for TWC's next match and write them to
 * cache_top_picks. The dashboard reads /api/top-picks first and falls back
 * to a live /api/machine-stats call if the cache misses, so a failure here
 * degrades gracefully into the previous (slower) behavior.
 *
 * Schedule: Tue 13:00 UTC (= Tue 05:00–06:00 Pacific) — well after Monday
 * night matches and after the daily sync-data cron has refreshed games.
 *
 * Manual trigger: GET /api/cron/refresh-top-picks?key=<CRON_SECRET>
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    const { searchParams } = new URL(request.url)
    if (searchParams.get('key') !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const baseUrl = getBaseUrl()

  try {
    // 1. Get TWC's next match (opponent display name + venue)
    const nextRes = await fetch(`${baseUrl}/api/latest-twc-match`, { cache: 'no-store' })
    if (!nextRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch next match' }, { status: 502 })
    }
    const next = await nextRes.json() as {
      venue?: string
      opponent?: string
      season?: number
    }
    if (!next.venue || !next.opponent || !next.season) {
      return NextResponse.json({ error: 'Next match has no opponent/venue', detail: next }, { status: 200 })
    }

    const venue = next.venue
    const opponentName = next.opponent
    const currentSeason = next.season
    const seasonStart = DEFAULT_SEASON_START
    const seasonEnd = currentSeason

    // 2. Look up opponent team key from teams table (case-insensitive name match).
    const { data: teamRow } = await supabase
      .from('teams')
      .select('team_key, team_name')
      .ilike('team_name', opponentName)
      .maybeSingle() as { data: { team_key: string; team_name: string } | null }

    if (!teamRow) {
      return NextResponse.json({ error: `Team not found: ${opponentName}` }, { status: 200 })
    }
    const opponentKey = teamRow.team_key
    const opponentTeamName = teamRow.team_name

    // 3. Fetch opponent's current roster (non-subs in the current season).
    const rosterRes = await fetch(
      `${baseUrl}/api/opponent-roster?team=${encodeURIComponent(opponentTeamName)}&currentSeason=${currentSeason}`,
      { cache: 'no-store' }
    )
    let rosterPlayers: string[] = []
    if (rosterRes.ok) {
      const data = await rosterRes.json() as { rosterPlayers?: string[] }
      rosterPlayers = data.rosterPlayers || []
    }

    // 4. Fetch the venue's current machine list (so picks list matches what
    //    the dashboard renders).
    const venuesRes = await fetch(`${baseUrl}/api/venues?season=${currentSeason}`, { cache: 'no-store' })
    let venueMachines: string[] = []
    if (venuesRes.ok) {
      const data = await venuesRes.json() as { venues?: Array<{ name: string; machines?: string[] }> }
      const v = (data.venues || []).find(v => v.name === venue)
      venueMachines = v?.machines || []
    }
    if (venueMachines.length === 0) {
      return NextResponse.json({ error: `No machines for venue ${venue}` }, { status: 200 })
    }

    // 5. Compute Top Picks via the existing machine-stats endpoint with the
    //    same params the dashboard uses (league-wide opponent stats limited
    //    to the current roster).
    const seasons: number[] = []
    for (let s = seasonStart; s <= seasonEnd; s++) seasons.push(s)
    const statsParams = new URLSearchParams({
      seasons: seasons.join(','),
      venue,
      teamName: 'The Wrecking Crew',
      opponentTeam: opponentTeamName,
      teamVenueSpecific: 'false',
      machines: venueMachines.join(','),
    })
    if (rosterPlayers.length > 0) {
      statsParams.set('opponentRoster', rosterPlayers.join(','))
    }

    const statsRes = await fetch(`${baseUrl}/api/machine-stats?${statsParams}`, { cache: 'no-store' })
    if (!statsRes.ok) {
      const text = await statsRes.text()
      return NextResponse.json({ error: 'machine-stats fetch failed', detail: text.slice(0, 200) }, { status: 502 })
    }
    const statsData = await statsRes.json() as { stats?: any[] }
    const allStats = statsData.stats || []

    // Match the dashboard's sort/filter exactly so the cached payload is what
    // the user would have seen.
    const picks = allStats
      .filter((s: any) => (s.timesPicked || 0) > 0)
      .sort((a: any, b: any) => (b.timesPicked || 0) - (a.timesPicked || 0))
      .slice(0, TOP_PICKS_LIMIT)

    // 6. Upsert the cache row.
    const { error: upsertError } = await supabase
      .from('cache_top_picks')
      .upsert(
        {
          opponent_team_key: opponentKey,
          opponent_team_name: opponentTeamName,
          venue,
          season_start: seasonStart,
          season_end: seasonEnd,
          roster_players: rosterPlayers,
          picks,
          computed_at: new Date().toISOString(),
        },
        { onConflict: 'opponent_team_key,venue,season_start,season_end' }
      )

    if (upsertError) {
      console.error('[refresh-top-picks] upsert error:', upsertError)
      return NextResponse.json({ error: 'Cache write failed', detail: upsertError.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      opponentKey,
      opponentTeamName,
      venue,
      seasonStart,
      seasonEnd,
      rostered: rosterPlayers.length,
      machines: venueMachines.length,
      picks: picks.length,
    })
  } catch (error) {
    console.error('[refresh-top-picks] unexpected error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
