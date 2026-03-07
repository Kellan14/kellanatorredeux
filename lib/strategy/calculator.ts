import { PlayerMachineStats } from '@/types/strategy'

export interface ScoreWeights {
  winRate: number
  recentForm: number
  venueAdjustedAvg: number
  confidence: number
}

const DEFAULT_WEIGHTS: ScoreWeights = {
  winRate: 0.4,
  recentForm: 0.3,
  venueAdjustedAvg: 0.2,
  confidence: 0.1
}

/**
 * Calculate weighted performance score for a player on a machine
 */
export function calculatePerformanceScore(
  stats: PlayerMachineStats | null,
  confidenceBoost: number = 0,
  weights?: ScoreWeights
): number {
  if (!stats) {
    return 0
  }

  // If no games but user confidence exists, return confidence-based score
  if (stats.games_played === 0) {
    if (stats.user_confidence && confidenceBoost > 0) {
      return (stats.user_confidence / 10) * confidenceBoost
    }
    return 0
  }

  const W = weights || DEFAULT_WEIGHTS

  // Venue-adjusted avg: 1.0 = venue average. Normalize to 0-1 scale:
  // 0.0 ratio → 0, 1.0 ratio → 0.5, 2.0+ ratio → 1.0
  const normalizedVenueAdj = Math.min(stats.venue_adjusted_avg / 2, 1)

  // Confidence score is already 1-10, normalize to 0-1
  const normalizedConfidence = stats.confidence_score / 10

  // Calculate weighted score
  let score =
    (stats.win_rate * W.winRate) +
    (stats.recent_form * W.recentForm) +
    (normalizedVenueAdj * W.venueAdjustedAvg) +
    (normalizedConfidence * W.confidence)

  // Blend with user confidence if present
  // At 0% slider: score is purely data-driven
  // At 100% slider: score is purely user confidence (user_confidence / 10)
  // Players without user_confidence are unaffected
  if (stats.user_confidence && confidenceBoost > 0) {
    const confidenceScore = stats.user_confidence / 10
    score = score * (1 - confidenceBoost) + confidenceScore * confidenceBoost
  }

  // Apply streak bonus/penalty
  if (stats.streak_type === 'win' && stats.streak_count >= 3) {
    return score * (1 + Math.min(stats.streak_count * 0.05, 0.2)) // Up to 20% bonus
  } else if (stats.streak_type === 'loss' && stats.streak_count >= 3) {
    return score * (1 - Math.min(stats.streak_count * 0.03, 0.15)) // Up to 15% penalty
  }

  return score
}

/**
 * Get a breakdown of how each factor contributes to the performance score.
 * Used for display on the strategy page.
 */
export function getFactorBreakdown(
  userInputWeight: number = 0,
  confidenceBoost: number = 0,
  weights?: ScoreWeights
): Array<{ factor: string; weight: number }> {
  const base = weights || DEFAULT_WEIGHTS

  const leaguePortion = base.venueAdjustedAvg * (1 - userInputWeight)
  const userPortion = base.venueAdjustedAvg * userInputWeight

  const factors = [
    { factor: 'Win Rate', weight: base.winRate },
    { factor: 'Recent Form', weight: base.recentForm },
    { factor: 'Score vs Venue Avg (League)', weight: leaguePortion },
  ]

  if (userInputWeight > 0) {
    factors.push({ factor: 'Score vs Venue Avg (User Input)', weight: userPortion })
  }

  factors.push({ factor: 'Data Confidence', weight: base.confidence })

  if (confidenceBoost > 0) {
    factors.push({ factor: 'User Confidence', weight: confidenceBoost })
  }

  return factors
}

/**
 * Calculate confidence level based on games played
 */
export function calculateConfidenceLevel(gamesPlayed: number): number {
  if (gamesPlayed === 0) return 1
  if (gamesPlayed < 3) return 3
  if (gamesPlayed < 5) return 5
  if (gamesPlayed < 10) return 7
  if (gamesPlayed < 20) return 9
  return 10
}

/**
 * Calculate expected win probability based on performance score
 */
export function calculateWinProbability(performanceScore: number): number {
  // Logistic function to convert score to probability
  // Score of 0.5 should give ~50% probability
  // Higher scores give higher probabilities
  return 1 / (1 + Math.exp(-10 * (performanceScore - 0.5)))
}

/**
 * Calculate synergy bonus for a pair of players
 */
