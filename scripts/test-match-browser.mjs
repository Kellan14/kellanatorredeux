import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const base = process.env.TEST_BASE_URL || 'http://localhost:3102'
const endpoint = params => fetch(`${base}/api/match-browser?${new URLSearchParams(params)}`)
async function get(params) {
  const response = await endpoint(params)
  assert.equal(response.status, 200, await response.clone().text())
  return response.json()
}

const { teams } = await get({})
assert.ok(teams.some(team => team.key === 'TWC' && team.name === 'The Wrecking Crew'))
const { matches } = await get({ team: 'TWC', opponent: 'SSS' })
const reverse = await get({ team: 'SSS', opponent: 'TWC' })
assert.deepEqual(matches, reverse.matches, 'Team order does not omit home or away matches')
assert.ok(matches.every((match, i) => i === 0 || matches[i - 1].season > match.season ||
  (matches[i - 1].season === match.season && matches[i - 1].week >= match.week)))
const key = 'mnp-24-6-SSS-TWC'
assert.ok(matches.some(match => match.key === key))
const { match } = await get({ match: key })
const source = JSON.parse(readFileSync(new URL(`../mnp-data-archive/season-24/matches/${key}.json`, import.meta.url), 'utf8'))
assert.deepEqual(match.rounds.map(round => round.games.length), [4, 7, 7, 4])
for (const [index, round] of match.rounds.entries()) {
  const games = source.rounds[index].games
  assert.equal(round.points.home, games.reduce((sum, game) => sum + game.home_points, 0))
  assert.equal(round.points.away, games.reduce((sum, game) => sum + game.away_points, 0))
  for (const [gameIndex, game] of round.games.entries()) {
    for (const player of game.players) {
      assert.equal(player.score, games[gameIndex][`score_${player.slot}`])
      assert.equal(player.points, games[gameIndex][`points_${player.slot}`])
    }
  }
}
assert.equal(match.points.home + match.points.away, 82)
assert.equal((await endpoint({ team: 'TWC', opponent: 'TWC' })).status, 400)
assert.equal((await endpoint({ match: 'not-a-match' })).status, 404)
const page = await fetch(`${base}/matches`)
assert.equal(page.status, 200)
assert.match(await page.text(), /Look up a completed match/)
console.log(`Match browser verified: ${matches.length} meetings; ${key} has all 4 rounds and 22 games matching the archive`)
