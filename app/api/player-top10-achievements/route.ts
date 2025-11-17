import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic';

// Cache for 1 hour since stats only update weekly
export const revalidate = 3600

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const playerName = searchParams.get('player')
    const seasonFilter = searchParams.get('season') // 'current' or 'alltime'

    if (!playerName) {
      return NextResponse.json(
        { error: 'Player parameter is required' },
        { status: 400 }
      )
    }

    // Determine which seasons to include
    const currentSeason = 22
    let seasonQuery = seasonFilter === 'current'
      ? `season.eq.${currentSeason}`
      : `season.gte.20,season.lte.22`

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

    // Get ALL games (for calculating top 10 lists)
    let allGamesQuery = supabase
      .from('games')
      .select('machine, venue, player_1_key, player_1_name, player_1_score, player_2_key, player_2_name, player_2_score, player_3_key, player_3_name, player_3_score, player_4_key, player_4_name, player_4_score, season')

    if (seasonFilter === 'current') {
      allGamesQuery = allGamesQuery.eq('season', currentSeason)
    } else {
      allGamesQuery = allGamesQuery.gte('season', 20).lte('season', 22)
    }

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
      return NextResponse.json({ error: error.message }, { status: 500 })
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
        if (s.key && s.name && s.score != null) {
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

    // Find achievements: where player has a top 10 score
    const achievements: Array<{
      machine: string
      context: string
      venue?: string
      rank: number
      score: number
      isVenueSpecific: boolean
    }> = []

    // Check league-wide top 10
    for (const [machine, scores] of machineScores.entries()) {
      // Sort scores descending and get unique top scores
      const sortedScores = scores
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)

      // Check if player is in top 10
      const playerEntry = sortedScores.find(s => s.playerKey === playerKey)
      if (playerEntry) {
        const rank = sortedScores.findIndex(s => s.playerKey === playerKey && s.score === playerEntry.score) + 1
        achievements.push({
          machine,
          context: 'League-wide',
          rank,
          score: playerEntry.score,
          isVenueSpecific: false
        })
      }
    }

    // Check venue-specific top 10
    for (const [venueKey, scores] of venueScores.entries()) {
      const [machine, venue] = venueKey.split('|||')

      // Sort scores descending and get top 10
      const sortedScores = scores
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)

      // Check if player is in top 10
      const playerEntry = sortedScores.find(s => s.playerKey === playerKey)
      if (playerEntry) {
        const rank = sortedScores.findIndex(s => s.playerKey === playerKey && s.score === playerEntry.score) + 1

        // Only add if not already added as league-wide for same machine
        // Or add with venue context
        achievements.push({
          machine,
          context: `${machine} at ${venue}`,
          venue,
          rank,
          score: playerEntry.score,
          isVenueSpecific: true
        })
      }
    }

    // Sort achievements by score descending
    achievements.sort((a, b) => b.score - a.score)

    return NextResponse.json({
      achievements,
      count: achievements.length
    })
  } catch (error) {
    console.error('Error fetching player achievements:', error)
    return NextResponse.json(
      { error: 'Failed to fetch achievements' },
      { status: 500 }
    )
  }
}
