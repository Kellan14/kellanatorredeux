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
  const playerValues = new Map<string, { ratioSum: number; logSum: number; count: number; venueCounts: Map<string, number> }>()
  const overall = new Map<string, { logSum: number; count: number }>()
  let leagueLogSum = 0, leagueCount = 0
  for (const s of eligible) {
    const b = baselines.get(normalizationKey(s.machine, s.venue))!
    const average = b.total / b.count
    if (!(average > 0)) continue
    const key = JSON.stringify([s.player, s.machine.trim().toLowerCase()])
    const p = playerValues.get(key) || { ratioSum: 0, logSum: 0, count: 0, venueCounts: new Map<string, number>() }
    const ratio = s.score / average, log = Math.log1p(ratio)
    const venueKey = normalizationKey(s.machine, s.venue)
    p.ratioSum += ratio; p.logSum += log; p.count++
    p.venueCounts.set(venueKey, (p.venueCounts.get(venueKey) ?? 0) + 1)
    playerValues.set(key, p)
    const o = overall.get(s.player) || { logSum: 0, count: 0 }
    o.logSum += log; o.count++; overall.set(s.player, o)
    leagueLogSum += log; leagueCount++
  }
  return {
    baselines,
    baseline(machine: string, venue: string) {
      const b = baselines.get(normalizationKey(machine, venue))
      return b && b.count ? b.total / b.count : null
    },
    player(player: string, machine: string, venue?: string) {
      const p = playerValues.get(JSON.stringify([player, machine.trim().toLowerCase()]))
      return p ? { count: p.count, ratio: p.ratioSum/p.count, logRatio: p.logSum/p.count,
        venueCount: venue ? p.venueCounts.get(normalizationKey(machine, venue)) ?? 0 : 0 } : null
    },
    overall(player: string) {
      const o = overall.get(player)
      return o ? { count: o.count, logRatio: o.logSum/o.count } : null
    },
    league: leagueCount ? { count: leagueCount, logRatio: leagueLogSum/leagueCount } : null,
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
