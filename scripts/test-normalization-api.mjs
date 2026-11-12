import assert from 'node:assert/strict'
import {register} from 'node:module'
const cacheMock = 'data:text/javascript,' + encodeURIComponent(`
  let revision=0
  export function unstable_cache(fn){let current=-1,value;return async()=>{if(current!==revision){value=await fn();current=revision}return value}}
  export function revalidateTag(){revision++}
`)
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){
  if(s==='next/cache')return {url:${JSON.stringify(cacheMock)},shortCircuit:true}
  return n(s==='next/server'?'next/server.js':s,c)
}`),import.meta.url)
process.env.NEXT_PUBLIC_SUPABASE_URL='https://normalization-test.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test-only-key'
process.env.SUPABASE_SERVICE_ROLE_KEY='test-only-key'
const players=Array.from({length:8},(_,i)=>`P${i}`),opponents=Array.from({length:8},(_,i)=>`Q${i}`),machines=['M1','M2','M3','M4']
const games=[];let id=0
for(const machine of machines)for(let j=0;j<4;j++)for(const venue of ['A','B']){
  const g={id:++id,season:24,week:1,match_key:'fixture',round_number:1,game_number:j+1,home_team:'OPP',away_team:'TWC',home_points:2,away_points:3,machine,venue}
  for(let slot=1;slot<=4;slot++){
    const own=venue==='B'&&slot%2===1,index=(j*2+Math.floor((slot-1)/2))%8
    g[`player_${slot}_name`]=own?players[index]:opponents[index]
    g[`player_${slot}_score`]=venue==='A'?10000:own?300*(index+1):1000
    g[`player_${slot}_points`]=own?1.5:1;g[`player_${slot}_team`]=own?'TWC':'OPP'
  }games.push(g)
}
let gameReads=0, limits=[]
globalThis.fetch=async input=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url)
  assert.equal(url.hostname,'normalization-test.invalid','No real network calls allowed')
  const table=url.pathname.split('/').pop()
  if(table==='games')gameReads++
  let data=table==='games'?games:table==='score_limits'?limits:table==='teams'?[{team_key:'TWC',team_name:'The Wrecking Crew'},{team_key:'OPP',team_name:'Opponents'}]:[]
  for(const filter of url.searchParams.getAll('season')){
    const [op,value]=filter.split('.')
    if(op==='eq')data=data.filter(row=>row.season===Number(value))
    if(op==='gte')data=data.filter(row=>row.season>=Number(value))
    if(op==='lte')data=data.filter(row=>row.season<=Number(value))
  }
  for(const field of ['venue','machine']){const filter=url.searchParams.get(field);if(filter?.startsWith('in.(')){
    const values=filter.slice(4,-1).split(',').map(x=>x.replaceAll('"',''));data=data.filter(x=>values.includes(x[field]))
  }}
  return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}})
}
const {LineupOptimizer}=await import('../lib/strategy/optimizer.ts')
const {buildNormalizationIndex,leagueNormalizationScores}=await import('../lib/strategy/normalization.ts')
const expected=buildNormalizationIndex(leagueNormalizationScores(games,()=>true))
const optimizer=new LineupOptimizer()
const automatic=await optimizer.prefetchStats(players,machines,24,24,'A',1,0,0,'mean',.1,true)
const legacy=await optimizer.prefetchStats(players,machines,24,24,'A',1,0,0,'mean',.1,false)
assert.equal(legacy.statsMap.size,0,'Legacy venue-only restriction remains available')
for(const p of players)for(const m of machines)assert(Math.abs(automatic.statsMap.get(p).get(m).venue_adjusted_avg-expected.player(p,m).ratio)<1e-12)
const greedy=await import('../app/api/optimize-picks/route.ts')
const hungarian=await import('../app/api/strategy/optimize/route.ts')
const common={venue:'A',opponent:'Opponents',seasonStart:24,seasonEnd:24,machines,opponentPlayers:opponents,
  venueWeight:1,userInputWeight:0,confidenceBoost:0,opponentWeight:.2,usePerGameNormalized:true,
  scoreWeights:{winRate:0,recentForm:0,venueAdjustedAvg:1,confidence:0}}
const post=async(route,body)=>{const res=await route.POST(new Request('http://localhost/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));const data=await res.json();assert.equal(res.status,200,JSON.stringify(data));return data}
const g=await post(greedy,{...common,format:'doubles',numMachines:4,availablePlayers:players})
assert.equal(g.recommendations.length,4)
for(const rec of g.recommendations)for(const p of rec.stats)assert.equal(p.pctOfVenue,Math.round(expected.player(p.player,rec.machine).ratio*100))
const h=await post(hungarian,{...common,format:'4x2',playerNames:players,useNashEquilibrium:false})
assert.equal(h.assignments.length,4)
for(const a of h.assignments){
  assert(Math.abs(a.player1_venue_adjusted_avg-expected.player(a.player1_id,a.machine_id).ratio)<1e-12)
  assert(Math.abs(a.player2_venue_adjusted_avg-expected.player(a.player2_id,a.machine_id).ratio)<1e-12)
}
console.log('Both API routes and prefetch passed: cross-venue-only players retained; own ratios agree; manual venue-only mode preserved.')

const {buildAssignmentEstimator}=await import('../lib/strategy/assignment-estimator.ts')
const {invalidateAssignmentHistory}=await import('../lib/strategy/assignment-history-revision.ts')
const roster=[...players,'P8','P9']
// A game on a non-candidate machine must still contribute to overall strength.
games.push({...games[1], id:++id, season:23, machine:'Other', player_1_name:'P0',player_1_score:1})
const estimator=buildAssignmentEstimator(leagueNormalizationScores(games,()=>true))
const preview={...common,seasonStart:23,scoringMode:'automatic-preview',mustPlay:['P8'],forcedAssignments:[{player:'P9',machine:'m1'}],
  exclusions:{m1:['P0']},lineupLimit:4}
for (const [route,format,input] of [[greedy,'doubles',{availablePlayers:roster,numMachines:4}],
  [hungarian,'4x2',{playerNames:roster}]]) {
  const request=async body=>route.POST(new Request('http://localhost/test',{method:'POST',
    headers:{'content-type':'application/json'},body:JSON.stringify({...preview,format,...input,...body})}))
  process.env.STRATEGY_ASSIGNMENT_PREVIEW='false'
  assert.equal((await request({})).status,403)
  process.env.STRATEGY_ASSIGNMENT_PREVIEW='true'
  const response=await request({})
  const payload=await response.json()
  assert.equal(response.status,200,JSON.stringify(payload))
  const {lineups}=payload.assignmentPreview
  assert(lineups.length>1 && lineups.length<=4)
  assert.equal(new Set(lineups.map(l=>JSON.stringify(l.picks.map(p=>[p.machine,p.players])))).size,lineups.length)
  for(const lineup of lineups){
    const selected=lineup.picks.flatMap(p=>p.players)
    assert.equal(new Set(selected).size,8)
    assert(selected.includes('P8'))
    assert.equal(lineup.bench.length,2)
    assert(lineup.picks.find(p=>p.machine==='M1').players.includes('P9'))
    assert(!lineup.picks.find(p=>p.machine==='M1').players.includes('P0'))
    let total=0
    for(const pick of lineup.picks)for(const [i,player] of pick.players.entries()){
      const expected=estimator.estimate(player,pick.machine,'A')
      assert.deepEqual(pick.evidence[i],expected)
      total+=expected.score
    }
    assert(Math.abs(total-lineup.score)<1e-12)
    for(const alt of lineup.alternatives){
      assert.notEqual(alt.to,alt.machine)
      assert.notEqual(alt.player,'P9')
      if(alt.player==='P8')assert.notEqual(alt.to,null)
    }
  }
  const reads=gameReads
  const warm=await request({})
  assert.equal((await warm.json()).assignmentPreview.historyCacheHit,true)
  assert.equal(gameReads,reads)
  invalidateAssignmentHistory()
  const refreshed=await request({})
  assert.equal((await refreshed.json()).assignmentPreview.historyCacheHit,false)
  assert(gameReads>reads)
  limits=[{machine:'M1',max_score:10000}]
  const changedLimits=await request({})
  assert.equal((await changedLimits.json()).assignmentPreview.historyCacheHit,false)
  limits=[]
  assert.equal((await request({minMachineGames:1})).status,422)
  assert.equal((await request({exclusions:{M1:['P9']}})).status,400)
  assert.equal((await request({mustPlay:['Unavailable']})).status,400)
  assert.equal((await request({machines:['M1','m1','M2','M3']})).status,400)
}
console.log('Both automatic previews passed: shared evidence, constraints, warm reuse, revision and score-limit invalidation.')
