import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { refreshMachineIssues } from '@/lib/machine-name-issues'

// Weekly Vercel Cron: rescans every machine-keyed table against the canon and
// checks the MNP machine list for drift, refreshing machine_name_issues so the
// Options badge reflects the latest state. Scheduled Mondays (see vercel.json).

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
    const issues = await refreshMachineIssues(supabase)
    const scannedAt = new Date().toISOString()

    const actionable = issues.filter((i) => i.issue_type === 'unmapped').length
    const upstream = issues.filter((i) => i.issue_type.startsWith('upstream')).length
    console.log(
      `[cron/scan-machine-names] ${issues.length} issues (${actionable} unmapped, ${upstream} upstream drift)`
    )
    return NextResponse.json({ success: true, total: issues.length, actionable, upstream, scannedAt })
  } catch (error) {
    console.error('[cron/scan-machine-names] error:', error)
    return NextResponse.json({ error: 'Scan failed' }, { status: 500 })
  }
}
