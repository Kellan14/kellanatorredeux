import assert from 'node:assert/strict'
import { evaluateDoublesLineups } from '../lib/strategy/doubles-metrics.ts'

const [result] = evaluateDoublesLineups([{
  machine: 'AFM', venue: 'Arcade', round_number: 1,
  player_1_name: 'A', player_1_score: 100, player_1_points: 0,
  player_2_name: 'C', player_2_score: 300, player_2_points: 2.5,
}], [{ score: 1, picks: [{ machine: 'AFM', players: ['A', 'B'], opponents: ['C', 'D'] }] }],
['C', 'D'], 'Arcade', false, false, {})
assert.equal(result.metrics.twcVenue, null)
assert.equal(result.metrics.venueSpread, null)
assert.deepEqual(result.coverage.twcVenue, { count: 1, total: 2, average: 50 })
assert.deepEqual(result.coverage.twcPops, { count: 1, total: 2, average: 0 })
assert.deepEqual(result.coverage.oppVenue, { count: 1, total: 2, average: 150 })
console.log('Partial metric averages preserve zero, report coverage, and stay out of complete-lineup rankings.')
