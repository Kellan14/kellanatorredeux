import { NextResponse } from 'next/server'
import { announcedReply, ResponseError, validateReply } from '@/lib/strategy/announced-response'
import { loadAssignmentEstimator } from '@/lib/strategy/assignment-preview-api'

export async function POST(request: Request) {
  try {
    const body=await request.json()
    validateReply(body)
    const {estimator}=await loadAssignmentEstimator(body.seasonStart,body.seasonEnd,request.signal)
    return NextResponse.json(announcedReply(body,(p,m)=>estimator.estimate(p,m,body.venue)))
  } catch(e) {
    if(e instanceof SyntaxError || e instanceof ResponseError) return NextResponse.json({error:e.message},{status:422})
    return NextResponse.json({error:'Could not load matchup history. Please retry.'},{status:503})
  }
}
