import assert from 'node:assert/strict'
import {createAssignmentHistoryCache} from '../lib/strategy/assignment-history-cache.ts'
let now=0
const cache=createAssignmentHistoryCache(2,100,()=>now)
cache.set('a',1)
cache.set('b',2)
assert.equal(cache.get('a'),1)
cache.set('c',3)
assert.equal(cache.get('b'),undefined)
assert.equal(cache.get('a'),1)
now=100
assert.equal(cache.get('a'),undefined)
assert.equal(cache.get('c'),undefined)
console.log('History cache: bounded LRU and expiry passed.')
