// Plans the two rounds an MNP team actually picks.
//
// Per the match rules a match is four rounds and 30 player-game slots:
//
//   R1 doubles  away picks machines + its pairs, we respond   8 slots
//   R2 singles  WE pick 7 machines and 7 players              7 slots
//   R3 singles  away picks machines + its players, we respond 7 slots
//   R4 doubles  WE pick 4 machines and 4 pairs                8 slots
//
// R1 and R3 depend on machines the opponent has not chosen yet, so guessing
// them is noise. This plans only R2 and R4 -- the 15 slots that are genuinely
// ours -- while still respecting the whole-match participation constraint.
//
// That constraint is what makes this more than two independent rounds.
// M3.00.4d allows one game per round, and M4.00.0c pays 9 points when 10
// players each play 3 games, which is exactly 30 slots. So every player sits
// exactly one round. Committing players to R2 and R4 therefore fixes who is
// left to cover R1 and R3:
//
//   3 players sit R2  -> they play R1, R3, R4
//   2 players sit R4  -> they play R1, R2, R3
//   the other 5 play both R2 and R4, so each sits exactly one of R1/R3
//                       (2 sit R1, 3 sit R3 -- decided once picks are known)
//
// Because only 120 x 45 subset pairs exist, this is solved exactly rather
// than hill-climbed: best R2 for every 7-player subset, best R4 for every
// 8-player subset, then the best disjoint combination.
//
// Machines must differ within a round (M3.00.4a/4b) but may repeat across
// rounds, so R2 and R4 may share a machine.
//
// Usage:
//   node --import ./scripts/strategy/lib/register-alias.mjs //     scripts/strategy/match-plan.mjs --team TWC --venue "..." [--players "a,b,..."]

import { calculatePerformanceScore, calculatePairSynergy } from '../../lib/strategy/calculator.ts'
import { hungarianAlgorithm } from '../../lib/strategy/hungarian.ts'
import { density, loadBundle, pickScenario } from './lib/pipeline.mjs'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
}
const list = (name) => arg(name)?.split(',').map((v) => v.trim()).filter(Boolean)

const WEIGHTS = { winRate: 0.17, recentForm: 0.09, venueAdjustedAvg: 0.46, confidence: 0.28 }
const LINEUP_SIZE = 10
const R2_SLOTS = 7   // singles we pick
const R4_SLOTS = 8   // doubles we pick (4 pairs)

// --- scoring ----------------------------------------------------------------
const cellScore = (stats, player, machine) =>
  calculatePerformanceScore(stats[player]?.[machine] ?? null, 0, WEIGHTS)

// hungarianAlgorithm takes its size from the ROW count and treats the matrix
// as square, so a 7x26 matrix silently considers only the first 7 machines --
// which is how the venue's best machine for a player can become unreachable.
// buildCostMatrix pads for exactly this reason; direct callers must too.
const DUMMY = -1000
function squarePad(matrix, columns) {
  const size = Math.max(matrix.length, columns)
  const padded = matrix.map((row) => {
    const copy = row.slice(0, columns)
    while (copy.length < size) copy.push(DUMMY)
    return copy
  })
  while (padded.length < size) padded.push(new Array(size).fill(DUMMY))
  return padded
}

function assignSingles(players, machines, stats) {
  const matrix = players.map((p) => machines.map((m) => cellScore(stats, p, m)))
  const { assignments } = hungarianAlgorithm(squarePad(matrix, machines.length), true)
  const picks = []
  let total = 0
  players.forEach((player, row) => {
    const column = assignments[row]
    if (column == null || column < 0 || column >= machines.length) return
    picks.push({ players: [player], machine: machines[column], score: matrix[row][column] })
    total += matrix[row][column]
  })
  return { picks, total }
}

/** All ways to split an even list into unordered pairs (8 players -> 105). */
function pairings(players) {
  if (players.length === 0) return [[]]
  const [first, ...rest] = players
  const out = []
  for (let index = 0; index < rest.length; index += 1) {
    const remaining = rest.filter((_, i) => i !== index)
    for (const tail of pairings(remaining)) out.push([[first, rest[index]], ...tail])
  }
  return out
}

function assignDoubles(players, machines, stats) {
  let best = null
  for (const pairing of pairings(players)) {
    const matrix = pairing.map(([a, b]) => machines.map((machine) => (
      cellScore(stats, a, machine) + cellScore(stats, b, machine)
      + calculatePairSynergy(stats[a]?.[machine] ?? null, stats[b]?.[machine] ?? null, undefined, 0, WEIGHTS)
    )))
    const { assignments } = hungarianAlgorithm(squarePad(matrix, machines.length), true)
    const picks = []
    let total = 0
    pairing.forEach((pair, row) => {
      const column = assignments[row]
      if (column == null || column < 0 || column >= machines.length) return
      picks.push({ players: pair, machine: machines[column], score: matrix[row][column] })
      total += matrix[row][column]
    })
    if (picks.length === pairing.length && (!best || total > best.total)) best = { picks, total }
  }
  return best ?? { picks: [], total: -Infinity }
}

