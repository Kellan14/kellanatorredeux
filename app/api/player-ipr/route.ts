import { NextResponse } from 'next/server'

const GITHUB_BASE = 'https://raw.githubusercontent.com/Invader-Zim/mnp-data-archive/main'
const CURRENT_SEASON = 22
const TEAM_CODES = ['BOC', 'CPO', 'DSV', 'DTP', 'KNR', 'LAS', 'NLT', 'OLD', 'PGN', 'RMS', 'SHK', 'SSS', 'TWC']

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

    // Search through matches from most recent week backward
    for (let week = 13; week >= 1; week--) {
      // Try all team combinations for this week
      for (let i = 0; i < TEAM_CODES.length; i++) {
        for (let j = 0; j < TEAM_CODES.length; j++) {
          if (i === j) continue

          const homeTeam = TEAM_CODES[i]
          const awayTeam = TEAM_CODES[j]

          try {
            const url = `${GITHUB_BASE}/season-${CURRENT_SEASON}/matches/mnp-${CURRENT_SEASON}-${week}-${homeTeam}-${awayTeam}.json`
            const response = await fetch(url)

            if (response.ok) {
              const matchData = await response.json()

              // Search in home team lineup
              if (matchData.home?.lineup) {
                const homePlayer = matchData.home.lineup.find((p: any) => p.name === playerName)
                if (homePlayer) {
                  return NextResponse.json({
                    name: playerName,
                    ipr: homePlayer.IPR || 0,
                    matchesPlayed: homePlayer.num_played || 0,
                    currentSeason: CURRENT_SEASON,
                    lastMatchWeek: week,
                    team: matchData.home.name
                  })
                }
              }

              // Search in away team lineup
              if (matchData.away?.lineup) {
                const awayPlayer = matchData.away.lineup.find((p: any) => p.name === playerName)
                if (awayPlayer) {
                  return NextResponse.json({
                    name: playerName,
                    ipr: awayPlayer.IPR || 0,
                    matchesPlayed: awayPlayer.num_played || 0,
                    currentSeason: CURRENT_SEASON,
                    lastMatchWeek: week,
                    team: matchData.away.name
                  })
                }
              }
            }
          } catch (err) {
            // Continue to next match
            continue
          }
        }
      }
    }

    // Player not found in any matches
    return NextResponse.json({
      name: playerName,
      ipr: 0,
      matchesPlayed: 0,
      currentSeason: CURRENT_SEASON,
      message: 'Player not found in season ' + CURRENT_SEASON
    })
  } catch (error) {
    console.error('Error fetching player stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player stats' },
      { status: 500 }
    )
  }
}
