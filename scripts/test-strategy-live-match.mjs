import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { liveMatchKey, liveMatchSnapshot, matchNight } from '../lib/strategy/live-match.ts'

const archive=JSON.parse(readFileSync('mnp-data-archive/season-24/matches/mnp-24-1-DTP-TWC.json','utf8'))
const key=archive.key, snapshot=s=>liveMatchSnapshot(s,key,x=>x,x=>x.toLowerCase())
assert(liveMatchKey.test(key));assert(!liveMatchKey.test('https://other.site/file'))
const scheduled=structuredClone(archive)
scheduled.state='playing';scheduled.round=1
const ids=new Set(scheduled.away.lineup.map(p=>p.key))
for(const g of scheduled.rounds[0].games){
  for(const slot of ['player_1','player_2','player_3','player_4']){
    if(!ids.has(g[slot]))delete g[slot]
  }
  for(const field of Object.keys(g))if(/^(score|points)|done/.test(field))delete g[field]
}
let s=snapshot(scheduled)
assert.deepEqual(s.sat,[],'Only opponents are entered: TWC has not sat yet')
assert.equal(s.picks.format,'doubles')
assert.equal(s.picks.games.length,4)
assert.equal(new Set(s.picks.games.flatMap(g=>g.opponents)).size,8)
const game=scheduled.rounds[0].games[0],slot=['player_1','player_2','player_3','player_4'].find(f=>ids.has(game[f]))
const newPick=scheduled.away.lineup.find(p=>!scheduled.rounds[0].games.some(g=>Object.values(g).includes(p.key)))
game[slot]=newPick.key
assert(snapshot(scheduled).picks.games[0].opponents.includes(newPick.name),'Player change propagates')
game.machine='revised';assert.equal(snapshot(scheduled).picks.games[0].machine,'revised')
const partial=structuredClone(scheduled)
delete partial.rounds[0].games[3].machine
assert.equal(snapshot(partial).picks,null,'Incomplete machine list is ignored')
const played={...archive,state:'playing',round:1,rounds:structuredClone(archive.rounds)}
for(const g of played.rounds[0].games)for(const f of Object.keys(g))if(/^(score|points)|done/.test(f))delete g[f]
s=snapshot(played)
assert.deepEqual(s.entered,[1]);assert.equal(s.sat.length,2);assert.deepEqual(s.satBeforeRound,[])
const ours=archive.home.lineup.find(p=>p.name===s.sat[0])
const changed=played.rounds[0].games[0],oursSlot=['player_1','player_2','player_3','player_4'].find(f=>archive.home.lineup.some(p=>p.key===changed[f]))
changed[oursSlot]=ours.key
assert(!snapshot(played).sat.includes(ours.name),'Correction removes a false sit')
assert.deepEqual(snapshot({...archive,state:'playing',round:2}).satBeforeRound,s.sat)
assert.equal(snapshot({...archive,state:'playing',round:2}).picks,null,'TWC is picking round two as home')
assert.equal(snapshot(archive).picks,null)
assert(!snapshot({...archive,key:'wrong'}))
assert(matchNight('20261123',new Date('2026-11-24T03:00:00Z')))
assert(matchNight('11/23/2026',new Date('2026-11-24T08:59:59Z')))
assert(!matchNight('20261123',new Date('2026-11-24T09:00:00Z')))
assert(!matchNight('20261123',new Date('2026-11-24T02:59:59Z')))
console.log('Live match: scores not required; partial entries, corrected players/machines, picker sides, sat-out boundaries and Pacific hours passed.')
