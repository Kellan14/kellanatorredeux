import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { machineMappings } from '@/lib/machine-mappings'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'
export const revalidate = 3600 // Cache for 1 hour

// Load score limits to filter out invalid/glitched scores
const scoreLimitsPath = path.join(process.cwd(), 'score_limits.json')
let scoreLimits: Record<string, number> = {}
try {
  const scoreLimitsData = fs.readFileSync(scoreLimitsPath, 'utf-8')
  scoreLimits = JSON.parse(scoreLimitsData)
} catch (error) {
  console.error('Failed to load score limits:', error)
}

// Helper to standardize machine names using mappings
function standardizeMachineName(machineName: string): string {
  const lowerName = machineName.toLowerCase()

  // Check if this name is an alias in our mappings
  if (machineMappings[lowerName]) {
    return machineMappings[lowerName]
  }

  // Return original name if no mapping found
  return machineName
}

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

    const currentSeason = 22
    
    // First, find the player's key by looking for any game they've played
    const { data: playerGames } = await supabase
      .from('games')
      .select('player_1_key, player_1_name, player_2_key, player_2_name, player_3_key, player_3_name, player_4_key, player_4_name')
      .or(`player_1_name.eq.${playerName},player_2_name.eq.${playerName},player_3_name.eq.${playerName},player_4_name.eq.${playerName}`)
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

    // Function to check if a score is valid (not glitched)
    const isValidScore = (machine: string, score: number): boolean => {
      const limit = scoreLimits[machine.toLowerCase()]
      return !limit || score <= limit
    }

    // Function to extract all scores from game records
    const extractScores = (games: any[]): GameScore[] => {
      const scores: GameScore[] = []

      for (const game of games) {
        // Standardize machine name using mappings
        const standardizedMachine = standardizeMachineName(game.machine)

        // Check each player position (1-4)
        for (let i = 1; i <= 4; i++) {
          const key = game[`player_${i}_key`]
          const name = game[`player_${i}_name`]
          const score = game[`player_${i}_score`]

          if (key && name && score != null && isValidScore(game.machine, score)) {
            scores.push({
              playerKey: key,
              playerName: name,
              score: score,
              machine: standardizedMachine, // Use standardized machine name
              venue: game.venue,
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

        // Deduplicate by player - keep only the highest score for each player
        const uniquePlayerScores = new Map<string, GameScore>()
        for (const score of sortedScores) {
          if (!uniquePlayerScores.has(score.playerKey)) {
            uniquePlayerScores.set(score.playerKey, score)
          }
        }

        // Convert back to array and take top 10
        const machineTop10 = Array.from(uniquePlayerScores.values()).slice(0, 10)
        
        // Debug logging for Aerosmith AFTER sorting
        if (groupKey === 'Aerosmith' && context.includes('League-wide - all time')) {
          console.log('=== AEROSMITH DEBUG (AFTER SORT) ===')
          console.log('Top 10 scores after sort:')
          machineTop10.forEach((s, i) => {
            const isPlayer = s.playerKey === playerKey ? ' <-- THIS IS THE PLAYER' : ''
            console.log(`${i + 1}. ${s.playerName} (key: ${s.playerKey}): ${s.score.toLocaleString()}${isPlayer}`)
          })
          console.log('Looking for playerKey:', playerKey)
        }
        
        // Find player's best score in the top 10
        for (let i = 0; i < machineTop10.length; i++) {
          if (machineTop10[i].playerKey === playerKey) {
            const [machine, venue] = groupKey.split('|||')
            
            // More debug logging
            if (machine === 'Aerosmith' && context.includes('League-wide - all time')) {
              console.log(`Found player at position ${i} (rank ${i + 1})`)
              console.log(`Player score: ${machineTop10[i].score.toLocaleString()}`)
            }
            
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
    let allTimeGames
    try {
      allTimeGames = await fetchAllRecords(
        () => supabase
          .from('games')
          .select('machine, venue, season, player_1_key, player_1_name, player_1_score, player_2_key, player_2_name, player_2_score, player_3_key, player_3_name, player_3_score, player_4_key, player_4_name, player_4_score')
          .gte('season', 2)
          .lte('season', 22)
      )
    } catch (allTimeError) {
      console.error('Error fetching all-time games:', allTimeError)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Fetch games for current season only with pagination
    let currentSeasonGames
    try {
      currentSeasonGames = await fetchAllRecords(
        () => supabase
          .from('games')
          .select('machine, venue, season, player_1_key, player_1_name, player_1_score, player_2_key, player_2_name, player_2_score, player_3_key, player_3_name, player_3_score, player_4_key, player_4_name, player_4_score')
          .eq('season', currentSeason)
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

    // Debug: Find IronMaiden specifically
    const ironMaidenDebug = {
      totalScoresCollected: allTimeScores.filter(s => s.machine === 'IronMaiden').length,
      top10Scores: allTimeScores
        .filter(s => s.machine === 'IronMaiden')
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map((s, i) => ({
          rank: i + 1,
          player: s.playerName,
          score: s.score,
          playerKey: s.playerKey,
          isYou: s.playerKey === playerKey
        }))
    }

    return NextResponse.json({
      achievements: sortedAchievements,
      count: sortedAchievements.length,
      playerKey: playerKey,
      debug: {
        ironMaiden: ironMaidenDebug
      }
    })

  } catch (error) {
    console.error('Error in achievements route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}