import assert from 'node:assert/strict'

const base = process.env.TEST_BASE_URL || 'http://localhost:3102'
async function json(path, params) {
  const response = await fetch(`${base}${path}?${new URLSearchParams(params)}`)
  assert.equal(response.status, 200, path)
  return response.json()
}

const scope = {
  allMachines: 'true',
  teamVenueSpecific: 'true',
  twcVenueSpecific: 'true',
  scoreLimits: '{"afm":1000000000}',
}
const { stats } = await json('/api/machine-stats', {
  ...scope, seasons: '22,23,24', teamName: 'The Wrecking Crew',
  opponentTeam: 'Silverball Slayers', machines: 'AFM',
})
assert.ok(stats.length > 1, 'League-wide scope ignores the venue inventory')
const afm = stats.find(row => row.machine === 'afm')
assert.ok(afm?.venueAverage > 0)
const details = await json('/api/cell-details', {
  ...scope, machine: 'afm', column: 'Venue Avg',
  seasonStart: '22', seasonEnd: '24', opponentRoster: 'Nobody',
})
assert.ok(new Set(details.details.map(row => row.venue)).size > 1)
assert.ok(details.details.every(row => row.score <= 1_000_000_000 && row.season >= 22 && row.season <= 24))
assert.ok(Math.abs(details.stats.average - afm.venueAverage) < .001)
assert.ok(Math.abs(afm.percentOfVenueAvg - afm.teamAverage / afm.venueAverage * 100) < .001)
assert.ok(Math.abs(afm.twcPercentOfVenueAvg - afm.twcAverage / afm.venueAverage * 100) < .001)
console.log(`League-wide stats verified: ${stats.length} machines, ${details.count} AFM scores, matching average and percentages`)
