import { NextResponse } from 'next/server'
import { listMachines } from '@/lib/machines-canon'

/**
 * The machine canon: short key + long form for every machine.
 * Clients render the long form and speak the short key back to the APIs.
 *
 * Changes only when the canon is edited, so it caches hard.
 */
export const revalidate = 3600

export async function GET() {
  try {
    const machines = await listMachines(true)
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
    console.error('Error loading machine canon:', error)
    return NextResponse.json(
      { error: 'Failed to load machine canon' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
