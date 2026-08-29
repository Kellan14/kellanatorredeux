import { NextResponse } from 'next/server'
import bundledMachines from '@/mnp-data-archive/machines.json'

/**
 * The machine canon: short key + long form for every machine.
 * Clients render the long form and speak the short key back to the APIs.
 *
 * Changes only when the canon is edited, so successful database responses
 * cache hard. The bundled MNP snapshot keeps clients working while the
 * database is unavailable.
 */
export const dynamic = 'force-dynamic'

type MachineResponse = {
  key: string
  name: string
  displayName: string
  source: 'mnp' | 'local'
  active: boolean
}

const fallbackMachines: MachineResponse[] = Object.values(bundledMachines)
  .map((machine) => ({
    key: machine.key,
    name: machine.name,
    displayName: machine.name,
    source: 'mnp' as const,
    active: true,
  }))
  .sort((a, b) => a.displayName.localeCompare(b.displayName))

export async function GET() {
  try {
    // Keep this import inside the guarded block. lib/supabase constructs its
    // client at module load, so missing environment values must not prevent
    // this route from returning the bundled fallback.
    const { listMachines } = await import('@/lib/machines-canon')
    const machines = await listMachines(true)
    if (machines.length === 0) throw new Error('Supabase returned an empty machine canon')
    return NextResponse.json(
      {
        machines: machines.map((m) => ({
          key: m.key,
          name: m.name,
          displayName: m.displayName,
          source: m.source,
          active: m.active,
        })),
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
        },
      }
    )
  } catch (error) {
    console.warn('Machine canon database unavailable; using bundled MNP fallback:', error)
    return NextResponse.json(
      { machines: fallbackMachines },
      {
        status: 200,
        headers: {
          // Retry the database on the next request instead of pinning fallback data.
          'Cache-Control': 'no-store',
          'X-Machine-Canon-Source': 'bundled-fallback',
        },
      }
    )
  }
}
