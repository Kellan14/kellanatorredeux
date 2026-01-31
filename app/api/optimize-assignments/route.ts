import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { getVenueVariations } from '@/lib/venue-mappings'

export const dynamic = 'force-dynamic';

type StatsMap = Map<string, Map<string, { total: number; count: number }>>

function buildPlayerMachineStats(games: any[], availablePlayers: string[]): StatsMap {
  const stats: StatsMap = new Map()
  for (const game of games) {
    for (let i = 1; i <= 4; i++) {
      const playerName = game[`player_${i}`]
      const score = game[`player_${i}_score`]
      if (!playerName || score == null || !availablePlayers.includes(playerName)) continue
      if (!stats.has(playerName)) stats.set(playerName, new Map())
      const playerStats = stats.get(playerName)!
      if (!playerStats.has(game.machine)) playerStats.set(game.machine, { total: 0, count: 0 })
      const ms = playerStats.get(game.machine)!
      ms.total += score
      ms.count++
    }
  }
  return stats
}

function getBlendedAvg(
  player: string,
  machine: string,
  venueStats: StatsMap,
  allStats: StatsMap,
  venueWeight: number
): { avg: number; source: 'venue' | 'all' | 'blended' | 'none' } {
  const vs = venueStats.get(player)?.get(machine)
  const as_ = allStats.get(player)?.get(machine)
  const venueAvg = vs ? vs.total / vs.count : null
  const allAvg = as_ ? as_.total / as_.count : null

  if (venueAvg !== null && allAvg !== null) {
    return { avg: venueAvg * venueWeight + allAvg * (1 - venueWeight), source: 'blended' }
  } else if (venueAvg !== null) {
    return { avg: venueAvg, source: 'venue' }
  } else if (allAvg !== null) {
    return { avg: allAvg, source: 'all' }
  }
  return { avg: 0, source: 'none' }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { venue, opponent, seasonStart = 20, seasonEnd = 22, format, machines, availablePlayers, venueWeight = 0.7 } = body

    if (!venue || !opponent || !machines || !availablePlayers || availablePlayers.length === 0) {
      return NextResponse.json(
        { error: 'Invalid parameters' },
        { status: 400 }
      )
    }

    const vw = Math.max(0, Math.min(1, venueWeight))
    const playersPerMachine = format === 'singles' ? 1 : 2

    if (availablePlayers.length < machines.length * playersPerMachine) {
      return NextResponse.json(
        { error: `Not enough players. Need ${machines.length * playersPerMachine}, have ${availablePlayers.length}` },
        { status: 400 }
      )
    }

    // Build OR filter for case-insensitive machine matching
    const machineFilter = machines.map((m: string) => {
      const lower = m.toLowerCase()
      const needsQuoting = /[\s,()]/.test(lower)
      return needsQuoting ? `machine.ilike."${lower}"` : `machine.ilike.${lower}`
    }).join(',')

    // Fetch venue-specific games
    const venueVariations = getVenueVariations(venue)
    let venueGames: any[] = []
    try {
      venueGames = await fetchAllRecords<any>(
        () => supabase
          .from('games')
          .select('*')
          .in('venue', venueVariations)
          .gte('season', seasonStart)
          .lte('season', seasonEnd)
          .or(machineFilter)
          .order('id', { ascending: true })
      )
    } catch (error) {
      console.error('Error fetching venue games:', error)
    }

    // Fetch all-venue games (excluding venue-specific)
    let allVenueGames: any[] = []
    try {
      const allGames = await fetchAllRecords<any>(
        () => supabase
          .from('games')
          .select('*')
          .gte('season', seasonStart)
          .lte('season', seasonEnd)
          .or(machineFilter)
          .order('id', { ascending: true })
      )
      const venueGameIds = new Set(venueGames.map(g => g.id))
      allVenueGames = allGames.filter(g => !venueGameIds.has(g.id))
    } catch (error) {
      console.error('Error fetching all-venue games:', error)
    }

    // Build stats maps
    const venuePlayerStats = buildPlayerMachineStats(venueGames, availablePlayers)
    const allPlayerStats = buildPlayerMachineStats(allVenueGames, availablePlayers)

    // Greedy assignment: assign best player to each machine using blended scores
    const assignments: Array<{ machine: string; players: string[]; expectedAvg: number; dataSource: string }> = []
    const assignedPlayers = new Set<string>()

    for (const machine of machines) {
      const playersToAssign: Array<{ player: string; avg: number; source: string }> = []

      for (const player of availablePlayers) {
        if (assignedPlayers.has(player)) continue
        const blended = getBlendedAvg(player, machine, venuePlayerStats, allPlayerStats, vw)
        playersToAssign.push({ player, avg: blended.avg, source: blended.source })
      }

      playersToAssign.sort((a, b) => b.avg - a.avg)
      const selectedPlayers = playersToAssign.slice(0, playersPerMachine)

      selectedPlayers.forEach(p => assignedPlayers.add(p.player))

      const expectedAvg = selectedPlayers.reduce((sum, p) => sum + p.avg, 0) / selectedPlayers.length

      const sources = new Set(selectedPlayers.map(p => p.source))
      let dataSource = 'none'
      if (sources.has('blended')) dataSource = 'blended'
      else if (sources.has('venue')) dataSource = 'venue'
      else if (sources.has('all')) dataSource = 'all'

      assignments.push({
        machine,
        players: selectedPlayers.map(p => p.player),
        expectedAvg,
        dataSource
      })
    }

    return NextResponse.json({
      assignments,
      format,
      totalExpectedScore: assignments.reduce((sum, a) => sum + a.expectedAvg, 0),
      venueWeight: vw
    })
  } catch (error) {
    console.error('Error optimizing assignments:', error)
    return NextResponse.json(
      { error: 'Failed to optimize assignments' },
      { status: 500 }
    )
  }
}
