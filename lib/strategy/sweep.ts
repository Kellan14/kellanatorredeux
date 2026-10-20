import type { PlayerMachineStats } from '../../types/strategy'
import { calculatePerformanceScore, calculatePairSynergy, type ScoreWeights } from './calculator'

export type SweepSettings = {
  venueWeight: number; userInputWeight: number; confidenceBoost: number; opponentWeight: number
  scoreWeights: ScoreWeights
}
export type SweepCell = {
  player: string; machine: string
  all: PlayerMachineStats | null; venue: PlayerMachineStats | null
  personalAll: PlayerMachineStats | null; personalVenue: PlayerMachineStats | null
  opponentAll: number | null; opponentVenue: number | null
}
export type SweepCandidate = { id: string; players: string[]; machine: string; score: number }
const factors = ['winRate', 'recentForm', 'venueAdjustedAvg', 'confidence'] as const
const adjustments = ['venueWeight', 'userInputWeight', 'confidenceBoost', 'opponentWeight'] as const
const clamp = (n: number) => Math.max(0, Math.min(1, n))

export function shiftSetting(base: SweepSettings, key: string, value: number): SweepSettings {
  value = clamp(value)
  if (!factors.includes(key as any)) return { ...base, [key]: value }
  const factor = key as typeof factors[number]
  const rest = factors.filter(k => k !== factor)
  const sum = rest.reduce((n, k) => n + base.scoreWeights[k], 0)
  const weights = { ...base.scoreWeights, [factor]: value }
  for (const k of rest) weights[k] = (1 - value) * (sum ? base.scoreWeights[k] / sum : 1 / 3)
  return { ...base, scoreWeights: weights }
}

function interpolate(a: PlayerMachineStats | null, b: PlayerMachineStats | null, weight: number) {
  if (!a) return b
  if (!b) return a
  return { ...a, venue_adjusted_avg: a.venue_adjusted_avg * (1 - weight) + b.venue_adjusted_avg * weight,
    avg_score: a.avg_score * (1 - weight) + b.avg_score * weight }
}

export function scoreCell(cell: SweepCell, s: SweepSettings, normalized: boolean) {
  const all = interpolate(cell.all, cell.personalAll, s.userInputWeight)
  const venue = interpolate(cell.venue, cell.personalVenue, s.userInputWeight)
  const vw = normalized ? 1 : s.venueWeight
  let stats: PlayerMachineStats | null = null
  if (venue && all) {
    stats = { ...all, user_confidence: venue.user_confidence || all.user_confidence }
    for (const key of ['win_rate', 'avg_score', 'venue_adjusted_avg', 'recent_form'] as const) {
      stats[key] = venue[key] * vw + all[key] * (1 - vw)
    }
    stats.confidence_score = Math.max(venue.confidence_score, all.confidence_score)
  } else if (venue) stats = venue
  else if (all && vw < 1) {
    stats = { ...all }
    for (const key of ['win_rate', 'avg_score', 'venue_adjusted_avg', 'recent_form'] as const) stats[key] *= 1 - vw
  }
  let score = calculatePerformanceScore(stats, s.confidenceBoost, s.scoreWeights)
  const opp = cell.opponentVenue !== null && cell.opponentAll !== null
    ? cell.opponentVenue * vw + cell.opponentAll * (1 - vw)
    : vw === 1 ? cell.opponentVenue : cell.opponentAll
  if (stats && opp !== null && opp > 0 && stats.venue_adjusted_avg > 0) {
    const ours = stats.venue_adjusted_avg
    score *= 1 + s.opponentWeight * Math.max(-0.5, Math.min(0.5, (ours - opp) / Math.max(ours, opp)))
  }
  return { score, stats }
}

export function rankSweep(cells: SweepCell[], settings: SweepSettings, normalized: boolean,
  doubles: boolean, pairs: Record<string, { winRate: number }> = {}): SweepCandidate[] {
  const scored = cells.map(cell => ({ cell, ...scoreCell(cell, settings, normalized) }))
  const candidates: SweepCandidate[] = []
  for (let i = 0; i < scored.length; i++) {
    const a = scored[i]
    if (!a.stats) continue
    if (!doubles) candidates.push({ id: JSON.stringify([a.cell.machine, a.cell.player]), players: [a.cell.player], machine: a.cell.machine, score: a.score })
    else for (let j = i + 1; j < scored.length; j++) {
      const b = scored[j]
      if (!b.stats || a.cell.machine !== b.cell.machine || a.cell.player === b.cell.player) continue
      const players = [a.cell.player, b.cell.player].sort()
      const pair = pairs[`${players[0]}|${players[1]}|${a.cell.machine}`] || pairs[`${players[1]}|${players[0]}|${a.cell.machine}`]
      const synergy = calculatePairSynergy(a.stats, b.stats, pair?.winRate, settings.confidenceBoost, settings.scoreWeights)
      candidates.push({ id: JSON.stringify([a.cell.machine, ...players]), players, machine: a.cell.machine, score: a.score + b.score + synergy })
    }
  }
  return candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
}

