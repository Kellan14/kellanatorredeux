import assert from 'node:assert/strict'
import { ASSIGNMENT_MODEL, buildAssignmentEstimator } from '../lib/strategy/assignment-estimator.ts'

const rows = [
  { player: 'A', machine: 'AFM', venue: 'Kraken', score: 3000 },
  { player: 'B', machine: 'AFM', venue: 'The Kraken', score: 1000 },
  { player: 'A', machine: 'AFM', venue: 'GPA', score: 900 },
  { player: 'B', machine: 'AFM', venue: 'GPA', score: 300 },
  { player: 'A', machine: 'TZ', venue: 'GPA', score: 0 },
  { player: 'B', machine: 'TZ', venue: 'GPA', score: 100 },
]
const model = buildAssignmentEstimator(rows)
const fit = model.estimate('A', 'AFM', 'the kraken')
const expected = (2 * Math.log1p(1.5) + 10 * (2 * Math.log1p(1.5) / 3)) / 12
assert.equal(fit.machineGames, 2)
assert.equal(fit.venueGames, 1)
assert.equal(fit.overallGames, 3)
assert.equal(fit.machineWeight, 2/12)
assert.equal(fit.normalizedPercent, 150)
assert(Math.abs(fit.score - (ASSIGNMENT_MODEL.intercept + ASSIGNMENT_MODEL.slope * expected)) < 1e-12)
assert.equal(model.estimate('A', 'TZ').normalizedPercent, 0)
assert.equal(model.estimate('A', 'Unknown').evidence, 'overall')
assert.equal(model.estimate('Unknown', 'AFM').evidence, 'league')
assert.equal(buildAssignmentEstimator([]).estimate('A', 'AFM').score, null)
console.log('Assignment estimator: frozen formula, counts, zero scores and all fallbacks passed.')
