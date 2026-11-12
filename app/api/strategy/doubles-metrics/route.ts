import { NextResponse } from 'next/server'
import { fetchAllRecords, supabase, type Database } from '@/lib/supabase'
import { getScoreLimits } from '@/lib/score-limits'
import { evaluateDoublesLineups } from '@/lib/strategy/doubles-metrics'
import type { DoublesLineup } from '@/lib/ranked-doubles'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const validName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 150

export async function POST(request: Request) {
  try {
    const { lineups, opponentPlayers, seasonStart, seasonEnd, venue, twcVenueSpecific, teamVenueSpecific, format } = await request.json()
    const slots = format === 'singles' ? 1 : 2
    if (!Array.isArray(lineups) || lineups.length < 1 || lineups.length > 20 ||
      !Array.isArray(opponentPlayers) || opponentPlayers.length > 40 || !opponentPlayers.every(validName) ||
      !validName(venue) || !Number.isInteger(seasonStart) || !Number.isInteger(seasonEnd) ||
      seasonStart < 1 || seasonEnd < seasonStart || seasonEnd > 100 ||
      !lineups.every(lineup => Array.isArray(lineup?.picks) && lineup.picks.length >= 1 && lineup.picks.length <= 12 &&
        lineup.picks.every((pick: DoublesLineup['picks'][number]) => validName(pick?.machine) &&
          Array.isArray(pick.players) && pick.players.length === slots && pick.players.every(validName) &&
          (pick.opponents === undefined || (Array.isArray(pick.opponents) && pick.opponents.length <= slots && pick.opponents.every(validName)))))) {
      return NextResponse.json({ error: 'Invalid doubles lineups or season range' }, { status: 400 })
    }
    const machines = Array.from(new Set<string>((lineups as DoublesLineup[]).flatMap(lineup =>
      lineup.picks.flatMap(pick => [pick.machine, pick.machine.toLowerCase(), pick.machine.toUpperCase()]))))
    if (machines.length > 180) return NextResponse.json({ error: 'Too many machines' }, { status: 400 })
    const [games, limits] = await Promise.all([
      fetchAllRecords<Database['public']['Tables']['games']['Row']>(() => supabase.from('games')
        .select('*').gte('season', seasonStart).lte('season', seasonEnd).in('machine', machines)),
      getScoreLimits(),
    ])
    const results = evaluateDoublesLineups(games, lineups, Array.from(new Set<string>(opponentPlayers)), venue,
      twcVenueSpecific === true, teamVenueSpecific === true, limits)
    return NextResponse.json({ results })
  } catch (error) {
    console.error('[doubles-metrics]', error)
    return NextResponse.json({ error: 'Could not calculate doubles metrics' }, { status: 500 })
  }
}
