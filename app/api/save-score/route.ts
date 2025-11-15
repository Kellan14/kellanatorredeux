import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function POST(request: Request) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const body = await request.json()
    const { machine, score, venue, playerName, userId } = body

    if (!machine || !score || !venue || !playerName || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Insert the score into Supabase
    const { data, error } = await supabase
      .from('user_machine_scores')
      .insert([
        {
          user_id: userId,
          player_name: playerName,
          machine,
          score,
          venue,
          played_at: new Date().toISOString(),
          include_in_calculations: true, // Default to true, can be toggled later
        },
      ])
      .select()

    if (error) {
      console.error('Error saving score:', error)
      return NextResponse.json(
        { error: 'Failed to save score' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('Error in save-score API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
