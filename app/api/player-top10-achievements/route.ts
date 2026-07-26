import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { standardizeVenueName } from '@/lib/venue-mappings'
import { getScoreLimits } from '@/lib/score-limits'
import { orEqAcrossColumns } from '@/lib/pg-filter'

export const dynamic = 'force-dynamic'
export const revalidate = 0 // No caching - always fetch fresh data

interface Achievement {
  machine: string
  context: string
  venue?: string
  rank: number
  score: number
  isVenueSpecific: boolean
  priority: number
  category: 'league-all' | 'venue-all' | 'league-season' | 'venue-season'
}

interface GameScore {
  playerKey: string
  playerName: string
  score: number
  machine: string
  venue: string | null
  season: number
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const playerName = searchParams.get('player')

    if (!playerName) {
      return NextResponse.json(
        { error: 'Player parameter is required' },
        { status: 400 }
      )
    }

    // Read the actual current (max) season from data instead of hardcoding.
    // Hardcoded 22 was leaving season 23+ data out of the "all-time" and
    // "this season" computations.
    let currentSeason = 22
    try {
      const { data: maxSeasonRow } = await supabase
        .from('matches')
        .select('season')
        .order('season', { ascending: false })
        .limit(1)
        .single<{ season: number }>()
      if (maxSeasonRow?.season) currentSeason = maxSeasonRow.season
    } catch {
      // Stick with the fallback — better than crashing.
    }

    // First, find the player's key by looking for any game they've played
    const { data: playerGames } = await supabase
      .from('games')
      .select('player_1_key, player_1_name, player_2_key, player_2_name, player_3_key, player_3_name, player_4_key, player_4_name')
      .or(orEqAcrossColumns(['player_1_name', 'player_2_name', 'player_3_name', 'player_4_name'], playerName))
      .limit(1)
      .returns<Array<{
        player_1_key: string | null
        player_1_name: string | null
        player_2_key: string | null
        player_2_name: string | null
        player_3_key: string | null
        player_3_name: string | null
        player_4_key: string | null
        player_4_name: string | null
      }>>()

    if (!playerGames || playerGames.length === 0) {
      return NextResponse.json({ achievements: [], count: 0 })
    }

    // Extract player key from the game record
    let playerKey: string | null = null
    const game = playerGames[0]
    if (game.player_1_name === playerName) playerKey = game.player_1_key
    else if (game.player_2_name === playerName) playerKey = game.player_2_key
    else if (game.player_3_name === playerName) playerKey = game.player_3_key
    else if (game.player_4_name === playerName) playerKey = game.player_4_key

    if (!playerKey) {
      return NextResponse.json({ achievements: [], count: 0 })
    }

    // --- Cache-first path ---
    // cache_machine_top_scores is rebuilt honestly every night from the full
    // game history, with venue names standardized so there's one bucket per
    // venue. Reading the player's own rows gives their rank directly in each
    // (machine, venue, season) bucket. Machine/venue labels are standardized
    // the same way as the live path so the two agree. Falls through to the
    // live scan when the cache has no rows for this player yet.
    // Only the season==currentSeason bucket represents "this season".
    {
      const { data: cachedRows } = await supabase
        .from('cache_machine_top_scores' as any)
        .select('*')
        .eq('player_name', playerName) as { data: any[] | null }

      if (cachedRows && cachedRows.length > 0) {
        const achievements: Achievement[] = []

        for (const row of cachedRows) {
          const isVenueSpecific = row.venue !== null
          // A per-season bucket only counts as a "this season" achievement
          // when it is the current season; older per-season buckets are not
          // surfaced (the all-time bucket already covers historical bests).
          const isSeason = row.season !== null
          if (isSeason && row.season !== currentSeason) continue

          const venueLabel = standardizeVenueName(row.venue) || row.venue

          let category: 'league-all' | 'venue-all' | 'league-season' | 'venue-season'
          let context: string
          let priority: number

          if (!isVenueSpecific && !isSeason) {
            category = 'league-all'; context = 'League-wide - all time'; priority = 1
          } else if (isVenueSpecific && !isSeason) {
            category = 'venue-all'; context = `${venueLabel} - all time`; priority = 2
          } else if (!isVenueSpecific && isSeason) {
            category = 'league-season'; context = 'League-wide - this season'; priority = 3
          } else {
            category = 'venue-season'; context = `${venueLabel} - this season`; priority = 4
          }

          achievements.push({
            machine: row.machine,
            context,
            venue: venueLabel || undefined,
            rank: row.rank,
            score: Number(row.score),
            isVenueSpecific,
            priority,
            category
          })
        }

        // Deduplicate by machine+context, keep best rank
        const uniqueAchievements = new Map<string, Achievement>()
        for (const a of achievements) {
          const key = `${a.machine}|||${a.context}`
          const existing = uniqueAchievements.get(key)
          if (!existing || a.rank < existing.rank) {
            uniqueAchievements.set(key, a)
          }
        }

        const sorted = Array.from(uniqueAchievements.values()).sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority
          if (a.rank !== b.rank) return a.rank - b.rank
          if (a.score !== b.score) return b.score - a.score
          return a.machine.localeCompare(b.machine)
        })

