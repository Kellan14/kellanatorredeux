import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic';

// Cache for 1 hour since stats only update weekly
export const revalidate = 3600

// Load score limits
const scoreLimitsPath = path.join(process.cwd(), 'score_limits.json')
let scoreLimits: Record<string, number> = {}
try {
  const scoreLimitsData = fs.readFileSync(scoreLimitsPath, 'utf-8')
  scoreLimits = JSON.parse(scoreLimitsData)
} catch (error) {
  console.error('Failed to load score limits:', error)
}

interface Achievement {
  machine: string
  context: string
  venue?: string
  rank: number
  score: number
  isVenueSpecific: boolean
  priority: number  // 1=highest (league-wide all-time), 4=lowest (venue-specific this season)
  category: 'league-all' | 'venue-all' | 'league-season' | 'venue-season'
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

    // Get player's key from games
    const { data: sampleGames } = await supabase
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

    let playerKey: string | null = null

    if (sampleGames && sampleGames.length > 0) {
      const game = sampleGames[0]
      if (game.player_1_name === playerName) playerKey = game.player_1_key
      else if (game.player_2_name === playerName) playerKey = game.player_2_key
      else if (game.player_3_name === playerName) playerKey = game.player_3_key
      else if (game.player_4_name === playerName) playerKey = game.player_4_key
    }

    if (!playerKey) {
      return NextResponse.json({ achievements: [] })
    }

    // Helper to check if a score should be filtered out based on machine limits
    const isScoreValid = (machine: string, score: number): boolean => {
      const machineLimit = scoreLimits[machine.toLowerCase()]
      if (!machineLimit) return true
      return score <= machineLimit
    }

