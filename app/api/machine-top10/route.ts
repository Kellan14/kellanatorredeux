import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const machineKey = searchParams.get('machine')
    const context = searchParams.get('context')
    const venue = searchParams.get('venue') || ''

    if (!machineKey || !context) {
      return NextResponse.json(
        { error: 'Machine and context parameters are required' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      machine: machineKey,
      machineKey,
      context,
      topScores: [],
      message: 'Feature temporarily disabled - GitHub data fetching in progress'
    })
  } catch (error) {
    console.error('Error fetching top 10:', error)
    return NextResponse.json(
      { error: 'Failed to fetch top 10' },
      { status: 500 }
    )
  }
}
