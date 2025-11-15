import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

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

    // Query all matches to find player's top performances
    const { data: matches, error } = await supabase
      .from('matches')
      .select('data, season, week')

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Find player's key
    let playerKey = ''
    for (const match of matches || []) {
      const homePlayer = match.data.home?.lineup?.find((p: any) => p.name === playerName)
      const awayPlayer = match.data.away?.lineup?.find((p: any) => p.name === playerName)
      if (homePlayer) playerKey = homePlayer.key
      if (awayPlayer) playerKey = awayPlayer.key
      if (playerKey) break
    }

    if (!playerKey) {
      return NextResponse.json({ achievements: [] })
    }

    // Collect all player's game performances
    const performances: any[] = []

    for (const match of matches || []) {
      const rounds = match.data.rounds || []

      for (const round of rounds) {
        for (const game of round.games || []) {
          const playerPosition = ['player_1', 'player_2', 'player_3', 'player_4']
            .find(pos => game[pos] === playerKey)

          if (playerPosition) {
            const posNum = playerPosition.split('_')[1]
            performances.push({
              machine: game.machine,
              score: game[`score_${posNum}`] || 0,
              points: game[`points_${posNum}`] || 0,
              season: match.season,
              week: match.week,
              venue: match.data.venue?.name
            })
          }
        }
      }
    }

    // Sort by score and get top 10
    const top10 = performances
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((perf, index) => ({
        rank: index + 1,
        machine: perf.machine,
        score: perf.score,
        points: perf.points,
        season: perf.season,
        week: perf.week,
        venue: perf.venue
      }))

    return NextResponse.json({
      achievements: top10
    })
  } catch (error) {
    console.error('Error fetching player achievements:', error)
    return NextResponse.json(
      { error: 'Failed to fetch achievements' },
      { status: 500 }
    )
  }
}
