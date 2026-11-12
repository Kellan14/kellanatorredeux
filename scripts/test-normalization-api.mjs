import assert from 'node:assert/strict'
import {register} from 'node:module'
register('data:text/javascript,'+encodeURIComponent("export async function resolve(s,c,n){return n(s==='next/server'?'next/server.js':s,c)}"),import.meta.url)
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
globalThis.fetch=async input=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url)
  assert.equal(url.hostname,'normalization-test.invalid','No real network calls allowed')
  const table=url.pathname.split('/').pop()
  let data=table==='games'?games:table==='teams'?[{team_key:'TWC',team_name:'The Wrecking Crew'},{team_key:'OPP',team_name:'Opponents'}]:[]
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
