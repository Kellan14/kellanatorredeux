import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const team = searchParams.get('team')
    const season = searchParams.get('season') || '22'
    const showSubs = searchParams.get('showSubs') === 'true'

    if (!team) {
      return NextResponse.json(
        { error: 'Team parameter is required' },
        { status: 400 }
      )
    }

    // Query player stats for this team
    const { data, error } = await supabase
      .from('player_stats')
      .select('*')
      .eq('season', parseInt(season))
      .eq('team', team)
      .order('ipr', { ascending: false })

    if (error) {
      console.error('Database error:', error)
      return NextResponse.json({
        players: []
      })
    }

    // Format the response
    const players = ((data as any[]) || []).map((p: any) => ({
      name: p.player_name,
      key: p.player_key,
      ipr: p.ipr,
      matchesPlayed: p.matches_played,
      sub: false // We can enhance this later if needed
    }))

    return NextResponse.json({
      players: players
    })
  } catch (error) {
    console.error('Error fetching team roster:', error)
    return NextResponse.json(
      { error: 'Failed to fetch team roster' },
      { status: 500 }
    )
  }
}
