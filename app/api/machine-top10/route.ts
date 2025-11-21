import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { getMachineVariations } from '@/lib/machine-mappings'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic';

// Load score limits
const scoreLimitsPath = path.join(process.cwd(), 'score_limits.json')
let scoreLimits: Record<string, number> = {}
try {
  const scoreLimitsData = fs.readFileSync(scoreLimitsPath, 'utf-8')
  scoreLimits = JSON.parse(scoreLimitsData)
} catch (error) {
  console.error('Failed to load score limits:', error)
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const machineKey = searchParams.get('machine')
    const context = searchParams.get('context')
    const venue = searchParams.get('venue') || ''

    if (!machineKey || !context) {
      return NextResponse.json(
        { error: 'Machine and context parameters are required' },
        { status: 400 }
      )
    }

    // Determine season filter from context
    const isThisSeason = context.includes('this season')
    const currentSeason = 22

    // Get all machine name variations to query for
    const machineVariations = getMachineVariations(machineKey)
    console.log(`Querying for machine "${machineKey}" with variations:`, machineVariations)

    // Build query for top 10 scores with pagination
    let query = supabase
      .from('games')
      .select('player_1_name, player_1_score, player_2_name, player_2_score, player_3_name, player_3_score, player_4_name, player_4_score, venue, season, week, match_key, round_number')
      .in('machine', machineVariations)

    // Filter by season if "this season"
    if (isThisSeason) {
      query = query.eq('season', currentSeason)
    } else {
      // All time: all historical seasons (2-22)
      query = query.gte('season', 2).lte('season', 22)
    }

    // Filter by venue if context is venue-specific (not league-wide)
    if (venue && !context.includes('League-wide')) {
      query = query.eq('venue', venue)
    }

    let games
    try {
      games = await fetchAllRecords<{
        player_1_name: string | null
        player_1_score: number | null
        player_2_name: string | null
        player_2_score: number | null
        player_3_name: string | null
        player_3_score: number | null
        player_4_name: string | null
        player_4_score: number | null
        venue: string | null
        season: number | null
        week: number | null
        match_key: string | null
        round_number: number | null
      }>(() => query)
    } catch (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Helper to check if a score should be filtered out based on machine limits
    const isScoreValid = (score: number): boolean => {
      const machineLimit = scoreLimits[machineKey.toLowerCase()]
      if (!machineLimit) return true
      return score <= machineLimit
    }

    // Extract all scores from games
    const scores: Array<{ player: string; score: number; venue: string; season: number; week: number; match: string; round: number }> = []

    for (const game of games) {
      // Player 1
      if (game.player_1_name && game.player_1_score != null && isScoreValid(game.player_1_score)) {
        scores.push({
          player: game.player_1_name,
          score: game.player_1_score,
          venue: game.venue || '',
          season: game.season || 0,
          week: game.week || 0,
          match: game.match_key || '',
          round: game.round_number || 0
        })
      }
      // Player 2
      if (game.player_2_name && game.player_2_score != null && isScoreValid(game.player_2_score)) {
        scores.push({
          player: game.player_2_name,
          score: game.player_2_score,
          venue: game.venue || '',
          season: game.season || 0,
          week: game.week || 0,
          match: game.match_key || '',
          round: game.round_number || 0
        })
      }
      // Player 3
      if (game.player_3_name && game.player_3_score != null && isScoreValid(game.player_3_score)) {
        scores.push({
          player: game.player_3_name,
          score: game.player_3_score,
          venue: game.venue || '',
          season: game.season || 0,
          week: game.week || 0,
          match: game.match_key || '',
          round: game.round_number || 0
        })
      }
      // Player 4
      if (game.player_4_name && game.player_4_score != null && isScoreValid(game.player_4_score)) {
        scores.push({
          player: game.player_4_name,
          score: game.player_4_score,
          venue: game.venue || '',
          season: game.season || 0,
          week: game.week || 0,
          match: game.match_key || '',
          round: game.round_number || 0
        })
      }
    }

    // Sort by score descending
    const sortedScores = scores.sort((a, b) => b.score - a.score)

    // Assign ranks handling ties correctly
    const rankedScores: Array<{ player: string; score: number; venue: string; season: number; week: number; match: string; round: number; rank: number }> = []
    let currentRank = 1

    for (let i = 0; i < sortedScores.length; i++) {
      // If this score is different from the previous score, update the rank
      if (i > 0 && sortedScores[i].score < sortedScores[i - 1].score) {
        currentRank = i + 1
      }

      rankedScores.push({
        ...sortedScores[i],
        rank: currentRank
      })
    }

    // Take top 10 after ranking
    const topScores = rankedScores.slice(0, 10)

    return NextResponse.json({
      machine: machineKey,
      machineKey,
      context,
      topScores
    })
  } catch (error) {
    console.error('Error fetching top 10:', error)
    return NextResponse.json(
      { error: 'Failed to fetch top 10' },
      { status: 500 }
    )
  }
}
