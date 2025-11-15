import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const uid = searchParams.get('uid')

    if (!uid) {
      return NextResponse.json(
        { error: 'UID is required' },
        { status: 400 }
      )
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    const response = await fetch(`${baseUrl}/player-mappings.json`, { cache: 'no-store' })

    if (!response.ok) {
      throw new Error('Failed to fetch player mappings')
    }

    const mappings = await response.json()

    const playerData = mappings[uid]

    if (!playerData) {
      return NextResponse.json(
        { error: 'Player mapping not found for this UID' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      uid: uid,
      name: playerData.name,
      team: playerData.team
    })
  } catch (error) {
    console.error('Error fetching player mapping:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player mapping' },
      { status: 500 }
    )
  }
}