// Deterministic stratified coverage, including pure-factor corners and each slider's endpoints.
export function sweepProfiles(base: SweepSettings, normalized: boolean, samples = 512) {
  const profiles: SweepSettings[] = [base]
  for (const key of [...factors, ...adjustments.filter(k => !normalized || k !== 'venueWeight')]) {
    for (const value of [0, .25, .5, .75, 1]) profiles.push(shiftSetting(base, key, value))
  }
  let seed = 123456789
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed + .5) / 4294967296 }
  for (let i = 0; i < samples; i++) {
    const values = factors.map(() => -Math.log(random()))
    const sum = values.reduce((a, b) => a + b, 0)
    profiles.push({ venueWeight: normalized ? base.venueWeight : random(), userInputWeight: random(), confidenceBoost: random(), opponentWeight: random(),
      scoreWeights: Object.fromEntries(factors.map((key, j) => [key, values[j] / sum])) as unknown as ScoreWeights })
  }
  return profiles
}

export function runSweep(cells: SweepCell[], baseline: SweepSettings, normalized: boolean, doubles: boolean,
  pairs: Record<string, { winRate: number }> = {}) {
  const base = rankSweep(cells, baseline, normalized, doubles, pairs)
  const baseRanks = new Map(base.map((c, i) => [c.id, i + 1]))
  const profiles = sweepProfiles(baseline, normalized)
  const findings = new Map<string, SweepCandidate & { baselineRank: number | null; bestRank: number; hits: number; example: SweepSettings }>()
  const top = Math.min(5, base.length)
  for (const settings of profiles) {
    rankSweep(cells, settings, normalized, doubles, pairs).slice(0, 5).forEach((candidate, index) => {
      const rank = index + 1
      const prior = findings.get(candidate.id)
      if (prior) { prior.hits++; if (rank < prior.bestRank) { prior.bestRank = rank; prior.example = settings } }
      else findings.set(candidate.id, { ...candidate, baselineRank: baseRanks.get(candidate.id) || null, bestRank: rank, hits: 1, example: settings })
    })
  }
  // Array.from rather than a spread: tsconfig targets es5, where spreading a
  // Map iterator needs --downlevelIteration.
  const entries = Array.from(findings.values()).map(f => ({ ...f, frequency: f.hits / profiles.length }))
  const stable = entries.filter(f => f.frequency >= .5).sort((a, b) => b.frequency - a.frequency).slice(0, 10)
  const surprises = entries.filter(f => (f.baselineRank || Infinity) > top && f.frequency < .5)
    .sort((a, b) => ((b.baselineRank || base.length + 1) - b.bestRank) - ((a.baselineRank || base.length + 1) - a.bestRank)).slice(0, 10)
  const tippingPoints: { slider: string; from: number; to: number; before: SweepCandidate; after: SweepCandidate; settings: SweepSettings }[] = []
  if (base[0]) for (const slider of [...factors, ...adjustments.filter(k => !normalized || k !== 'venueWeight')]) {
    const from = slider in baseline.scoreWeights ? baseline.scoreWeights[slider as keyof ScoreWeights] : baseline[slider as keyof Omit<SweepSettings, 'scoreWeights'>]
    for (const direction of [-1, 1]) for (const delta of [.01, .05, .1]) {
      const to = clamp(from + direction * delta)
      if (to === from) continue
      const settings = shiftSetting(baseline, slider, to)
      const after = rankSweep(cells, settings, normalized, doubles, pairs)[0]
      if (after && after.id !== base[0].id) { tippingPoints.push({ slider, from, to, before: base[0], after, settings }); break }
    }
  }
  return { samples: profiles.length, candidates: base.length, baseline: base.slice(0, 5), stable, surprises, tippingPoints,
    notes: ['Sampled candidate rankings, not exhaustive or calibrated win probabilities. Picks may share players or machines; use the normal optimizer for a legal lineup.',
      'Opponent weight compares against the selected roster’s average normalized performance, not a new Nash counter-lineup for each sample.',
      'Personal-score and confidence sliders have no effect where those inputs are missing. Averaging method and trim percentage stay fixed.',
      ...(normalized ? ['Venue Weight is inactive while per-game normalization is on, so it is not varied.'] : [])] }
}
