import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic';

interface PlayerData {
  player_name: string
  player_key: string
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const playerName = searchParams.get('playerName')

    if (!playerName) {
      return NextResponse.json(
        { error: 'playerName parameter is required' },
        { status: 400 }
      )
    }

    // Check if this player name exists in player_stats (TWC data)
    const { data, error } = await supabase
      .from('player_stats')
      .select('player_name, player_key')
      .eq('player_name', playerName)
      .limit(1)
      .maybeSingle()

    if (error || !data) {
      return NextResponse.json({
        exists: false,
        playerName: null,
        playerKey: null
      })
    }

    const playerData = data as PlayerData

    return NextResponse.json({
      exists: true,
      playerName: playerData.player_name,
      playerKey: playerData.player_key
    })
  } catch (error) {
    console.error('Error verifying player:', error)
    return NextResponse.json(
      { error: 'Failed to verify player' },
      { status: 500 }
    )
  }
}
