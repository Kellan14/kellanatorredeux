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
      gamesData = await fetchAllRecords(
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
        const playerName = game[`player_${i}_name`]
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

    // Generate recommendations: best machine for each available player
    const recommendations = availablePlayers.map((player: string) => {
      const playerStats = playerMachineStats.get(player)

      if (!playerStats) {
        return {
          player,
          recommendedMachine: null,
          avgScore: 0,
          timesPlayed: 0,
          confidence: 'low'
        }
      }

      let bestMachine = null
      let bestAvg = 0
      let bestCount = 0

      for (const [machine, stats] of playerStats.entries()) {
        if (!machinesAtVenue.includes(machine)) continue

        const avg = stats.total / stats.count

        if (avg > bestAvg) {
          bestAvg = avg
          bestMachine = machine
          bestCount = stats.count
        }
      }

      return {
        player,
        recommendedMachine: bestMachine,
        avgScore: bestAvg,
        timesPlayed: bestCount,
        confidence: bestCount >= 5 ? 'high' : bestCount >= 2 ? 'medium' : 'low'
      }
    }).sort((a: any, b: any) => b.avgScore - a.avgScore)

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
