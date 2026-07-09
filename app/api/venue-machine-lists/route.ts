import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export interface VenueMachineList {
  included?: string[]
  excluded?: string[]
}

export interface VenueMachineLists {
  [venueName: string]: VenueMachineList
}

export async function GET() {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    // Fetch all venue machine lists from Supabase
    const { data, error } = await supabase
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
    const auth = await requireAdmin(request)
    if (!auth.ok) return auth.response

    const { venueName, included, excluded } = await request.json()

    if (!venueName) {
      return NextResponse.json(
        { error: 'Venue name is required' },
        { status: 400 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    // Upsert (insert or update) the venue machine list
    const { data, error } = await supabase
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
    const { data: allLists } = await supabase
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
