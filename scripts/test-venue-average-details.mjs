import assert from 'node:assert/strict'

const base = process.env.TEST_BASE_URL || 'http://localhost:3102'
const venue = 'Georgetown Pizza and Arcade'
async function json(path, params) {
  const response = await fetch(`${base}${path}?${new URLSearchParams(params)}`)
  assert.equal(response.status, 200, `${path} loads`)
  return response.json()
}
for (const machine of ['AFM', 'GOT']) {
  const params = { machine, column: 'Venue Avg', venue, team: 'Not an actual team',
    seasonStart: '22', seasonEnd: '24', teamVenueSpecific: 'false', twcVenueSpecific: 'false',
    opponentRoster: 'Nobody', twcPlayers: 'Nobody', scoreLimits: JSON.stringify({ [machine.toLowerCase()]: 1_000_000_000 }) }
  const drill = await json('/api/cell-details', params)
  assert.ok(drill.count > 0, 'Venue scores do not depend on a team or roster')
  assert.ok(drill.details.every(row => row.venue === venue), 'Venue scores never include other venues')
  assert.ok(drill.details.every(row => row.score <= 1_000_000_000), 'Score limits remain applied')
  const stats = await json('/api/machine-stats', { seasons: '22,23,24', venue, teamName: 'The Wrecking Crew',
    opponentTeam: 'Silverball Slayers', machines: machine, scoreLimits: params.scoreLimits })
  const rows = Array.isArray(stats) ? stats : stats.stats
  const average = rows.find(row => row.machine.toLowerCase() === machine.toLowerCase())?.venueAverage
  assert.equal(typeof average, 'number', 'Parent average exists')
  assert.ok(Math.abs(drill.stats.average - average) < .001, 'Drilldown average matches the Statistics table')
  const normal = await json('/api/cell-details', { ...params, column: 'Team Avg' })
  assert.equal(normal.count, 0, 'Team columns still respect team and roster filters')
  console.log(`${machine}: venue scope, roster independence, score limits, average parity and team isolation passed`)
}
