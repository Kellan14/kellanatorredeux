import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const team = searchParams.get('team')
    const season = searchParams.get('season') || '22'
    const showSubs = searchParams.get('showSubs') === 'true'

    if (!team) {
      return NextResponse.json(
        { error: 'Team parameter is required' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      players: [],
      message: 'Feature temporarily disabled - GitHub data fetching in progress'
    })
  } catch (error) {
    console.error('Error fetching team roster:', error)
    return NextResponse.json(
      { error: 'Failed to fetch team roster' },
      { status: 500 }
    )
  }
}
