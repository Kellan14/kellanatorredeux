import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { currentPopsMachines, parseLineupVenueKeys } from '../lib/player-pops-inventory.ts'

const keys = parseLineupVenueKeys('\uFEFFKEY,Name\r\nIBX,Ice Box\r\nGPA,Georgetown\r\nIBX,Ice Box\nNAV,Unavailable\nTBD,Undecided\nERROR')
assert.deepEqual(keys, ['IBX', 'GPA'])
const venues = [
  { key: 'GPA', name: 'Georgetown', machines: ['AFM', 'SEGAGOD'] },
  { key: 'IBX', name: 'Ice Box', machines: ['Afm', 'Godzilla'] },
  { key: 'OLD', name: 'Closed venue', machines: ['Fathom'] },
]
assert.deepEqual([...currentPopsMachines(venues, keys, 'all')], ['afm', 'segagod', 'godzilla'])
assert.deepEqual([...currentPopsMachines(venues, keys, 'Icebox')], ['afm', 'godzilla'])
assert.deepEqual([...currentPopsMachines(venues, keys, 'Closed venue')], [])
const slate = parseLineupVenueKeys(readFileSync('mnp-data-archive/season-24/venues.csv', 'utf8'))
assert(slate.includes('GPA') && !slate.includes('TBD'))
console.log('POPS machine inventory passes: current league and venue membership, canonical case, and venue aliases.')
