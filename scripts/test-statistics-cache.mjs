import assert from 'node:assert/strict'
import { StatisticsResultCache, statisticsQueryKey } from '../lib/statistics-cache.ts'

const query = params => statisticsQueryKey(new URLSearchParams(params))
assert.equal(
  query({ seasons: '24,22,23', allMachines: 'true', venue: 'Ignored', opponentRoster: 'B,A', scoreLimits: '{"tz":300,"afm":200}' }),
  query({ opponentRoster: 'A,B', seasons: '22,23,24', allMachines: 'true', scoreLimits: '{"afm":200,"tz":300}' }),
)
for (const [field, first, second] of [
  ['venue', 'Ice Box', 'Kraken'],
  ['seasons', '23', '24'],
  ['opponentRoster', 'A', 'B'],
  ['twcPlayers', 'A', 'B'],
  ['scoreLimits', '{"afm":200}', '{"afm":300}'],
  ['includeManualScores', 'false', 'true'],
]) assert.notEqual(query({ [field]: first }), query({ [field]: second }))

let now = 0
const cache = new StatisticsResultCache(2, 100, 1000, () => now)
cache.set('a', [1])
cache.set('b', [2])
assert.deepEqual(cache.get('a'), [1])
cache.set('c', [3])
assert.equal(cache.get('b'), undefined, 'Least recently used entry evicted')
assert.deepEqual(cache.get('a'), [1])
cache.set('large', 'x'.repeat(100))
assert.equal(cache.get('large'), undefined, 'Oversize result bypasses cache')
now = 1000
assert.equal(cache.get('c'), undefined, 'Entries expire')
const bytes = new StatisticsResultCache(100, 12)
bytes.set('a', '12345')
bytes.set('b', '67890')
assert.equal(bytes.get('a'), undefined, 'Byte budget enforced below entry limit')
assert.equal(bytes.get('b'), '67890')
console.log('Statistics cache: canonical keys, isolation, expiry, byte cap and LRU passed')

let saved
const session = () => ({ getItem: () => saved ?? null, setItem: (_key, value) => { saved = value } })
now = 0
const tab = () => new StatisticsResultCache(100, 8 * 1024 * 1024, 1000, () => now, session)
const first = tab()
for (let i = 0; i < 26; i++) first.set(`search-${i}`, [{ machine: 'AFM', search: i }])
first.get('search-0') // Revisited searches count as recent.
now = 750
const reloaded = tab()
assert.deepEqual(reloaded.get('search-0'), [{ machine: 'AFM', search: 0 }])
assert.equal(reloaded.get('search-1'), undefined, 'Only 25 recent results survive reload')
now = 1000
assert.equal(tab().get('search-25'), undefined, 'Reload does not extend freshness')
now = 0
const large = tab()
large.set('one', 'x'.repeat(1_200_000))
large.set('two', 'y'.repeat(1_200_000))
assert.ok(Buffer.byteLength(saved) <= 2 * 1024 * 1024, 'Session storage stays under 2 MiB')
assert.equal(tab().get('one'), undefined)
assert.equal(tab().get('two')?.length, 1_200_000)
saved = 'invalid json'
assert.equal(tab().get('two'), undefined, 'Corrupt storage is ignored')
console.log('Recent Statistics cache: reload, recency, storage cap and original expiry passed')
