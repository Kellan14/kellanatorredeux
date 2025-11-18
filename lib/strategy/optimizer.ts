import { hungarianAlgorithm, greedyAssignment } from './hungarian'
import {
  calculatePerformanceScore,
  calculateConfidenceLevel,
  buildCostMatrix,
  generateSuggestions,
  calculateTeamMetrics,
  calculatePairSynergy
} from './calculator'
import { calculatePlayerMachineStats, calculatePairStats } from './stats-calculator'
import type {
  OptimizationResult,
  Assignment,
  PairAssignment,
  PlayerMachineStats
} from '@/types/strategy'

export class LineupOptimizer {
  /**
   * Optimize lineup for 7x7 singles format
   * Calculates stats from games table on-the-fly
   */
  async optimize7x7(
    playerNames: string[],
    machines: string[],
    seasonStart: number = 20,
    seasonEnd: number = 22
  ): Promise<OptimizationResult> {
    if (playerNames.length !== 7 || machines.length !== 7) {
      throw new Error('7x7 format requires exactly 7 players and 7 machines')
    }

    // Calculate stats from games table
    const statsMap = await calculatePlayerMachineStats(playerNames, machines, seasonStart, seasonEnd)

    // Build cost matrix
    const costMatrix = buildCostMatrix(playerNames, machines, statsMap)

    // Run Hungarian algorithm
    const { assignments: hungarianAssignments, totalCost } = hungarianAlgorithm(
      costMatrix,
      true // maximize
    )

    // Convert to Assignment objects
    const assignments: Assignment[] = []
    for (let i = 0; i < playerNames.length; i++) {
      const machineIdx = hungarianAssignments[i]
      if (machineIdx === -1) continue

      const playerName = playerNames[i]
      const machine = machines[machineIdx]
      const stats = statsMap.get(playerName)?.get(machine)
      const score = calculatePerformanceScore(stats || null)
      const confidence = stats
        ? calculateConfidenceLevel(stats.games_played)
        : 1

      assignments.push({
        player_id: playerName,
        machine_id: machine,
        expected_score: score,
        confidence
      })
    }

    // Generate alternative assignments using greedy approach
    const { assignments: greedyAssignments } = greedyAssignment(costMatrix, true)
    const alternatives: Assignment[][] = [[]]

    for (let i = 0; i < playerNames.length; i++) {
      const machineIdx = greedyAssignments[i]
      if (machineIdx === -1) continue

      const playerName = playerNames[i]
      const machine = machines[machineIdx]
      const stats = statsMap.get(playerName)?.get(machine)
      const score = calculatePerformanceScore(stats || null)
      const confidence = stats
        ? calculateConfidenceLevel(stats.games_played)
        : 1

      alternatives[0].push({
        player_id: playerName,
        machine_id: machine,
        expected_score: score,
        confidence
      })
    }

    // Generate suggestions
    const suggestions = generateSuggestions(
      assignments.map(a => ({
        playerId: a.player_id,
        machineId: a.machine_id,
        score: a.expected_score,
        confidence: a.confidence
      })),
      statsMap
    )

    // Calculate team metrics
    const { totalScore, winProbability } = calculateTeamMetrics(
      assignments.map(a => ({
        playerId: a.player_id,
        machineId: a.machine_id,
        score: a.expected_score
      }))
    )

    return {
      format: '7x7',
      assignments,
      total_score: totalScore,
      win_probability: winProbability,
      alternative_assignments: alternatives,
      suggestions
    }
  }

