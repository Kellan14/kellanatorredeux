import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const player = searchParams.get('player')
    const venue = searchParams.get('venue') || ''
    const seasonStart = parseInt(searchParams.get('seasonStart') || '20')
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '22')

    if (!player) {
      return NextResponse.json(
        { error: 'Player parameter is required' },
        { status: 400 }
      )
    }

    // Get player's key from games table
    const { data: sampleGames } = await supabase
      .from('games')
      .select('player_1_key, player_1_name, player_2_key, player_2_name, player_3_key, player_3_name, player_4_key, player_4_name')
      .or(`player_1_name.eq.${player},player_2_name.eq.${player},player_3_name.eq.${player},player_4_name.eq.${player}`)
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
      if (game.player_1_name === player) playerKey = game.player_1_key
      else if (game.player_2_name === player) playerKey = game.player_2_key
      else if (game.player_3_name === player) playerKey = game.player_3_key
      else if (game.player_4_name === player) playerKey = game.player_4_name
    }

    if (!playerKey) {
      return NextResponse.json({
        counts: {},
        totalGames: 0
      })
    }

    // Query games with pagination
    let query = supabase
      .from('games')
      .select('machine, player_1_key, player_2_key, player_3_key, player_4_key')
      .gte('season', seasonStart)
      .lte('season', seasonEnd)
      .or(`player_1_key.eq.${playerKey},player_2_key.eq.${playerKey},player_3_key.eq.${playerKey},player_4_key.eq.${playerKey}`)

    if (venue) {
      query = query.eq('venue', venue)
    }

    let gamesData
    try {
      gamesData = await fetchAllRecords<{
        machine: string
        player_1_key: string | null
        player_2_key: string | null
        player_3_key: string | null
        player_4_key: string | null
      }>(query)
    } catch (error) {
      console.error('Error fetching games:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Count games per machine
    const counts: Record<string, number> = {}
    let totalGames = 0

    for (const game of gamesData) {
      const isPlayerGame =
        game.player_1_key === playerKey ||
        game.player_2_key === playerKey ||
        game.player_3_key === playerKey ||
        game.player_4_key === playerKey

      if (isPlayerGame) {
        counts[game.machine] = (counts[game.machine] || 0) + 1
        totalGames++
      }
    }

    return NextResponse.json({
      counts,
      totalGames
    })
  } catch (error) {
    console.error('Error fetching player machine counts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player machine counts' },
      { status: 500 }
    )
  }
}
