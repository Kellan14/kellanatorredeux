import { NextResponse } from 'next/server'
import { getAllPlayerNames } from '@/lib/players'

// The roster only changes when the weekly sync imports new games, so this can
// be cached aggressively at every layer (route cache, CDN, browser).
export const revalidate = 3600

export async function GET() {
  try {
    const players = await getAllPlayerNames()

    return NextResponse.json(
      { players },
      {
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
        },
      }
    )
  } catch (error) {
    console.error('Error loading player list:', error)
    // Never let a failure get cached in place of the roster.
    return NextResponse.json(
      { error: 'Failed to load players' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
