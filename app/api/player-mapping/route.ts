import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const uid = searchParams.get('uid')

    if (!uid) {
      return NextResponse.json(
        { error: 'UID is required' },
        { status: 400 }
      )
    }

    // Create Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Check the profiles table for the player_name
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('player_name')
      .eq('id', uid)
      .single()

    if (error || !profile?.player_name) {
      return NextResponse.json(
        { error: 'Player mapping not found for this UID' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      uid: uid,
      name: profile.player_name,
      team: 'TWC' // Default team for now
    })
  } catch (error) {
    console.error('Error fetching player mapping:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player mapping' },
      { status: 500 }
    )
  }
}
