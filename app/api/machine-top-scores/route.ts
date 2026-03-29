import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { getMachineVariations, machineMappings } from '@/lib/machine-mappings'
import { getVenueVariations } from '@/lib/venue-mappings'
import { getScoreLimits } from '@/lib/score-limits'

export const dynamic = 'force-dynamic';

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

    // Load score limits from database
    const scoreLimits = await getScoreLimits()

    // Helper to check if a score should be filtered out
    // Use standardized machine name to check limits
    const isScoreValid = (score: number): boolean => {
      const standardized = (machineMappings[machineName.toLowerCase()] || machineName).toLowerCase()
      const machineLimit = scoreLimits[standardized] || scoreLimits[machineName.toLowerCase()]
      if (!machineLimit) return true
      return score <= machineLimit
    }

    // Get all machine name variations (aliases) for better matching
    const machineVariations = getMachineVariations(machineName)
    const lowerVariations = machineVariations.map((v: string) => v.toLowerCase())

    // --- Try cache-first path ---
    const venueVariations = venue ? getVenueVariations(venue) : []
    {
      // Season top scores — fetch extra rows since multiple machine name variants
      // may have separate cache entries with overlapping scores
      let seasonQuery = supabase
        .from('cache_machine_top_scores' as any)
        .select('*')
        .in('machine', lowerVariations)
        .eq('season', currentSeason)
      if (venue) {
        seasonQuery = seasonQuery.in('venue', venueVariations)
      } else {
        seasonQuery = seasonQuery.is('venue', null)
      }
      const { data: seasonCache } = await (seasonQuery.order('score', { ascending: false }).limit(50)) as { data: any[] | null }

      // All-time top scores
      let allTimeQuery = supabase
        .from('cache_machine_top_scores' as any)
        .select('*')
        .in('machine', lowerVariations)
        .is('season', null)
      if (venue) {
        allTimeQuery = allTimeQuery.in('venue', venueVariations)
      } else {
        allTimeQuery = allTimeQuery.is('venue', null)
      }
      const { data: allTimeCache } = await (allTimeQuery.order('score', { ascending: false }).limit(50)) as { data: any[] | null }

      if ((seasonCache && seasonCache.length > 0) || (allTimeCache && allTimeCache.length > 0)) {
        const mapRow = (row: any) => ({
          player: row.player_name,
          score: Number(row.score),
          season: row.season || 0,
          week: row.week || 0,
          venue: row.venue || ''
        })

        // Deduplicate: same player + score + week = same game result
        const dedup = (rows: any[]) => {
          const seen = new Set<string>()
          return rows.filter(row => {
            const key = `${row.player_name}|${row.score}|${row.week}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
          }).slice(0, 10)
        }

        return NextResponse.json({
          machine: machineName,
          topSeasonScores: dedup(seasonCache || []).map(mapRow),
          topAllTimeScores: dedup(allTimeCache || []).map(mapRow),
          venue: venue || 'all venues'
        })
      }
    }

    // --- Fallback: full games scan ---
    console.log(`[machine-top-scores] Cache miss, falling back to full scan for "${machineName}"`)

    // Query current season games with pagination using .in() for exact matching
    // getMachineVariations returns all case variations (PULP, pulp, Pulp, etc.)
    const fallbackVenueVariations = venue ? getVenueVariations(venue) : []
    let seasonGames
    try {
      seasonGames = await fetchAllRecords<any>(() => {
        let query = supabase
          .from('games')
          .select('player_1_name, player_1_score, player_2_name, player_2_score, player_3_name, player_3_score, player_4_name, player_4_score, season, week, venue')
          .in('machine', machineVariations)
          .eq('season', currentSeason)

        if (venue) {
          query = query.in('venue', fallbackVenueVariations)
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
          .in('machine', machineVariations)
          .gte('season', 2)
          .lte('season', currentSeason)

        if (venue) {
          query = query.in('venue', fallbackVenueVariations)
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
