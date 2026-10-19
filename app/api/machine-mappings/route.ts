import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth'
import {
  applyCanonChange,
  loadMnpMachines,
  officialChoice,
  syncMnpCanon,
  canonEditingReady,
} from '@/lib/manage-machine-canon'
import {
  planMnpSync,
  publishedIdentity,
  normalizeIdentity,
  type MachineIdentity,
} from '@/lib/machine-canon-plans'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Machine aliases: raw spelling -> canon key.
 *
 * This used to serve a 683-entry hand-maintained table from
 * lib/machine-mappings.ts. That table mapped both key->name and name->key, so
 * standardization had no single output space. Aliases now live in the
 * machine_aliases table and only cover spellings that cannot be reached by
 * normalizing or by matching a canon long form — see lib/machines-canon.ts.
 */
export async function GET() {
  try {
    const [aliases, upstreamResult, storedResult, history, editingReady] =
      await Promise.all([
        fetchAllRecords<{
          alias: string
          alias_raw: string | null
          canon_key: string
          origin: string
          reason: string | null
        }>(() =>
          supabase
            .from('machine_aliases')
            .select('alias, alias_raw, canon_key, origin, reason')
            .order('canon_key', { ascending: true }),
        ),
        loadMnpMachines(true)
          .then((rows) => ({ rows, error: null as string | null }))
          .catch((error) => ({ rows: [], error: error.message as string })),
        supabase
          .from('machine_canon')
          .select(
            'key,name,display_override,source,mnp_key,mnp_name,active,note',
          )
          .order('name'),
        fetchAllRecords<any>(() =>
          supabase
            .from('data_provenance')
            .select(
              'batch_id,applied_at,description,reason,source,rows_affected,details',
            )
            .in('category', ['machine_canon', 'machine_aliases'])
            .order('applied_at', { ascending: false })
            .order('id'),
        ),
        canonEditingReady(),
      ])

    if (storedResult.error) throw storedResult.error
    const storedMachines = (storedResult.data || []) as Array<
      MachineIdentity & { display_override: string | null }
    >
    return NextResponse.json({
      aliases,
      editingReady,
      count: aliases.length,
      upstream: upstreamResult.rows,
      upstreamError: upstreamResult.error,
      syncPlan: planMnpSync(upstreamResult.rows, storedMachines),
      history,
      machines: storedMachines.map((m) => ({
        key: m.key,
        name: m.name,
        displayName: m.display_override || m.name,
        source: m.source,
      })),
      note: 'Aliases live in machine_aliases; the canon lives in machine_canon. Most spellings resolve without one.',
    })
  } catch (error) {
    console.error('Error in GET /api/machine-mappings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch machine aliases' },
      { status: 500 },
    )
  }
}

const EDIT_HINT = {
  error:
    'Use POST to create provisional canon entries, combine selected spellings, or adopt MNP names. Canon deletion is not supported.',
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if (!auth.ok) return auth.response
  try {
    const body = await request.json()
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    if (body.action === 'sync')
      return NextResponse.json(await syncMnpCanon(client, auth.user.id))
    if (
      !Array.isArray(body.rawValues) ||
      body.rawValues.length > 200 ||
      body.rawValues.some(
        (v: unknown) => typeof v !== 'string' || v.length > 200,
      ) ||
      typeof body.reason !== 'string' ||
      !body.reason.trim() ||
      body.reason.length > 2000 ||
      typeof body.key !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(body.key) ||
      typeof body.name !== 'string' ||
      !body.name.trim() ||
      body.name.length > 200
    ) {
      return NextResponse.json(
        {
          error:
            'Enter short and long forms, selected source spellings, and a reason.',
        },
        { status: 400 },
      )
    }
    const upstream = await loadMnpMachines(true)
    const selectedNames = new Set(body.rawValues.map(normalizeIdentity))
    const publishedMatches = upstream.filter(
      (m) =>
        selectedNames.has(normalizeIdentity(m.key)) ||
        selectedNames.has(normalizeIdentity(m.name)),
    )
    if (publishedMatches.length > 1)
      return NextResponse.json(
        {
          error:
            'Selected entries refer to different published MNP machines. Review the selection before combining.',
        },
        { status: 400 },
      )
    let change
    if (body.source === 'mnp') {
      const published = officialChoice(upstream, body.key)
      if (!published)
        return NextResponse.json(
          {
            error:
              'That short form is not published by MNP. Save it as provisional instead.',
          },
          { status: 400 },
        )
      if (publishedMatches.some((m) => m.key !== published.key))
        return NextResponse.json(
          { error: 'A selected spelling belongs to a different MNP machine.' },
          { status: 400 },
        )
      change = {
        ...publishedIdentity(published),
        source: 'mnp',
        mnpKey: published.key,
        mnpName: published.name,
        previousKey: body.previousKey || null,
      }
    } else {
      if (body.source !== 'local' || body.previousKey)
        return NextResponse.json(
          { error: 'Select a valid provisional or MNP source.' },
          { status: 400 },
        )
      if (publishedMatches.length || officialChoice(upstream, body.key))
        return NextResponse.json(
          {
            error:
              'MNP already publishes this machine. Select its official canon instead of creating a provisional entry.',
          },
          { status: 400 },
        )
      change = { key: body.key, name: body.name.trim(), source: 'local' }
    }
    const result = await applyCanonChange(client, {
      ...change,
      rawValues: body.rawValues,
      reason: body.reason.trim(),
      actor: auth.user.id,
    })
    return NextResponse.json({ result })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Could not save machine canon' },
      { status: 400 },
    )
  }
}

export async function PUT() {
  return NextResponse.json(EDIT_HINT, { status: 405 })
}

export async function DELETE() {
  return NextResponse.json(EDIT_HINT, { status: 405 })
}
