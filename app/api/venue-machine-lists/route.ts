import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic';

export interface VenueMachineList {
  included?: string[]
  excluded?: string[]
}

export interface VenueMachineLists {
  [venueName: string]: VenueMachineList
}

export async function GET() {
  try {
    // Fetch all venue machine lists from Supabase
    const { data, error } = await (supabase as any)
      .from('venue_machine_lists')
      .select('venue_name, included, excluded')

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ lists: {} })
    }

    // Transform array into object keyed by venue name
    const lists: VenueMachineLists = {}
    if (data) {
      data.forEach((row: any) => {
        const venueKey = row.venue_name.toLowerCase()
        lists[venueKey] = {
          included: row.included || [],
          excluded: row.excluded || []
        }
      })
    }

    return NextResponse.json({ lists })
  } catch (error) {
    console.error('Error reading venue machine lists:', error)
    return NextResponse.json({ lists: {} })
  }
}

export async function POST(request: Request) {
  try {
    const { venueName, included, excluded } = await request.json()

    if (!venueName) {
      return NextResponse.json(
        { error: 'Venue name is required' },
        { status: 400 }
      )
    }

    // Upsert (insert or update) the venue machine list
    const { data, error } = await (supabase as any)
      .from('venue_machine_lists')
      .upsert({
        venue_name: venueName,
        included: included || [],
        excluded: excluded || [],
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'venue_name'
      })
      .select()

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json(
        { error: 'Failed to update venue machine lists', details: error.message },
        { status: 500 }
      )
    }

    // Fetch all lists to return
    const { data: allLists } = await (supabase as any)
      .from('venue_machine_lists')
      .select('venue_name, included, excluded')

    const lists: VenueMachineLists = {}
    if (allLists) {
      allLists.forEach((row: any) => {
        const venueKey = row.venue_name.toLowerCase()
        lists[venueKey] = {
          included: row.included || [],
          excluded: row.excluded || []
        }
      })
    }

    return NextResponse.json({
      success: true,
      lists
    })
  } catch (error) {
    console.error('Error updating venue machine lists:', error)
    return NextResponse.json(
      { error: 'Failed to update venue machine lists' },
      { status: 500 }
    )
  }
}
