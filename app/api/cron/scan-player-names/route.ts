import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { computeNameIssues } from '@/lib/player-name-issues'

// Weekly Vercel Cron: rescans for player-name inconsistencies and refreshes the
// player_name_issues cache so the Options badge reflects the latest state.
// Scheduled Mondays (see vercel.json).

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET(request: Request) {
  // Verify cron secret (same pattern as the other cron routes).
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey)
    const issues = await computeNameIssues(supabase)
    const scannedAt = new Date().toISOString()

    try {
      await supabase.from('player_name_issues').delete().neq('normalized_name', '__never__')
      if (issues.length > 0) {
        await supabase.from('player_name_issues').insert(
          issues.map((i) => ({
            normalized_name: i.normalized_name,
            variants: i.variants,
            suggested_canonical: i.suggested_canonical,
            issue_type: i.issue_type,
            player_key: i.player_key,
            scanned_at: scannedAt,
          }))
        )
      }
    } catch (e) {
      console.error('[cron/scan-player-names] cache write failed (table missing?):', e)
    }

    const actionable = issues.filter((i) => i.issue_type === 'case').length
    console.log(`[cron/scan-player-names] ${issues.length} issues (${actionable} actionable)`)
    return NextResponse.json({ success: true, total: issues.length, actionable, scannedAt })
  } catch (error) {
    console.error('[cron/scan-player-names] error:', error)
    return NextResponse.json({ error: 'Scan failed' }, { status: 500 })
  }
}