        return NextResponse.json({
          achievements: sorted,
          count: sorted.length,
          playerKey
        })
      }
    }

    // --- Fallback: full games scan ---
    // Load score limits from database
    const scoreLimits = await getScoreLimits()

    // Function to check if a score is valid (not glitched)
    // Use standardized machine name to check limits
    const isValidScore = (machine: string, score: number): boolean => {
      const standardized = machine.toLowerCase()
      const limit = scoreLimits[standardized] || scoreLimits[machine.toLowerCase()]
      return !limit || score <= limit
    }

    // Function to extract all scores from game records
    const extractScores = (games: any[]): GameScore[] => {
      const scores: GameScore[] = []

      for (const game of games) {
        // Standardize machine name using mappings
        const standardizedMachine = game.machine

        // Check each player position (1-4)
        for (let i = 1; i <= 4; i++) {
          const key = game[`player_${i}_key`]
          const name = game[`player_${i}_name`]
          const score = game[`player_${i}_score`]

          // Include players even without player_key (subs may not have keys)
          // Use player name as fallback key for deduplication
          if (name && score != null && isValidScore(game.machine, score)) {
            scores.push({
              playerKey: key || `name:${name}`, // Use name as fallback key for subs
              playerName: name,
              score: score,
              machine: standardizedMachine, // Use standardized machine name
              venue: standardizeVenueName(game.venue), // Normalize venue names
              season: game.season
            })
          }
        }
      }

      return scores
    }

    // Function to find player achievements in a dataset
    const findAchievements = (
      scores: GameScore[], 
      playerKey: string, 
      context: string,
      priority: number,
      category: 'league-all' | 'venue-all' | 'league-season' | 'venue-season'
    ): Achievement[] => {
      const achievements: Achievement[] = []
      
      // Group scores by machine (or machine+venue for venue-specific)
      const groupedScores = new Map<string, GameScore[]>()
      
      for (const score of scores) {
        const key = category.includes('venue') ? `${score.machine}|||${score.venue}` : score.machine
        if (!groupedScores.has(key)) {
          groupedScores.set(key, [])
        }
        groupedScores.get(key)!.push(score)
      }
      
      // Process each machine/venue group
      groupedScores.forEach((groupScores, groupKey) => {
        // Sort scores for this machine/venue (highest first)
        const sortedScores = groupScores.sort((a, b) => b.score - a.score)

        // NOTE: We do NOT deduplicate by player here to match machine-top10 API behavior
        // This ensures rankings are consistent between the achievements list and detail view
        // A player can appear multiple times in the top 10 with different scores

        // Take top 10 scores (same player can appear multiple times)
        const machineTop10 = sortedScores.slice(0, 10)

        // Find player's best score in the top 10
        for (let i = 0; i < machineTop10.length; i++) {
          if (machineTop10[i].playerKey === playerKey) {
            const [machine, venue] = groupKey.split('|||')

            achievements.push({
              machine,
              context,
              venue: venue || undefined,
              rank: i + 1,
              score: machineTop10[i].score,
              isVenueSpecific: category.includes('venue'),
              priority,
              category
            })
            
            // Only take the player's highest score for this machine/venue
            // Since the list is sorted by score descending, first occurrence is the best
            break
          }
        }
      })
      
      return achievements
    }

    // Fetch all games for all-time period (all seasons 2-22) with pagination
    // IMPORTANT: Must use .order('id') for consistent pagination - without ordering,
    // PostgreSQL returns rows in arbitrary order that changes between pages, causing
    // entire seasons to be missed during pagination
    let allTimeGames
    try {
      allTimeGames = await fetchAllRecords(
        () => supabase
          .from('games')
          .select('machine, venue, season, player_1_key, player_1_name, player_1_score, player_2_key, player_2_name, player_2_score, player_3_key, player_3_name, player_3_score, player_4_key, player_4_name, player_4_score')
          .gte('season', 2)
          .lte('season', currentSeason)
          .order('id', { ascending: true })
      )
    } catch (allTimeError) {
      console.error('Error fetching all-time games:', allTimeError)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Fetch games for current season only with pagination
    // Also needs .order('id') for consistent pagination
    let currentSeasonGames
    try {
      currentSeasonGames = await fetchAllRecords(
        () => supabase
          .from('games')
          .select('machine, venue, season, player_1_key, player_1_name, player_1_score, player_2_key, player_2_name, player_2_score, player_3_key, player_3_name, player_3_score, player_4_key, player_4_name, player_4_score')
          .eq('season', currentSeason)
          .order('id', { ascending: true })
      )
    } catch (seasonError) {
      console.error('Error fetching current season games:', seasonError)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Extract scores from both datasets
    const allTimeScores = extractScores(allTimeGames)
    const currentSeasonScores = extractScores(currentSeasonGames)

    // Find achievements in each category
    const achievements: Achievement[] = []

    // League-wide all-time (priority 1)
    achievements.push(...findAchievements(
      allTimeScores,
      playerKey,
      'League-wide - all time',
      1,
      'league-all'
    ))

    // Venue-specific all-time (priority 2)
    achievements.push(...findAchievements(
      allTimeScores,
      playerKey,
      'all time', // Will be prefixed with venue name
      2,
      'venue-all'
    ))

    // League-wide current season (priority 3)
    achievements.push(...findAchievements(
      currentSeasonScores,
      playerKey,
      'League-wide - this season',
      3,
      'league-season'
    ))

    // Venue-specific current season (priority 4)
    achievements.push(...findAchievements(
      currentSeasonScores,
      playerKey,
      'this season', // Will be prefixed with venue name
      4,
      'venue-season'
    ))

    // Fix venue-specific context strings
    for (const achievement of achievements) {
      if (achievement.isVenueSpecific && achievement.venue) {
        if (achievement.context === 'all time') {
          achievement.context = `${achievement.venue} - all time`
        } else if (achievement.context === 'this season') {
          achievement.context = `${achievement.venue} - this season`
        }
      }
    }

    // Remove duplicates (keep best rank for each machine+context)
    const uniqueAchievements = new Map<string, Achievement>()
    
    for (const achievement of achievements) {
      const key = `${achievement.machine}|||${achievement.context}`
      const existing = uniqueAchievements.get(key)
      
      if (!existing || achievement.rank < existing.rank) {
        uniqueAchievements.set(key, achievement)
      }
    }

    // Sort final achievements
    const sortedAchievements = Array.from(uniqueAchievements.values()).sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      if (a.rank !== b.rank) return a.rank - b.rank
      if (a.score !== b.score) return b.score - a.score
      return a.machine.localeCompare(b.machine)
    })

    return NextResponse.json({
      achievements: sortedAchievements,
      count: sortedAchievements.length,
      playerKey: playerKey
    })

  } catch (error) {
    console.error('Error in achievements route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}