import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const base = process.env.TEST_BASE_URL || 'http://localhost:3102'
const source = JSON.parse(readFileSync(new URL('../mnp-data-archive/season-24/matches/mnp-24-6-SSS-TWC.json', import.meta.url)))
const game = source.rounds[0].games[0]
const getName = (side, slot) => source[side].lineup.find(player => player.key === game[`player_${slot}`]).name
const players = [getName('home', 2), getName('home', 4)]
const opponents = [getName('away', 1), getName('away', 3)]
const pick = { machine: game.machine, players, opponents }
const unknown = ['No archived player 1', 'No archived player 2']
const response = await fetch(`${base}/api/strategy/doubles-metrics`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    venue: source.venue.name, seasonStart: 24, seasonEnd: 24, opponentPlayers: opponents,
    lineups: [{ picks: [pick] }, { picks: [{ ...pick, opponents: undefined }] }, { picks: [{ ...pick, players: unknown }] }],
  }),
})
assert.equal(response.status, 200, await response.clone().text())
const { results } = await response.json()
const [assigned, projected, missing] = results
assert.deepEqual(assigned.opponents, [opponents])
assert.deepEqual(projected.opponents.flat().sort(), [...opponents].sort())
for (const value of Object.values(assigned.metrics)) assert.ok(Number.isFinite(value))
assert.equal(assigned.metrics.venueSpread, assigned.metrics.twcVenue - assigned.metrics.oppVenue)
assert.equal(assigned.metrics.popsSpread, assigned.metrics.twcPops - assigned.metrics.oppPops)
assert.equal(missing.metrics.twcVenue, null)
assert.equal(missing.metrics.twcPops, null)
assert.equal(missing.metrics.venueSpread, null)
assert.equal(missing.metrics.popsSpread, null)
console.log('Doubles metrics verified with recorded scores, opponent projection and missing-data handling')
