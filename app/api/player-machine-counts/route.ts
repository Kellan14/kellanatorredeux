import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const player = searchParams.get('player')
    const venue = searchParams.get('venue') || ''
    const seasonStart = parseInt(searchParams.get('seasonStart') || '20')
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '22')

    if (!player) {
      return NextResponse.json(
        { error: 'Player parameter is required' },
        { status: 400 }
      )
    }

    // Store counts for each machine
    const machineCounts: Record<string, { atVenue: number; allVenues: number }> = {}

    // Search through seasons
    for (let season = seasonStart; season <= seasonEnd; season++) {
      const seasonDir = path.join(process.cwd(), 'mnp-data-archive', `season-${season}`, 'matches')

      if (!fs.existsSync(seasonDir)) continue

      const files = fs.readdirSync(seasonDir)

      for (const file of files) {
        if (!file.endsWith('.json')) continue

        const matchData = JSON.parse(fs.readFileSync(path.join(seasonDir, file), 'utf-8'))

        const matchVenue = matchData.venue?.name || ''
        const isAtVenue = venue && matchVenue.toLowerCase() === venue.toLowerCase()

        // Process rounds and games
        const rounds = matchData.rounds || []
        for (const round of rounds) {
          const games = round.games || []
          for (const game of games) {
            if (!game.machine) continue

            const machine = game.machine

            // Initialize counts if not exists
            if (!machineCounts[machine]) {
              machineCounts[machine] = { atVenue: 0, allVenues: 0 }
            }

            // Check all player positions
            for (let i = 1; i <= 4; i++) {
              const playerKey = game[`player_${i}`]
              if (!playerKey) continue

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

              // If this is the player we're looking for
              if (playerName.toLowerCase() === player.toLowerCase()) {
                machineCounts[machine].allVenues++
                if (isAtVenue) {
                  machineCounts[machine].atVenue++
                }
                break // Only count once per game
              }
            }
          }
        }
      }
    }

    return NextResponse.json({ counts: machineCounts })
  } catch (error) {
    console.error('Error fetching player machine counts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player machine counts' },
      { status: 500 }
    )
  }
}
