import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth'
import { revertKeyMapping } from '@/lib/apply-key-mappings'

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// GET - all key merges (from_key -> to_key)
export async function GET() {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { data, error } = await supabase
      .from('player_key_mappings')
      .select('*')
      .order('display_name', { ascending: true })
    if (error) {
      // Table may not exist yet — fail soft so the dialog still works.
      return NextResponse.json({ mappings: [], needsMigration: true })
    }
    return NextResponse.json({ mappings: data || [] })
  } catch (error) {
    console.error('Error fetching key mappings:', error)
    return NextResponse.json({ error: 'Failed to fetch key mappings' }, { status: 500 })
  }
}

// POST - add/update a key merge (admin)
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request)
    if (!auth.ok) return auth.response

    const { from_key, to_key, display_name } = await request.json()
    if (!from_key || !to_key) {
      return NextResponse.json({ error: 'from_key and to_key are required' }, { status: 400 })
    }
    if (from_key === to_key) {
      return NextResponse.json({ error: 'from_key and to_key must differ' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { data, error } = await (supabase.from('player_key_mappings') as any)
      .upsert({ from_key, to_key, display_name: display_name ?? null }, { onConflict: 'from_key' })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ mapping: data })
  } catch (error) {
    console.error('Error saving key mapping:', error)
    return NextResponse.json({ error: 'Failed to save key mapping' }, { status: 500 })
  }
}

// DELETE - undo a key merge by from_key (admin). Surgically restores the rows
// this merge rewrote (using the recorded affected_ids) back to from_key, then
// removes the mapping so the nightly sync won't re-apply it. No full resync
// needed — see lib/apply-key-mappings.ts.
export async function DELETE(request: Request) {
  try {
    const auth = await requireAdmin(request)
    if (!auth.ok) return auth.response

    const { from_key } = await request.json()
    if (!from_key) return NextResponse.json({ error: 'from_key is required' }, { status: 400 })

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Look up the merge so we know what to reverse before deleting it.
    const { data: row } = await supabase
      .from('player_key_mappings')
      .select('from_key, to_key, affected_ids')
      .eq('from_key', from_key)
      .maybeSingle()

    let restored = 0
    if (row) {
      restored = await revertKeyMapping(supabase, row.from_key, row.to_key, row.affected_ids)
    }

    const { error } = await supabase.from('player_key_mappings').delete().eq('from_key', from_key)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, restored })
  } catch (error) {
    console.error('Error deleting key mapping:', error)
    return NextResponse.json({ error: 'Failed to delete key mapping' }, { status: 500 })
  }
}
