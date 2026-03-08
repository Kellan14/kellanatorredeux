import { NextRequest, NextResponse } from 'next/server'
import { LineupOptimizer } from '@/lib/strategy/optimizer'
import { calculatePairStats } from '@/lib/strategy/stats-calculator'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { getVenueVariations } from '@/lib/venue-mappings'
import { getAllMachineVariations } from '@/lib/machine-mappings'

export const dynamic = 'force-dynamic'

/**
 * Generate all combinations of size k from array
 */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const results: T[][] = []
  const [first, ...rest] = arr
  for (const combo of combinations(rest, k - 1)) {
    results.push([first, ...combo])
  }
  for (const combo of combinations(rest, k)) {
    results.push(combo)
  }
  return results
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      format,
      playerNames,
      machines,
      seasonStart = 20,
      seasonEnd = 22,
      venue,
      venueWeight,
      exclusions = {},
      mustPlay = [],
      userInputWeight = 0,
      confidenceBoost = 0,
      scoreWeights,
      forcedAssignments = [],  // Array of { player: string, machine: string }
      opponentWeight = 0,
      opponentPlayers,
      opponent
    } = body

    if (!format || !playerNames || !machines) {
      return NextResponse.json(
        { error: 'Missing required fields: format, playerNames, machines' },
        { status: 400 }
      )
    }

    if (!['7x7', '4x2'].includes(format)) {
      return NextResponse.json(
        { error: 'Format must be either "7x7" or "4x2"' },
        { status: 400 }
      )
    }

    const requiredPlayers = format === '7x7' ? 7 : 8
    const requiredMachines = format === '7x7' ? 7 : 4

    if (machines.length < requiredMachines) {
      return NextResponse.json(
        { error: `${format} format requires at least ${requiredMachines} machines, have ${machines.length}` },
        { status: 400 }
      )
    }

    const mustPlaySet = new Set(mustPlay as string[])
    if (mustPlaySet.size > requiredPlayers) {
      return NextResponse.json(
        { error: `Too many must-play players (${mustPlaySet.size}) for ${requiredPlayers} slots` },
        { status: 400 }
      )
    }

    // Handle forced assignments - these players/machines are locked
    const forcedPlayerSet = new Set<string>()
    const forcedMachineSet = new Set<string>()
    const forcedAssignmentMap = new Map<string, string>() // machine -> player

    for (const fa of forcedAssignments as { player: string; machine: string }[]) {
      forcedPlayerSet.add(fa.player)
      forcedMachineSet.add(fa.machine)
      forcedAssignmentMap.set(fa.machine, fa.player)
    }

    // Filter out forced players from optimization pool
    // For singles: also filter out forced machines
    // For doubles: keep forced machines (optimizer will fill 2nd slot, we replace pair with forced+partner)
    const allPlayers = (playerNames as string[]).filter(p => !forcedPlayerSet.has(p))
    const selectedMachines = format === '7x7'
      ? (machines as string[]).filter(m => !forcedMachineSet.has(m))
      : (machines as string[])  // For doubles, keep all machines
    const optimizer = new LineupOptimizer()

    // Pre-fetch stats for ALL players (including forced ones for merging back)
    const allPlayersForStats = [...allPlayers, ...Array.from(forcedPlayerSet)]
    const allMachinesForStats = [...selectedMachines, ...Array.from(forcedMachineSet)]
    const { statsMap, userInputs } = await optimizer.prefetchStats(
      allPlayersForStats, allMachinesForStats, seasonStart, seasonEnd, venue, venueWeight, userInputWeight, confidenceBoost
    )

    // Apply opponent weakness to statsMap if opponent weight is active
    const ow = Math.max(0, Math.min(1, opponentWeight || 0))
    const vw = Math.max(0, Math.min(1, venueWeight || 0.7))
    if (ow > 0 && venue && opponent) {
      const venueVariations = getVenueVariations(venue)
      const machineVariationToCanonical = new Map<string, string>()
      for (const machine of allMachinesForStats) {
        for (const variation of getAllMachineVariations([machine])) {
          machineVariationToCanonical.set(variation, machine)
        }
      }

      const allGames = await fetchAllRecords<any>(
        () => supabase
          .from('games')
          .select('*')
          .gte('season', seasonStart)
          .lte('season', seasonEnd)
          .order('id', { ascending: true })
      )

      // Normalize machine names and separate venue/non-venue
      const venueGames: any[] = []
      const nonVenueGames: any[] = []
      for (const game of allGames) {
        const canonical = machineVariationToCanonical.get(game.machine)
        if (!canonical) continue
        game.machine = canonical
        if (venueVariations.includes(game.venue)) venueGames.push(game)
        else nonVenueGames.push(game)
      }

      // Build team name map
      const teamKeys = new Set<string>()
      for (const game of allGames) {
        for (let i = 1; i <= 4; i++) {
          const tk = game[`player_${i}_team`]
          if (tk) teamKeys.add(tk)
        }
      }
      const { data: teamsData } = await supabase
        .from('teams')
        .select('team_key, team_name')
        .in('team_key', Array.from(teamKeys))
      const teamNameMap: Record<string, string> = {}
      ;(teamsData || []).forEach((t: any) => { teamNameMap[t.team_key] = t.team_name })

      // Build venue avg and opponent avg per machine
      const machineStats = new Map<string, { venueTotal: number; venueCount: number; oppVTotal: number; oppVCount: number; oppNvTotal: number; oppNvCount: number }>()

      const processBatch = (games: any[], isVenue: boolean) => {
        for (const game of games) {
          if (!machineStats.has(game.machine)) {
            machineStats.set(game.machine, { venueTotal: 0, venueCount: 0, oppVTotal: 0, oppVCount: 0, oppNvTotal: 0, oppNvCount: 0 })
          }
          const ms = machineStats.get(game.machine)!
          for (let i = 1; i <= 4; i++) {
            const playerName = game[`player_${i}_name`]
            const teamKey = game[`player_${i}_team`]
            const score = game[`player_${i}_score`]
            if (!score || !teamKey) continue
            if (isVenue) { ms.venueTotal += score; ms.venueCount++ }
            const teamDisplayName = teamNameMap[teamKey]
            if (teamDisplayName === opponent) {
              if (!opponentPlayers || opponentPlayers.length === 0 || opponentPlayers.includes(playerName)) {
                if (isVenue) { ms.oppVTotal += score; ms.oppVCount++ }
                else { ms.oppNvTotal += score; ms.oppNvCount++ }
              }
            }
          }
        }
      }

      processBatch(venueGames, true)
      processBatch(nonVenueGames, false)

      // Compute weakness and apply to statsMap
      for (const machine of allMachinesForStats) {
        const ms = machineStats.get(machine)
        if (!ms) continue

        const venueAvg = ms.venueCount > 0 ? ms.venueTotal / ms.venueCount : 0
        const oppVAvg = ms.oppVCount > 0 ? ms.oppVTotal / ms.oppVCount : null
        const oppNvAvg = ms.oppNvCount > 0 ? ms.oppNvTotal / ms.oppNvCount : null
        let oppAvg = 0
        if (oppVAvg !== null && oppNvAvg !== null) {
          oppAvg = oppVAvg * vw + oppNvAvg * (1 - vw)
        } else if (oppVAvg !== null) {
          oppAvg = oppVAvg
        } else if (oppNvAvg !== null) {
          oppAvg = oppNvAvg
        }

        if (venueAvg > 0 && oppAvg > 0) {
          const weakness = Math.max(-0.5, Math.min(0.5, (venueAvg - oppAvg) / venueAvg))
          const multiplier = 1 + ow * weakness

          // Scale all player stats for this machine
          for (const [, playerStats] of Array.from(statsMap.entries())) {
            const s = playerStats.get(machine)
            if (!s) continue
            playerStats.set(machine, {
              ...s,
              win_rate: s.win_rate * multiplier,
              venue_adjusted_avg: s.venue_adjusted_avg * multiplier,
              recent_form: s.recent_form * multiplier,
            })
          }
        }
      }
    }

    // Pre-fetch pair stats for doubles
    let pairStatsMap = new Map<string, { winRate: number; gamesPlayed: number }>()
    if (format === '4x2') {
      const pairStatsData = await calculatePairStats(allPlayersForStats, allMachinesForStats, seasonStart, seasonEnd)
      for (const [key, stats] of Array.from(pairStatsData.entries())) {
        pairStatsMap.set(key, stats)
      }
    }

    const runOptimize = (players: string[]) => {
      if (format === '7x7') {
        return optimizer.optimize7x7WithStats(players, selectedMachines, statsMap, userInputs, exclusions, confidenceBoost, scoreWeights)
      } else {
        return optimizer.optimize4x2WithStats(players, selectedMachines, statsMap, userInputs, pairStatsMap, exclusions, confidenceBoost, scoreWeights)
      }
    }

    // Adjust required counts for forced assignments
    // For singles: forced players/machines are removed from pool
    // For doubles: only forced players are removed (machines stay, partner will be assigned)
    const adjustedRequiredPlayers = requiredPlayers - forcedPlayerSet.size
    const adjustedRequiredMachines = format === '7x7'
      ? requiredMachines - forcedMachineSet.size
      : requiredMachines  // Doubles: machines stay in pool

    // Helper to merge forced assignments back into result
    const mergeForced = (result: any) => {
      if (format === '7x7') {
        // For singles: add forced assignments directly
        for (const [machine, player] of Array.from(forcedAssignmentMap.entries())) {
          const playerStats = statsMap.get(player)?.get(machine)
          const userInput = userInputs?.get(player)?.get(machine)
          result.assignments.push({
            player_id: player,
            machine_id: machine,
            expected_score: playerStats?.venue_adjusted_avg || 1,
            confidence: playerStats?.confidence_score || 0,
            venue_adjusted_avg: playerStats?.venue_adjusted_avg,
            user_average: userInput?.userAverage,
            user_confidence: userInput?.userConfidence,
            forced: true
          })
        }
      } else {
        // For doubles: replace optimized pairs on forced machines with forced player + partner
        for (const [forcedMachine, forcedPlayer] of Array.from(forcedAssignmentMap.entries())) {
          // Find the existing assignment for this machine
          const existingIdx = result.assignments.findIndex((a: any) => a.machine_id === forcedMachine)

          if (existingIdx >= 0) {
            const existing = result.assignments[existingIdx]
            // Keep one of the optimized players as partner (prefer the better one)
            const p1 = existing.player1_id
            const p2 = existing.player2_id

            // Get stats for both potential partners with the forced player
            const p1Stats = statsMap.get(p1)?.get(forcedMachine)
            const p2Stats = statsMap.get(p2)?.get(forcedMachine)
            const forcedStats = statsMap.get(forcedPlayer)?.get(forcedMachine)
            const forcedUserInput = userInputs?.get(forcedPlayer)?.get(forcedMachine)

            // Check pair synergy
            const pairKey1 = [forcedPlayer, p1].sort().join('|') + '|' + forcedMachine
            const pairKey2 = [forcedPlayer, p2].sort().join('|') + '|' + forcedMachine
            const pair1Stats = pairStatsMap.get(pairKey1)
            const pair2Stats = pairStatsMap.get(pairKey2)

            // Calculate combined scores for each potential pairing
            const score1 = (forcedStats?.venue_adjusted_avg || 1) + (p1Stats?.venue_adjusted_avg || 1) + (pair1Stats?.winRate || 0.5)
            const score2 = (forcedStats?.venue_adjusted_avg || 1) + (p2Stats?.venue_adjusted_avg || 1) + (pair2Stats?.winRate || 0.5)

            // Pick the better partner
            const partner = score1 >= score2 ? p1 : p2
            const partnerStats = score1 >= score2 ? p1Stats : p2Stats
            const partnerUserInput = userInputs?.get(partner)?.get(forcedMachine)
            const pairStats = score1 >= score2 ? pair1Stats : pair2Stats

            // Replace the assignment
            result.assignments[existingIdx] = {
              player1_id: forcedPlayer,
              player2_id: partner,
              machine_id: forcedMachine,
              expected_score: (forcedStats?.venue_adjusted_avg || 1) + (partnerStats?.venue_adjusted_avg || 1),
              confidence: ((forcedStats?.confidence_score || 0) + (partnerStats?.confidence_score || 0)) / 2,
              player1_venue_adjusted_avg: forcedStats?.venue_adjusted_avg,
              player2_venue_adjusted_avg: partnerStats?.venue_adjusted_avg,
              player1_user_average: forcedUserInput?.userAverage,
              player2_user_average: partnerUserInput?.userAverage,
              player1_user_confidence: forcedUserInput?.userConfidence,
              player2_user_confidence: partnerUserInput?.userConfidence,
              pair_win_rate: pairStats?.winRate,
              pair_games_played: pairStats?.gamesPlayed,
              forced: true,
              forced_player: forcedPlayer
            }

            // The displaced partner (the one we didn't keep) needs to be reallocated
            // For now, they go to benched - the optimizer can be re-run if needed
            const displaced = score1 >= score2 ? p2 : p1
            if (!result.benched) result.benched = []
            if (!result.benched.includes(displaced)) {
              result.benched.push(displaced)
            }
          } else {
            // No existing assignment for this machine - shouldn't happen normally
            // but handle it by creating a partial assignment
            const forcedStats = statsMap.get(forcedPlayer)?.get(forcedMachine)
            const forcedUserInput = userInputs?.get(forcedPlayer)?.get(forcedMachine)
            result.assignments.push({
              player1_id: forcedPlayer,
              player2_id: null,
              machine_id: forcedMachine,
              expected_score: forcedStats?.venue_adjusted_avg || 1,
              confidence: forcedStats?.confidence_score || 0,
              player1_venue_adjusted_avg: forcedStats?.venue_adjusted_avg,
              player1_user_average: forcedUserInput?.userAverage,
              player1_user_confidence: forcedUserInput?.userConfidence,
              forced: true,
              forced_player: forcedPlayer
            })
          }
        }
      }
      return result
    }

    // Exact match or fewer players — run directly
    if (allPlayers.length <= adjustedRequiredPlayers) {
      const result = runOptimize(allPlayers)
      result.benched = []
      return NextResponse.json(mergeForced(result))
    }

    // More players than required — exhaustive combination search
    const mustPlayPlayers = allPlayers.filter(p => mustPlaySet.has(p))
    const flexPlayers = allPlayers.filter(p => !mustPlaySet.has(p))
    const slotsToFill = adjustedRequiredPlayers - mustPlayPlayers.length

    const flexCombos = combinations(flexPlayers, slotsToFill)

    if (flexCombos.length === 0) {
      // If no flex combos but we have forced assignments, just return those
      if (forcedAssignmentMap.size > 0) {
        const result = {
          format,
          assignments: [],
          total_score: 0,
          win_probability: 0,
          benched: flexPlayers
        }
        return NextResponse.json(mergeForced(result))
      }
      return NextResponse.json(
        { error: `Not enough players to fill ${requiredPlayers} slots` },
        { status: 400 }
      )
    }

    let bestResult: any = null
    let bestScore = -Infinity
    let bestBenched: string[] = []

    for (const flexCombo of flexCombos) {
      const comboPlayers = [...mustPlayPlayers, ...flexCombo]
      const benched = flexPlayers.filter(p => !flexCombo.includes(p))

      const result = runOptimize(comboPlayers)

      if (result.total_score > bestScore) {
        bestScore = result.total_score
        bestResult = result
        bestBenched = benched
      }
    }

    bestResult.benched = bestBenched
    return NextResponse.json(mergeForced(bestResult))
  } catch (error: any) {
    console.error('Optimization error:', error)
    return NextResponse.json(
      {
        error: error.message || 'Optimization failed',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    )
  }
}
