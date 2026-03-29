import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const dynamic = 'force-dynamic'
export const revalidate = 3600

/**
 * GET /api/player-ipr-history
 *
 * Returns historical IPR data for a player from the matches table lineup data.
 * IPR is stored in matches.data.home.lineup[] and matches.data.away.lineup[]
 *
 * Uses player_first_season table to cache the earliest season per player,
 * avoiding full table scans on subsequent requests.
 *
 * Params:
 *   name - player name (required)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const playerName = searchParams.get('name')

    if (!playerName) {
      return NextResponse.json(
        { error: 'Player name is required' },
        { status: 400 }
      )
    }

    // Check for cached first season
    let firstSeason: number | null = null
    const { data: cached } = await (supabase as any)
      .from('player_first_season')
      .select('first_season')
      .eq('player_name', playerName)
      .maybeSingle()

    if (cached?.first_season) {
      firstSeason = cached.first_season
    }

    // Get matches ordered by season and week, filtered by first_season if known
    const queryBuilder = () => {
      let q = supabase
        .from('matches')
        .select('match_key, season, week, data, created_at')
        .order('season', { ascending: true })
        .order('week', { ascending: true })

      if (firstSeason) {
        q = q.gte('season', firstSeason)
      }

      return q
    }

    const matchesData = await fetchAllRecords<{
      match_key: string
      season: number
      week: number | null
      data: any
      created_at: string | null
    }>(queryBuilder)

    if (!matchesData || matchesData.length === 0) {
      return NextResponse.json({
        playerName,
        history: [],
        firstSeason: null,
        totalMatches: 0,
        message: 'No matches found'
      })
    }

    // Extract IPR history from lineup data
    const history: Array<{
      season: number
      week: number | null
      matchNumber: number
      ipr: number
      date: string
    }> = []

    for (const match of matchesData) {
      if (!match.data) continue

      let playerIPR: number | null = null

      // Check home team lineup
      if (match.data.home?.lineup) {
        const homePlayer = match.data.home.lineup.find(
          (p: any) => p.name === playerName
        )
        if (homePlayer && homePlayer.IPR != null) {
          playerIPR = homePlayer.IPR
        }
      }

      // Check away team lineup
      if (playerIPR === null && match.data.away?.lineup) {
        const awayPlayer = match.data.away.lineup.find(
          (p: any) => p.name === playerName
        )
        if (awayPlayer && awayPlayer.IPR != null) {
          playerIPR = awayPlayer.IPR
        }
      }

      // If player found in this match, add to history
      if (playerIPR !== null) {
        history.push({
          season: match.season,
          week: match.week || 0,
          matchNumber: history.length + 1,
          ipr: playerIPR,
          date: match.created_at || new Date().toISOString()
        })
      }
    }

    // Determine first season from the data
    const computedFirstSeason = history.length > 0 ? history[0].season : null

    // Cache first season if not cached yet or if it changed
    if (computedFirstSeason !== null && computedFirstSeason !== firstSeason) {
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
      await (supabaseAdmin as any)
        .from('player_first_season')
        .upsert(
          {
            player_name: playerName,
            first_season: computedFirstSeason,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'player_name' }
        )
    }

    return NextResponse.json({
      playerName,
      history,
      firstSeason: computedFirstSeason,
      totalMatches: history.length
    })
  } catch (error) {
    console.error('Error fetching IPR history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch IPR history' },
      { status: 500 }
    )
  }
}
