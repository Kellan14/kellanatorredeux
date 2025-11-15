import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const player = searchParams.get('player')
    const venue = searchParams.get('venue')
    const seasonStart = parseInt(searchParams.get('seasonStart') || '20')
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '22')
    const allVenues = searchParams.get('allVenues') === 'true'

    if (!player || !venue) {
      return NextResponse.json(
        { error: 'Player and venue parameters are required' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      player,
      totalGames: 0,
      uniqueMachines: 0,
      venuesPlayed: 0,
      machinePerformance: [],
      allVenues,
      message: 'Feature temporarily disabled - GitHub data fetching in progress'
    })
  } catch (error) {
    console.error('Error fetching player analysis:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player analysis' },
      { status: 500 }
    )
  }
}
