import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const venue = searchParams.get('venue')
    const opponent = searchParams.get('opponent')
    const seasonStart = parseInt(searchParams.get('seasonStart') || '20')
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '22')
    const teamVenueSpecific = searchParams.get('teamVenueSpecific') === 'true'
    const twcVenueSpecific = searchParams.get('twcVenueSpecific') === 'true'

    if (!venue || !opponent) {
      return NextResponse.json(
        { error: 'Venue and opponent are required' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      advantages: [],
      players: [],
      rosterPlayers: [],
      message: 'Feature temporarily disabled - GitHub data fetching in progress'
    })
  } catch (error) {
    console.error('Error calculating machine advantages:', error)
    return NextResponse.json(
      { error: 'Failed to calculate machine advantages' },
      { status: 500 }
    )
  }
}
