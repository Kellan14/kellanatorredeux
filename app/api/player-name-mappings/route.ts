import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET - Fetch all player name mappings
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('player_name_mappings')
      .select('*')
      .order('alias', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ mappings: data || [] })
  } catch (error) {
    console.error('Error fetching player name mappings:', error)
    return NextResponse.json({ error: 'Failed to fetch mappings' }, { status: 500 })
  }
}

// POST - Add or update a mapping
export async function POST(request: Request) {
  try {
    const { alias, canonical_name } = await request.json()

    if (!alias || !canonical_name) {
      return NextResponse.json(
        { error: 'alias and canonical_name are required' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('player_name_mappings')
      .upsert({ alias, canonical_name }, { onConflict: 'alias' })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ mapping: data })
  } catch (error) {
    console.error('Error saving player name mapping:', error)
    return NextResponse.json({ error: 'Failed to save mapping' }, { status: 500 })
  }
}

// DELETE - Remove a mapping by alias
export async function DELETE(request: Request) {
  try {
    const { alias } = await request.json()

    if (!alias) {
      return NextResponse.json({ error: 'alias is required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('player_name_mappings')
      .delete()
      .eq('alias', alias)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting player name mapping:', error)
    return NextResponse.json({ error: 'Failed to delete mapping' }, { status: 500 })
  }
}
