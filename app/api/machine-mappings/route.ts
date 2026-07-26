import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { listMachines } from '@/lib/machines-canon'

export const dynamic = 'force-dynamic'

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
    const [aliases, machines] = await Promise.all([
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
          .order('canon_key', { ascending: true })
      ),
      listMachines(true),
    ])

    return NextResponse.json({
      aliases,
      count: aliases.length,
      machines: machines.map((m) => ({
        key: m.key,
        name: m.name,
        displayName: m.displayName,
        source: m.source,
      })),
      note: 'Aliases live in machine_aliases; the canon lives in machine_canon. Most spellings resolve without one.',
    })
  } catch (error) {
    console.error('Error in GET /api/machine-mappings:', error)
    return NextResponse.json({ error: 'Failed to fetch machine aliases' }, { status: 500 })
  }
}

const EDIT_HINT = {
  error:
    'Machine aliases are rows in machine_aliases, keyed to machine_canon. Add them via scripts/seed-machine-aliases.ts — each row records the reason it exists and the run is logged to data_provenance.',
}

export async function POST() {
  return NextResponse.json(EDIT_HINT, { status: 405 })
}

export async function PUT() {
  return NextResponse.json(EDIT_HINT, { status: 405 })
}

export async function DELETE() {
  return NextResponse.json(EDIT_HINT, { status: 405 })
}
