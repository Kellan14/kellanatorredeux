import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

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

    const stats: any[] = []

    // Search through seasons
    for (let season = seasonStart; season <= seasonEnd; season++) {
      const seasonDir = path.join(process.cwd(), 'mnp-data-archive', `season-${season}`, 'matches')

      if (!fs.existsSync(seasonDir)) continue

      const files = fs.readdirSync(seasonDir)

      for (const file of files) {
        if (!file.endsWith('.json')) continue

        const matchData = JSON.parse(fs.readFileSync(path.join(seasonDir, file), 'utf-8'))

        const matchVenue = matchData.venue?.name || ''

        // If venue specific, filter by venue
        if (venue && matchVenue.toLowerCase() !== venue.toLowerCase()) {
          continue
        }

        // Process rounds and games
        const rounds = matchData.rounds || []
        for (let roundIndex = 0; roundIndex < rounds.length; roundIndex++) {
          const round = rounds[roundIndex]
          const games = round.games || []
          for (const game of games) {
            if (game.machine !== machine) continue

            // Check all player positions
            for (let i = 1; i <= 4; i++) {
              const playerKey = game[`player_${i}`]
              const score = game[`score_${i}`]
              const points = game[`points_${i}`]

              if (!playerKey || score === undefined) continue

              // Find player name
              let playerName = ''
              let playerTeam = ''

              if (matchData.home?.lineup) {
                const p = matchData.home.lineup.find((pl: any) => pl.key === playerKey)
                if (p) {
                  playerName = p.name
                  playerTeam = matchData.home.name
                }
              }

              if (!playerName && matchData.away?.lineup) {
                const p = matchData.away.lineup.find((pl: any) => pl.key === playerKey)
                if (p) {
                  playerName = p.name
                  playerTeam = matchData.away.name
                }
              }

              // If this is the player we're looking for
              if (playerName.toLowerCase() === player.toLowerCase()) {
                // Determine round name/number
                let roundName = 'Round ?'
                if (round.name) {
                  roundName = round.name
                } else if (round.number !== undefined) {
                  roundName = `Round ${round.number}`
                } else {
                  roundName = `Round ${roundIndex + 1}`
                }

                // Determine opponent team name
                const homeTeam = matchData.home?.name || 'Unknown'
                const awayTeam = matchData.away?.name || 'Unknown'
                const opponentTeam = playerTeam === homeTeam ? awayTeam : homeTeam

                stats.push({
                  score,
                  points: points !== undefined ? points : null,
                  match: opponentTeam,
                  round: roundName,
                  season,
                  venue: matchVenue,
                  team: playerTeam
                })
              }
            }
          }
        }
      }
    }

    // Sort by season and then score (descending)
    stats.sort((a, b) => {
      if (b.season !== a.season) return b.season - a.season
      return b.score - a.score
    })

    console.log(`Player-machine-stats: Found ${stats.length} stats for ${player} on ${machine}`)

    return NextResponse.json({ stats })
  } catch (error) {
    console.error('Error fetching player machine stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player machine stats' },
      { status: 500 }
    )
  }
}
