import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// GET - Fetch all player name mappings
export async function GET() {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
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

// POST - Add or update a mapping (admin only)
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request)
    if (!auth.ok) return auth.response

    const { alias, canonical_name } = await request.json()

    if (!alias || !canonical_name) {
      return NextResponse.json(
        { error: 'alias and canonical_name are required' },
        { status: 400 }
      )
    }

    // The canonical is the display name we control, so normalize its whitespace
    // (trim + collapse runs). A trailing/leading space here is invisible in the
    // UI and produces look-alike duplicate/cycle mappings. The alias is left
    // exactly as given — it must match the raw data spelling to have any effect.
    const cleanCanonical = String(canonical_name).replace(/\s+/g, ' ').trim()
    if (!cleanCanonical) {
      return NextResponse.json({ error: 'canonical_name is empty' }, { status: 400 })
    }
    // alias already equals the cleaned canonical → nothing to standardize; skip
    // rather than store a self-mapping.
    if (alias === cleanCanonical) {
      return NextResponse.json({ mapping: null, skipped: true })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { data, error } = await (supabase
      .from('player_name_mappings') as any)
      .upsert({ alias, canonical_name: cleanCanonical }, { onConflict: 'alias' })
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

// DELETE - Remove a mapping by alias (admin only)
export async function DELETE(request: Request) {
  try {
    const auth = await requireAdmin(request)
    if (!auth.ok) return auth.response

    const { alias } = await request.json()

    if (!alias) {
      return NextResponse.json({ error: 'alias is required' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
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
