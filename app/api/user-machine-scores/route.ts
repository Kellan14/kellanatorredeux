import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getMachineVariations } from '@/lib/machine-mappings'

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const player = searchParams.get('player')
    const machine = searchParams.get('machine')

    if (!player || !machine) {
      return NextResponse.json(
        { error: 'Player and machine parameters are required' },
        { status: 400 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get all machine name variations for case-insensitive matching
    const machineVariations = getMachineVariations(machine)

    const { data, error } = await supabase
      .from('user_machine_scores')
      .select('*')
      .eq('player_name', player)
      .in('machine', machineVariations)
      .order('score', { ascending: false })

    if (error) {
      console.error('Error fetching user scores:', error)
      return NextResponse.json(
        { error: 'Failed to fetch scores' },
        { status: 500 }
      )
    }

    return NextResponse.json({ scores: data || [] })
  } catch (error) {
    console.error('Error in user-machine-scores API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
