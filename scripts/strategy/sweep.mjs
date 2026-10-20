// Maps the strategy sliders to the lineups they actually produce.
//
// The optimizer's output is a lineup, not a number, so this is not an
// optimisation -- there is nothing to maximise. It partitions weight-space by
// outcome and reports:
//
//   * which lineups are reachable at all, and what share of the space
//     produces each (basin volume = how robust that answer is)
//   * which player->machine pairs are settled vs genuinely contested
//   * which sliders change the answer, and which are decoration
//   * the exact slider values where the lineup flips
//
// Two structural facts make this cheap, both verified rather than assumed:
//
//   1. calculatePerformanceScore is linear in the four score weights and
//      hungarianAlgorithm's argmax is scale-invariant, so those four sliders
//      are a point on a 3-simplex -- magnitude is a no-op. (Only true while
//      confidenceBoost is 0, which blends in an unscaled term.)
//   2. The weights enter at buildCostMatrix, after the DB work. Fetch stats
//      once and an evaluation costs ~13us.
//
// Usage:
//   node --import ./scripts/strategy/lib/register-alias.mjs \
//        scripts/strategy/sweep.mjs [--match KEY] [--samples 20000] [--json]

import { shiftSetting } from '../../lib/strategy/sweep.ts'
import { density, loadBundle, lineupFor, pickScenario, scaleInvariant, toStatsMap } from './lib/pipeline.mjs'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
}
const SAMPLES = Number(arg('samples', 20000))
const AS_JSON = argv.includes('--json')
const FACTORS = ['winRate', 'recentForm', 'venueAdjustedAvg', 'confidence']
// The fitted defaults (see app/strategy/page.tsx SLIDER_DEFAULTS).
const BASELINE = { winRate: 0.17, recentForm: 0.09, venueAdjustedAvg: 0.46, confidence: 0.28 }

// --- low-discrepancy sampling ----------------------------------------------
// Halton rather than uniform random: basin volumes are the whole point here,
// and uniform random clumps, which biases those estimates badly at this
// sample count. Scrambled with a fixed offset so runs stay reproducible.
const PRIMES = [2, 3, 5, 7, 11]
function halton(index, base) {
  let result = 0
  let f = 1 / base
  let i = index
  while (i > 0) {
    result += f * (i % base)
    i = Math.floor(i / base)
    f /= base
  }
  return result
}
const OFFSET = [0.11, 0.37, 0.59, 0.83, 0.29]
const point = (index) => PRIMES.map((base, d) => (halton(index + 1, base) + OFFSET[d]) % 1)

// Three uniforms -> a uniform point on the 3-simplex via sorted spacings, so
// the four weights are sampled by direction only.
function simplexWeights([u1, u2, u3]) {
  const [a, b, c] = [u1, u2, u3].sort((x, y) => x - y)
  return { winRate: a, recentForm: b - a, venueAdjustedAvg: c - b, confidence: 1 - c }
}

const pct = (n) => `${(n * 100).toFixed(1)}%`

