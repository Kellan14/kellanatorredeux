import { NextResponse } from 'next/server'

const GITHUB_BASE = 'https://raw.githubusercontent.com/Invader-Zim/mnp-data-archive/main'
const CURRENT_SEASON = 22

// Known team codes from MNP
const TEAM_CODES = ['BOC', 'CPO', 'DSV', 'DTP', 'KNR', 'LAS', 'NLT', 'OLD', 'PGN', 'RMS', 'SHK', 'SSS']

export async function GET() {
  try {
    // Try weeks 13 down to 1 to find the latest TWC match
    for (let week = 13; week >= 1; week--) {
      // Try TWC vs each possible opponent
      for (const opponent of TEAM_CODES) {
        // Try TWC as home team: mnp-22-{week}-TWC-{opponent}.json
        try {
          const homeUrl = `${GITHUB_BASE}/season-${CURRENT_SEASON}/matches/mnp-${CURRENT_SEASON}-${week}-TWC-${opponent}.json`
          const homeResponse = await fetch(homeUrl)

          if (homeResponse.ok) {
            const matchData = await homeResponse.json()

            return NextResponse.json({
              venue: matchData.venue?.name || 'Georgetown Pizza and Arcade',
              opponent: matchData.away?.name || opponent,
              matchKey: matchData.key,
              week: matchData.week,
              state: matchData.state
            })
          }
        } catch (err) {
          // Try next pattern
        }

        // Try TWC as away team: mnp-22-{week}-{opponent}-TWC.json
        try {
          const awayUrl = `${GITHUB_BASE}/season-${CURRENT_SEASON}/matches/mnp-${CURRENT_SEASON}-${week}-${opponent}-TWC.json`
          const awayResponse = await fetch(awayUrl)

          if (awayResponse.ok) {
            const matchData = await awayResponse.json()

            return NextResponse.json({
              venue: matchData.venue?.name || 'Georgetown Pizza and Arcade',
              opponent: matchData.home?.name || opponent,
              matchKey: matchData.key,
              week: matchData.week,
              state: matchData.state
            })
          }
        } catch (err) {
          // Continue to next opponent
        }
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
