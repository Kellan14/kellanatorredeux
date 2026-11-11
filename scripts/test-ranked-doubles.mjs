import assert from 'node:assert/strict'
import { rankDoublesRuns } from '../lib/ranked-doubles.ts'

const lineup = (score, machine, players) => ({ score, picks: [{ machine, players }] })
const control = new AbortController()
const excluded = { TZ: ['A'] }
const answers = [
  lineup(2, 'AFM', ['A', 'B']),
  lineup(1, 'GOT', ['A', 'C']),
  lineup(4, 'GOT', ['C', 'A']), // Same lineup, reversed pair order.
  lineup(10, 'TZ', ['A', 'C']), // Invalid: A excluded from TZ.
  lineup(9, 'PULP', ['B', 'C']), // Invalid: missing must-play A.
]
let calls = 0
const ranked = await rankDoublesRuns({
  iterations: 5, machines: 1, mustPlay: ['A'], exclusions: excluded, signal: control.signal,
  solve: async exclusions => {
    assert.ok(exclusions.TZ.includes('A'), 'Original exclusions are preserved')
    return answers[calls++]
  },
})
assert.equal(ranked.completed, 5)
assert.deepEqual(ranked.lineups.map(row => row.score), [4, 2])
assert.deepEqual(excluded, { TZ: ['A'] }, 'Inputs are not mutated')

const controller = new AbortController()
calls = 0
const stopped = await rankDoublesRuns({
  iterations: 20, machines: 1, mustPlay: [], exclusions: {}, signal: controller.signal,
  solve: async () => {
    if (calls++ === 0) return answers[0]
    controller.abort()
    throw controller.signal.reason
  },
})
assert.equal(stopped.completed, 1)
assert.equal(stopped.lineups.length, 1, 'Stop retains completed lineups')
console.log('Ranked doubles: alternate branches, ranking, uniqueness, constraints and stop verified')
