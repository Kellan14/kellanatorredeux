import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const machine = searchParams.get('machine')
    const column = searchParams.get('column')
    const venue = searchParams.get('venue')
    const team = searchParams.get('team')
    const twcTeam = searchParams.get('twcTeam') || 'The Wrecking Crew'
    const seasonStart = parseInt(searchParams.get('seasonStart') || '1')
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '999')
    const teamVenueSpecific = searchParams.get('teamVenueSpecific') === 'true'
    const twcVenueSpecific = searchParams.get('twcVenueSpecific') === 'true'

    if (!machine || !column) {
      return NextResponse.json(
        { error: 'Machine and column are required' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      machine,
      column,
      summary: 'Feature temporarily disabled - GitHub data fetching in progress',
      details: [],
      count: 0,
      message: 'Feature temporarily disabled - GitHub data fetching in progress'
    })
  } catch (error) {
    console.error('Error fetching cell details:', error)
    return NextResponse.json(
      { error: 'Failed to fetch cell details' },
      { status: 500 }
    )
  }
}
