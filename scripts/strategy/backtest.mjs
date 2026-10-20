// Does the scoring model actually predict anything? Fits the score weights
// against real results instead of against taste.
//
// The obvious backtest -- "would this lineup have scored more points?" -- is
// impossible: you never observe what a player would have done on a machine
// they did not play. So this evaluates the only thing the data can answer
// without counterfactuals: in a head-to-head singles game, does the model
// rank the player who actually won higher?
//
// Leakage is avoided by building each test season's stats from strictly
// earlier seasons, and the weights are fitted on one season and reported on a
// later one, so the headline number is out-of-sample.
//
// Usage:
//   node --import ./scripts/strategy/lib/register-alias.mjs \
//        scripts/strategy/backtest.mjs [--fit 21] [--test 22] [--train-start 13] [--samples 600]

import { calculatePerformanceScore } from '../../lib/strategy/calculator.ts'
import { loadBundle } from './lib/pipeline.mjs'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
}
const FIT_SEASON = Number(arg('fit', 21))
const TEST_SEASON = Number(arg('test', 22))
const TRAIN_START = Number(arg('train-start', 13))
const SAMPLES = Number(arg('samples', 600))
const DEFAULT_WEIGHTS = { winRate: 0.4, recentForm: 0.3, venueAdjustedAvg: 0.2, confidence: 0.1 }

// Same simplex sampling as the sweep: only the direction of the four weights
// matters, so sample the 3-simplex rather than the 4-cube.
const PRIMES = [2, 3, 5]
const halton = (index, base) => {
  let result = 0, f = 1 / base, i = index
  while (i > 0) { result += f * (i % base); i = Math.floor(i / base); f /= base }
  return result
}
function weightSamples(count) {
  const out = [DEFAULT_WEIGHTS]
  for (let index = 0; index < count; index += 1) {
    const [a, b, c] = PRIMES.map((base) => halton(index + 1, base)).sort((x, y) => x - y)
    out.push({ winRate: a, recentForm: b - a, venueAdjustedAvg: c - b, confidence: 1 - c })
  }
  return out
}

async function fetchSeason(season) {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const rows = []
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await sb.from('games')
      .select('player_1_name,player_2_name,player_3_name,player_1_score,player_2_score,machine')
      .eq('season', season)
      // Deterministic order: paging without it can repeat and drop rows.
      .order('id', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  // Singles only: a clean two-player head-to-head on one machine.
  return rows.filter((r) => r.player_1_name && r.player_2_name && !r.player_3_name
    && r.player_1_score > 0 && r.player_2_score > 0 && r.machine
    && r.player_1_score !== r.player_2_score)
}

/** Head-to-heads the model can actually call: both players have prior stats. */
function usable(games, stats) {
  return games.filter((game) => stats[game.player_1_name]?.[game.machine]?.games_played
    && stats[game.player_2_name]?.[game.machine]?.games_played)
}

function accuracy(games, stats, weights) {
  let correct = 0
  for (const game of games) {
    const a = calculatePerformanceScore(stats[game.player_1_name][game.machine], 0, weights)
    const b = calculatePerformanceScore(stats[game.player_2_name][game.machine], 0, weights)
    if (a === b) continue
    const predictedFirst = a > b
    const actualFirst = game.player_1_score > game.player_2_score
    if (predictedFirst === actualFirst) correct += 1
  }
  return correct / games.length
}

/** Ignores the weights entirely: whoever has played the machine more. */
function experienceBaseline(games, stats) {
  let correct = 0
  for (const game of games) {
    const a = stats[game.player_1_name][game.machine].games_played
    const b = stats[game.player_2_name][game.machine].games_played
    if (a === b) continue
    if ((a > b) === (game.player_1_score > game.player_2_score)) correct += 1
  }
  return correct / games.length
}

async function prepare(season) {
  const games = await fetchSeason(season)
  const players = [...new Set(games.flatMap((g) => [g.player_1_name, g.player_2_name]))]
  const machines = [...new Set(games.map((g) => g.machine))]
  // Stats built strictly from earlier seasons -- no leakage from the season
  // being predicted.
  const bundle = await loadBundle({
    players, machines, seasonStart: TRAIN_START, seasonEnd: season - 1, venue: undefined,
  })
  const scored = usable(games, bundle.stats)
  return { season, games, scored, stats: bundle.stats, players, machines }
}

const pct = (n) => `${(n * 100).toFixed(1)}%`

console.log(`\ntrain window: seasons ${TRAIN_START}-${FIT_SEASON - 1} for the fit, ${TRAIN_START}-${TEST_SEASON - 1} for the test`)

const fit = await prepare(FIT_SEASON)
console.log(`fit  season ${FIT_SEASON}: ${fit.games.length} head-to-heads, ${fit.scored.length} callable `
  + `(${pct(fit.scored.length / fit.games.length)}), ${fit.players.length} players x ${fit.machines.length} machines`)

const test = await prepare(TEST_SEASON)
console.log(`test season ${TEST_SEASON}: ${test.games.length} head-to-heads, ${test.scored.length} callable `
  + `(${pct(test.scored.length / test.games.length)})`)

const candidates = weightSamples(SAMPLES)
let best = null
for (const weights of candidates) {
  const score = accuracy(fit.scored, fit.stats, weights)
  if (!best || score > best.score) best = { weights, score }
}

const show = (w) => ['winRate', 'recentForm', 'venueAdjustedAvg', 'confidence']
  .map((k) => `${k} ${w[k].toFixed(3)}`).join('  ')

console.log(`\n--- fitted on season ${FIT_SEASON} (${candidates.length} weight samples) ---`)
console.log(`  best weights : ${show(best.weights)}`)
console.log(`  in-sample    : ${pct(best.score)}`)
console.log(`  defaults     : ${pct(accuracy(fit.scored, fit.stats, DEFAULT_WEIGHTS))}`)

console.log(`\n--- held out on season ${TEST_SEASON} (the number that counts) ---`)
const fittedOut = accuracy(test.scored, test.stats, best.weights)
const defaultOut = accuracy(test.scored, test.stats, DEFAULT_WEIGHTS)
console.log(`  fitted weights       : ${pct(fittedOut)}`)
console.log(`  current defaults     : ${pct(defaultOut)}`)
console.log(`  games-played baseline: ${pct(experienceBaseline(test.scored, test.stats))}`)
console.log(`  coin flip            : 50.0%`)

const spread = candidates.map((w) => accuracy(test.scored, test.stats, w)).sort((a, b) => a - b)
console.log(`\n  best possible on the test season itself: ${pct(spread[spread.length - 1])} `
  + `(worst ${pct(spread[0])}, median ${pct(spread[Math.floor(spread.length / 2)])})`)
console.log(`  -> the whole simplex spans ${pct(spread[spread.length - 1] - spread[0])} of accuracy; `
  + `if that span is small, the sliders cannot matter much either.`)

const delta = fittedOut - defaultOut
console.log(`\n  fitting moved out-of-sample accuracy by ${delta >= 0 ? '+' : ''}${pct(delta)}.`)
console.log(`  With 3 free parameters and ${test.scored.length} games, treat anything under ~2% as noise.\n`)
