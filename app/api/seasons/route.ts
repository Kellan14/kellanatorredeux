import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Cache for 1 hour since seasons don't change often
export const revalidate = 3600

/**
 * Returns list of seasons that have game data in the database.
 * Uses fetchAllRecords to handle pagination properly.
 */
export async function GET() {
  try {
    // Fetch all matches with pagination to get all seasons
    const data = await fetchAllRecords<{ season: number }>(
      () => supabase
        .from('matches')
        .select('season')
        .order('season', { ascending: true })
    )

    // Get unique seasons
    const seasons = Array.from(new Set(data?.map(d => d.season) || []))
      .filter(s => s != null)
      .sort((a, b) => a - b)

    return NextResponse.json({
      seasons,
      min: seasons.length > 0 ? Math.min(...seasons) : null,
      max: seasons.length > 0 ? Math.max(...seasons) : null
    })
  } catch (error: any) {
    console.error('Error in seasons API:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch seasons' },
      { status: 500 }
    )
  }
}
