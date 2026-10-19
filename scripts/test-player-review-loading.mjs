import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const ui = read('../components/player-mapping-manager.tsx')
assert.match(ui, /if \(open && !loaded.current\)/)
assert.match(ui, /loadIssues = async \(refresh = false\)/)
assert.match(ui, /player-name-issues\$\{refresh \? '\?refresh=true' : ''\}/)
assert.match(ui, /filteredPlayers.slice\(0, visiblePlayers\)/)
assert.ok(ui.includes('Show more'))
assert.ok(ui.includes('Rescan name issues'))
const reload = ui.slice(ui.indexOf('const loadData ='), ui.indexOf('const loadPlayers ='))
assert.ok(!reload.includes('loadIssues('))
assert.ok(!reload.includes('loadKeyMappings('))
assert.ok(!reload.includes('/api/player-mappings'))
for (const path of ['../app/api/player-name-issues/route.ts', '../app/api/cron/scan-player-names/route.ts']) {
  const route = read(path)
  assert.ok(route.includes('keys: i.keys || null'))
  assert.ok(route.includes('canonical_key: i.canonical_key || null'))
}
const directory = read('../app/api/player-mappings/route.ts')
assert.ok(directory.includes('unstable_cache(getAllPlayers'))
assert.ok(directory.includes('revalidate: 3600'))
console.log('Player review cached loading and independent refresh regression checks passed')