  /**
   * Optimize lineup for 4x2 doubles format
   * Calculates stats from games table on-the-fly
   */
  async optimize4x2(
    playerNames: string[],
    machines: string[],
    seasonStart: number = 20,
    seasonEnd: number = 22
  ): Promise<OptimizationResult> {
    if (playerNames.length !== 8 || machines.length !== 4) {
      throw new Error('4x2 format requires exactly 8 players and 4 machines')
    }

    // Calculate stats from games table
    const statsMap = await calculatePlayerMachineStats(playerNames, machines, seasonStart, seasonEnd)

    // Calculate pair stats for synergy calculation
    const pairStatsData = await calculatePairStats(playerNames, machines, seasonStart, seasonEnd)

    const pairStatsMap = new Map<string, { winRate: number; gamesPlayed: number }>()
    for (const [key, stats] of Array.from(pairStatsData.entries())) {
      pairStatsMap.set(key, stats)
    }

    // Generate all possible pairs
    const pairs: Array<{ p1: string; p2: string }> = []
    for (let i = 0; i < playerNames.length; i++) {
      for (let j = i + 1; j < playerNames.length; j++) {
        pairs.push({ p1: playerNames[i], p2: playerNames[j] })
      }
    }

    // Build cost matrix for pairs x machines
    // This is more complex than 7x7, so we use a greedy approach
    const assignments: PairAssignment[] = []
    const usedPlayers = new Set<string>()
    const usedMachines = new Set<string>()

    // For each machine, find the best available pair
    for (const machine of machines) {
      let bestPair: { p1: string; p2: string; score: number } | null = null

      for (const { p1, p2 } of pairs) {
        if (usedPlayers.has(p1) || usedPlayers.has(p2)) continue

        const stats1 = statsMap.get(p1)?.get(machine)
        const stats2 = statsMap.get(p2)?.get(machine)

        const score1 = calculatePerformanceScore(stats1 || null)
        const score2 = calculatePerformanceScore(stats2 || null)

        // Get pair stats
        const pairKey1 = `${p1}|${p2}|${machine}`
        const pairKey2 = `${p2}|${p1}|${machine}`
        const pairStats = pairStatsMap.get(pairKey1) || pairStatsMap.get(pairKey2)

        const synergy = calculatePairSynergy(stats1 || null, stats2 || null, pairStats?.winRate)
        const combinedScore = score1 + score2 + synergy

        if (!bestPair || combinedScore > bestPair.score) {
          bestPair = { p1, p2, score: combinedScore }
        }
      }

      if (bestPair) {
        const stats1 = statsMap.get(bestPair.p1)?.get(machine)
        const stats2 = statsMap.get(bestPair.p2)?.get(machine)
        const pairKey1 = `${bestPair.p1}|${bestPair.p2}|${machine}`
        const pairKey2 = `${bestPair.p2}|${bestPair.p1}|${machine}`
        const pairStats = pairStatsMap.get(pairKey1) || pairStatsMap.get(pairKey2)

        const synergy = calculatePairSynergy(stats1 || null, stats2 || null, pairStats?.winRate)

        assignments.push({
          player1_id: bestPair.p1,
          player2_id: bestPair.p2,
          machine_id: machine,
          expected_score: bestPair.score,
          synergy_bonus: synergy
        })

        usedPlayers.add(bestPair.p1)
        usedPlayers.add(bestPair.p2)
        usedMachines.add(machine)
      }
    }

    // Generate suggestions
    const suggestions: string[] = []
    if (assignments.length < 4) {
      suggestions.push('Warning: Could not create optimal pairs for all machines')
    }

    // Check for synergy
    const highSynergy = assignments.filter(a => a.synergy_bonus > 0.1)
    if (highSynergy.length > 0) {
      suggestions.push(`${highSynergy.length} pair(s) show strong synergy - excellent!`)
    }

    const lowSynergy = assignments.filter(a => a.synergy_bonus < -0.1)
    if (lowSynergy.length > 0) {
      suggestions.push(`${lowSynergy.length} pair(s) may benefit from different pairing`)
    }

    if (suggestions.length === 0) {
      suggestions.push('Pairs look well balanced for the selected machines')
    }

    // Calculate team metrics
    const totalScore = assignments.reduce((sum, a) => sum + a.expected_score, 0)
    const avgScore = assignments.length > 0 ? totalScore / assignments.length : 0
    const winProbability = 1 / (1 + Math.exp(-10 * (avgScore / 2 - 0.5)))

    return {
      format: '4x2',
      assignments,
      total_score: totalScore,
      win_probability: winProbability,
      suggestions
    }
  }
}
