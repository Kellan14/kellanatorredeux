import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const machineName = searchParams.get('machine')

    if (!machineName) {
      return NextResponse.json(
        { error: 'Machine parameter is required' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      topSeasonScores: [],
      topAllTimeScores: [],
      message: 'Feature temporarily disabled - GitHub data fetching in progress'
    })
  } catch (error) {
    console.error('Error fetching top scores:', error)
    return NextResponse.json(
      { error: 'Failed to fetch top scores' },
      { status: 500 }
    )
  }
}