function main(scenario, statsMap) {
  const { players, machines } = scenario
  const evaluate = (weights, confidenceBoost) =>
    lineupFor(statsMap, players, machines, { weights, confidenceBoost })

  // --- sample ---------------------------------------------------------------
  const basins = new Map()
  const perPlayer = new Map(players.map((player) => [player, new Map()]))
  const samples = []
  for (let index = 0; index < SAMPLES; index += 1) {
    const u = point(index)
    const weights = simplexWeights(u.slice(0, 3))
    const confidenceBoost = u[3]
    const result = evaluate(weights, confidenceBoost)
    samples.push({ weights, confidenceBoost, signature: result.signature })

    const basin = basins.get(result.signature)
    if (basin) basin.count += 1
    else basins.set(result.signature, { count: 1, pairs: result.pairs, example: { weights, confidenceBoost } })
    for (const [player, machine] of result.pairs) {
      const row = perPlayer.get(player)
      row.set(machine, (row.get(machine) ?? 0) + 1)
    }
  }

  const ranked = [...basins.values()].sort((a, b) => b.count - a.count)

  // --- settled vs contested -------------------------------------------------
  // Shannon entropy over a player's machine distribution: 0 means the sweep
  // never disagreed about them.
  const assignments = players.map((player) => {
    const row = [...perPlayer.get(player).entries()].sort((a, b) => b[1] - a[1])
    const total = row.reduce((sum, [, n]) => sum + n, 0) || 1
    const entropy = -row.reduce((sum, [, n]) => {
      const p = n / total
      return sum + (p > 0 ? p * Math.log2(p) : 0)
    }, 0)
    return { player, top: row[0], share: row[0] ? row[0][1] / total : 0, entropy, spread: row.slice(0, 3), total }
  }).sort((a, b) => b.entropy - a.entropy)

  // --- which sliders matter -------------------------------------------------
  // Morris-style screening, adapted for a categorical output: perturb one
  // slider and measure how often the lineup changes at all.
  const DELTA = 0.1
  const screenCount = Math.min(600, SAMPLES)
  const influence = []
  for (const key of [...FACTORS, 'confidenceBoost']) {
    let flips = 0
    let tried = 0
    for (let index = 0; index < screenCount; index += 1) {
      const { weights, confidenceBoost, signature } = samples[Math.floor(index * SAMPLES / screenCount)]
      const current = key === 'confidenceBoost' ? confidenceBoost : weights[key]
      const moved = current + (current > 0.5 ? -DELTA : DELTA)
      if (moved < 0 || moved > 1) continue
      tried += 1
      const next = key === 'confidenceBoost'
        ? evaluate(weights, moved)
        : evaluate(shiftSetting({ venueWeight: 0, userInputWeight: 0, confidenceBoost: 0, opponentWeight: 0, scoreWeights: weights }, key, moved).scoreWeights, confidenceBoost)
      if (next.signature !== signature) flips += 1
    }
    influence.push({ key, flipRate: tried ? flips / tried : 0, tried })
  }
  influence.sort((a, b) => b.flipRate - a.flipRate)

  // --- where it flips -------------------------------------------------------
  // Walk each slider from the baseline and bisect the first change, which
  // turns a volume into an actionable threshold.
  const base = { venueWeight: 0, userInputWeight: 0, confidenceBoost: 0, opponentWeight: 0, scoreWeights: BASELINE }
  const baseResult = evaluate(BASELINE, 0)
  const at = (key, value) => (key === 'confidenceBoost'
    ? evaluate(BASELINE, value)
    : evaluate(shiftSetting(base, key, value).scoreWeights, 0))

  const boundaries = []
  for (const key of [...FACTORS, 'confidenceBoost']) {
    const from = key === 'confidenceBoost' ? 0 : BASELINE[key]
    for (const direction of [1, -1]) {
      let previous = from
      let found = null
      for (let step = 1; step <= 20; step += 1) {
        const value = from + direction * step * 0.05
        if (value < 0 || value > 1) break
        if (at(key, value).signature !== baseResult.signature) { found = value; break }
        previous = value
      }
      if (found == null) continue
      let low = previous
      let high = found
      for (let iteration = 0; iteration < 24; iteration += 1) {
        const mid = (low + high) / 2
        if (at(key, mid).signature === baseResult.signature) low = mid
        else high = mid
      }
      const after = at(key, high)
      const changed = after.pairs.filter(([player, machine]) =>
        baseResult.pairs.find((p) => p[0] === player)?.[1] !== machine)
      boundaries.push({ key, from, threshold: high, direction, changed, before: baseResult.pairs })
    }
  }

  return { ranked, assignments, influence, boundaries, baseResult, total: SAMPLES }
}

