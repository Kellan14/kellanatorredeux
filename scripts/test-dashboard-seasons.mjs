import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { defaultDashboardRange, changeSeasonRange } from '../lib/dashboard-seasons.ts'

assert.deepEqual(defaultDashboardRange(24), { start: 22, end: 24 })
assert.deepEqual(defaultDashboardRange(25), { start: 23, end: 25 })
assert.deepEqual(defaultDashboardRange(2), { start: 2, end: 2 })
assert.deepEqual(changeSeasonRange({ start: 22, end: 24 }, 'start', 23), { start: 23, end: 24 })
assert.deepEqual(changeSeasonRange({ start: 22, end: 24 }, 'start', 25), { start: 25, end: 25 })
assert.deepEqual(changeSeasonRange({ start: 22, end: 24 }, 'end', 20), { start: 20, end: 20 })

// Guard the shared-range wiring: overrides are opt-in and master updates clear them.
const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8')
for (const section of ['picks', 'unique', 'performance', 'player']) {
  assert.ok(page.includes(`sectionRanges.${section} || dashboardRange`))
}
assert.match(page, /setMasterRange\(range\)\s+setSectionRanges\(\{\}\)/)
assert.ok(page.includes('&seasonStart=${performanceRange.start}'))
assert.ok(page.includes('&seasonEnd=${performanceRange.end}'))
assert.ok(!page.includes('historicalSeason'))
// Player machine selection must never depend on the comparison report having data.
assert.ok(page.includes('venueMachines.map((machine) =>'))
assert.ok(!page.includes('setMachinesAtVenue'))
assert.ok(!page.includes('/api/machine-advantages?'))
assert.ok(page.includes('getMachineDisplayName(machine)'))
console.log('Dashboard season range tests passed')
