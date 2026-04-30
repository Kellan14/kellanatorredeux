import { NextRequest, NextResponse } from 'next/server'
import { calculatePlayerMachineStats, type UserInputData } from '@/lib/strategy/stats-calculator'
import type { PlayerMachineStats } from '@/types/strategy'
import { createClient } from '@supabase/supabase-js'
import { getAllMachineVariations, getCanonicalMachineKey } from '@/lib/machine-mappings'

/**
 * GET /api/strategy/matrix
 *
 * Fetches player-machine performance matrix data from the games table.
 * Returns serialized stats for displaying in PerformanceMatrix component.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    const playerNamesParam = searchParams.get('playerNames')
    const machinesParam = searchParams.get('machines')
    const seasonStart = parseInt(searchParams.get('seasonStart') || '20')
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '22')
    const venue = searchParams.get('venue') || undefined
    // When usePerGameNormalized is true (the strategy page's default), the
    // venueWeight blend is bypassed — each score is judged against its own
    // venue's avg, which is what venueWeight=1 produces when scope is set.
    const usePerGameNormalized = searchParams.get('usePerGameNormalized') !== 'false'
    const venueWeight = usePerGameNormalized
      ? 1
      : parseFloat(searchParams.get('venueWeight') || '1')
    const userInputWeight = parseFloat(searchParams.get('userInputWeight') || '0')
    const confidenceBoost = parseFloat(searchParams.get('confidenceBoost') || '0')
    const scoreWeightsParam = searchParams.get('scoreWeights')
    const scoreWeights = scoreWeightsParam ? JSON.parse(scoreWeightsParam) : undefined

    if (!playerNamesParam || !machinesParam) {
      return NextResponse.json(
        { error: 'playerNames and machines query parameters are required' },
        { status: 400 }
      )
    }

    const playerNames = playerNamesParam.split(',').map(name => name.trim())
    const machines = machinesParam.split(',').map(name => name.trim())

    if (playerNames.length === 0 || machines.length === 0) {
      return NextResponse.json(
        { error: 'playerNames and machines must not be empty' },
        { status: 400 }
      )
    }

    // Fetch user inputs if weight > 0
    let userInputs: Map<string, Map<string, UserInputData>> | undefined
    if (userInputWeight > 0 || confidenceBoost > 0) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey)
        const machineVariations = getAllMachineVariations(machines)
        let query = supabase
          .from('user_machine_inputs')
          .select('player_name, machine, user_average, user_confidence')
          .in('player_name', playerNames)
          .in('machine', machineVariations)

        if (venue) {
          query = query.in('venue', [venue, ''])
        }

        const { data } = await query

        if (data) {
          userInputs = new Map()
          for (const row of data) {
            // Normalize stored machine name to canonical key for matching
            const canonical = getCanonicalMachineKey(row.machine)
            const machineKey = machines.includes(canonical) ? canonical
              : machines.find(m => m.toLowerCase() === canonical.toLowerCase()) || canonical
            if (!userInputs.has(row.player_name)) {
              userInputs.set(row.player_name, new Map())
            }
            userInputs.get(row.player_name)!.set(machineKey, {
              userAverage: row.user_average,
              userConfidence: row.user_confidence,
            })
          }
        }
      }
    }

    // Calculate stats — blend venue-specific and all-venue if venue + venueWeight provided
    let statsMap: Map<string, Map<string, PlayerMachineStats>>

    if (venue && venueWeight < 1) {
      const vw = Math.max(0, Math.min(1, venueWeight))
      const [venueStats, allStats] = await Promise.all([
        calculatePlayerMachineStats(playerNames, machines, seasonStart, seasonEnd, venue, userInputs, userInputWeight),
        calculatePlayerMachineStats(playerNames, machines, seasonStart, seasonEnd, undefined, userInputs, userInputWeight)
      ])

      statsMap = new Map()
      for (const player of playerNames) {
        const playerBlended = new Map<string, PlayerMachineStats>()
        const vs = venueStats.get(player)
        const as_ = allStats.get(player)

        for (const machine of machines) {
          const vStats = vs?.get(machine)
          const aStats = as_?.get(machine)
          if (!vStats && !aStats) continue

          if (vStats && aStats) {
            playerBlended.set(machine, {
              id: vStats.id,
              player_id: vStats.player_id,
              machine_id: vStats.machine_id,
              games_played: aStats.games_played,
              wins: aStats.wins,
              losses: aStats.losses,
              win_rate: vStats.win_rate * vw + aStats.win_rate * (1 - vw),
              avg_score: vStats.avg_score * vw + aStats.avg_score * (1 - vw),
              venue_adjusted_avg: vStats.venue_adjusted_avg * vw + aStats.venue_adjusted_avg * (1 - vw),
              high_score: Math.max(vStats.high_score, aStats.high_score),
              recent_form: vStats.recent_form * vw + aStats.recent_form * (1 - vw),
              streak_type: aStats.streak_type,
              streak_count: aStats.streak_count,
              confidence_score: Math.max(vStats.confidence_score, aStats.confidence_score),
              user_confidence: vStats.user_confidence || aStats.user_confidence,
              last_played: vStats.last_played || aStats.last_played
            })
          } else {
            playerBlended.set(machine, (vStats || aStats)!)
          }
        }

        if (playerBlended.size > 0) {
          statsMap.set(player, playerBlended)
        }
      }
    } else {
      statsMap = await calculatePlayerMachineStats(
        playerNames,
        machines,
        seasonStart,
        seasonEnd,
        venue,
        userInputs,
        userInputWeight
      )
    }

    // Convert Map to serializable object
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
