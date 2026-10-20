// Shared plumbing for the strategy sweep and backtest.
//
// The point of this file is the split the optimize route implies but never
// exploits:
//
//   expensive, DB-bound   venue / seasons / venueWeight / userInputWeight /
//                         avgMethod / trimPct  ->  statsMap
//   cheap, pure CPU       confidenceBoost + the four scoreWeights
//                         ->  buildCostMatrix -> hungarianAlgorithm
//
// So a stats bundle is fetched once and cached, and a sweep over the score
// weights is then microseconds per sample instead of an HTTP + DB round trip.
// Everything here calls the real lib/strategy modules; nothing is reimplemented.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

import { LineupOptimizer } from '../../../lib/strategy/optimizer.ts'
import { buildCostMatrix } from '../../../lib/strategy/calculator.ts'
import { hungarianAlgorithm } from '../../../lib/strategy/hungarian.ts'

export const CACHE_DIR = process.env.STRATEGY_CACHE_DIR
  ?? join(process.env.TEMP ?? '.', 'strategy-sweep-cache')

/** Stats-layer settings. Changing any of these requires a fresh DB fetch. */
export const DEFAULT_BUNDLE = {
  seasonStart: 20,
  seasonEnd: 22,
  venue: undefined,
  venueWeight: 0.7,
  userInputWeight: 0,
  avgMethod: 'mean',
  trimPct: 0.1,
  usePerGameNormalized: true,
}

const keyOf = (config) => createHash('sha1').update(JSON.stringify(config)).digest('hex').slice(0, 16)

/**
 * Fetches (or reloads from cache) the player x machine stats for one
 * stats-layer configuration. Returns a plain nested object so it serialises;
 * use toStatsMap() to get the Map shape buildCostMatrix wants.
 */
export async function loadBundle(options = {}) {
  const config = { ...DEFAULT_BUNDLE, ...options }
  const { players, machines } = config
  if (!players?.length || !machines?.length) throw new Error('players and machines are required')

  const cachePath = join(CACHE_DIR, `bundle-${keyOf(config)}.json`)
  if (existsSync(cachePath) && !process.env.STRATEGY_NO_CACHE) {
    return { ...config, stats: JSON.parse(await readFile(cachePath, 'utf8')), cached: true }
  }

  // usePerGameNormalized forces venueWeight to 1, matching the route.
  const venueWeight = config.usePerGameNormalized ? 1 : config.venueWeight
  const optimizer = new LineupOptimizer()
  const { statsMap } = await optimizer.prefetchStats(
    players, machines, config.seasonStart, config.seasonEnd, config.venue,
    venueWeight, config.userInputWeight, 0, config.avgMethod, config.trimPct,
  )

  const stats = {}
  for (const player of players) {
    stats[player] = {}
    const row = statsMap.get(player)
    for (const machine of machines) stats[player][machine] = row?.get(machine) ?? null
  }

  await mkdir(dirname(cachePath), { recursive: true })
  await writeFile(cachePath, JSON.stringify(stats), 'utf8')
  return { ...config, stats, cached: false }
}

export function toStatsMap(stats) {
  return new Map(Object.entries(stats).map(([player, row]) => [player, new Map(Object.entries(row))]))
}

/**
 * One optimizer evaluation. `weights` are the four score sliders as 0-1; they
 * need not sum to 1, though only their direction matters (see scaleInvariant
 * below). Returns a canonical signature so samples can be grouped.
 */
export function lineupFor(statsMap, players, machines, {
  weights, confidenceBoost = 0, edgeBonuses = null, opponentWeight = 0,
}) {
  const { matrix, realRows, realCols } = buildCostMatrix(players, machines, statsMap, confidenceBoost, weights)
  // Opponent edge, applied exactly as optimizer.ts does: MULTIPLICATIVE on the
  // real cells only, never the -1000 padding. The stored edge is already the
  // ow=1 value, so scaling it here reproduces any opponentWeight. Because the
  // edge comes from venue-adjusted averages and the opponent's assignment, not
  // from the score weights, one fetch covers a whole weight sweep.
  if (edgeBonuses && opponentWeight > 0) {
    for (let row = 0; row < realRows; row += 1) {
      for (let column = 0; column < realCols; column += 1) {
        const edge = edgeBonuses[`${players[row]}|${machines[column]}`]
        if (edge == null) continue
        matrix[row][column] *= 1 + opponentWeight * edge
      }
    }
  }
  const { assignments, totalCost } = hungarianAlgorithm(matrix, true)

  const pairs = []
  for (let row = 0; row < players.length; row += 1) {
    const column = assignments[row]
    if (column == null || column < 0 || column >= machines.length) continue
    pairs.push([players[row], machines[column]])
  }
  pairs.sort((a, b) => a[0].localeCompare(b[0]))
  return {
    pairs,
    total: totalCost,
    signature: pairs.map(([player, machine]) => `${player}>${machine}`).join('|'),
  }
}

/**
 * The four score weights enter calculatePerformanceScore linearly and
 * hungarianAlgorithm's argmax is invariant to positive scaling, so only their
 * direction matters -- unless confidenceBoost > 0, which blends in an
 * unscaled user_confidence term. Verified rather than assumed.
 */
export function scaleInvariant(statsMap, players, machines, weights, confidenceBoost = 0) {
  const base = lineupFor(statsMap, players, machines, { weights, confidenceBoost })
  const scaled = lineupFor(statsMap, players, machines, {
    weights: Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v * 2.5])),
    confidenceBoost,
  })
  return base.signature === scaled.signature
}

