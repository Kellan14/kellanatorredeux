import assert from 'node:assert/strict'
import { leastUniqueReplacements, summarizeLeastUniqueSet } from '../lib/least-unique-machine-swap.ts'

const a = { machine: 'afm', players: ['Ada', 'Inez'] }
const b = { machine: 'tz', players: ['Inez', 'Tess'] }
const c = { machine: 'mm', players: ['Sam'] }
const d = { machine: 'rfg', players: ['Ada', 'Lee'] }
const original = summarizeLeastUniqueSet([a, b, c, d])
const same = { machine: 'tron', players: ['Ada', 'Inez', 'Inez'] }
const newPlayer = { machine: 'wonka', players: ['Uma'] }
const noHistory = { machine: 'dialedin', players: [] }
const data = { candidateMachines: [a, b, c, d, same, newPlayer, noHistory, { ...same, machine: 'TRON' }] }
const options = leastUniqueReplacements(original, ' MM ', data)
assert.deepEqual(options.map(o => o.machine), ['dialedin', 'tron', 'wonka'])
assert.deepEqual(options.map(o => o.set.totalUniquePlayers), [4, 4, 5])
assert.deepEqual(options[1].set.machines.map(m => m.machine), ['afm', 'tz', 'tron', 'rfg'])
assert.deepEqual(options[1].set.machines.map(m => m.addedPlayers), [2, 1, 0, 1])
assert.equal(options[1].set.machines[2].playerCount, 2)
assert.deepEqual(options[1].set.allPlayers, ['Ada', 'Inez', 'Tess', 'Lee'])
assert.equal(original.totalUniquePlayers, 5)
assert.equal(original.machines[2].machine, 'mm')
const followUp = leastUniqueReplacements(options[1].set, 'tron', data)
assert(followUp.some(o => o.machine === 'mm'))
assert(!followUp.some(o => o.machine.toLowerCase() === 'tron'))
assert.equal(leastUniqueReplacements(original, 'missing', data).length, 0)
assert.deepEqual(leastUniqueReplacements(original, 'mm', { sets: [original, summarizeLeastUniqueSet([a, b, newPlayer, d])] })
  .map(o => o.machine), ['wonka'])
console.log('Machine swaps preserve other slots and recalculate deduplicated player counts, including zero-history and legacy candidates.')
