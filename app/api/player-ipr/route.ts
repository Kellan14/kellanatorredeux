import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

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

    const matchesDir = path.join(process.cwd(), 'mnp-data-archive', 'season-22', 'matches')
    const files = fs.readdirSync(matchesDir)

    // Filter for TWC matches and parse their data
    const twcMatches: Array<{ filename: string; week: number; data: any }> = []

    for (const file of files) {
      if (file.includes('TWC') && file.endsWith('.json')) {
        const filePath = path.join(matchesDir, file)
        const fileContent = fs.readFileSync(filePath, 'utf-8')
        const matchData = JSON.parse(fileContent)

        const weekNum = parseInt(matchData.week || '0', 10)
        twcMatches.push({
          filename: file,
          week: weekNum,
          data: matchData
        })
      }
    }

    // Sort by week number descending (most recent first)
    twcMatches.sort((a, b) => b.week - a.week)

    // Calculate comprehensive stats across all matches
    let ipr = 0
    let matchesPlayed = 0
    let totalPoints = 0
    let totalPossiblePoints = 0

    for (const match of twcMatches) {
      const matchData = match.data

      // Check if TWC is home or away
      let twcLineup: any[] = []

      if (matchData.home && matchData.home.key === 'TWC') {
        twcLineup = matchData.home.lineup || []
      } else if (matchData.away && matchData.away.key === 'TWC') {
        twcLineup = matchData.away.lineup || []
      }

      // Look for the player in the lineup
      const player = twcLineup.find((p: any) =>
        p.name.toLowerCase() === playerName.toLowerCase()
      )

      if (player) {
        // Get IPR from most recent match (first match in sorted list)
        if (ipr === 0 && player.IPR !== undefined) {
          ipr = player.IPR
        }

        // Count matches where player actually played
        if (player.num_played > 0) {
          matchesPlayed++
        }

        // Calculate points from all rounds and games
        const playerKey = player.key
        const rounds = matchData.rounds || []

        for (const round of rounds) {
          const games = round.games || []
          const roundNumber = round.n

          // Determine max points based on round type
          // Rounds 1 & 4: Doubles (2v2) - max 2.5 points
          // Rounds 2 & 3: Singles (1v1) - max 3 points
          const maxPointsForRound = (roundNumber === 1 || roundNumber === 4) ? 2.5 : 3

          for (const game of games) {
            // Check each player position in the game
            for (let i = 1; i <= 4; i++) {
              const playerKeyField = `player_${i}`
              const pointsField = `points_${i}`

              if (game[playerKeyField] === playerKey && game[pointsField] !== undefined) {
                totalPoints += game[pointsField]
                totalPossiblePoints += maxPointsForRound
                break // Player can only appear once per game
              }
            }
          }
        }
      }
    }

    if (ipr === 0) {
      return NextResponse.json(
        { error: 'Player not found in recent matches' },
        { status: 404 }
      )
    }

    // Calculate derived stats
    const pointsPerMatch = matchesPlayed > 0 ? totalPoints / matchesPlayed : 0
    const pops = totalPossiblePoints > 0 ? (totalPoints / totalPossiblePoints) * 100 : 0

    return NextResponse.json({
      name: playerName,
      ipr: ipr,
      matchesPlayed: matchesPlayed,
      pointsWon: totalPoints,
      pointsPerMatch: pointsPerMatch,
      pops: pops,
      currentSeason: 22
    })
  } catch (error) {
    console.error('Error fetching player stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player stats' },
      { status: 500 }
    )
  }
}
