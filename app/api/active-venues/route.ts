export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { fetchMNPText } from '@/lib/fetch-mnp-text'
import { fetchMNPData } from '@/lib/fetch-mnp-data'
import { createClient } from '@supabase/supabase-js'
import { applyVenueMachineListOverrides } from '@/lib/venue-machine-lists'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

/**
 * Parse venues.csv into a set of venue keys.
 * CSV format: KEY,Name (one per line)
 * Uses keys to match against venues.json since names may differ
 * (e.g., CSV has "Waterland Arcade" but venues.json has "Waterland").
 */
function parseVenuesCsvKeys(csv: string): Set<string> {
  const keys = new Set<string>()

  for (const line of csv.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const commaIdx = trimmed.indexOf(',')
    if (commaIdx === -1) continue

    const key = trimmed.substring(0, commaIdx).trim()

    // Skip placeholder entries
    if (key === 'TBD' || key === 'NAV' || !key) continue

    keys.add(key)
  }

  return keys
}

export async function GET() {
  try {
    // 1. Fetch current season's venues.csv from GitHub (use keys for matching)
    const csvText = await fetchMNPText('season-23/venues.csv')
    const csvKeys = parseVenuesCsvKeys(csvText)

    // 2. Fetch full venues.json for machine lists and metadata
    const venuesObj = await fetchMNPData('venues.json')

    // 3. Fetch overrides from Supabase (stored by venue name from venues.json)
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { data: overrides } = await supabase
      .from('active_venue_overrides')
      .select('venue_name, action') as { data: Array<{ venue_name: string; action: string }> | null }

    const addedVenues = new Set<string>()
    const removedVenues = new Set<string>()

    if (overrides) {
      for (const o of overrides) {
        if (o.action === 'add') addedVenues.add(o.venue_name)
        if (o.action === 'remove') removedVenues.add(o.venue_name)
      }
    }

    // 4. Filter venues.json by CSV keys, then apply overrides
    const venues = Object.values(venuesObj)
      .filter((v: any) => v.name !== 'No Available Venue')
      .map((v: any) => ({
        key: v.key,
        name: v.name,
        address: v.address || '',
        neighborhood: v.neighborhood || '',
        machines: applyVenueMachineListOverrides(v.name, v.machines || [])
      }))
      .filter((v: any) => {
        // Removed by user override
        if (removedVenues.has(v.name)) return false
        // In CSV or added by user override
        return csvKeys.has(v.key) || addedVenues.has(v.name)
      })
      .sort((a: any, b: any) => a.name.localeCompare(b.name))

    return NextResponse.json({ venues })
  } catch (error) {
    console.error('Error loading active venues:', error)
    return NextResponse.json(
      { error: 'Failed to load active venues' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { venue_name, action } = body

    if (!venue_name || !['add', 'remove'].includes(action)) {
      return NextResponse.json(
        { error: 'Required: venue_name and action (add/remove)' },
        { status: 400 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    // Upsert the override
    const { error } = await (supabase
      .from('active_venue_overrides') as any)
      .upsert(
        { venue_name, action },
        { onConflict: 'venue_name' }
      )

    if (error) {
      console.error('Error saving venue override:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error in active-venues POST:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to save venue override' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json()
    const { venue_name } = body

    if (!venue_name) {
      return NextResponse.json(
        { error: 'Required: venue_name' },
        { status: 400 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    // Remove the override entirely (revert to CSV default)
    const { error } = await (supabase
      .from('active_venue_overrides') as any)
      .delete()
      .eq('venue_name', venue_name)

    if (error) {
      console.error('Error deleting venue override:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error in active-venues DELETE:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete venue override' },
      { status: 500 }
    )
  }
}
