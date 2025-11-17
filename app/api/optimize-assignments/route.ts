import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { venue, opponent, seasonStart = 20, seasonEnd = 22, format, machines, availablePlayers } = body

    if (!venue || !opponent || !machines || !availablePlayers || availablePlayers.length === 0) {
      return NextResponse.json(
        { error: 'Invalid parameters' },
        { status: 400 }
      )
    }

    const playersPerMachine = format === 'singles' ? 1 : 2

    // Check if we have enough players
    if (availablePlayers.length < machines.length * playersPerMachine) {
      return NextResponse.json(
        { error: `Not enough players. Need ${machines.length * playersPerMachine}, have ${availablePlayers.length}` },
        { status: 400 }
      )
    }

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
          .in('machine', machines)
      )
    } catch (error) {
      console.error('Error fetching games:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Calculate player performance on each machine
    const playerMachineAvgs = new Map<string, Map<string, number>>()

    for (const game of gamesData) {
      for (let i = 1; i <= 4; i++) {
        const playerName = game[`player_${i}_name`]
        const score = game[`player_${i}_score`]

        if (!playerName || score == null || !availablePlayers.includes(playerName)) continue

        if (!playerMachineAvgs.has(playerName)) {
          playerMachineAvgs.set(playerName, new Map())
        }

        const playerStats = playerMachineAvgs.get(playerName)!
        if (!playerStats.has(game.machine)) {
          playerStats.set(game.machine, 0)
        }

        const currentAvg = playerStats.get(game.machine)!
        const currentCount = gamesData.filter((g: any) =>
          [g.player_1_name, g.player_2_name, g.player_3_name, g.player_4_name].includes(playerName) &&
          g.machine === game.machine
        ).length

        playerStats.set(game.machine, (currentAvg * (currentCount - 1) + score) / currentCount)
      }
    }

    // Greedy assignment algorithm: assign best player to each machine
    const assignments: Array<{ machine: string; players: string[]; expectedAvg: number }> = []
    const assignedPlayers = new Set<string>()

    for (const machine of machines) {
      const playersToAssign: Array<{ player: string; avg: number }> = []

      for (const player of availablePlayers) {
        if (assignedPlayers.has(player)) continue

        const playerStats = playerMachineAvgs.get(player)
        const avg = playerStats?.get(machine) || 0

        playersToAssign.push({ player, avg })
      }

      // Sort by average score and take top players
      playersToAssign.sort((a, b) => b.avg - a.avg)
      const selectedPlayers = playersToAssign.slice(0, playersPerMachine)

      selectedPlayers.forEach(p => assignedPlayers.add(p.player))

      const expectedAvg = selectedPlayers.reduce((sum, p) => sum + p.avg, 0) / selectedPlayers.length

      assignments.push({
        machine,
        players: selectedPlayers.map(p => p.player),
        expectedAvg
      })
    }

    return NextResponse.json({
      assignments,
      format,
      totalExpectedScore: assignments.reduce((sum, a) => sum + a.expectedAvg, 0)
    })
  } catch (error) {
    console.error('Error optimizing assignments:', error)
    return NextResponse.json(
      { error: 'Failed to optimize assignments' },
      { status: 500 }
    )
  }
}
