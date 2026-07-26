import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { refreshMachineIssues, type MachineIssue } from '@/lib/machine-name-issues'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Machine canon scanner. Mirrors /api/player-name-issues.
 *
 * GET               → read the cached scan (cheap; drives the Options badge).
 * GET ?refresh=true → rescan every machine-keyed table plus upstream drift,
 *                     replace the cache, and return.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const refresh = searchParams.get('refresh') === 'true'
    const supabase = createClient(supabaseUrl, supabaseKey)

    let issues: MachineIssue[]
    let scannedAt: string | null = null

    if (refresh) {
      issues = await refreshMachineIssues(supabase)
      scannedAt = new Date().toISOString()
    } else {
      const { data } = await supabase
        .from('machine_name_issues')
        .select('*')
        .order('occurrences', { ascending: false })
      issues = (data || []) as MachineIssue[]
      scannedAt = (data && data[0]?.scanned_at) || null
    }

    // Only 'unmapped' means data is unattributable; the rest are tidiness.
    const actionable = issues.filter((i) => i.issue_type === 'unmapped').length

    return NextResponse.json({
      issues,
      total: issues.length,
      actionable,
      scannedAt,
      byType: issues.reduce<Record<string, number>>((acc, i) => {
        acc[i.issue_type] = (acc[i.issue_type] || 0) + 1
        return acc
      }, {}),
    })
  } catch (error) {
    console.error('[machine-name-issues] Error:', error)
    return NextResponse.json({ error: 'Failed to scan machine names' }, { status: 500 })
  }
}
