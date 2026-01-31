import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { applyVenueMachineListOverrides } from '@/lib/venue-machine-lists'
import { getVenueVariations } from '@/lib/venue-mappings'

export const dynamic = 'force-dynamic';

type StatsMap = Map<string, Map<string, { total: number; count: number }>>

function buildPlayerMachineStats(games: any[], machinesAtVenue: string[]): StatsMap {
  const stats: StatsMap = new Map()
  for (const game of games) {
    if (!machinesAtVenue.includes(game.machine)) continue
    for (let i = 1; i <= 4; i++) {
      const playerName = game[`player_${i}`]
      const score = game[`player_${i}_score`]
      if (!playerName || score == null) continue
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
): { avg: number; count: number; source: 'venue' | 'all' | 'blended' | 'none' } {
  const vs = venueStats.get(player)?.get(machine)
  const as_ = allStats.get(player)?.get(machine)
  const venueAvg = vs ? vs.total / vs.count : null
  const allAvg = as_ ? as_.total / as_.count : null

  if (venueAvg !== null && allAvg !== null) {
    return {
      avg: venueAvg * venueWeight + allAvg * (1 - venueWeight),
      count: (vs?.count || 0) + (as_?.count || 0),
      source: 'blended'
    }
  } else if (venueAvg !== null) {
    return { avg: venueAvg, count: vs?.count || 0, source: 'venue' }
  } else if (allAvg !== null) {
    return { avg: allAvg, count: as_?.count || 0, source: 'all' }
  }
  return { avg: 0, count: 0, source: 'none' }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { venue, opponent, seasonStart = 20, seasonEnd = 22, format, numMachines, availablePlayers, venueWeight = 0.7 } = body

    if (!venue || !opponent || !availablePlayers || availablePlayers.length === 0) {
      return NextResponse.json(
        { error: 'Invalid parameters' },
        { status: 400 }
      )
    }

    const vw = Math.max(0, Math.min(1, venueWeight))

    // Get machines at venue
    const latestSeason = seasonEnd
    const venueVariations = getVenueVariations(venue)
    let venueMachinesData
    try {
      venueMachinesData = await fetchAllRecords<{ machine: string }>(
        () => supabase
          .from('games')
          .select('machine')
          .in('venue', venueVariations)
          .eq('season', latestSeason)
          .order('id', { ascending: true })
      )
    } catch (error) {
      console.error('Error fetching venue machines:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    let machinesAtVenue = Array.from(new Set(venueMachinesData?.map(g => g.machine) || []))
    machinesAtVenue = applyVenueMachineListOverrides(venue, machinesAtVenue)

    // Fetch venue-specific games
    let venueGames: any[] = []
    try {
      venueGames = await fetchAllRecords<any>(
        () => supabase
          .from('games')
          .select('*')
          .in('venue', venueVariations)
          .gte('season', seasonStart)
          .lte('season', seasonEnd)
          .order('id', { ascending: true })
      )
    } catch (error) {
      console.error('Error fetching venue games:', error)
    }

    // Fetch all-venue games (excluding venue-specific to avoid double counting)
    let allVenueGames: any[] = []
    try {
      const allGames = await fetchAllRecords<any>(
        () => supabase
          .from('games')
          .select('*')
          .gte('season', seasonStart)
          .lte('season', seasonEnd)
          .order('id', { ascending: true })
      )
      // Exclude venue-specific games so stats don't overlap
      const venueGameIds = new Set(venueGames.map(g => g.id))
      allVenueGames = allGames.filter(g => !venueGameIds.has(g.id))
    } catch (error) {
      console.error('Error fetching all-venue games:', error)
    }

    // Build stats maps
    const venuePlayerStats = buildPlayerMachineStats(venueGames, machinesAtVenue)
    const allPlayerStats = buildPlayerMachineStats(allVenueGames, machinesAtVenue)

    // Calculate machine scores for available players using blended averages
    const machineScores = new Map<string, number>()
    for (const machine of machinesAtVenue) {
      let totalPlayerAvg = 0
      let playerCount = 0

      for (const player of availablePlayers) {
        const { avg } = getBlendedAvg(player, machine, venuePlayerStats, allPlayerStats, vw)
        if (avg > 0) {
          totalPlayerAvg += avg
          playerCount++
        }
      }

      machineScores.set(machine, playerCount > 0 ? totalPlayerAvg / playerCount : 0)
    }

    // Sort machines by score and pick top N
    const rankedMachines = Array.from(machineScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, numMachines)
      .map(([machine]) => machine)

    // Assign best players to each machine
    const playersPerMachine = format === 'doubles' ? 2 : 1
    const usedPlayers = new Set<string>()
    const recommendations = []

    for (const machine of rankedMachines) {
      const assignedPlayers: string[] = []

      const playerScores = availablePlayers
        .filter((p: string) => !usedPlayers.has(p))
        .map((player: string) => {
          const blended = getBlendedAvg(player, machine, venuePlayerStats, allPlayerStats, vw)
          return {
            player,
            avg: blended.avg,
            count: blended.count,
            source: blended.source
          }
        })
        .sort((a: any, b: any) => b.avg - a.avg)

      for (let i = 0; i < playersPerMachine && i < playerScores.length; i++) {
        assignedPlayers.push(playerScores[i].player)
        usedPlayers.add(playerScores[i].player)
      }

      // Determine data source for this machine recommendation
      const sources = new Set(playerScores.slice(0, playersPerMachine).map((p: any) => p.source))
      let dataSource = 'none'
      if (sources.has('blended')) dataSource = 'blended'
      else if (sources.has('venue')) dataSource = 'venue'
      else if (sources.has('all')) dataSource = 'all'

      recommendations.push({
        machine,
        players: assignedPlayers,
        dataSource
      })
    }

    return NextResponse.json({
      recommendations,
      machinesAtVenue,
      venue,
      venueWeight: vw
    })
  } catch (error) {
    console.error('Error optimizing picks:', error)
    return NextResponse.json(
      { error: 'Failed to optimize picks' },
      { status: 500 }
    )
  }
}
