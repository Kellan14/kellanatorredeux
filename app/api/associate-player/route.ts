import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { userId, playerName } = await request.json()

    if (!userId || !playerName) {
      return NextResponse.json(
        { error: 'userId and playerName are required' },
        { status: 400 }
      )
    }

    // Create admin client to update profiles
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Update the profile with the player_name
    const { data, error } = await supabase
      .from('profiles')
      .update({ player_name: playerName })
      .eq('id', userId)
      .select()
      .single()

    if (error) {
      console.error('Error associating player:', error)
      return NextResponse.json(
        { error: 'Failed to associate player' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      profile: data
    })
  } catch (error) {
    console.error('Error in associate-player:', error)
    return NextResponse.json(
      { error: 'Failed to associate player' },
      { status: 500 }
    )
  }
}
