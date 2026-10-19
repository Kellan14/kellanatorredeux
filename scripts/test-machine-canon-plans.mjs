import assert from 'node:assert/strict'
import {
  suggestMachine,
  planMnpSync,
  publishedIdentity,
} from '../lib/machine-canon-plans.ts'

const official = [{ key: 'OFFICIAL', name: 'A New Game' }]
assert.equal(
  suggestMachine(['a new game', 'OFFICIAL'], official, []).source,
  'mnp',
)
assert.equal(suggestMachine(['MysteryGame'], [], []).name, 'Mystery Game')
assert.equal(
  suggestMachine(['ABC123'], [], []).name,
  'ABC123',
  'Never invent an acronym expansion',
)
assert.equal(
  suggestMachine(['A New Game'], [], [{ key: 'ANewGame', name: 'Other' }]).key,
  'ANewGame2',
)
assert.equal(
  suggestMachine(
    ['A New Game', 'Different'],
    [...official, { key: 'OTHER', name: 'Different' }],
    [],
  ).key,
  '',
  'Distinct published games need review',
)
assert.deepEqual(
  planMnpSync(official, []).map((p) => p.action),
  ['add'],
)
const local = { key: 'TEMP', name: 'A New Game', source: 'local' }
assert.equal(planMnpSync(official, [local])[0].previousKey, 'TEMP')
assert.equal(planMnpSync(official, [local])[0].action, 'promote')
assert.equal(
  planMnpSync(official, [local, { ...local, key: 'TEMP2' }])[0].action,
  'review',
  'Ambiguous identities are not auto-merged',
)
assert.equal(
  planMnpSync(official, [
    { ...local, key: 'OFFICIAL', name: 'Different Game' },
  ])[0].action,
  'review',
  'A reused key is not proof of identity',
)
assert.equal(
  planMnpSync(official, [
    {
      ...official[0],
      source: 'mnp',
      mnp_key: 'OFFICIAL',
      mnp_name: 'Old Title',
    },
  ])[0].action,
  'update',
)
assert.deepEqual(
  planMnpSync(official, [{ ...official[0], source: 'mnp' }]),
  [],
  'No repeated writes when upstream is unchanged',
)
assert.deepEqual(publishedIdentity({ key: 'Future Spa', name: 'FutureSpa' }), {
  key: 'FutureSpa',
  name: 'Future Spa',
})
assert.equal(
  publishedIdentity({ key: "Hotdoggin'", name: 'Hotdoggin' }).key,
  'Hotdoggin',
)
assert.equal(
  planMnpSync(
    [{ key: 'Spiderman', name: 'Spider-man (Stern)' }],
    [{ key: 'TASM', name: 'The Amazing Spider-Man', source: 'local' }],
  )[0].action,
  'add',
)
console.log('Machine canon suggestions and MNP adoption plans passed')
