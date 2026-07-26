import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { getScoreLimits } from '@/lib/score-limits'
import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const player = searchParams.get('player')
    const machine = searchParams.get('machine')

    if (!player || !machine) {
      return NextResponse.json(
        { error: 'Player and machine parameters are required' },
        { status: 400 }
      )
    }

    // Read score limits from the DB (single source of truth) rather than the
    // stale local score_limits.json that the rest of the app no longer uses.
    const scoreLimits = await getScoreLimits()

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)


    // Fetch manually added scores from user_machine_scores table
    const { data: manualScores, error: manualError } = await supabaseAdmin
      .from('user_machine_scores')
      .select('*')
      .eq('player_name', player)
      .eq('machine', machine)
      .order('score', { ascending: false })

    if (manualError) {
      console.error('Error fetching manual scores:', manualError)
    }

    // Fetch league scores from games table

    // Helper to check if a score should be filtered out
    const isScoreValid = (score: number): boolean => {
      const machineLimit = scoreLimits[machine.toLowerCase()]
      if (!machineLimit) return true
      return score <= machineLimit
    }

    let leagueGames
    try {
      leagueGames = await fetchAllRecords<any>(() =>
        supabase
          .from('games')
          .select('player_1_name, player_1_score, player_2_name, player_2_score, player_3_name, player_3_score, player_4_name, player_4_score, season, week, venue, match_key, created_at')
          .eq('machine', machine)
          .gte('season', 2)
      )
    } catch (error) {
      console.error('Error fetching league games:', error)
      leagueGames = []
    }

    // Extract player's scores from league games
    const leagueScores: Array<{
      score: number
      venue: string | null
      played_at: string
      season: number
      week: number
      source: 'league'
    }> = []

    for (const game of leagueGames || []) {
      for (let i = 1; i <= 4; i++) {
        const playerName = game[`player_${i}_name`]
        const score = game[`player_${i}_score`]

        if (playerName === player && score != null && isScoreValid(score)) {
          leagueScores.push({
            score,
            venue: game.venue,
            played_at: game.created_at || new Date().toISOString(),
            season: game.season,
            week: game.week,
            source: 'league'
          })
        }
      }
    }

    // Sort league scores by score descending and take top 10
    leagueScores.sort((a, b) => b.score - a.score)
    const topLeagueScores = leagueScores.slice(0, 10)

    // Format manual scores with source field and ID for deletion
    const formattedManualScores = (manualScores || []).map(s => ({
      id: s.id,
      score: s.score,
      venue: s.venue,
      played_at: s.played_at,
      source: 'manual' as const
    }))

    // Combine all scores - manual scores first, then league scores
    // Don't deduplicate - show both sources
    const allScores = [
      ...formattedManualScores,
      ...topLeagueScores
    ].sort((a, b) => b.score - a.score)

    return NextResponse.json({
      scores: allScores,
      manualCount: formattedManualScores.length,
      leagueCount: topLeagueScores.length
    })
  } catch (error) {
    console.error('Error in user-machine-scores API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    // Ownership is derived from the authenticated session, not a query param.
    const auth = await requireUser(request)
    if (!auth.ok) return auth.response
    const userId = auth.user.id

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'ID parameter is required' },
        { status: 400 }
      )
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Verify the score belongs to this user before deleting
    const { data: score, error: fetchError } = await supabaseAdmin
      .from('user_machine_scores')
      .select('user_id')
      .eq('id', id)
      .single()

    if (fetchError || !score) {
      return NextResponse.json(
        { error: 'Score not found' },
        { status: 404 }
      )
    }

    if (score.user_id !== userId) {
      return NextResponse.json(
        { error: 'Unauthorized - you can only delete your own scores' },
        { status: 403 }
      )
    }

    // Delete the score
    const { error: deleteError } = await supabaseAdmin
      .from('user_machine_scores')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('Error deleting score:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete score' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in DELETE user-machine-scores:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
