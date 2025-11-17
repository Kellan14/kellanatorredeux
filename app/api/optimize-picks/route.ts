import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { applyVenueMachineListOverrides } from '@/lib/venue-machine-lists'

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { venue, opponent, seasonStart = 20, seasonEnd = 22, format, numMachines, availablePlayers } = body

    if (!venue || !opponent || !availablePlayers || availablePlayers.length === 0) {
      return NextResponse.json(
        { error: 'Invalid parameters' },
        { status: 400 }
      )
    }

    // Get machines at venue
    const latestSeason = seasonEnd
    let venueMachinesData
    try {
      venueMachinesData = await fetchAllRecords<{ machine: string }>(
        supabase
          .from('games')
          .select('machine')
          .eq('venue', venue)
          .eq('season', latestSeason)
      )
    } catch (error) {
      console.error('Error fetching venue machines:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    let machinesAtVenue = Array.from(new Set(venueMachinesData?.map(g => g.machine) || []))
    machinesAtVenue = applyVenueMachineListOverrides(venue, machinesAtVenue)

    // Query games with pagination
    let gamesData
    try {
      gamesData = await fetchAllRecords<any>(
        supabase
          .from('games')
          .select('*')
          .eq('venue', venue)
          .gte('season', seasonStart)
          .lte('season', seasonEnd)
      )
    } catch (error) {
      console.error('Error fetching games:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Calculate player performance on each machine
    const playerMachineStats = new Map<string, Map<string, { total: number; count: number }>>()

    for (const game of gamesData) {
      if (!machinesAtVenue.includes(game.machine)) continue

      for (let i = 1; i <= 4; i++) {
        const playerName = game[`player_${i}`]
        const score = game[`player_${i}_score`]

        if (!playerName || score == null) continue

        if (!playerMachineStats.has(playerName)) {
          playerMachineStats.set(playerName, new Map())
        }

        const playerStats = playerMachineStats.get(playerName)!
        if (!playerStats.has(game.machine)) {
          playerStats.set(game.machine, { total: 0, count: 0 })
        }

        const machineStats = playerStats.get(game.machine)!
        machineStats.total += score
        machineStats.count++
      }
    }

    // Calculate venue averages for each machine
    const machineVenueStats = new Map<string, { total: number; count: number }>()
    for (const game of gamesData) {
      if (!machinesAtVenue.includes(game.machine)) continue

      if (!machineVenueStats.has(game.machine)) {
        machineVenueStats.set(game.machine, { total: 0, count: 0 })
      }

      const stats = machineVenueStats.get(game.machine)!
      for (let i = 1; i <= 4; i++) {
        const score = game[`player_${i}_score`]
        if (score != null) {
          stats.total += score
          stats.count++
        }
      }
    }

    // Calculate machine scores for available players
    const machineScores = new Map<string, number>()
    for (const machine of machinesAtVenue) {
      let totalPlayerAvg = 0
      let playerCount = 0

      for (const player of availablePlayers) {
        const playerStats = playerMachineStats.get(player)
        if (playerStats && playerStats.has(machine)) {
          const stats = playerStats.get(machine)!
          const avg = stats.total / stats.count
          totalPlayerAvg += avg
          playerCount++
        }
      }

      // Score is the average performance of available players on this machine
      machineScores.set(machine, playerCount > 0 ? totalPlayerAvg / playerCount : 0)
    }

    // Sort machines by score and pick top N
    const rankedMachines = Array.from(machineScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, numMachines)
      .map(([machine]) => machine)

    // For singles: assign best player to each machine
    // For doubles: assign best 2 players to each machine
    const playersPerMachine = format === 'doubles' ? 2 : 1
    const usedPlayers = new Set<string>()
    const recommendations = []

    for (const machine of rankedMachines) {
      const assignedPlayers: string[] = []

      // Find best available players for this machine
      const playerScores = availablePlayers
        .filter((p: string) => !usedPlayers.has(p))
        .map((player: string) => {
          const playerStats = playerMachineStats.get(player)
          if (!playerStats || !playerStats.has(machine)) {
            return { player, avg: 0, count: 0 }
          }
          const stats = playerStats.get(machine)!
          return {
            player,
            avg: stats.total / stats.count,
            count: stats.count
          }
        })
        .sort((a, b) => b.avg - a.avg)

      for (let i = 0; i < playersPerMachine && i < playerScores.length; i++) {
        assignedPlayers.push(playerScores[i].player)
        usedPlayers.add(playerScores[i].player)
      }

      recommendations.push({
        machine,
        players: assignedPlayers
      })
    }

    return NextResponse.json({
      recommendations,
      machinesAtVenue,
      venue
    })
  } catch (error) {
    console.error('Error optimizing picks:', error)
    return NextResponse.json(
      { error: 'Failed to optimize picks' },
      { status: 500 }
    )
  }
}
