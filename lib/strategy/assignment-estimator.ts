import { buildNormalizationIndex, type NormalizationScore } from './normalization'

export const ASSIGNMENT_MODEL = {
  version: 'doubles-log-normalized-v1',
  shrinkage: 10,
  // Frozen development-season calibration used by the offline matchup study.
  slope: 0.9039489310821653,
  intercept: 0.07966165660123337,
} as const

// Build from the entire eligible history window, not just candidate machines
// or roster members. Both league baselines and overall strength need that scope.
export function buildAssignmentEstimator(scores: NormalizationScore[]) {
  const index = buildNormalizationIndex(scores)
  return {
    version: ASSIGNMENT_MODEL.version,
    estimate(player: string, machine: string, venue?: string) {
      const specific = index.player(player, machine, venue)
      const overall = index.overall(player)
      const prior = overall ?? index.league
      const n = specific?.count ?? 0
      const weight = n / (n + ASSIGNMENT_MODEL.shrinkage)
      const blended = prior ? (n * (specific?.logRatio ?? 0) + ASSIGNMENT_MODEL.shrinkage * prior.logRatio)
        / (n + ASSIGNMENT_MODEL.shrinkage) : null
      return {
        score: blended === null ? null : Math.max(0, ASSIGNMENT_MODEL.intercept + ASSIGNMENT_MODEL.slope * blended),
        blendedLogRatio: blended,
        normalizedPercent: specific ? specific.ratio * 100 : null,
        machineGames: n,
        venueGames: specific?.venueCount ?? 0,
        overallGames: overall?.count ?? 0,
        machineWeight: weight,
        evidence: n ? 'machine' : overall ? 'overall' : prior ? 'league' : 'none',
      } as const
    },
  }
}
