import assert from 'node:assert/strict'

// Read-only integration check. Run against a local server or TEST_BASE_URL.
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3102'
async function getJson(path, params) {
  const response = await fetch(`${baseUrl}${path}?${new URLSearchParams(params)}`)
  assert.equal(response.status, 200, `${path} should load`)
  return response.json()
}

for (const [key, name] of [['PULP', 'Pulp Fiction'], ['AFM', 'Attack From Mars']]) {
  const byKey = await getJson('/api/machine-top-scores', { machine: key })
  const byName = await getJson('/api/machine-top-scores', { machine: name })
  assert.ok(byKey.topSeasonScores.length > 0, `${key} has current-season scores`)
  assert.ok(byKey.topAllTimeScores.length > 0, `${key} has historical scores`)
  assert.equal(byName.machine, key, 'API returns the canonical short form')
  assert.deepEqual(byName.topSeasonScores, byKey.topSeasonScores)
  assert.deepEqual(byName.topAllTimeScores, byKey.topAllTimeScores)

  const venues = await getJson('/api/machine-venues', { machine: key })
  assert.ok(venues.venues.length > 0, `${key} has venues`)
  assert.deepEqual(await getJson('/api/machine-venues', { machine: name }), venues)

  const player = byKey.topAllTimeScores[0].player
  const scores = await getJson('/api/user-machine-scores', { machine: key, player })
  assert.ok(scores.scores.length > 0, 'Personal league scores use the same machine key')
  assert.deepEqual(await getJson('/api/user-machine-scores', { machine: name, player }), scores)

  for (const route of [key, name]) {
    const response = await fetch(`${baseUrl}/machines/${encodeURIComponent(route)}`)
    assert.equal(response.status, 200, 'Both canonical and legacy machine links work')
    const html = await response.text()
    assert.ok(html.includes(`>${name}</h1>`), 'The page displays the full machine name')
    assert.ok(html.includes(`\\"machineKey\\":\\"${key}\\"`), 'The detail component receives the canonical API key')
  }
  console.log(`${key}: top scores, personal scores, venues, and machine links passed`)
}
