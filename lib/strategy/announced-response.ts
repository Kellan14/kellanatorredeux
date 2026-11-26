export type ResponseInput = {
  format: 'singles' | 'doubles'; venue: string; seasonStart: number; seasonEnd: number
  players: string[]; mustPlay: string[]
  games: { machine: string; opponents: string[]; excluded: string[]; forced: string[] }[]
}
type Evidence = { blendedLogRatio: number | null; machineGames: number }
export class ResponseError extends Error {}
const fail = (message: string): never => { throw new ResponseError(message) }
const name = (v: unknown): v is string => typeof v === 'string' && !!v && v.trim() === v && v.length <= 150
const distinct = (v: string[]) => new Set(v.map(s => s.toLowerCase())).size === v.length
const names = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 16 && v.every(name) && distinct(v)

export function validateReply(b: ResponseInput) {
  if (!b || !['singles','doubles'].includes(b.format) || !name(b.venue) ||
      !Number.isInteger(b.seasonStart) || !Number.isInteger(b.seasonEnd) || b.seasonStart < 1 ||
      b.seasonEnd > 100 || b.seasonEnd < b.seasonStart || b.seasonEnd-b.seasonStart >= 32) fail('Choose a valid venue and season range (up to 32 seasons).')
  const size = b.format === 'singles' ? 1 : 2
  if (!Array.isArray(b.games) || !b.games.length || b.games.length > (size===1?7:4)) fail('Choose up to seven singles machines or four doubles machines.')
  if (!names(b.players) || b.players.length > 12 || b.players.length < b.games.length*size) fail('Choose enough distinct available players (up to 12).')
  if (!names(b.mustPlay) || b.mustPlay.some(p=>!b.players.includes(p))) fail('Every must-play player must be available.')
  for (const g of b.games) {
    if (!g || !name(g.machine) || !names(g.opponents) || g.opponents.length !== size) fail('Enter the announced opponent on every slot.')
    if (!names(g.excluded) || !names(g.forced) || g.forced.length > size ||
        g.forced.some(p=>!b.players.includes(p)||g.excluded.includes(p))) fail('Check the locks and exclusions on each machine.')
  }
  if (!distinct(b.games.map(g=>g.machine)) || !distinct(b.games.flatMap(g=>g.opponents))) fail('Each machine and announced opponent must appear only once.')
  const physical = (m:string) => {
    const key=m.toLowerCase().replace(/\s*\(competition mode\)$/, '')
    return ({fhrn:'fh',bop2:'bop',jdsg:'jd'} as Record<string,string>)[key] ?? key
  }
  if (!distinct(b.games.map(g=>physical(g.machine)))) fail('Two selected rulesets use the same physical machine.')
  const forced=b.games.flatMap(g=>g.forced)
  if (!distinct(forced) || new Set([...forced,...b.mustPlay]).size>b.games.length*size) fail('The locks and must-play players exceed the available slots.')
}

export function announcedReply(b: ResponseInput, estimate: (p:string,m:string)=>Evidence) {
  validateReply(b)
  // Frozen exact-opponent *responding* fits; input is the pre-calibration
  // shrunk log(1 + normalized score), not the estimator's calibrated score.
  const single=b.format==='singles', w=single ? [-.04402669,.602687,0,-.66850298] : [-.10331304,.76074196,.02746274,-.79005798]
  const candidates=b.games.map(g=>{
    const history=(p:string)=>{const e=estimate(p,g.machine);return {name:p,games:e.machineGames,value:e.blendedLogRatio??fail('No usable history in the selected seasons.')}}
    const opp=g.opponents.map(history), players=b.players.map(history), oppMean=opp.reduce((s,p)=>s+p.value,0)/opp.length
    const rows=[]
    for(let i=0;i<players.length;i++) for(let j=single?i:i+1;j<(single?i+1:players.length);j++){
      const group=single?[players[i]]:[players[i],players[j]]
      if(group.some(p=>g.excluded.includes(p.name)) || !g.forced.every(p=>group.some(x=>x.name===p)))continue
      const strength=(players[i].value+players[j].value)/2
      const z=w[0]+4*(w[1]*(strength-.65)+w[2]*Math.abs(players[i].value-players[j].value)+w[3]*(oppMean-.65))
      rows.push({mask:(1<<i)|(1<<j),strength,points:(single?3:5)/(1+Math.exp(-z)),machine:g.machine,players:group,opponents:opp})
    }
    return rows
  })
  const required=b.mustPlay.reduce((mask,p)=>mask|(1<<b.players.indexOf(p)),0)
  function solve(metric:'strength'|'points'){
    type Path={total:number; rows:typeof candidates[number]}
    let paths=new Map<number,Path>([[0,{total:0,rows:[]}]])
    for(const cs of candidates){
      const next=new Map<number,Path>()
      for(const [mask,path] of Array.from(paths))for(const c of cs){
        if(mask&c.mask)continue
        const id=mask|c.mask,total=path.total+c[metric]
        if(total>(next.get(id)?.total??-Infinity))next.set(id,{total,rows:[...path.rows,c]})
      }
      paths=next
    }
    return Array.from(paths).filter(([m])=>(m&required)===required).sort((a,b)=>b[1].total-a[1].total)[0]?.[1]??fail('No legal reply fits. Check must-play players, locks, and exclusions.')
  }
  const own=solve('strength'),best=solve('points'),baseline=own.rows.reduce((s,r)=>s+r.points,0)
  const selected=best.total-baseline<1e-9?own:best
  return {total:selected.rows.reduce((s,r)=>s+r.points,0),baseline,assignments:selected.rows.map((r,i)=>({
    machine:r.machine,players:r.players.map(p=>({name:p.name,games:p.games})),opponents:r.opponents.map(p=>({name:p.name,games:p.games})),
    ownStrengthPlayers:own.rows[i].players.map(p=>p.name),points:r.points
  }))}
}
