import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const team = searchParams.get('team')
    const season = searchParams.get('season') || '22'
    const showSubs = searchParams.get('showSubs') === 'true'

    if (!team) {
      return NextResponse.json(
        { error: 'Team parameter is required' },
        { status: 400 }
      )
    }

    const players = new Set<string>()
    const rosterPlayers = new Set<string>()

    // Read matches from the specified season
    const seasonDir = path.join(process.cwd(), 'mnp-data-archive', `season-${season}`, 'matches')

    if (!fs.existsSync(seasonDir)) {
      return NextResponse.json({ players: [] })
    }

    const files = fs.readdirSync(seasonDir)

    for (const file of files) {
      if (!file.endsWith('.json')) continue

      const matchData = JSON.parse(fs.readFileSync(path.join(seasonDir, file), 'utf-8'))

      // Check if this team played in this match
      const isHomeTeam = matchData.home?.name?.toLowerCase() === team.toLowerCase()
      const isAwayTeam = matchData.away?.name?.toLowerCase() === team.toLowerCase()

      if (isHomeTeam && matchData.home?.lineup) {
        matchData.home.lineup.forEach((player: any) => {
          if (!player.sub) {
            rosterPlayers.add(player.name)
          }
          players.add(player.name)
        })
      }

      if (isAwayTeam && matchData.away?.lineup) {
        matchData.away.lineup.forEach((player: any) => {
          if (!player.sub) {
            rosterPlayers.add(player.name)
          }
          players.add(player.name)
        })
      }
    }

    // Return roster players or all players based on showSubs
    const playerList = showSubs
      ? Array.from(players).sort()
      : Array.from(rosterPlayers).sort()

    return NextResponse.json({ players: playerList })
  } catch (error) {
    console.error('Error fetching team roster:', error)
    return NextResponse.json(
      { error: 'Failed to fetch team roster' },
      { status: 500 }
    )
  }
}
