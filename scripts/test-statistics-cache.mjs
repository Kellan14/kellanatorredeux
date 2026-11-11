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
