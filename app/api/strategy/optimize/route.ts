import { NextRequest, NextResponse } from 'next/server'
import { LineupOptimizer } from '@/lib/strategy/optimizer'
import { calculatePairStats } from '@/lib/strategy/stats-calculator'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { getVenueVariations } from '@/lib/venue-mappings'
import { getAllMachineVariations } from '@/lib/machine-mappings'
import { hungarianAlgorithm } from '@/lib/strategy/hungarian'
import { buildCostMatrix, calculatePerformanceScore, calculatePairSynergy } from '@/lib/strategy/calculator'
import { getScoreLimits, isScoreValid } from '@/lib/score-limits'

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
      venueWeight: rawVenueWeight,
      // When true (strategy page's default), the venueWeight blend is
      // bypassed — venueWeight is forced to 1 so prefetchStats /
      // getBlendedAvg use venue-only data when venue is set, falling back
      // to non-venue when it isn't. Approximates per-game-normalized at
      // this layer without rebuilding lib/strategy internals.
      usePerGameNormalized = true,
      exclusions = {},
      mustPlay = [],
      userInputWeight = 0,
      confidenceBoost = 0,
      scoreWeights,
      forcedAssignments = [],  // Array of { player: string, machine: string }
      opponentWeight = 0,
      opponentPlayers,
      opponent,
      useNashEquilibrium = true,
      assignAll = false,  // When true, greedily assign remaining players after normal optimization
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
    const venueWeight = usePerGameNormalized ? 1 : rawVenueWeight
    const { statsMap, userInputs } = await optimizer.prefetchStats(
      allPlayersForStats, allMachinesForStats, seasonStart, seasonEnd, venue, venueWeight, userInputWeight, confidenceBoost
    )

    // Fetch score limits for filtering impossible scores
    const scoreLimits = await getScoreLimits()

    // Compute opponent edge bonuses per machine (does NOT mutate statsMap)
    const ow = Math.max(0, Math.min(1, opponentWeight || 0))
    const vw = Math.max(0, Math.min(1, venueWeight || 0.7))
    let assumedOpponents: Record<string, any[]> | null = null
    const machineEdgeBonuses = new Map<string, number>()
    let oppDataForDisplay: {
      oppPlayerList: string[]
      oppPlayerStats: Map<string, Map<string, { vTotal: number; vCount: number; nvTotal: number; nvCount: number }>>
      getBlendedAvg: (player: string, machine: string) => number
      allGames: any[]
      venueVariations: string[]
      teamNameMap: Record<string, string>
      venueAvgPerMachine: Map<string, { total: number; count: number }>
    } | null = null

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

      // Build venue avg per machine (all scores at venue on that machine)
      const venueAvgPerMachine = new Map<string, { total: number; count: number }>()
      for (const game of venueGames) {
        for (let i = 1; i <= 4; i++) {
          const score = game[`player_${i}_score`]
          if (!score || !isScoreValid(game.machine, score, scoreLimits)) continue
          const entry = venueAvgPerMachine.get(game.machine) || { total: 0, count: 0 }
          entry.total += score
          entry.count++
          venueAvgPerMachine.set(game.machine, entry)
        }
      }

      // Discover opponent players from games or use provided list
      const oppPlayerSet = new Set<string>()
      if (opponentPlayers && opponentPlayers.length > 0) {
        for (const p of opponentPlayers) oppPlayerSet.add(p)
      } else {
        for (const game of allGames) {
          for (let i = 1; i <= 4; i++) {
            const teamKey = game[`player_${i}_team`]
            const playerName = game[`player_${i}_name`]
            if (teamKey && playerName && teamNameMap[teamKey] === opponent) {
              oppPlayerSet.add(playerName)
            }
          }
        }
      }
      const oppPlayerList = Array.from(oppPlayerSet)

      // Build per-opponent-player stats: venue and non-venue scores per machine
      const oppPlayerStats = new Map<string, Map<string, { vTotal: number; vCount: number; nvTotal: number; nvCount: number }>>()
      for (const p of oppPlayerList) {
        oppPlayerStats.set(p, new Map())
      }

      const collectOppStats = (games: any[], isVenue: boolean) => {
        for (const game of games) {
          for (let i = 1; i <= 4; i++) {
            const playerName = game[`player_${i}_name`]
            const teamKey = game[`player_${i}_team`]
            const score = game[`player_${i}_score`]
            if (!score || !teamKey || !playerName) continue
            if (!isScoreValid(game.machine, score, scoreLimits)) continue
            if (!oppPlayerSet.has(playerName)) continue
            if (teamNameMap[teamKey] !== opponent) continue
            const playerMap = oppPlayerStats.get(playerName)!
            const entry = playerMap.get(game.machine) || { vTotal: 0, vCount: 0, nvTotal: 0, nvCount: 0 }
            if (isVenue) { entry.vTotal += score; entry.vCount++ }
            else { entry.nvTotal += score; entry.nvCount++ }
            playerMap.set(game.machine, entry)
          }
        }
      }
      collectOppStats(venueGames, true)
      collectOppStats(nonVenueGames, false)

      // Compute blended avg for each opponent player on each machine
      const getBlendedAvg = (player: string, machine: string): number => {
        const playerMap = oppPlayerStats.get(player)
        if (!playerMap) return 0
        const entry = playerMap.get(machine)
        if (!entry) return 0
        const vAvg = entry.vCount > 0 ? entry.vTotal / entry.vCount : null
        const nvAvg = entry.nvCount > 0 ? entry.nvTotal / entry.nvCount : null
        if (vAvg !== null && nvAvg !== null) return vAvg * vw + nvAvg * (1 - vw)
        if (vAvg !== null) return vAvg
        if (nvAvg !== null) return nvAvg
        return 0
      }

      // Nash Equilibrium via Iterative Best Response
      // TWC picks first, opponent responds, TWC re-responds, until convergence.
      // Each iteration is one Hungarian (O(n³)), guaranteed to converge for zero-sum games.
      //
      // 1. TWC picks optimal lineup (pure strength, no opponent consideration)
      // 2. Opponent responds: Hungarian assigns their best players to TWC's chosen machines
      // 3. TWC re-responds: Hungarian with edge bonuses against that opponent lineup
      // 4. Repeat until neither side changes

      const playersPerMachine = format === '4x2' ? 2 : 1

      // Helper: run opponent Hungarian against a set of machines, return machine -> oppAvg map
      const runOpponentHungarian = (targetMachines: string[]): Map<string, number[]> => {
        if (oppPlayerList.length === 0 || targetMachines.length === 0) return new Map()

        const mSlots: { machine: string; slotIndex: number }[] = []
        for (const machine of targetMachines) {
          for (let s = 0; s < playersPerMachine; s++) {
            mSlots.push({ machine, slotIndex: s })
          }
        }

        const d = Math.max(oppPlayerList.length, mSlots.length)
        const matrix: number[][] = []
        for (let r = 0; r < d; r++) {
          const row: number[] = []
          for (let c = 0; c < d; c++) {
            if (r < oppPlayerList.length && c < mSlots.length) {
              row.push(getBlendedAvg(oppPlayerList[r], mSlots[c].machine))
            } else {
              row.push(-1e9)
            }
          }
          matrix.push(row)
        }

        const result = hungarianAlgorithm(matrix, true)
        const oppAvgMap = new Map<string, number[]>()
        for (let r = 0; r < oppPlayerList.length; r++) {
          const col = result.assignments[r]
          if (col < 0 || col >= mSlots.length) continue
          const { machine } = mSlots[col]
          const avg = getBlendedAvg(oppPlayerList[r], machine)
          if (avg <= 0) continue
          const list = oppAvgMap.get(machine) || []
          list.push(avg)
          oppAvgMap.set(machine, list)
        }
        return oppAvgMap
      }

      // Helper: compute per-player-per-machine edge bonuses from opponent assignments
      // Each TWC player's blended avg is compared against the specific opponent assigned to that machine
      const computeEdgeBonuses = (oppAvgMap: Map<string, number[]>): Map<string, number> => {
        const bonuses = new Map<string, number>()
        for (const machine of allMachinesForStats) {
          const venueEntry = venueAvgPerMachine.get(machine)
          const venueAvg = venueEntry && venueEntry.count > 0 ? venueEntry.total / venueEntry.count : 0
          if (venueAvg <= 0) continue

          const oppAvgs = oppAvgMap.get(machine)
          if (!oppAvgs || oppAvgs.length === 0) continue
          const oppAvg = oppAvgs.reduce((a, b) => a + b, 0) / oppAvgs.length
          if (oppAvg <= 0) continue

          // Convert opponent avg to a venue-adjusted ratio
          const oppRatio = oppAvg / venueAvg

          for (const player of allPlayers) {
            const twcRatio = statsMap.get(player)?.get(machine)?.venue_adjusted_avg || 0
            if (twcRatio <= 0) continue

            // Compare TWC player's ratio vs opponent's ratio
            // Positive = TWC player scores higher relative to venue avg than opponent
            const edge = Math.max(-0.5, Math.min(0.5, (twcRatio - oppRatio) / Math.max(twcRatio, oppRatio)))
            bonuses.set(`${player}|${machine}`, ow * edge)
          }
        }
        return bonuses
      }

      // Iteration 1: TWC picks first (pure strength, no opponent weight)
      // We don't actually run the optimizer here — we just need TWC's chosen machines.
      // Use the TWC cost matrix to find initial assignment via Hungarian.
      const { matrix: twcInitMatrix, realRows: twcRows, realCols: twcCols } = buildCostMatrix(
        allPlayers, selectedMachines, statsMap, confidenceBoost, scoreWeights
      )
      const twcInitResult = hungarianAlgorithm(twcInitMatrix, true)
      let twcMachines: string[] = []
      for (let i = 0; i < twcRows; i++) {
        const mIdx = twcInitResult.assignments[i]
        if (mIdx >= 0 && mIdx < twcCols) {
          twcMachines.push(selectedMachines[mIdx])
        }
      }

      // Iterate: opponent responds to TWC's machines, TWC re-responds with edge bonuses
      // With Nash off: single iteration (double Hungarian — TWC picks first, opponent responds once)
      // With Nash on: iterate until convergence (Nash equilibrium)
      const MAX_ITERATIONS = useNashEquilibrium ? 10 : 1
      let prevBonusKey = ''
      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        // Opponent responds: assign best opponent players to TWC's chosen machines
        const oppAvgMap = runOpponentHungarian(twcMachines.length > 0 ? twcMachines : selectedMachines)

        // Compute edge bonuses from opponent response
        const newBonuses = computeEdgeBonuses(oppAvgMap)

        // Check convergence: have the bonuses stabilized?
        const bonusKey = Array.from(newBonuses.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([m, v]) => `${m}:${v.toFixed(6)}`)
          .join('|')

        if (bonusKey === prevBonusKey) break // Nash equilibrium reached
        prevBonusKey = bonusKey

        // Update edge bonuses for next TWC response
        machineEdgeBonuses.clear()
        for (const [m, v] of Array.from(newBonuses.entries())) {
          machineEdgeBonuses.set(m, v)
        }

        // TWC re-responds: re-run Hungarian with updated edge bonuses
        const { matrix: twcMatrix, realRows: rr, realCols: rc } = buildCostMatrix(
          allPlayers, selectedMachines, statsMap, confidenceBoost, scoreWeights
        )
        // Apply per-player-per-machine edge bonuses to cost matrix
        for (let i = 0; i < rr; i++) {
          for (let j = 0; j < rc; j++) {
            const bonus = machineEdgeBonuses.get(`${allPlayers[i]}|${selectedMachines[j]}`)
            if (bonus == null) continue
            twcMatrix[i][j] *= (1 + bonus)
          }
        }
        const twcResult = hungarianAlgorithm(twcMatrix, true)
        twcMachines = []
        for (let i = 0; i < rr; i++) {
          const mIdx = twcResult.assignments[i]
          if (mIdx >= 0 && mIdx < rc) {
            twcMachines.push(selectedMachines[mIdx])
          }
        }
      }

      // Save data for post-optimization opponent assignment display
      oppDataForDisplay = { oppPlayerList, oppPlayerStats, getBlendedAvg, allGames, venueVariations, teamNameMap, venueAvgPerMachine }
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
        return optimizer.optimize7x7WithStats(players, selectedMachines, statsMap, userInputs, exclusions, confidenceBoost, scoreWeights, machineEdgeBonuses.size > 0 ? machineEdgeBonuses : undefined)
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

    // After TWC optimization, compute assumed opponents via Hungarian for display
    const computeAssumedOpponents = (assignedMachines: string[]) => {
      if (!oppDataForDisplay) return null
      const { oppPlayerList, getBlendedAvg, allGames, venueVariations, teamNameMap, venueAvgPerMachine } = oppDataForDisplay

      // Build opponent cost matrix for the machines that TWC is actually playing
      const playersPerMachine = format === '4x2' ? 2 : 1
      const machineSlots: { machine: string; slotIndex: number }[] = []
      for (const machine of assignedMachines) {
        for (let s = 0; s < playersPerMachine; s++) {
          machineSlots.push({ machine, slotIndex: s })
        }
      }

      if (oppPlayerList.length === 0 || machineSlots.length === 0) return null

      const dim = Math.max(oppPlayerList.length, machineSlots.length)
      const oppCostMatrix: number[][] = []
      for (let r = 0; r < dim; r++) {
        const row: number[] = []
        for (let c = 0; c < dim; c++) {
          if (r < oppPlayerList.length && c < machineSlots.length) {
            row.push(getBlendedAvg(oppPlayerList[r], machineSlots[c].machine))
          } else {
            row.push(-1e9)
          }
        }
        oppCostMatrix.push(row)
      }

      const oppResult = hungarianAlgorithm(oppCostMatrix, true)

      // DEBUG: Log opponent assignment
      console.log('\n--- Assumed Opponent Assignments ---')
      for (let r = 0; r < oppPlayerList.length; r++) {
        const col = oppResult.assignments[r]
        const machine = col >= 0 && col < machineSlots.length ? machineSlots[col].machine : 'DUMMY'
        const avg = col >= 0 && col < machineSlots.length ? getBlendedAvg(oppPlayerList[r], machine) : 0
        console.log(`  ${oppPlayerList[r]} -> ${machine} (blendedAvg: ${avg.toFixed(1)})`)
      }

      // Map assignments and build detailed stats
      const result: Record<string, any[]> = {}
      for (let r = 0; r < oppPlayerList.length; r++) {
        const col = oppResult.assignments[r]
        if (col < 0 || col >= machineSlots.length) continue
        const { machine } = machineSlots[col]
        const blendedAvg = getBlendedAvg(oppPlayerList[r], machine)

        // Compute per-player detailed stats
        const playerName = oppPlayerList[r]
        let vTotal = 0, vCount = 0, vWins = 0, allTotal = 0, allCount = 0, allWins = 0
        for (const game of allGames) {
          for (let i = 1; i <= 4; i++) {
            const pn = game[`player_${i}_name`]
            const tk = game[`player_${i}_team`]
            const score = game[`player_${i}_score`]
            if (pn !== playerName || !tk || !score) continue
            if (!isScoreValid(game.machine, score, scoreLimits)) continue
            if (teamNameMap[tk] !== opponent) continue
            const isVenueGame = venueVariations.includes(game.venue)
            const position = game[`player_${i}_position`]
            if (isVenueGame) { vTotal += score; vCount++; if (position === 1) vWins++ }
            allTotal += score; allCount++; if (position === 1) allWins++
          }
        }

        const venueEntry = venueAvgPerMachine.get(machine)
        const machineVenueAvg = venueEntry && venueEntry.count > 0 ? venueEntry.total / venueEntry.count : 0

        if (!result[machine]) result[machine] = []
        result[machine].push({
          player: playerName,
          avgScore: Math.round(blendedAvg),
          venueAvg: Math.round(machineVenueAvg),
          venueGames: vCount,
          venueWinRate: vCount > 0 ? Math.round((vWins / vCount) * 100) : 0,
          allAvg: allCount > 0 ? Math.round(allTotal / allCount) : 0,
          allGames: allCount,
          allWinRate: allCount > 0 ? Math.round((allWins / allCount) * 100) : 0,
        })
      }
      return result
    }

    // Helper: greedily assign remaining (benched) players to their best machines
    // Used when assignAll is true to extend the normal optimization
    const greedyAssignRemaining = (merged: any, benchedPlayers: string[]) => {
      if (!assignAll || benchedPlayers.length === 0) return
      const regularCount = merged.assignments.length
      merged.regularCount = regularCount

      const assignedMachineSet = new Set<string>(merged.assignments.map((a: any) => a.machine_id))
      const usedPlayers = new Set<string>()
      for (const a of merged.assignments) {
        if (a.player_id) usedPlayers.add(a.player_id)
        if (a.player1_id) usedPlayers.add(a.player1_id)
        if (a.player2_id) usedPlayers.add(a.player2_id)
      }

      const remainingPlayers = benchedPlayers.filter(p => !usedPlayers.has(p))
      // All machines at venue (including already-used ones for reuse)
      const allMachines = machines as string[]

      if (format === '7x7') {
        // Singles: greedily assign each remaining player to their best machine
        for (const player of remainingPlayers) {
          let bestMachine = ''
          let bestScore = -Infinity
          let bestStats: any = null

          for (const machine of allMachines) {
            const stats = statsMap.get(player)?.get(machine) || null
            const score = calculatePerformanceScore(stats, confidenceBoost, scoreWeights)
            // Prefer unused machines
            const bonus = assignedMachineSet.has(machine) ? 0 : 0.001
            if (score + bonus > bestScore) {
              bestScore = score + bonus
              bestMachine = machine
              bestStats = stats
            }
          }

          if (bestMachine) {
            const ui = userInputs?.get(player)?.get(bestMachine)
            merged.assignments.push({
              player_id: player,
              machine_id: bestMachine,
              expected_score: bestScore,
              confidence: bestStats?.confidence_score || 0,
              venue_adjusted_avg: bestStats?.venue_adjusted_avg,
              user_average: ui?.userAverage ?? null,
              user_confidence: ui?.userConfidence ?? null,
              isExtra: true,
            })
            assignedMachineSet.add(bestMachine)
          }
        }
      } else {
        // Doubles: pair remaining players and assign to best machine
        const remaining = [...remainingPlayers]
        while (remaining.length >= 2) {
          let bestMachine = ''
          let bestPair: [string, string] | null = null
          let bestScore = -Infinity

          for (let i = 0; i < remaining.length; i++) {
            for (let j = i + 1; j < remaining.length; j++) {
              const p1 = remaining[i], p2 = remaining[j]
              for (const machine of allMachines) {
                const stats1 = statsMap.get(p1)?.get(machine) || null
                const stats2 = statsMap.get(p2)?.get(machine) || null
                const score1 = calculatePerformanceScore(stats1, confidenceBoost, scoreWeights)
                const score2 = calculatePerformanceScore(stats2, confidenceBoost, scoreWeights)
                const pairKey1 = `${p1}|${p2}|${machine}`
                const pairKey2 = `${p2}|${p1}|${machine}`
                const pStats = pairStatsMap.get(pairKey1) || pairStatsMap.get(pairKey2)
                const synergy = calculatePairSynergy(stats1, stats2, pStats?.winRate, confidenceBoost, scoreWeights)
                const combined = score1 + score2 + synergy
                const bonus = assignedMachineSet.has(machine) ? 0 : 0.001
                if (combined + bonus > bestScore) {
                  bestScore = combined + bonus
                  bestMachine = machine
                  bestPair = [p1, p2]
                }
              }
            }
          }

          if (bestPair && bestMachine) {
            const stats1 = statsMap.get(bestPair[0])?.get(bestMachine)
            const stats2 = statsMap.get(bestPair[1])?.get(bestMachine)
            const ui1 = userInputs?.get(bestPair[0])?.get(bestMachine)
            const ui2 = userInputs?.get(bestPair[1])?.get(bestMachine)
            merged.assignments.push({
              player1_id: bestPair[0],
              player2_id: bestPair[1],
              machine_id: bestMachine,
              expected_score: bestScore,
              confidence: ((stats1?.confidence_score || 0) + (stats2?.confidence_score || 0)) / 2,
              player1_venue_adjusted_avg: stats1?.venue_adjusted_avg,
              player2_venue_adjusted_avg: stats2?.venue_adjusted_avg,
              player1_user_average: ui1?.userAverage ?? null,
              player2_user_average: ui2?.userAverage ?? null,
              player1_user_confidence: ui1?.userConfidence ?? null,
              player2_user_confidence: ui2?.userConfidence ?? null,
              isExtra: true,
            })
            assignedMachineSet.add(bestMachine)
            remaining.splice(remaining.indexOf(bestPair[1]), 1)
            remaining.splice(remaining.indexOf(bestPair[0]), 1)
          } else {
            break
          }
        }
      }

      // Clear benched since all are now assigned
      merged.benched = []
    }

    // Exact match or fewer players — run directly
    if (allPlayers.length <= adjustedRequiredPlayers) {
      const result = runOptimize(allPlayers)
      result.benched = []
      const merged = mergeForced(result)
      if (assignAll) merged.regularCount = merged.assignments.length
      const assignedMachines = merged.assignments.map((a: any) => a.machine_id)
      assumedOpponents = computeAssumedOpponents(assignedMachines)
      return NextResponse.json({ ...merged, ...(assumedOpponents ? { assumedOpponents } : {}), ...(assignAll ? { regularCount: merged.regularCount } : {}) })
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

    // DEBUG: Log per-player per-machine performance scores
    console.log('\n=== OPTIMIZER DEBUG: Per-Player Per-Machine Scores ===')
    for (const player of allPlayers) {
      const scores: Record<string, string> = {}
      for (const machine of selectedMachines) {
        const stats = statsMap.get(player)?.get(machine)
        const perfScore = stats ? (stats.venue_adjusted_avg || 0).toFixed(3) : 'NO_STATS'
        const gamesPlayed = stats?.games_played || 0
        scores[machine] = `${perfScore} (${gamesPlayed}g)`
      }
      console.log(`  ${player}: ${JSON.stringify(scores)}`)
    }

    let bestResult: any = null
    let bestScore = -Infinity
    let bestBenched: string[] = []
    const comboResults: { players: string[]; benched: string[]; score: number; assignments: string }[] = []

    for (const flexCombo of flexCombos) {
      const comboPlayers = [...mustPlayPlayers, ...flexCombo]
      const benched = flexPlayers.filter(p => !flexCombo.includes(p))

      const result = runOptimize(comboPlayers)

      comboResults.push({
        players: comboPlayers,
        benched,
        score: result.total_score,
        assignments: result.assignments.map((a: any) => `${a.player_id}->${a.machine_id}(${a.expected_score.toFixed(3)})`).join(', ')
      })

      if (result.total_score > bestScore) {
        bestScore = result.total_score
        bestResult = result
        bestBenched = benched
      }
    }

    // DEBUG: Log all combo results sorted by score
    console.log('\n=== OPTIMIZER DEBUG: Combo Results (sorted by score) ===')
    comboResults.sort((a, b) => b.score - a.score)
    for (const c of comboResults.slice(0, 10)) {
      console.log(`  Score: ${c.score.toFixed(4)} | Benched: [${c.benched.join(', ')}]`)
      console.log(`    Assignments: ${c.assignments}`)
    }
    console.log(`  Total combos evaluated: ${comboResults.length}`)
    console.log(`  Best score: ${bestScore.toFixed(4)}, Benched: [${bestBenched.join(', ')}]`)
    console.log('=== END OPTIMIZER DEBUG ===\n')

    bestResult.benched = bestBenched
    const merged = mergeForced(bestResult)
    greedyAssignRemaining(merged, bestBenched)
    const assignedMachines = merged.assignments.map((a: any) => a.machine_id)
    assumedOpponents = computeAssumedOpponents(assignedMachines)
    return NextResponse.json({ ...merged, ...(assumedOpponents ? { assumedOpponents } : {}), ...(assignAll ? { regularCount: merged.regularCount } : {}) })
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
