import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const player = searchParams.get('player')
    const venue = searchParams.get('venue')
    const seasonStart = parseInt(searchParams.get('seasonStart') || '20')
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '22')
    const allVenues = searchParams.get('allVenues') === 'true'

    if (!player) {
      return NextResponse.json(
        { error: 'Player parameter is required' },
        { status: 400 }
      )
    }

    // Query matches from database
    let query = supabase
      .from('matches')
      .select('data, venue_name')
      .gte('season', seasonStart)
      .lte('season', seasonEnd)

    if (!allVenues && venue) {
      query = query.eq('venue_name', venue)
    }

    const { data: matches, error } = await query

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Find player's key
    let playerKey = ''
    for (const match of matches || []) {
      const homePlayer = match.data.home?.lineup?.find((p: any) => p.name === player)
      const awayPlayer = match.data.away?.lineup?.find((p: any) => p.name === player)
      if (homePlayer) playerKey = homePlayer.key
      if (awayPlayer) playerKey = awayPlayer.key
      if (playerKey) break
    }

    if (!playerKey) {
      return NextResponse.json({
        player,
        totalGames: 0,
        uniqueMachines: 0,
        venuesPlayed: 0,
        machinePerformance: [],
        allVenues
      })
    }

    // Analyze performance
    const machineStats = new Map()
    const venuesSet = new Set()
    let totalGames = 0

    for (const match of matches || []) {
      if (match.venue_name) venuesSet.add(match.venue_name)

      const rounds = match.data.rounds || []
      for (const round of rounds) {
        for (const game of round.games || []) {
          const playerPosition = ['player_1', 'player_2', 'player_3', 'player_4']
            .find(pos => game[pos] === playerKey)

          if (playerPosition) {
            const posNum = playerPosition.split('_')[1]
            const machine = game.machine
            const points = game[`points_${posNum}`] || 0
            const score = game[`score_${posNum}`] || 0

            if (!machineStats.has(machine)) {
              machineStats.set(machine, {
                machine,
                gamesPlayed: 0,
                totalPoints: 0,
                avgPoints: 0,
                bestScore: 0
              })
            }

            const stats = machineStats.get(machine)
            stats.gamesPlayed++
            stats.totalPoints += points
            stats.bestScore = Math.max(stats.bestScore, score)
            totalGames++
          }
        }
      }
    }

    const machinePerformance = Array.from(machineStats.values()).map(stats => ({
      ...stats,
      avgPoints: stats.totalPoints / stats.gamesPlayed
    })).sort((a, b) => b.avgPoints - a.avgPoints)

    return NextResponse.json({
      player,
      totalGames,
      uniqueMachines: machineStats.size,
      venuesPlayed: venuesSet.size,
      machinePerformance,
      allVenues
    })
  } catch (error) {
    console.error('Error fetching player analysis:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player analysis' },
      { status: 500 }
    )
  }
}
