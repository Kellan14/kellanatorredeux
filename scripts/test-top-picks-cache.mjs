import assert from 'node:assert/strict'
import { collectTeamPicks, rankTeamPicks } from '../lib/top-picks-cache.ts'

const game = (id, season, round, machine, slots, home = 'TWC', away = 'KBZ') => ({
  id, season, round_number: round, machine, home_team: home, away_team: away,
  ...Object.fromEntries(slots.flatMap(([team, key, name, score], index) => {
    const slot = index + 1
    return [
      [`player_${slot}_team`, team], [`player_${slot}_key`, key],
      [`player_${slot}_name`, name], [`player_${slot}_score`, score],
    ]
  })),
})

const games = [
  game(1, 23, 1, 'Jaws', [['KBZ', 'a', 'Alice', 100], ['KBZ', 'b', 'Bob', 90]]),
  game(2, 24, 3, 'Jaws', [['KBZ', 'a', 'Alice', 80]]),
  game(3, 24, 2, 'Godzilla', [['TWC', 'c', 'Carol', 70]]),
  game(4, 24, 1, 'Godzilla', [['KBZ', 'b', 'Bob', 60]]),
  game(5, 24, 5, 'Jaws', [['KBZ', 'a', 'Alice', 50]]),
]
const picks = collectTeamPicks(games, '2026-10-04T00:00:00Z')
assert.equal(picks.length, 4, 'tiebreakers do not count as picks')
assert.deepEqual(picks[0].player_names, ['Alice', 'Bob'], 'doubles is one game with both players')
const teamPicks = picks.filter(pick => pick.team_key === 'KBZ')
assert.deepEqual(rankTeamPicks(teamPicks, 24, 24, ['Jaws', 'Godzilla'], ['Alice']), [
  { machine: 'jaws', timesPicked: 1 },
])
assert.deepEqual(rankTeamPicks(teamPicks, 23, 24, ['Jaws', 'Godzilla'], ['Alice']), [
  { machine: 'jaws', timesPicked: 2 },
])
assert.deepEqual(rankTeamPicks(teamPicks, 24, 24, ['Jaws', 'Godzilla'], []), [
  { machine: 'godzilla', timesPicked: 1 },
  { machine: 'jaws', timesPicked: 1 },
])
console.log('top-picks cache tests passed')
