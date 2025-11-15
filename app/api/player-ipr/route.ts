import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const playerName = searchParams.get('name')

    if (!playerName) {
      return NextResponse.json(
        { error: 'Player name is required' },
        { status: 400 }
      )
    }

    // TODO: Implement actual IPR calculation by fetching from GitHub
    // For now, return mock data to prevent 500 errors
    return NextResponse.json({
      name: playerName,
      ipr: 4.5,
      matchesPlayed: 0,
      pointsWon: 0,
      pointsPerMatch: 0,
      pops: 0,
      currentSeason: 23,
      message: 'IPR calculation temporarily disabled - GitHub data fetching in progress'
    })
  } catch (error) {
    console.error('Error fetching player stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player stats' },
      { status: 500 }
    )
  }
}
