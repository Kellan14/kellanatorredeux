import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth'
import { applyKeyMapping } from '@/lib/apply-key-mappings'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

/**
 * Apply player-key merges to the database immediately (admin).
 * Body: { mappings: [{ from_key, to_key }] }  OR  { from_key, to_key }.
 * Also usable to re-apply all stored merges when body is omitted.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request)
    if (!auth.ok) return auth.response

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const body = await request.json().catch(() => ({}))

    // Resolve the list of merges to apply.
    let merges: { from_key: string; to_key: string }[] = []
    if (Array.isArray(body.mappings)) {
      merges = body.mappings
    } else if (body.from_key && body.to_key) {
      merges = [{ from_key: body.from_key, to_key: body.to_key }]
    } else {
      // No body → apply every stored merge.
      const { data } = await supabase.from('player_key_mappings').select('from_key, to_key')
      merges = data || []
    }

    let totalUpdated = 0
    const results: { from_key: string; to_key: string; updated: number }[] = []
    for (const m of merges) {
      if (!m.from_key || !m.to_key) continue
      const updated = await applyKeyMapping(supabase, m.from_key, m.to_key)
      totalUpdated += updated
      results.push({ from_key: m.from_key, to_key: m.to_key, updated })
    }

    return NextResponse.json({ success: true, totalUpdated, results })
  } catch (error) {
    console.error('Error applying player key merges:', error)
    return NextResponse.json({ error: 'Failed to apply key merges' }, { status: 500 })
  }
}