/** Fraction of player x machine cells that actually have games behind them. */
export function density(stats, players, machines) {
  let filled = 0
  for (const player of players) {
    for (const machine of machines) if (stats[player]?.[machine]?.games_played) filled += 1
  }
  return { filled, total: players.length * machines.length, ratio: filled / (players.length * machines.length) }
}

/**
 * Picks a real roster and machine list to sweep against.
 *
 * Defaults to the busiest venue inside the requested season window rather
 * than the most recent match: a recent roster against an older stats window
 * yields an all-null stats bundle, where every score is 0, the assignment is
 * arbitrary-but-deterministic, and the sweep reports a confident single
 * lineup that means nothing.
 */
export async function pickScenario({
  matchKey, team, venue, players: explicitPlayers, machines: explicitMachines,
  seasonStart = 20, seasonEnd = 22, size = 7,
} = {}) {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // An explicit roster wins over any heuristic: the top-N-by-games-played
  // default is only a guess at who will actually be fielded.
  if (explicitPlayers?.length) {
    const scenario = team || venue
      ? await pickScenario({ team, venue, seasonStart, seasonEnd, size: 40 })
      : { label: 'custom', venue, machines: [] }
    return {
      label: `${explicitPlayers.length} named players at ${venue ?? 'any venue'}`,
      season: `${seasonStart}-${seasonEnd}`,
      venue,
      players: explicitPlayers,
      machines: explicitMachines?.length ? explicitMachines : scenario.machines.slice(0, size),
    }
  }

  // A match that has not been played yet has no games rows, so an upcoming
  // fixture is described by its roster and its venue instead.
  if (team) {
    const rows = []
    for (let page = 0; page < 12; page += 1) {
      const { data, error } = await sb.from('games')
        .select('player_1_name,player_1_team,player_2_name,player_2_team,player_3_name,player_3_team,player_4_name,player_4_team,machine,venue,season')
        .gte('season', seasonStart).lte('season', seasonEnd)
        // .range() without .order() is non-deterministic in PostgREST: pages
        // can repeat and drop rows, which silently skews every tally below.
        .order('id', { ascending: true })
        .range(page * 1000, page * 1000 + 999)
      if (error) throw new Error(error.message)
      if (!data?.length) break
      rows.push(...data)
      if (data.length < 1000) break
    }
    // Rank the roster by how much they actually play, and the venue's
    // machines by how often they come up.
    const players = new Map()
    for (const row of rows) {
      for (const slot of [1, 2, 3, 4]) {
        if (row[`player_${slot}_team`] !== team) continue
        const name = row[`player_${slot}_name`]
        if (name) players.set(name, (players.get(name) ?? 0) + 1)
      }
    }
    // Machines come from the latest season only: a venue swaps its lineup
    // between seasons, so pooling 22-24 would propose machines that are no
    // longer on the floor. Player stats still use the full window. Asked for
    // server-side rather than tallied from the paged rows, so the list is
    // exact.
    const latest = Math.max(...rows.map((row) => row.season ?? 0))
    const machineQuery = sb.from('games').select('machine').eq('season', latest)
    const { data: machineRows, error: machineError } = venue
      ? await machineQuery.eq('venue', venue)
      : await machineQuery
    if (machineError) throw new Error(machineError.message)
    const machines = new Map()
    for (const row of machineRows ?? []) {
      if (row.machine) machines.set(row.machine, (machines.get(row.machine) ?? 0) + 1)
    }
    const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, size).map(([value]) => value)
    return {
      label: `${team} at ${venue ?? 'any venue'}`,
      season: `${seasonStart}-${seasonEnd}`,
      venue,
      players: top(players),
      machines: top(machines),
    }
  }

  if (matchKey) {
    const { data, error } = await sb.from('games')
      .select('match_key, season, venue, machine, player_1_name, player_1_team, home_team')
      .eq('match_key', matchKey)
    if (error) throw new Error(error.message)
    if (!data?.length) throw new Error(`no games for match ${matchKey}`)
    const team = data[0].home_team
    return {
      label: matchKey,
      season: data[0].season,
      venue: data[0].venue,
      players: [...new Set(data.filter((r) => r.player_1_team === team).map((r) => r.player_1_name).filter(Boolean))],
      machines: [...new Set(data.map((r) => r.machine).filter(Boolean))],
    }
  }

  const rows = []
  for (let page = 0; page < 8; page += 1) {
    const { data, error } = await sb.from('games')
      .select('venue, machine, player_1_name, season')
      .gte('season', seasonStart).lte('season', seasonEnd)
      .order('id', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  if (!rows.length) throw new Error(`no games in seasons ${seasonStart}-${seasonEnd}`)

  const byVenue = new Map()
  for (const row of rows) {
    if (!row.venue) continue
    if (!byVenue.has(row.venue)) byVenue.set(row.venue, [])
    byVenue.get(row.venue).push(row)
  }
  const [busiestVenue, venueRows] = [...byVenue.entries()].sort((a, b) => b[1].length - a[1].length)[0]

  const tally = (field) => {
    const counts = new Map()
    for (const row of venueRows) {
      const value = row[field]
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, size).map(([value]) => value)
  }
  return {
    label: `${busiestVenue} (busiest in s${seasonStart}-${seasonEnd})`,
    season: `${seasonStart}-${seasonEnd}`,
    venue: busiestVenue,
    players: tally('player_1_name'),
    machines: tally('machine'),
  }
}
