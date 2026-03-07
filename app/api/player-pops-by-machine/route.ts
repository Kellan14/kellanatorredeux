import { NextRequest, NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { machineMappings } from '@/lib/machine-mappings'
import { standardizeVenueName, venuesMatch } from '@/lib/venue-mappings'

export const dynamic = 'force-dynamic'

// Cache for 1 hour
export const revalidate = 3600

interface GameRecord {
  season: number
  week: number
  venue: string
  machine: string
  match_key: string
  round_number: number
  player_1_key: string | null
  player_1_name: string | null
  player_1_points: number | null
  player_2_key: string | null
  player_2_name: string | null
  player_2_points: number | null
  player_3_key: string | null
  player_3_name: string | null
  player_3_points: number | null
  player_4_key: string | null
  player_4_name: string | null
  player_4_points: number | null
}

/**
 * Returns POPS stats for each machine a player has played
 *
 * Query params:
 * - player (required): Player name
 * - seasonStart (optional): Start season (default 1)
 * - seasonEnd (optional): End season (default 99)
 * - venue (optional): Filter to specific venue, or "all" for all venues
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const playerName = searchParams.get('player')
  const seasonStart = parseInt(searchParams.get('seasonStart') || '1')
  const seasonEnd = parseInt(searchParams.get('seasonEnd') || '99')
  const venueFilter = searchParams.get('venue') || 'all'

  if (!playerName) {
    return NextResponse.json({ error: 'Player name required' }, { status: 400 })
  }

  try {
    // Fetch all games where this player participated
    const gamesData = await fetchAllRecords<GameRecord>(
      () => supabase
        .from('games')
        .select('season, week, venue, machine, match_key, round_number, player_1_key, player_1_name, player_1_points, player_2_key, player_2_name, player_2_points, player_3_key, player_3_name, player_3_points, player_4_key, player_4_name, player_4_points')
        .gte('season', seasonStart)
        .lte('season', seasonEnd)
        .or(`player_1_name.eq.${playerName},player_2_name.eq.${playerName},player_3_name.eq.${playerName},player_4_name.eq.${playerName}`)
        .order('season', { ascending: false })
        .order('week', { ascending: false })
    )

    if (!gamesData || gamesData.length === 0) {
      return NextResponse.json({
        machines: [],
        player: playerName,
        seasonStart,
        seasonEnd,
        venue: venueFilter
      })
    }

    // Filter by venue if specified
    const filteredGames = venueFilter === 'all'
      ? gamesData
      : gamesData.filter(g => venuesMatch(g.venue, venueFilter))

    // Aggregate stats by machine
    const machineStats: Record<string, {
      games: number
      totalPoints: number
      totalPossible: number
    }> = {}

    for (const game of filteredGames) {
      // Find which player position this player is in
      let playerPoints: number | null = null
      for (let i = 1; i <= 4; i++) {
        const name = game[`player_${i}_name` as keyof GameRecord]
        if (name === playerName) {
          playerPoints = game[`player_${i}_points` as keyof GameRecord] as number | null
          break
        }
      }

      if (playerPoints === null) continue

      // Normalize machine name
      const rawMachine = (game.machine || '').toLowerCase()
      const mapped = machineMappings[rawMachine]
      const machine = mapped ? mapped.toLowerCase() : rawMachine

      if (!machine) continue

      // Count players to determine singles vs doubles
      let playerCount = 0
      for (let i = 1; i <= 4; i++) {
        if (game[`player_${i}_key` as keyof GameRecord]) playerCount++
      }

      // Possible points: singles (2 players) = 3, doubles (4 players) = 2.5
      const possiblePoints = playerCount === 4 ? 2.5 : 3

      if (!machineStats[machine]) {
        machineStats[machine] = { games: 0, totalPoints: 0, totalPossible: 0 }
      }

      machineStats[machine].games++
      machineStats[machine].totalPoints += playerPoints
      machineStats[machine].totalPossible += possiblePoints
    }

    // Convert to array and calculate POPS
    const machines = Object.entries(machineStats)
      .map(([machine, stats]) => ({
        machine,
        games: stats.games,
        totalPoints: stats.totalPoints,
        totalPossible: stats.totalPossible,
        pops: stats.totalPossible > 0
          ? Math.round((stats.totalPoints / stats.totalPossible) * 1000) / 10
          : 0
      }))
      .sort((a, b) => b.pops - a.pops) // Sort by POPS descending

    return NextResponse.json({
      machines,
      player: playerName,
      seasonStart,
      seasonEnd,
      venue: venueFilter,
      totalGames: machines.reduce((sum, m) => sum + m.games, 0)
    })
  } catch (error) {
    console.error('Error fetching player POPS by machine:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player POPS data' },
      { status: 500 }
    )
  }
}
