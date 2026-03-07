import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCanonicalMachineKey, getMachineVariations } from '@/lib/machine-mappings'

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function POST(request: Request) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const body = await request.json()
    const { machine, venue, playerName, userId, userAverage, userConfidence, clear } = body

    if (!machine || !venue || !playerName || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields: machine, venue, playerName, userId' },
        { status: 400 }
      )
    }

    // Normalize machine name to canonical key for consistent storage
    const canonicalMachine = getCanonicalMachineKey(machine)

    // Handle clear request — delete the row (use variations to match any stored format)
    if (clear) {
      const machineVariations = getMachineVariations(machine)
      const { error } = await supabase
        .from('user_machine_inputs')
        .delete()
        .eq('player_name', playerName)
        .in('machine', machineVariations)
        .eq('venue', venue)

      if (error) {
        console.error('Error clearing user input:', error)
        return NextResponse.json({ error: 'Failed to clear user input' }, { status: 500 })
      }
      return NextResponse.json({ success: true, cleared: true })
    }

    // At least one field must be explicitly present in the request (even if null to clear)
    if (!('userAverage' in body) && !('userConfidence' in body)) {
      return NextResponse.json(
        { error: 'At least one of userAverage or userConfidence must be provided' },
        { status: 400 }
      )
    }

    // Build the update object with only provided fields (null clears the field)
    const updateFields: Record<string, any> = {
      user_id: userId,
      updated_at: new Date().toISOString(),
    }
    if ('userAverage' in body) updateFields.user_average = userAverage
    if ('userConfidence' in body) updateFields.user_confidence = userConfidence

    // Upsert: insert or update on conflict (player_name, machine, venue)
    // Use canonical machine key for consistent storage
    const { data, error } = await supabase
      .from('user_machine_inputs')
      .upsert(
        {
          user_id: userId,
          player_name: playerName,
          machine: canonicalMachine,
          venue,
          ...updateFields,
        },
        { onConflict: 'player_name,machine,venue' }
      )
      .select()

    if (error) {
      console.error('Error saving user input:', error)
      return NextResponse.json(
        { error: 'Failed to save user input' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('Error in save-user-input API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
