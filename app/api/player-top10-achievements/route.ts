import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const categories = ['league-all', 'venue-all', 'league-season', 'venue-season'] as const

interface Ranking {
  machine: string
  venue: string | null
  priority: 1 | 2 | 3 | 4
  rank: number
  score: number
}

export async function GET(request: Request) {
  const playerName = new URL(request.url).searchParams.get('player')
  if (!playerName?.trim()) {
    return NextResponse.json({ error: 'Player parameter is required' }, { status: 400 })
  }

  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data, error } = await db
      .from('cache_player_top10_weekly')
      .select('player_key, rankings, refreshed_at')
      .eq('player_name', playerName)
      .maybeSingle<{ player_key: string | null; rankings: Ranking[]; refreshed_at: string }>()
    if (error) throw error

    const achievements = (data?.rankings || []).map(({ machine, venue, priority, rank, score }) => ({
      machine,
      context: `${venue || 'League-wide'} - ${priority >= 3 ? 'this season' : 'all time'}`,
      venue: venue || undefined,
      rank,
      score,
      isVenueSpecific: venue !== null,
      priority,
      category: categories[priority - 1],
    }))
    return NextResponse.json({
      achievements,
      count: achievements.length,
      playerKey: data?.player_key ?? null,
      refreshedAt: data?.refreshed_at ?? null,
    })
  } catch (error) {
    console.error('[player-top10-achievements] Weekly snapshot unavailable:', error)
    return NextResponse.json({ error: 'Rankings are temporarily unavailable' }, { status: 503 })
  }
}
