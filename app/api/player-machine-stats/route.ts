import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const player = searchParams.get('player')
    const machine = searchParams.get('machine')
    const venue = searchParams.get('venue') || ''
    const seasonStart = parseInt(searchParams.get('seasonStart') || '20')
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '22')

    if (!player || !machine) {
      return NextResponse.json(
        { error: 'Player and machine parameters are required' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      stats: [],
      message: 'Feature temporarily disabled - GitHub data fetching in progress'
    })
  } catch (error) {
    console.error('Error fetching player machine stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player machine stats' },
      { status: 500 }
    )
  }
}