// --- run ---------------------------------------------------------------------
const seasonStart = Number(arg('season-start', 20))
const seasonEnd = Number(arg('season-end', 22))
const list = (name) => arg(name)?.split(',').map((value) => value.trim()).filter(Boolean)
const scenario = await pickScenario({
  matchKey: arg('match'),
  team: arg('team'),
  venue: arg('venue'),
  players: list('players'),
  machines: list('machines'),
  seasonStart,
  seasonEnd,
})
const bundle = await loadBundle({
  players: scenario.players,
  machines: scenario.machines,
  venue: argv.includes('--no-venue') ? undefined : scenario.venue,
  seasonStart,
  seasonEnd,
})

// A sparse bundle scores every cell 0, which makes Hungarian return a single
// arbitrary-but-deterministic lineup -- and the sweep then reports total
// confidence in nothing at all. Refuse rather than print a meaningless answer.
const coverage = density(bundle.stats, scenario.players, scenario.machines)
if (coverage.ratio < 0.25) {
  console.error(`stats bundle is too sparse: ${coverage.filled}/${coverage.total} cells have games.`)
  console.error('Every score would be 0 and the sweep would report one fake lineup.')
  console.error('Check the roster falls inside --season-start/--season-end, or pass --no-venue.')
  process.exit(1)
}
const statsMap = toStatsMap(bundle.stats)
const started = Date.now()
const report = main(scenario, statsMap)
const elapsed = Date.now() - started

if (AS_JSON) {
  console.log(JSON.stringify({ scenario, ...report }, null, 2))
} else {
  console.log(`\nscenario: ${scenario.label}  (season ${scenario.season})`)
  console.log(`${scenario.players.length} players x ${scenario.machines.length} machines`
    + `  |  coverage ${coverage.filled}/${coverage.total} cells (${(coverage.ratio * 100).toFixed(0)}%)`)
  console.log(`${report.total} samples in ${elapsed}ms  (${(elapsed * 1000 / report.total).toFixed(0)}us each)`)
  console.log(`scale-invariant: ${scaleInvariant(statsMap, scenario.players, scenario.machines, BASELINE)}`
    + '  (so the 4 score sliders are 3 DOF, magnitude is a no-op)')

  console.log(`\n--- reachable lineups (${report.ranked.length}) -------------------------`)
  for (const basin of report.ranked.slice(0, 6)) {
    console.log(`\n  ${pct(basin.count / report.total).padStart(6)} of weight-space`)
    for (const [player, machine] of basin.pairs) console.log(`     ${player.padEnd(18)} -> ${machine}`)
  }
  if (report.ranked.length > 6) {
    const tail = report.ranked.slice(6).reduce((sum, b) => sum + b.count, 0)
    console.log(`\n  ...${report.ranked.length - 6} more lineups sharing ${pct(tail / report.total)} (fragile; likely artifacts)`)
  }

  console.log('\n--- settled vs contested ------------------------------------')
  for (const row of report.assignments) {
    const label = row.entropy < 0.05 ? 'SETTLED  ' : row.entropy < 0.8 ? 'leaning  ' : 'CONTESTED'
    const spread = row.spread.map(([machine, n]) => `${machine} ${pct(n / row.total)}`).join(', ')
    console.log(`  ${label} ${row.player.padEnd(18)} ${spread}`)
  }

  console.log('\n--- which sliders actually matter ---------------------------')
  for (const row of report.influence) {
    const bar = '#'.repeat(Math.round(row.flipRate * 40))
    console.log(`  ${row.key.padEnd(18)} ${pct(row.flipRate).padStart(6)} ${bar}${row.flipRate < 0.02 ? '  (inert -- consider hiding)' : ''}`)
  }

  console.log('\n--- flip points from the default weights --------------------')
  if (!report.boundaries.length) console.log('  none within range: the default lineup is stable across every slider')
  for (const bound of report.boundaries) {
    const moves = bound.changed.map(([player, machine]) => `${player} -> ${machine}`).join(', ')
    console.log(`  ${bound.key.padEnd(18)} crosses ${bound.threshold.toFixed(3)} (from ${bound.from.toFixed(2)}): ${moves}`)
  }
  console.log()
}
