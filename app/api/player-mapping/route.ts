import { NextResponse } from 'next/server'

// Hardcoded player mappings (will move to database later)
const PLAYER_MAPPINGS: Record<string, { name: string; team: string }> = {
  'dcdbf053-3e71-4f05-a627-70390da8f984': {
    name: 'Kellan Kirkland',
    team: 'TWC'
  }
}

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

    const mappings = PLAYER_MAPPINGS

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
