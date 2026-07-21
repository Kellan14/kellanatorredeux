import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser, isAdminUser } from '@/lib/auth'
import { healEdits, checkCoverage, getDbSeasons } from '@/lib/integrity'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

/**
 * Data-integrity check.
 *
 * GET ?read=true          → return the latest stored report (public; badge/UI).
 * GET ?scope=current|full → run a check (auto-heal + archive reconcile), store a
 *                           report, and return it. Auth: CRON_SECRET header (for
 *                           the Vercel crons) OR an admin session (manual button).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Cheap read for the badge / dialog.
  if (searchParams.get('read') === 'true') {
    const { data, error } = await supabase
      .from('integrity_reports')
      .select('*')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return NextResponse.json({ report: null, needsMigration: true })
    return NextResponse.json({ report: data || null })
  }

  // Authorize a run: cron secret header OR admin session.
  const authHeader = request.headers.get('authorization') || ''
  const isCron = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`
  let triggeredBy = 'cron'
  if (!isCron) {
    const user = await getSessionUser(request)
    if (!user || !isAdminUser(user)) {
      // Allow in local dev when no cron secret is configured.
      if (process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }
    triggeredBy = user?.email || 'manual'
  }

  const scope = searchParams.get('scope') === 'full' ? 'full' : 'current'

  try {
    // 1. Auto-heal: re-apply every recorded edit.
    const heal = await healEdits(supabase)

    // 2. Reconcile coverage against the GitHub archive.
    let seasons: number[]
    if (scope === 'full') {
      seasons = await getDbSeasons(supabase)
    } else {
      const { data: maxRow } = await supabase.from('games').select('season').order('season', { ascending: false }).limit(1)
      seasons = maxRow?.[0]?.season ? [maxRow[0].season] : []
    }
    const coverage = await checkCoverage(supabase, seasons)

    const duplicateTotal = coverage.duplicateGames.length
    // Missing/orphan/duplicates fail the check; gameless & unverified are informational.
    const ok = coverage.missingTotal === 0 && coverage.orphanTotal === 0 && duplicateTotal === 0

    // Columns that exist on integrity_reports (gameless & per-season source live
    // inside the `seasons` JSONB, so no schema change is needed).
    const report = {
      scope: triggeredBy === 'cron' ? scope : 'manual',
      healed_names: heal.healedNames,
      healed_keys: heal.healedKeys,
      healed_sublinks: heal.healedSubLinks,
      missing_total: coverage.missingTotal,
      orphan_total: coverage.orphanTotal,
      duplicate_total: duplicateTotal,
      ok,
      seasons: coverage.seasons,
      missing: coverage.seasons.flatMap((s) => s.missing.map((m) => ({ season: s.season, match_key: m }))),
      orphan: coverage.seasons.flatMap((s) => s.orphan.map((o) => ({ season: s.season, match_key: o }))),
      duplicates: coverage.duplicateGames,
      triggered_by: triggeredBy,
      ran_at: new Date().toISOString(),
    }

    try {
      await supabase.from('integrity_reports').insert(report)
    } catch (e) {
      console.error('[integrity] failed to store report:', e)
    }

    console.log(`[integrity] scope=${scope} healed(${heal.healedNames}/${heal.healedKeys}/${heal.healedSubLinks}) missing=${coverage.missingTotal} orphan=${coverage.orphanTotal} gameless=${coverage.gamelessTotal} dup=${duplicateTotal}`)
    // gamelessTotal is returned for the UI but not stored as a column.
    return NextResponse.json({ success: true, report: { ...report, gameless_total: coverage.gamelessTotal } })
  } catch (error) {
    console.error('[integrity] error:', error)
    return NextResponse.json({ error: 'Integrity check failed' }, { status: 500 })
  }
}
