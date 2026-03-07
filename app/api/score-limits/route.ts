import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// GET - Fetch all score limits
export async function GET() {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data, error } = await supabase
      .from('score_limits')
      .select('machine, max_score')

    if (error) {
      // Table might not exist yet
      if (error.code === '42P01') {
        return NextResponse.json({ limits: {} })
      }
      console.error('[score-limits] Error fetching:', error)
      return NextResponse.json({ error: 'Failed to fetch score limits' }, { status: 500 })
    }

    // Convert to {machine: max_score} format
    const limits: Record<string, number> = {}
    for (const row of data || []) {
      limits[row.machine.toLowerCase()] = row.max_score
    }

    return NextResponse.json({ limits })
  } catch (error) {
    console.error('[score-limits] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Save score limits
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { limits } = body as { limits: Record<string, number> }

    if (!limits || typeof limits !== 'object') {
      return NextResponse.json({ error: 'Invalid limits format' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Delete all existing limits and insert new ones
    const { error: deleteError } = await supabase
      .from('score_limits')
      .delete()
      .neq('machine', '') // Delete all rows

    if (deleteError && deleteError.code !== '42P01') {
      console.error('[score-limits] Error deleting:', deleteError)
    }

    // Insert new limits
    const rows = Object.entries(limits).map(([machine, max_score]) => ({
      machine: machine.toLowerCase(),
      max_score
    }))

    if (rows.length > 0) {
      const { error: insertError } = await supabase
        .from('score_limits')
        .insert(rows)

      if (insertError) {
        console.error('[score-limits] Error inserting:', insertError)
        return NextResponse.json({ error: 'Failed to save score limits' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true, count: rows.length })
  } catch (error) {
    console.error('[score-limits] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