const combinations = (items, k) => {
  if (k === 0) return [[]]
  if (items.length < k) return []
  const [first, ...rest] = items
  return [...combinations(rest, k - 1).map((c) => [first, ...c]), ...combinations(rest, k)]
}

// --- run ---------------------------------------------------------------------
const seasonStart = Number(arg('season-start', 22))
const seasonEnd = Number(arg('season-end', 24))
const team = arg('team', 'TWC')
const venue = arg('venue')

const scenario = await pickScenario({ team, venue, players: list('players'), seasonStart, seasonEnd, size: 60 })
const lineup = scenario.players.slice(0, LINEUP_SIZE)
if (lineup.length < LINEUP_SIZE) {
  console.error(`need ${LINEUP_SIZE} players for the full M4.00.0c bonus, got ${lineup.length}`)
  process.exit(1)
}
const pool = scenario.machines
const bundle = await loadBundle({ players: lineup, machines: pool, venue, seasonStart, seasonEnd })
const stats = bundle.stats
const coverage = density(stats, lineup, pool)

// Exact search: best R2 for each 7-subset, best R4 for each 8-subset, then
// the best disjoint pairing of their complements.
const key = (players) => players.join('|')
const r2Best = new Map()
for (const sitting of combinations(lineup, LINEUP_SIZE - R2_SLOTS)) {
  const playing = lineup.filter((p) => !sitting.includes(p))
  r2Best.set(key(sitting), { sitting, ...assignSingles(playing, pool, stats) })
}
const r4Best = new Map()
for (const sitting of combinations(lineup, LINEUP_SIZE - R4_SLOTS)) {
  const playing = lineup.filter((p) => !sitting.includes(p))
  r4Best.set(key(sitting), { sitting, ...assignDoubles(playing, pool, stats) })
}

let best = null
for (const r2 of r2Best.values()) {
  for (const r4 of r4Best.values()) {
    // Each player sits exactly one round, so the two sit-out sets are disjoint.
    if (r4.sitting.some((p) => r2.sitting.includes(p))) continue
    const total = r2.total + r4.total
    if (!best || total > best.total) best = { r2, r4, total }
  }
}

const both = lineup.filter((p) => !best.r2.sitting.includes(p) && !best.r4.sitting.includes(p))

console.log(`\n${team} -- the two rounds we pick${venue ? `, at ${venue}` : ''}`)
console.log(`stats seasons ${seasonStart}-${seasonEnd} | lineup ${lineup.length} | pool ${pool.length} machines`
  + ` | coverage ${coverage.filled}/${coverage.total} (${(coverage.ratio * 100).toFixed(0)}%)`)
console.log(`searched ${r2Best.size} x ${r4Best.size} subset pairs exactly\n`)

console.log('ROUND 2 -- singles, we pick 7 machines and 7 players')
for (const pick of best.r2.picks) console.log(`   ${pick.players[0].padEnd(20)} ${pick.machine}`)
console.log(`   sitting: ${best.r2.sitting.join(', ')}\n`)

console.log('ROUND 4 -- doubles, we pick 4 machines and 4 pairs')
for (const pick of best.r4.picks) console.log(`   ${pick.players.join(' + ').padEnd(36)} ${pick.machine}`)
console.log(`   sitting: ${best.r4.sitting.join(', ')}\n`)

console.log('--- what this commits for the rounds they pick ---')
console.log(`  play both R2 and R4 (each sits one of R1/R3): ${both.join(', ')}`)
console.log(`    -> when their picks are known, 2 of those 5 sit R1 and 3 sit R3`)
console.log(`  sit R2, so must play R1+R3+R4: ${best.r2.sitting.join(', ')}`)
console.log(`  sit R4, so must play R1+R2+R3: ${best.r4.sitting.join(', ')}`)
console.log(`  every player reaches 3 games -> M4.00.0c bonus 9 points\n`)

const thin = lineup.map((player) => ({
  player,
  games: pool.reduce((sum, m) => sum + (stats[player]?.[m]?.games_played ? 1 : 0), 0),
})).filter((row) => row.games <= 2)
if (thin.length) {
  console.log('--- thin data, treat these placements as guesses ---')
  for (const row of thin) console.log(`  ${row.player.padEnd(20)} stats on only ${row.games} of ${pool.length} pool machines`)
  console.log()
}
