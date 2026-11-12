import { standardizeVenueName } from '../venue-mappings'

export type NormalizationScore = { player: string; machine: string; venue: string; score: number }
export const normalizationKey = (machine: string, venue: string) => JSON.stringify([
  machine.trim().toLowerCase(), (standardizeVenueName(venue) || '').trim().toLowerCase(),
])
export function buildNormalizationIndex(scores: NormalizationScore[]) {
  const baselines = new Map<string, { total: number; count: number }>()
  const eligible = scores.filter(s => s.player && s.venue && Number.isFinite(s.score) && s.score >= 0)
  for (const s of eligible) {
    const key = normalizationKey(s.machine, s.venue)
    const b = baselines.get(key) || { total: 0, count: 0 }
    b.total += s.score; b.count++; baselines.set(key, b)
  }
  const playerValues = new Map<string, { ratios: number[]; logs: number[] }>()
  for (const s of eligible) {
    const b = baselines.get(normalizationKey(s.machine, s.venue))!
    const average = b.total / b.count
    if (!(average > 0)) continue
    const key = JSON.stringify([s.player, s.machine.trim().toLowerCase()])
    const p = playerValues.get(key) || { ratios: [], logs: [] }
    p.ratios.push(s.score / average); p.logs.push(Math.log1p(s.score / average)); playerValues.set(key, p)
  }
  return {
    baselines,
    baseline(machine: string, venue: string) {
      const b = baselines.get(normalizationKey(machine, venue))
      return b && b.count ? b.total / b.count : null
    },
    player(player: string, machine: string) {
      const p = playerValues.get(JSON.stringify([player, machine.trim().toLowerCase()]))
      return p ? { count: p.ratios.length, ratio: p.ratios.reduce((a,b)=>a+b,0)/p.ratios.length,
        logRatio: p.logs.reduce((a,b)=>a+b,0)/p.logs.length } : null
    },
  }
}

// Same completed/scored-game eligibility as the chronological offline studies.
// Keep score-limit decisions with the caller so current configured limits apply.
export function isScoredLeagueGame(g: any): boolean {
  const possible = [1,4].includes(g.round_number) ? 5 : [2,3].includes(g.round_number) ? 3 : 0
  return !!possible && g.home_points != null && g.away_points != null &&
    Number(g.home_points) + Number(g.away_points) === possible && !!g.machine && !!g.venue
}
export function leagueNormalizationScores(games: any[], valid: (machine: string, score: number) => boolean): NormalizationScore[] {
  return games.flatMap(g => {
    if (!isScoredLeagueGame(g)) return []
    return [1,2,3,4].flatMap(i => {
      const player = g[`player_${i}_name`], raw = g[`player_${i}_score`], score = Number(raw)
      return player && raw != null && Number.isFinite(score) && score >= 0 && valid(g.machine, score)
        ? [{ player, machine: g.machine, venue: g.venue, score }] : []
    })
  })
}
