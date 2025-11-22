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
    const machineName = searchParams.get('machine')
    const venue = searchParams.get('venue') || ''

    if (!machineName) {
      return NextResponse.json(
        { error: 'Machine parameter is required' },
        { status: 400 }
      )
    }

    // Get the current season dynamically from the database
    const { data: maxSeasonData } = await supabase
      .from('games')
      .select('season')
      .order('season', { ascending: false })
      .limit(1)
      .single<{ season: number }>()

    const currentSeason = maxSeasonData?.season || 22

    // Helper to check if a score should be filtered out
    const isScoreValid = (score: number): boolean => {
      const machineLimit = scoreLimits[machineName.toLowerCase()]
      if (!machineLimit) return true
      return score <= machineLimit
    }

    // Get all machine name variations (aliases) for better matching
    const machineVariations = getMachineVariations(machineName)

    // Build OR condition for all machine variations using ilike
    // Values with spaces or special characters need to be double-quoted for Supabase
    const machineOrCondition = machineVariations
      .map(v => {
        // Quote values that contain spaces, commas, or other special characters
        const needsQuoting = /[\s,()]/.test(v)
        return needsQuoting ? `machine.ilike."${v}"` : `machine.ilike.${v}`
      })
      .join(',')

    // Query current season games with pagination
    let seasonGames
    try {
      seasonGames = await fetchAllRecords<any>(() => {
        let query = supabase
          .from('games')
          .select('player_1_name, player_1_score, player_2_name, player_2_score, player_3_name, player_3_score, player_4_name, player_4_score, season, week, venue')
          .or(machineOrCondition)
          .eq('season', currentSeason)

        if (venue) {
          query = query.eq('venue', venue)
        }
        return query
      })
    } catch (error) {
      console.error('Error fetching season games:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Query all-time games (seasons 2 to current) with pagination
    let allTimeGames
    try {
      allTimeGames = await fetchAllRecords<any>(() => {
        let query = supabase
          .from('games')
          .select('player_1_name, player_1_score, player_2_name, player_2_score, player_3_name, player_3_score, player_4_name, player_4_score, season, week, venue')
          .or(machineOrCondition)
          .gte('season', 2)
          .lte('season', currentSeason)

        if (venue) {
          query = query.eq('venue', venue)
        }
        return query
      })
    } catch (error) {
      console.error('Error fetching all-time games:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Extract and sort scores
    const extractScores = (games: any[]) => {
      const scores: Array<{ player: string; score: number; season: number; week: number; venue: string }> = []

      for (const game of games) {
        for (let i = 1; i <= 4; i++) {
          const playerName = game[`player_${i}_name`]
          const score = game[`player_${i}_score`]

          if (playerName && score != null && isScoreValid(score)) {
            scores.push({
              player: playerName,
              score: score,
              season: game.season,
              week: game.week,
              venue: game.venue || ''
            })
          }
        }
      }

      return scores.sort((a, b) => b.score - a.score).slice(0, 10)
    }

    const topSeasonScores = extractScores(seasonGames)
    const topAllTimeScores = extractScores(allTimeGames)

    return NextResponse.json({
      machine: machineName,
      topSeasonScores,
      topAllTimeScores,
      venue: venue || 'all venues'
    })
  } catch (error) {
    console.error('Error fetching top scores:', error)
    return NextResponse.json(
      { error: 'Failed to fetch top scores' },
      { status: 500 }
    )
  }
}
