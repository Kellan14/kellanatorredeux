import { hungarianAlgorithm } from './hungarian'
import { standardizeVenueName } from '../venue-mappings'
import type { Database } from '../supabase'
import type { DoublesLineup, DoublesMetricComparison } from '../ranked-doubles'

type Game = Database['public']['Tables']['games']['Row']
type Metric = { venue: number | null; pops: number | null }
type Totals = { ratios: number; scores: number; points: number; possible: number }
const id = (...parts: string[]) => JSON.stringify(parts)
const venueKey = (venue: string | null) => (standardizeVenueName(venue) || '').toLowerCase()
const mean = (values: (number | null)[]) => values.length && values.every(v => v !== null)
  ? values.reduce<number>((sum, v) => sum + (v ?? 0), 0) / values.length : null
const spread = (ours: number | null, theirs: number | null) =>
  ours !== null && theirs !== null ? ours - theirs : null

export function evaluateDoublesLineups(
  games: Game[], lineups: DoublesLineup[], opponents: string[], venue: string,
  twcVenueSpecific: boolean, teamVenueSpecific: boolean, limits: Record<string, number>,
): DoublesMetricComparison[] {
  const selectedVenue = venueKey(venue)
  const players = new Set([...opponents, ...lineups.flatMap(lineup => lineup.picks.flatMap(p => p.players))])
  const baseline = new Map<string, { sum: number; count: number }>()
  const rows: { player: string; machine: string; venue: string; score: number | null; points: number | null; possible: number }[] = []
  for (const game of games) {
    const machine = game.machine.toLowerCase()
    const v = venueKey(game.venue)
    const baselineKey = id(machine, v)
    const possible = game.round_number === 1 || game.round_number === 4 ? 2.5
      : game.round_number === 2 || game.round_number === 3 ? 3 : 0
    for (const slot of [1, 2, 3, 4] as const) {
      const player = game[`player_${slot}_name`]
      const rawScore = game[`player_${slot}_score`]
      const score = rawScore != null && Number.isFinite(Number(rawScore)) && Number(rawScore) >= 0 &&
        (!limits[machine] || Number(rawScore) <= limits[machine]) ? Number(rawScore) : null
      if (player && score !== null && v) {
        const total = baseline.get(baselineKey) || { sum: 0, count: 0 }
        total.sum += score
        total.count++
        baseline.set(baselineKey, total)
      }
      if (player && players.has(player)) {
        const points = game[`player_${slot}_points`]
        rows.push({ player, machine, venue: v, score, points: points != null && Number.isFinite(Number(points)) ? Number(points) : null, possible })
      }
    }
  }
  const all = new Map<string, Totals>()
  const local = new Map<string, Totals>()
  for (const row of rows) {
    const baselineRow = baseline.get(id(row.machine, row.venue))
    const avg = baselineRow ? baselineRow.sum / baselineRow.count : 0
    for (const bucket of row.venue === selectedVenue ? [all, local] : [all]) {
      const key = id(row.player, row.machine)
      const total = bucket.get(key) || { ratios: 0, scores: 0, points: 0, possible: 0 }
      if (row.score !== null && avg > 0) {
        total.ratios += row.score / avg
        total.scores++
      }
      if (row.points !== null && row.possible > 0) {
        total.points += row.points
        total.possible += row.possible
      }
      bucket.set(key, total)
    }
  }
  const metric = (player: string, machine: string, venueOnly: boolean): Metric => {
    const entry = (venueOnly ? local : all).get(id(player, machine.toLowerCase()))
    return {
      venue: entry?.scores ? 100 * entry.ratios / entry.scores : null,
      pops: entry?.possible ? 100 * entry.points / entry.possible : null,
    }
  }
  const roster = new Set(opponents)
  return lineups.map(lineup => {
    const projected = lineup.picks.map(p => (p.opponents || []).filter(name => roster.has(name)))
    const projectedNames = projected.flat()
    // When the optimizer didn't model an opponent (e.g. zero opponent
    // weight), project one using the strongest non-repeating assignment.
    if (projected.some((pair, i) => pair.length !== lineup.picks[i].players.length) || new Set(projectedNames).size !== projectedNames.length) {
      const slots = lineup.picks.flatMap((pick, index) => pick.players.map(() => ({ machine: pick.machine, index })))
      projected.forEach(pair => { pair.length = 0 })
      const size = Math.max(slots.length, opponents.length)
      const matrix = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) =>
        opponents[i] && slots[j] ? metric(opponents[i], slots[j].machine, teamVenueSpecific).venue ?? -1 : 0))
      hungarianAlgorithm(matrix).assignments.slice(0, opponents.length).forEach((slot, index) => {
        if (slots[slot]) projected[slots[slot].index].push(opponents[index])
      })
    }
    const ours = lineup.picks.flatMap(p => p.players.map(player => metric(player, p.machine, twcVenueSpecific)))
    const theirs = lineup.picks.flatMap((p, i) => projected[i].map(player => metric(player, p.machine, teamVenueSpecific)))
    const twcVenue = mean(ours.map(p => p.venue))
    const twcPops = mean(ours.map(p => p.pops))
    const oppVenue = theirs.length === ours.length ? mean(theirs.map(p => p.venue)) : null
    const oppPops = theirs.length === ours.length ? mean(theirs.map(p => p.pops)) : null
    const coverage = (values: (number | null)[]) => {
      const known = values.filter(v => v !== null)
      return { count: known.length, total: ours.length, average: mean(known) }
    }
    return { opponents: projected, coverage: {
      twcVenue: coverage(ours.map(p => p.venue)), twcPops: coverage(ours.map(p => p.pops)),
      oppVenue: coverage(theirs.map(p => p.venue)), oppPops: coverage(theirs.map(p => p.pops)),
    }, metrics: { twcVenue, oppVenue, venueSpread: spread(twcVenue, oppVenue),
      twcPops, oppPops, popsSpread: spread(twcPops, oppPops) } }
  })
}