    // Function to process games for a specific season range
    const processGamesForSeasonRange = async (minSeason: number, maxSeason: number, label: 'all time' | 'this season') => {
      let allGamesQuery = supabase
        .from('games')
        .select('machine, venue, player_1_key, player_1_name, player_1_score, player_2_key, player_2_name, player_2_score, player_3_key, player_3_name, player_3_score, player_4_key, player_4_name, player_4_score, season')
        .gte('season', minSeason)
        .lte('season', maxSeason)

      const { data: allGames, error } = await allGamesQuery.returns<Array<{
        machine: string
        venue: string | null
        player_1_key: string | null
        player_1_name: string | null
        player_1_score: number | null
        player_2_key: string | null
        player_2_name: string | null
        player_2_score: number | null
        player_3_key: string | null
        player_3_name: string | null
        player_3_score: number | null
        player_4_key: string | null
        player_4_name: string | null
        player_4_score: number | null
        season: number
      }>>()

      if (error) {
        console.error('Supabase error:', error)
        return []
      }

      // Extract all scores and organize by machine and machine+venue
      const machineScores = new Map<string, Array<{ player: string; playerKey: string; score: number }>>()
      const venueScores = new Map<string, Array<{ player: string; playerKey: string; score: number }>>()

      for (const game of allGames || []) {
        const scores = [
          { key: game.player_1_key, name: game.player_1_name, score: game.player_1_score },
          { key: game.player_2_key, name: game.player_2_name, score: game.player_2_score },
          { key: game.player_3_key, name: game.player_3_name, score: game.player_3_score },
          { key: game.player_4_key, name: game.player_4_name, score: game.player_4_score }
        ]

        for (const s of scores) {
          if (s.key && s.name && s.score != null && isScoreValid(game.machine, s.score)) {
            // League-wide scores by machine
            if (!machineScores.has(game.machine)) {
              machineScores.set(game.machine, [])
            }
            machineScores.get(game.machine)!.push({
              player: s.name,
              playerKey: s.key,
              score: s.score
            })

            // Venue-specific scores by machine+venue
            if (game.venue) {
              const venueKey = `${game.machine}|||${game.venue}`
              if (!venueScores.has(venueKey)) {
                venueScores.set(venueKey, [])
              }
              venueScores.get(venueKey)!.push({
                player: s.name,
                playerKey: s.key,
                score: s.score
              })
            }
          }
        }
      }

      const achievements: Achievement[] = []

      // Determine priority based on label
      const leaguePriority = label === 'all time' ? 1 : 3
      const venuePriority = label === 'all time' ? 2 : 4
      const leagueCategory = label === 'all time' ? 'league-all' : 'league-season'
      const venueCategory = label === 'all time' ? 'venue-all' : 'venue-season'

      // Check league-wide top 10
      for (const [machine, scores] of Array.from(machineScores.entries())) {
        // Sort all scores to find rankings
        const allSortedScores = scores.sort((a, b) => b.score - a.score)

        // Get unique top 10 scores (considering ties)
        const uniqueScores = Array.from(new Set(allSortedScores.map(s => s.score)))
          .sort((a, b) => b - a)
          .slice(0, 10)
        
        // If there are no scores in top 10, skip
        if (uniqueScores.length === 0) continue

        // The 10th place score (or last score if less than 10 unique scores)
        const cutoffScore = uniqueScores[uniqueScores.length - 1]

        // Get all player's scores that are >= the cutoff (in top 10)
        const playerTopScores = allSortedScores
          .filter(s => s.playerKey === playerKey && s.score >= cutoffScore)
        
        // Add each qualifying score as a separate achievement
        for (const playerScore of playerTopScores) {
          // Calculate rank based on how many scores are higher
          const rank = allSortedScores.filter(s => s.score > playerScore.score).length + 1

          // Only add if rank is <= 10
          if (rank <= 10) {
            achievements.push({
              machine,
              context: `League-wide - ${label}`,
              rank,
              score: playerScore.score,
              isVenueSpecific: false,
              priority: leaguePriority,
              category: leagueCategory as 'league-all' | 'league-season'
            })
          }
        }
      }

      // Check venue-specific top 10
      for (const [venueKey, scores] of Array.from(venueScores.entries())) {
        const [machine, venue] = venueKey.split('|||')

        // Sort all scores to find rankings
        const allSortedScores = scores.sort((a, b) => b.score - a.score)

        // Get unique top 10 scores (considering ties)
        const uniqueScores = Array.from(new Set(allSortedScores.map(s => s.score)))
          .sort((a, b) => b - a)
          .slice(0, 10)
        
        // If there are no scores in top 10, skip
        if (uniqueScores.length === 0) continue

        // The 10th place score (or last score if less than 10 unique scores)
        const cutoffScore = uniqueScores[uniqueScores.length - 1]

        // Get all player's scores that are >= the cutoff (in top 10)
        const playerTopScores = allSortedScores
          .filter(s => s.playerKey === playerKey && s.score >= cutoffScore)
        
        // Add each qualifying score as a separate achievement
        for (const playerScore of playerTopScores) {
          // Calculate rank based on how many scores are higher
          const rank = allSortedScores.filter(s => s.score > playerScore.score).length + 1

          // Only add if rank is <= 10
          if (rank <= 10) {
            achievements.push({
              machine,
              context: `${venue} - ${label}`,
              venue,
              rank,
              score: playerScore.score,
              isVenueSpecific: true,
              priority: venuePriority,
              category: venueCategory as 'venue-all' | 'venue-season'
            })
          }
        }
      }

      return achievements
    }

    // Get achievements for both all-time and current season
    const allTimeAchievements = await processGamesForSeasonRange(20, 22, 'all time')
    const currentSeasonAchievements = await processGamesForSeasonRange(currentSeason, currentSeason, 'this season')

    // Combine achievements
    const combinedAchievements = [...allTimeAchievements, ...currentSeasonAchievements]

    // Deduplicate: for each machine+context combination, only keep the best (highest score/best rank)
    const achievementMap = new Map<string, Achievement>()
    
    for (const achievement of combinedAchievements) {
      const key = `${achievement.machine}|||${achievement.context}`
      const existing = achievementMap.get(key)
      
      if (!existing || 
          achievement.rank < existing.rank || 
          (achievement.rank === existing.rank && achievement.score > existing.score)) {
        achievementMap.set(key, achievement)
      }
    }

    // Convert back to array and sort
    const allAchievements = Array.from(achievementMap.values())
      .sort((a, b) => {
        // First by priority (1=best)
        if (a.priority !== b.priority) return a.priority - b.priority
        // Then by rank (1=best)
        if (a.rank !== b.rank) return a.rank - b.rank
        // Then by score (higher=better)
        if (a.score !== b.score) return b.score - a.score
        // Finally by machine name for consistency
        return a.machine.localeCompare(b.machine)
      })

    return NextResponse.json({
      achievements: allAchievements,
      count: allAchievements.length
    })
  } catch (error) {
    console.error('Error fetching player achievements:', error)
    return NextResponse.json(
      { error: 'Failed to fetch achievements' },
      { status: 500 }
    )
  }
}