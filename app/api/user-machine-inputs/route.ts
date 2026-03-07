import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAllMachineVariations, getMachineVariations, getCanonicalMachineKey } from '@/lib/machine-mappings'

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET(request: Request) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { searchParams } = new URL(request.url)

    // Debug: dump all inputs for a player (no machine/venue filter)
    const debugPlayer = searchParams.get('debugPlayer')
    if (debugPlayer) {
      const { data, error } = await supabase
        .from('user_machine_inputs')
        .select('*')
        .eq('player_name', debugPlayer)

      if (error) {
        console.error('Debug query error:', error)
        return NextResponse.json({ error: 'Database error', details: error }, { status: 500 })
      }
      return NextResponse.json({ debugData: data, count: data?.length || 0 })
    }

    // Single player+machine lookup (for machine page)
    const player = searchParams.get('player')
    const machine = searchParams.get('machine')

    const venue = searchParams.get('venue')

    if (player && machine) {
      // Use variations for inclusive matching (handles different stored formats)
      const machineVariations = getMachineVariations(machine)
      let query = supabase
        .from('user_machine_inputs')
        .select('user_average, user_confidence, updated_at')
        .eq('player_name', player)
        .in('machine', machineVariations)

      if (venue) {
        query = query.in('venue', [venue, ''])
      }

      // Prefer venue-specific row; fall back to legacy row with empty venue
      const { data, error } = await query.order('venue', { ascending: false }).limit(1).single()

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows found, which is fine
        console.error('Error fetching user input:', error)
        return NextResponse.json({ error: 'Database error' }, { status: 500 })
      }

      return NextResponse.json({
        input: data ? {
          userAverage: data.user_average,
          userConfidence: data.user_confidence,
          updatedAt: data.updated_at,
        } : null
      })
    }

    // Bulk lookup (for strategy page)
    const playerNamesParam = searchParams.get('playerNames')
    const machinesParam = searchParams.get('machines')

    if (!playerNamesParam || !machinesParam) {
      return NextResponse.json(
        { error: 'Either player+machine or playerNames+machines required' },
        { status: 400 }
      )
    }

    const playerNames = playerNamesParam.split(',').map(n => n.trim())
    const machines = machinesParam.split(',').map(n => n.trim())
    const machineVariations = getAllMachineVariations(machines)

    let bulkQuery = supabase
      .from('user_machine_inputs')
      .select('player_name, machine, user_average, user_confidence')
      .in('player_name', playerNames)
      .in('machine', machineVariations)

    if (venue) {
      bulkQuery = bulkQuery.in('venue', [venue, ''])
    }

    const { data, error } = await bulkQuery

    if (error) {
      console.error('Error fetching user inputs:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Build nested map: { [player]: { [machine]: { userAverage, userConfidence } } }
    const inputs: Record<string, Record<string, { userAverage: number | null; userConfidence: number | null }>> = {}

    for (const row of data || []) {
      // Normalize stored machine name to canonical key for matching
      const canonical = getCanonicalMachineKey(row.machine)
      const machineKey = machines.includes(canonical) ? canonical
        : machines.find(m => m.toLowerCase() === canonical.toLowerCase()) || canonical
      if (!inputs[row.player_name]) {
        inputs[row.player_name] = {}
      }
      inputs[row.player_name][machineKey] = {
        userAverage: row.user_average,
        userConfidence: row.user_confidence,
      }
    }

    return NextResponse.json({ inputs })
  } catch (error) {
    console.error('Error in user-machine-inputs API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
