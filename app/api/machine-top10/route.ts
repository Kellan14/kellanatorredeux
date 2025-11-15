import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import machinesData from '@/mnp-data-archive/machines.json'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const machineKey = searchParams.get('machine')
    const context = searchParams.get('context') // e.g., "League-Wide This Season", "This Season at Venue Name"
    const venue = searchParams.get('venue') || ''
    const currentSeason = 22

    if (!machineKey || !context) {
      return NextResponse.json(
        { error: 'Machine and context parameters are required' },
        { status: 400 }
      )
    }

    console.log('Fetching top 10 for:', machineKey, 'context:', context, 'venue:', venue)

    interface Score {
      player: string
      score: number
      venue: string
      season: number
    }

    const allScores: Score[] = []

    // Parse context to determine what to fetch
    const isLeagueWide = context.includes('League-Wide')
    const isThisSeason = context.includes('This Season')
    const isAllTime = context.includes('All-Time')
    const isVenueSpecific = context.includes(' at ')

    // Get all scores from match data
    const startSeason = isThisSeason ? currentSeason : 20
    const endSeason = currentSeason

    for (let season = startSeason; season <= endSeason; season++) {
      const seasonDir = path.join(process.cwd(), 'mnp-data-archive', `season-${season}`, 'matches')

      if (!fs.existsSync(seasonDir)) continue

      const files = fs.readdirSync(seasonDir)

      for (const file of files) {
        if (!file.endsWith('.json')) continue

        const matchData = JSON.parse(fs.readFileSync(path.join(seasonDir, file), 'utf-8'))
        const matchVenue = matchData.venue?.name || ''

        // Filter by venue if venue-specific
        if (isVenueSpecific && venue && matchVenue !== venue) continue

        const rounds = matchData.rounds || []
        for (const round of rounds) {
          const games = round.games || []
          for (const game of games) {
            if (game.machine !== machineKey) continue

            // Check all player positions
            for (let i = 1; i <= 4; i++) {
              const playerKey = game[`player_${i}`]
              const score = game[`score_${i}`]

              if (!playerKey || score === undefined) continue

              // Find player name
              let playerName = ''

              if (matchData.home?.lineup) {
                const p = matchData.home.lineup.find((pl: any) => pl.key === playerKey)
                if (p) playerName = p.name
              }

              if (!playerName && matchData.away?.lineup) {
                const p = matchData.away.lineup.find((pl: any) => pl.key === playerKey)
                if (p) playerName = p.name
              }

              if (playerName) {
                allScores.push({
                  player: playerName,
                  score,
                  venue: matchVenue,
                  season
                })
              }
            }
          }
        }
      }
    }

    // Sort and get top 10
    const topScores = allScores
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((s, index) => ({
        rank: index + 1,
        player: s.player,
        score: s.score,
        venue: s.venue,
        season: s.season
      }))

    console.log(`Found ${allScores.length} scores, returning top 10`)

    // Get machine name from key
    const machineEntry = Object.values(machinesData).find(
      (m: any) => m.key === machineKey
    ) as any
    const machineName = machineEntry?.name || machineKey

    return NextResponse.json({
      machine: machineName,
      machineKey,
      context,
      topScores
    })
  } catch (error) {
    console.error('Error fetching top 10:', error)
    return NextResponse.json(
      { error: 'Failed to fetch top 10' },
      { status: 500 }
    )
  }
}
