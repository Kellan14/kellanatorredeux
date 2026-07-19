import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { computeNameIssues, type NameIssue } from '@/lib/player-name-issues'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Player-name standardization scanner.
 *
 * GET                 → read the cached scan results (cheap; used by the badge).
 * GET ?refresh=true   → recompute from the identity tables, replace the cache,
 *                       and return (used by the dialog and the weekly cron).
 *
 * Results are cached in `player_name_issues` so the nav badge can read a count
 * without rescanning tens of thousands of rows on every page load.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const refresh = searchParams.get('refresh') === 'true'
  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    if (!refresh) {
      const { data, error } = await supabase
        .from('player_name_issues')
        .select('normalized_name, variants, suggested_canonical, issue_type, player_key, scanned_at')
        .order('issue_type', { ascending: true })
        .order('normalized_name', { ascending: true })

      if (error) {
        // Table may not exist yet (migration not run). Fail soft.
        return NextResponse.json({ issues: [], count: 0, actionableCount: 0, scannedAt: null, needsMigration: true })
      }
      return NextResponse.json(formatResponse(data || [], (data && data[0]?.scanned_at) || null))
    }

    // Recompute and replace the cache.
    const issues = await computeNameIssues(supabase)
    const scannedAt = new Date().toISOString()

    // Replace cache contents (best-effort; ignore if table absent).
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
    } catch {
      /* table missing — still return the freshly computed issues */
    }

    return NextResponse.json(formatResponse(issues, scannedAt))
  } catch (error) {
    console.error('Error scanning player name issues:', error)
    return NextResponse.json({ error: 'Failed to scan player name issues' }, { status: 500 })
  }
}

function formatResponse(issues: NameIssue[], scannedAt: string | null) {
  const actionableCount = issues.filter((i) => i.issue_type === 'case').length
  return {
    issues,
    count: issues.length,
    actionableCount, // 'case' issues that Fix All resolves
    scannedAt,
  }
}
