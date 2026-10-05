import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchAllPickSourceGames, rebuildTeamPicksCache } from '@/lib/top-picks-cache'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Manual/weekly rebuild of the all-time pick cache; the daily sync also rebuilds it. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const secret = process.env.CRON_SECRET
  if (!secret || (request.headers.get('authorization') !== `Bearer ${secret}` &&
      searchParams.get('key') !== secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 })
  }

  try {
    const supabase = createClient(url, key)
    const games = await fetchAllPickSourceGames(supabase)
    const picks = await rebuildTeamPicksCache(supabase, games)
    return NextResponse.json({ ok: true, games: games.length, picks })
  } catch (error) {
    console.error('[refresh-top-picks] Rebuild failed:', error)
    return NextResponse.json({ error: 'Pick cache rebuild failed' }, { status: 500 })
  }
}
