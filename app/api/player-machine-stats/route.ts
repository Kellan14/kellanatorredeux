import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const player = searchParams.get('player')
    const machine = searchParams.get('machine')
    const venue = searchParams.get('venue') || ''
    const seasonStart = parseInt(searchParams.get('seasonStart') || '20')
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '22')

    if (!player || !machine) {
      return NextResponse.json(
        { error: 'Player and machine parameters are required' },
        { status: 400 }
      )
    }

    // Query matches from database
    let query = supabase
      .from('matches')
      .select('data, venue_name, match_key, week, season')
      .gte('season', seasonStart)
      .lte('season', seasonEnd)

    if (venue) {
      query = query.eq('venue_name', venue)
    }

    const { data: matches, error } = await query

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Find player's key
    let playerKey = ''
    for (const match of (matches as any[]) || []) {
      const homePlayer = match.data?.home?.lineup?.find((p: any) => p.name === player)
      const awayPlayer = match.data?.away?.lineup?.find((p: any) => p.name === player)
      if (homePlayer) playerKey = homePlayer.key
      if (awayPlayer) playerKey = awayPlayer.key
      if (playerKey) break
    }

    if (!playerKey) {
      return NextResponse.json({
        stats: [],
        message: 'Player not found in matches'
      })
    }

    // Find all games on this machine for this player
    const stats: any[] = []

    for (const match of (matches as any[]) || []) {
      const rounds = match.data.rounds || []
      for (const round of rounds) {
        for (const game of round.games || []) {
          if (game.machine === machine) {
            const playerPosition = ['player_1', 'player_2', 'player_3', 'player_4']
              .find(pos => game[pos] === playerKey)

            if (playerPosition) {
              const posNum = playerPosition.split('_')[1]
              stats.push({
                matchKey: match.match_key,
                week: match.week,
                season: match.season,
                venue: match.venue_name,
                score: game[`score_${posNum}`] || 0,
                points: game[`points_${posNum}`] || 0
              })
            }
          }
        }
      }
    }

    return NextResponse.json({
      stats,
      player,
      machine,
      totalGames: stats.length
    })
  } catch (error) {
    console.error('Error fetching player machine stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player machine stats' },
      { status: 500 }
    )
  }
}
