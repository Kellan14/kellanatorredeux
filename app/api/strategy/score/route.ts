import { NextRequest, NextResponse } from 'next/server'
import { calculatePlayerMachineStats, type UserInputData } from '@/lib/strategy/stats-calculator'
import { calculatePerformanceScore, calculateConfidenceLevel } from '@/lib/strategy/calculator'
import type { PlayerMachineStats } from '@/types/strategy'
import { createClient } from '@supabase/supabase-js'
import { getAllMachineVariations, getCanonicalMachineKey } from '@/lib/machine-mappings'

export const dynamic = 'force-dynamic'

/**
 * Score a given set of player-machine assignments without re-optimizing.
 * Used by the drag-and-drop UI to update scores after manual swaps.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      format,
      assignments,
      seasonStart = 20,
      seasonEnd = 22,
      venue,
      venueWeight = 0.7,
      userInputWeight = 0,
      confidenceBoost = 0,
      scoreWeights
    } = body

    if (!assignments || !Array.isArray(assignments)) {
      return NextResponse.json({ error: 'Missing assignments array' }, { status: 400 })
    }

    const playerNames = Array.from(new Set(assignments.map((a: any) => a.player))) as string[]
    const machines = Array.from(new Set(assignments.map((a: any) => a.machine))) as string[]

    // Fetch user inputs if user input weight or confidence boost is active
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

    // Fetch stats (with venue blending if applicable)
    let statsMap: Map<string, Map<string, PlayerMachineStats>>

    if (venue) {
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
              games_played: vStats.games_played + aStats.games_played,
              wins: vStats.wins + aStats.wins,
              losses: vStats.losses + aStats.losses,
              win_rate: vStats.win_rate * vw + aStats.win_rate * (1 - vw),
              avg_score: vStats.avg_score * vw + aStats.avg_score * (1 - vw),
              venue_adjusted_avg: vStats.venue_adjusted_avg * vw + aStats.venue_adjusted_avg * (1 - vw),
              high_score: Math.max(vStats.high_score, aStats.high_score),
              recent_form: vStats.recent_form * vw + aStats.recent_form * (1 - vw),
              streak_type: vStats.streak_type,
              streak_count: vStats.streak_count,
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
      statsMap = await calculatePlayerMachineStats(playerNames, machines, seasonStart, seasonEnd, undefined, userInputs, userInputWeight)
    }

    // Score each assignment
    const scoredAssignments = assignments.map((a: any) => {
      const stats = statsMap.get(a.player)?.get(a.machine) || null
      const ui = userInputs?.get(a.player)?.get(a.machine)
      const score = calculatePerformanceScore(stats, confidenceBoost, scoreWeights)
      const confidence = stats ? calculateConfidenceLevel(stats.games_played) : 1
      return {
        player_id: a.player,
        machine_id: a.machine,
        expected_score: score,
        confidence,
        venue_adjusted_avg: stats?.venue_adjusted_avg ?? null,
        user_average: ui?.userAverage ?? null,
        user_confidence: ui?.userConfidence ?? null
      }
    })

    const totalScore = scoredAssignments.reduce((sum: number, a: any) => sum + a.expected_score, 0)
    const count = scoredAssignments.length
    const avgScore = count > 0 ? totalScore / count : 0
    const winProbability = 1 / (1 + Math.exp(-10 * (avgScore - 0.5)))

    return NextResponse.json({
      format,
      assignments: scoredAssignments,
      total_score: totalScore,
      win_probability: winProbability
    })
  } catch (error: any) {
    console.error('Score calculation error:', error)
    return NextResponse.json(
      { error: error.message || 'Score calculation failed' },
      { status: 500 }
    )
  }
}
