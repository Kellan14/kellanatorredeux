import { NextResponse } from 'next/server'

const GITHUB_BASE = 'https://raw.githubusercontent.com/Kellan14/kellanatorredeux/main/mnp-data-archive'
const CURRENT_SEASON = 22

export async function GET() {
  try {
    // Try weeks 13 down to 1 to find the latest TWC match
    for (let week = 13; week >= 1; week--) {
      try {
        const url = `${GITHUB_BASE}/season-${CURRENT_SEASON}/matches/mnp-${CURRENT_SEASON}-${week}-TWC.json`
        const response = await fetch(url)

        if (response.ok) {
          const matchData = await response.json()

          // Determine opponent - TWC could be home or away
          let opponent = ''
          if (matchData.home && matchData.home.key === 'TWC') {
            opponent = matchData.away.name
          } else if (matchData.away && matchData.away.key === 'TWC') {
            opponent = matchData.home.name
          }

          return NextResponse.json({
            venue: matchData.venue?.name || 'Georgetown Pizza and Arcade',
            opponent: opponent,
            matchKey: matchData.key,
            week: matchData.week,
            state: matchData.state
          })
        }
      } catch (err) {
        // Continue to next week
        continue
      }
    }

    // Fallback if no match found
    return NextResponse.json({
      venue: 'Georgetown Pizza and Arcade',
      opponent: null,
      matchKey: null
    })
  } catch (error) {
    console.error('Error finding latest TWC match:', error)
    return NextResponse.json(
      { error: 'Failed to find latest match' },
      { status: 500 }
    )
  }
}
