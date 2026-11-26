export type LivePicks = { format: 'singles' | 'doubles'; games: { machine:string; opponents:string[] }[] }
export type LiveMatch = {
  key:string; date:string; venue:string; venueKey:string; opponent:string; round:number; completed:boolean
  sat:string[]; satBeforeRound:string[]; entered:number[]; picks:LivePicks|null
}
type Side={ key?:string; name?:string; lineup?:{key?:string;name?:string}[] }
type Game={ n?:number; machine?:string; player_1?:string; player_2?:string; player_3?:string; player_4?:string }
type Sheet={ key?:string; date?:string; state?:string; round?:number; venue?:{key?:string;name?:string};
  home?:Side; away?:Side; rounds?:{n?:number;games?:Game[]}[] }
const pacific = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'})
export function matchNight(date:string, now=new Date()) {
  const f=(d:Date)=>Object.fromEntries(pacific.formatToParts(d).map(p=>[p.type,p.value]))
  const t=f(now),h=Number(t.hour)
  if(h>=1&&h<19)return false
  const d=h<1?f(new Date(now.getTime()-3600000)):t
  const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date)
  return (m?m[3]+m[1].padStart(2,'0')+m[2].padStart(2,'0'):date.replace(/-/g,''))===d.year+d.month+d.day
}
export const liveMatchKey = /^mnp-\d{1,3}-\d{1,3}-(?:TWC-[A-Z\d]{2,8}|[A-Z\d]{2,8}-TWC)$/

export function liveMatchSnapshot(sheet:Sheet, key:string, playerName:(name:string)=>string, machineKey:(name:string)=>string):LiveMatch|null {
  if(!sheet||sheet.key!==key||!sheet.date||!sheet.venue?.name||!sheet.home||!sheet.away||
    (sheet.home.key==='TWC')===(sheet.away.key==='TWC')||!Array.isArray(sheet.rounds))return null
  const home=sheet.home.key==='TWC',ours=home?sheet.home:sheet.away,theirs=home?sheet.away:sheet.home
  const roster=(side:Side)=>new Map((Array.isArray(side.lineup)?side.lineup:[]).flatMap(p=>
    p?.key&&p?.name?[[p.key,playerName(p.name)] as const]:[]))
  const a=roster(ours),b=roster(theirs)
  const completed=sheet.state==='complete'
  const round=Number.isInteger(sheet.round)&&sheet.round!>=1&&sheet.round!<=4?sheet.round!:0
  const sat=new Set<string>(),before=new Set<string>(),entered:number[]=[]
  let picks:LivePicks|null=null, contiguous=true
  for(let n=1;n<=4;n++){
    if(!completed&&n>round)break
    const doubles=n===1||n===4, count=doubles?4:7, size=doubles?2:1
    const games=sheet.rounds.find(r=>r.n===n)?.games
    const full=Array.isArray(games)&&games.length===count&&new Set(games.map(g=>g.n)).size===count&&games.every(g=>g.machine)
    const ids=(g:Game)=>[g.player_1,g.player_2,...(doubles?[g.player_3,g.player_4]:[])].filter((p):p is string=>!!p)
    const sideReady=(roster:Map<string,string>)=>{
      if(!full||games.some(g=>ids(g).filter(p=>roster.has(p)).length!==size))return null
      const slots=games.flatMap(g=>ids(g).filter(p=>roster.has(p)))
      return new Set(slots).size===count*size?new Set(slots):null
    }
    const played=sideReady(a)
    if(!played)contiguous=false
    if(played&&contiguous){
      entered.push(n)
      a.forEach((name,id)=>{if(!played.has(id)){sat.add(name);if(n<round)before.add(name)}})
    }
    const opponentPicks=home?n%2===1:n%2===0
    if(n===round&&!completed&&opponentPicks&&sideReady(b)&&full){
      picks={format:doubles?'doubles':'singles',games:games.map(g=>({
        machine:machineKey(g.machine!),opponents:ids(g).flatMap(id=>b.has(id)?[b.get(id)!]:[])
      }))}
    }
  }
  return {key,date:sheet.date,venue:sheet.venue.name,venueKey:sheet.venue.key||'',opponent:theirs.name||'',
    round,completed,sat:Array.from(sat).sort(),satBeforeRound:Array.from(before).sort(),entered,picks}
}
