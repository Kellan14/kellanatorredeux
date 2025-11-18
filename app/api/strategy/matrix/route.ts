import { NextRequest, NextResponse } from 'next/server'
import { calculatePlayerMachineStats } from '@/lib/strategy/stats-calculator'
import type { PlayerMachineStats } from '@/types/strategy'

/**
 * GET /api/strategy/matrix
 *
 * Fetches player-machine performance matrix data from the games table.
 * Returns serialized stats for displaying in PerformanceMatrix component.
 *
 * Query params:
 * - playerNames: comma-separated list of player names
 * - machines: comma-separated list of machine names
 * - seasonStart: starting season number (default: 20)
 * - seasonEnd: ending season number (default: 22)
 * - venue: optional venue filter (omit for all venues)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // Parse query parameters
    const playerNamesParam = searchParams.get('playerNames')
    const machinesParam = searchParams.get('machines')
    const seasonStart = parseInt(searchParams.get('seasonStart') || '20')
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '22')
    const venue = searchParams.get('venue') || undefined

    if (!playerNamesParam || !machinesParam) {
      return NextResponse.json(
        { error: 'playerNames and machines query parameters are required' },
        { status: 400 }
      )
    }

    // Split comma-separated values
    const playerNames = playerNamesParam.split(',').map(name => name.trim())
    const machines = machinesParam.split(',').map(name => name.trim())

    if (playerNames.length === 0 || machines.length === 0) {
      return NextResponse.json(
        { error: 'playerNames and machines must not be empty' },
        { status: 400 }
      )
    }

    // Calculate stats from games table (optionally filtered by venue)
    const statsMap = await calculatePlayerMachineStats(
      playerNames,
      machines,
      seasonStart,
      seasonEnd,
      venue
    )

    // Convert Map<string, Map<string, PlayerMachineStats>> to serializable object
    const serializedStats: Record<string, Record<string, PlayerMachineStats>> = {}

    for (const [playerName, machineMap] of Array.from(statsMap.entries())) {
      serializedStats[playerName] = {}
      for (const [machineName, stats] of Array.from(machineMap.entries())) {
        serializedStats[playerName][machineName] = stats
      }
    }

    return NextResponse.json({
      playerNames,
      machines,
      statsMap: serializedStats,
      seasonStart,
      seasonEnd
    })
  } catch (error) {
    console.error('Error fetching strategy matrix:', error)
    return NextResponse.json(
      { error: 'Failed to fetch strategy matrix data' },
      { status: 500 }
    )
  }
}