export function calculatePairSynergy(
  player1Stats: PlayerMachineStats | null,
  player2Stats: PlayerMachineStats | null,
  pairWinRate?: number,
  confidenceBoost?: number,
  weights?: ScoreWeights
): number {
  const score1 = calculatePerformanceScore(player1Stats, confidenceBoost, weights)
  const score2 = calculatePerformanceScore(player2Stats, confidenceBoost, weights)
  const avgIndividual = (score1 + score2) / 2

  // If we have actual pair data, use it
  if (pairWinRate !== undefined) {
    // Synergy is the difference between pair performance and average individual
    return pairWinRate - avgIndividual
  }

  // Otherwise, estimate based on individual scores
  // Pairs with similar skill levels tend to work better
  const skillDifference = Math.abs(score1 - score2)
  const synergyPenalty = skillDifference * 0.1 // Penalty for skill mismatch

  return -synergyPenalty
}

/**
 * Build a cost matrix for the Hungarian algorithm.
 * Pads the matrix to be square (required by Hungarian) with 0-score dummy entries.
 * Returns the matrix and the actual dimensions so callers can filter out dummy assignments.
 */
export function buildCostMatrix(
  playerNames: string[],
  machines: string[],
  statsMap: Map<string, Map<string, PlayerMachineStats>>,
  confidenceBoost: number = 0,
  weights?: ScoreWeights
): { matrix: number[][]; realRows: number; realCols: number } {
  const realRows = playerNames.length
  const realCols = machines.length
  const n = Math.max(realRows, realCols)
  const matrix: number[][] = []

  for (let i = 0; i < n; i++) {
    const row: number[] = []
    const playerName = i < realRows ? playerNames[i] : null
    const playerStats = playerName ? statsMap.get(playerName) : null

    for (let j = 0; j < n; j++) {
      if (i >= realRows || j >= realCols) {
        row.push(-1000) // dummy entry — strongly discouraged so real assignments are always preferred
      } else {
        const machine = machines[j]
        const stats = playerStats?.get(machine) || null
        const score = calculatePerformanceScore(stats, confidenceBoost, weights)
        row.push(score)
      }
    }

    matrix.push(row)
  }

  return { matrix, realRows, realCols }
}

/**
 * Generate strategic suggestions based on assignments
 */
export function generateSuggestions(
  assignments: Array<{
    playerId: string
    machineId: string
    score: number
    confidence: number
  }>,
  statsMap: Map<string, Map<string, PlayerMachineStats>>
): string[] {
  const suggestions: string[] = []

  // Check for low confidence assignments
  const lowConfidence = assignments.filter(a => a.confidence < 5)
  if (lowConfidence.length > 0) {
    suggestions.push(
      `${lowConfidence.length} assignment(s) have low confidence due to limited game history. Consider recent practice performance.`
    )
  }

  // Check for close alternatives
  for (const assignment of assignments) {
    const playerStats = statsMap.get(assignment.playerId)
    if (!playerStats) continue

    const allMachines = Array.from(playerStats.entries())
      .map(([machineId, stats]) => ({
        machineId,
        score: calculatePerformanceScore(stats)
      }))
      .sort((a, b) => b.score - a.score)

    const currentRank = allMachines.findIndex(m => m.machineId === assignment.machineId)
    if (currentRank > 0 && allMachines[currentRank].score * 1.1 >= allMachines[0].score) {
      // Current assignment is not the player's best machine, but it's close
      suggestions.push(
        `Consider assigning player to their strongest machines if possible`
      )
      break
    }
  }

  // Check for players on winning streaks
  const hotPlayers = assignments.filter(a => {
    const stats = statsMap.get(a.playerId)?.get(a.machineId)
    return stats?.streak_type === 'win' && stats.streak_count >= 3
  })

  if (hotPlayers.length > 0) {
    suggestions.push(
      `${hotPlayers.length} player(s) are on hot streaks - lineup is well optimized`
    )
  }

  if (suggestions.length === 0) {
    suggestions.push('Lineup looks solid! Focus on execution and machine-specific strategies.')
  }

  return suggestions
}

/**
 * Calculate overall team score and win probability
 */
export function calculateTeamMetrics(
  assignments: Array<{
    playerId: string
    machineId: string
    score: number
  }>
): { totalScore: number; winProbability: number } {
  if (assignments.length === 0) {
    return { totalScore: 0, winProbability: 0.5 }
  }

  const totalScore = assignments.reduce((sum, a) => sum + a.score, 0)
  const avgScore = totalScore / assignments.length

  // Win probability is based on average performance
  // Assume team needs avg > 0.6 to have good chance of winning
  const winProbability = calculateWinProbability(avgScore)

  return { totalScore, winProbability }
}
