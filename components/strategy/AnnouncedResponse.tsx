'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { announcedReply, ResponseInput } from '@/lib/strategy/announced-response'
import type { LivePicks } from '@/lib/strategy/live-match'

type Props = Omit<ResponseInput,'games'> & {
  machines:string[]; roster:string[]; display:(m:string)=>string
  excludedMachines:string[]; exclusions:Record<string,string[]>[]; locks:{player:string;machine:string}[]
  livePicks?:LivePicks['games']; liveMustPlay?:string[]
}
export function AnnouncedResponse(p:Props) {
  const [choices,setChoices]=useState<Record<string,string[]>>({})
  const [reply,setReply]=useState<{key:string;result?:ReturnType<typeof announcedReply>;error?:string}>()
  const [busy,setBusy]=useState(false)
  const [manual,setManual]=useState(false)
  const request=useRef<AbortController|null>(null)
  const size=p.format==='singles'?1:2
  const useLive=!!p.livePicks&&!manual
  const machines=useLive?p.livePicks!.map(g=>g.machine):p.machines
  const mustPlay=useLive?p.liveMustPlay??[]:p.mustPlay
  const games=machines.map((machine,j)=>({machine,
    opponents:useLive?p.livePicks![j].opponents:Array.from({length:size},(_,i)=>{const v=choices[machine]?.[i];return p.roster.includes(v)?v:''}),
    excluded:p.players.filter(n=>p.exclusions.some(e=>e[machine]?.includes(n))),
    forced:p.locks.filter(l=>l.machine===machine).map(l=>l.player)}))
  const key=JSON.stringify({format:p.format,venue:p.venue,seasonStart:p.seasonStart,seasonEnd:p.seasonEnd,players:p.players,mustPlay,games})
  const blocked=machines.some(m=>p.excludedMachines.includes(m))
  const result=!blocked&&reply?.key===key?reply.result:undefined
  const names=games.flatMap(g=>g.opponents)
  const problem=blocked?'Undo the machine exclusion or deselect that machine.':
    games.length>(size===1?7:4)?'Too many machines for this round.':
    p.players.length<names.length?'Not enough available TWC players.':
    mustPlay.length>names.length?'More players must play than there are selected slots.':
    names.some(n=>!n)?'Select an opponent for each announced slot.':
    new Set(names).size!==names.length?'Each opponent can play only once this round.':''
  async function calculate(){
    request.current?.abort()
    const controller=new AbortController();request.current=controller;setBusy(true);setReply(undefined)
    try{
      const res=await fetch('/api/strategy/respond',{method:'POST',headers:{'Content-Type':'application/json'},body:key,signal:controller.signal})
      const data=await res.json()
      if(!res.ok)throw Error(data.error||'Could not calculate a reply.')
      if(!controller.signal.aborted)setReply({key,result:data})
    }catch(e){if(!controller.signal.aborted)setReply({key,error:e instanceof Error?e.message:'Could not calculate a reply.'})}
    finally{if(!controller.signal.aborted)setBusy(false)}
  }
  useEffect(()=>{
    setBusy(false)
    if(useLive&&!problem)void calculate()
    return ()=>request.current?.abort()
  },[key,blocked,useLive,problem]) // eslint-disable-line react-hooks/exhaustive-deps
  return <section id={'announced-response-'+p.format} className="scroll-mt-20 space-y-2 rounded border p-3 text-sm">
    <h4 className="font-semibold">Respond to announced lineup</h4>
    {p.livePicks&&<div className="flex flex-wrap items-center gap-2">
      <span className="text-xs">{useLive?'Using live league picks':'Manual entry'}</span>
      <Button size="sm" variant="outline" onClick={()=>setManual(!manual)}>{useLive?'Enter manually':'Use live picks'}</Button>
    </div>}
    {!games.length&&<p className="text-xs text-muted-foreground">Select the announced machines above to enter the opposing lineup.</p>}
    <p className="text-xs text-muted-foreground">Select who they put on each machine. Uses normalized history from seasons {p.seasonStart}–{p.seasonEnd}, not the manual sliders. Roster, sit and must-play selections still apply.</p>
    {games.map(g=><div key={g.machine} className="space-y-1">
      <div className="font-medium">{p.display(g.machine)}</div>
      {useLive?<div className="text-xs">{g.opponents.join(' + ')}</div>:<div className="flex flex-wrap gap-2">{g.opponents.map((name,i)=><select key={i} aria-label={`${p.display(g.machine)} opponent ${i+1}`}
        className="max-w-full rounded border bg-background px-2 py-1" value={name}
        onChange={e=>{const value=e.target.value;setChoices(old=>{const pair=[...(old[g.machine]||[])];pair[i]=value;return {...old,[g.machine]:pair}})}}>
        <option value="">Choose opponent</option>
        {p.roster.map(n=><option key={n} value={n} disabled={n!==name&&names.includes(n)}>{n}</option>)}
      </select>)}</div>}</div>)}
    {games.length>0&&<Button size="sm" onClick={calculate} disabled={!!problem||busy}>{busy?'Calculating…':'Find TWC’s reply'}</Button>}
    {games.length>0&&problem&&<p className="text-xs text-muted-foreground">{problem}</p>}
    {reply?.key===key&&reply.error&&<p role="alert">{reply.error}</p>}
    {result&&<div aria-live="polite" className="space-y-2">
      <p><strong>{result.total.toFixed(2)} projected points</strong> on the selected machines. Own-strength lineup against the same opponents: {result.baseline.toFixed(2)}. These are estimates, not guaranteed gains.</p>
      {result.assignments.map(g=><div key={g.machine} className="border-t pt-2">
        <strong>{p.display(g.machine)}</strong>: {g.players.map(x=>x.name).join(' + ')} vs. {g.opponents.map(x=>x.name).join(' + ')} · {g.points.toFixed(2)} projected
        <div className="text-xs text-muted-foreground">Machine history: {[...g.players,...g.opponents].map(x=>`${x.name}: ${x.games} games`).join(' · ')}</div>
        {g.ownStrengthPlayers.join('|')!==g.players.map(x=>x.name).join('|')&&<div className="text-xs">Own-strength pick: {g.ownStrengthPlayers.join(' + ')}</div>}
      </div>)}
    </div>}
  </section>
}
