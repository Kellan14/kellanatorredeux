import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { getMachineCanon, resolveWithIndex } from '@/lib/machines-canon'
import { liveMatchKey, liveMatchSnapshot, matchNight } from '@/lib/strategy/live-match'

export const dynamic='force-dynamic'
const aliases=unstable_cache(async()=>fetchAllRecords<{alias:string;canonical_name:string}>(
  ()=>supabase.from('player_name_mappings').select('alias,canonical_name'),1000,'alias'),['live-strategy-names'],{revalidate:300})

export async function GET(request:Request) {
  const {searchParams}=new URL(request.url),key=searchParams.get('match')||'',date=searchParams.get('date')||''
  if(!liveMatchKey.test(key))return NextResponse.json({error:'Invalid TWC match key.'},{status:400})
  if(!matchNight(date))return new Response(null,{status:204})
  try {
    const feed=await fetch(`https://mondaynightpinball.com/matches/${key}.json`,{
      cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000),
    })
    if(feed.status===404)return new Response(null,{status:204})
    if(!feed.ok)throw Error('Live scorecard unavailable')
    const sheet=await feed.json()
    if(typeof sheet?.date!=='string'||!matchNight(sheet.date))return new Response(null,{status:204})
    const [names,canon]=await Promise.all([aliases().catch(()=>[]),getMachineCanon()])
    const map=new Map(names.map(x=>[x.alias.toLowerCase(),x.canonical_name]))
    const snapshot=liveMatchSnapshot(sheet,key,raw=>{
      const name=raw.replace(/\s*\(sub\)\s*$/i,'').trim()
      return map.get(name.toLowerCase())??name
    },m=>resolveWithIndex(canon,m)??m)
    return snapshot?NextResponse.json(snapshot,{headers:{'Cache-Control':'public, max-age=0, s-maxage=20'}}):
      NextResponse.json({error:'Unexpected live scorecard.'},{status:502})
  }catch{
    return NextResponse.json({error:'Live scorecard is temporarily unavailable.'},{status:502})
  }
}
