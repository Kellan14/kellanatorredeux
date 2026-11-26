'use client'
import { useEffect, useState } from 'react'
import { liveMatchKey, matchNight, type LiveMatch } from '@/lib/strategy/live-match'

export function useStrategyLiveMatch(key?:string,date?:string) {
  const [snapshot,setSnapshot]=useState<LiveMatch|null>(null)
  const [status,setStatus]=useState<'idle'|'waiting'|'live'|'retry'>('idle')
  useEffect(()=>{
    if(!key||!date||!liveMatchKey.test(key))return
    let request:AbortController|null=null,active=true
    let previous=''
    const check=async()=>{
      if(!matchNight(date)){
        previous='';setStatus('idle');setSnapshot(null)
        return
      }
      if(document.hidden||request)return
      const ctrl=new AbortController();request=ctrl
      try{
        const res=await fetch('/api/strategy/live-match?'+new URLSearchParams({match:key,date}),{signal:ctrl.signal})
        if(!active)return
        if(res.status===204){setStatus(previous?'retry':'waiting');return}
        if(!res.ok)throw Error('Live feed unavailable')
        const value:LiveMatch=await res.json()
        if(!active||value.key!==key)return
        const fingerprint=JSON.stringify(value)
        if(fingerprint!==previous){previous=fingerprint;setSnapshot(value)}
        setStatus('live')
      }catch{if(active)setStatus('retry')}
      finally{request=null}
    }
    void check()
    const timer=window.setInterval(check,30000)
    document.addEventListener('visibilitychange',check)
    return ()=>{active=false;request?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',check)}
  },[key,date])
  return {snapshot:snapshot?.key===key?snapshot:null,status}
}
