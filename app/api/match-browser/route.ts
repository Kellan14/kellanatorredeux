import { NextRequest, NextResponse } from 'next/server'
import { fetchAllRecords, supabase } from '@/lib/supabase'
import { formatMatchDetail, type MatchSummary } from '@/lib/match-browser'

export const dynamic = 'force-dynamic'

const matchColumns = 'match_key,season,week,venue_name,home_team,away_team,date:data->>date'
type MatchRow = {
  match_key: string; season: number; week: number; venue_name: string | null
  date: string | null; home_team: string | null; away_team: string | null
}
const summary = (row: MatchRow): MatchSummary => ({
  key: row.match_key, season: row.season, week: row.week, venue: row.venue_name,
  date: row.date, home: row.home_team, away: row.away_team,
})

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const matchKey = params.get('match')
  const team = params.get('team')
  const opponent = params.get('opponent')
  try {
    if (matchKey !== null) {
      if (!matchKey || matchKey.length > 150) return NextResponse.json({ error: 'Invalid match' }, { status: 400 })
      const { data: match, error } = await supabase.from('matches').select(matchColumns)
        .eq('match_key', matchKey).eq('state', 'complete').maybeSingle<MatchRow>()
      if (error) throw error
      if (!match) return NextResponse.json({ error: 'Completed match not found' }, { status: 404 })
      const { data: games, error: gameError } = await supabase.from('games').select('*')
        .eq('season', match.season).eq('week', match.week).eq('match_key', matchKey)
        .order('round_number').order('game_number').order('id')
      if (gameError) throw gameError
      return NextResponse.json({ match: formatMatchDetail(summary(match), games || []) })
    }
    if (team !== null || opponent !== null) {
      // Team keys appear in a compound PostgREST filter, not a display name.
      const valid = /^[a-z0-9_-]{1,32}$/i
      if (!team || !opponent || team === opponent || !valid.test(team) || !valid.test(opponent)) {
        return NextResponse.json({ error: 'Choose two different teams' }, { status: 400 })
      }
      const rows = await fetchAllRecords<MatchRow>(() => supabase.from('matches').select(matchColumns)
        .eq('state', 'complete')
        .or(`and(home_team.eq.${team},away_team.eq.${opponent}),and(home_team.eq.${opponent},away_team.eq.${team})`)
        .order('season', { ascending: false }).order('week', { ascending: false }).order('id', { ascending: false }),
      1000, null)
      return NextResponse.json({ matches: rows.map(summary) })
    }
    const rows = await fetchAllRecords<{ team_key: string; team_name: string }>(() => supabase.from('teams')
      .select('team_key,team_name').order('team_name').order('team_key'), 1000, null)
    return NextResponse.json({ teams: rows.map(row => ({ key: row.team_key, name: row.team_name })) })
  } catch (error) {
    console.error('[match-browser]', error)
    return NextResponse.json({ error: 'Could not load match data. Try again.' }, { status: 500 })
  }
}
