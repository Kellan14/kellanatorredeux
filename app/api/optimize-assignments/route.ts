import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { venue, opponent, seasonStart, seasonEnd, format, machines, availablePlayers } = body

    if (!venue || !opponent || !machines || !availablePlayers || availablePlayers.length === 0) {
      return NextResponse.json(
        { error: 'Invalid parameters' },
        { status: 400 }
      )
    }

    const twcTeam = 'The Wrecking Crew'
    const playersPerMachine = format === 'singles' ? 1 : 2

    // Check if we have enough players
    if (availablePlayers.length < machines.length * playersPerMachine) {
      return NextResponse.json(
        { error: `Not enough players. Need ${machines.length * playersPerMachine}, have ${availablePlayers.length}` },
        { status: 400 }
      )
    }

    // Collect player-machine stats
    const playerMachineStats: Record<string, Record<string, {
      scores: number[]
      avg: number
      pctOfVenue: number
      count: number
    }>> = {}

    const machineVenueAvg: Record<string, number> = {}

    for (let season = seasonStart; season <= seasonEnd; season++) {
      const seasonDir = path.join(process.cwd(), 'public', 'mnp-data-archive', `season-${season}`, 'matches')

      if (!fs.existsSync(seasonDir)) continue

      const files = fs.readdirSync(seasonDir)

      for (const file of files) {
        if (!file.endsWith('.json')) continue

        const matchData = JSON.parse(fs.readFileSync(path.join(seasonDir, file), 'utf-8'))

        if (!matchData.venue?.name || matchData.venue.name.toLowerCase() !== venue.toLowerCase()) continue

        const rounds = matchData.rounds || []
        for (const round of rounds) {
          const games = round.games || []
          for (const game of games) {
            if (!game.machine || !machines.includes(game.machine)) continue

            const machine = game.machine

            let machineScoreSum = 0
            let machineScoreCount = 0

            for (let i = 1; i <= 4; i++) {
              const playerKey = game[`player_${i}`]
              const score = game[`score_${i}`]

              if (!playerKey || score === undefined) continue

              let playerName = ''
              let playerTeam = ''
              let isRoster = false

              if (matchData.home?.lineup) {
                const player = matchData.home.lineup.find((p: any) => p.key === playerKey)
                if (player) {
                  playerName = player.name
                  playerTeam = matchData.home.name
                  isRoster = !player.sub
                }
              }

              if (!playerName && matchData.away?.lineup) {
                const player = matchData.away.lineup.find((p: any) => p.key === playerKey)
                if (player) {
                  playerName = player.name
                  playerTeam = matchData.away.name
                  isRoster = !player.sub
                }
              }

              if (!playerName) continue

              machineScoreSum += score
              machineScoreCount++

              if (playerTeam.toLowerCase() === twcTeam.toLowerCase() && isRoster && availablePlayers.includes(playerName)) {
                if (!playerMachineStats[playerName]) {
                  playerMachineStats[playerName] = {}
                }
                if (!playerMachineStats[playerName][machine]) {
                  playerMachineStats[playerName][machine] = {
                    scores: [],
                    avg: 0,
                    pctOfVenue: 100,
                    count: 0
                  }
                }
                playerMachineStats[playerName][machine].scores.push(score)
                playerMachineStats[playerName][machine].count++
              }
            }

            // Calculate machine venue average
            if (machineScoreCount > 0) {
              if (!machineVenueAvg[machine]) {
                machineVenueAvg[machine] = machineScoreSum / machineScoreCount
              } else {
                // Update average
                const currentAvg = machineVenueAvg[machine]
                machineVenueAvg[machine] = (currentAvg + (machineScoreSum / machineScoreCount)) / 2
              }
            }
          }
        }
      }
    }

    // Calculate player averages and pct of venue
    const playerOverallAvg: Record<string, number> = {}

    for (const player of Object.keys(playerMachineStats)) {
      let totalPct = 0
      let machineCount = 0

      for (const machine of Object.keys(playerMachineStats[player])) {
        const stats = playerMachineStats[player][machine]
        stats.avg = stats.scores.reduce((sum, s) => sum + s, 0) / stats.scores.length

        if (machineVenueAvg[machine] > 0) {
          stats.pctOfVenue = (stats.avg / machineVenueAvg[machine]) * 100
          totalPct += stats.pctOfVenue
          machineCount++
        }
      }

      playerOverallAvg[player] = machineCount > 0 ? totalPct / machineCount : 100
    }

    // Assign players to machines
    const assignments: Array<{
      machine: string
      players: string[]
    }> = []

    const usedPlayers = new Set<string>()

    if (format === 'singles') {
      // For singles, use a greedy approach
      for (const machine of machines) {
        // Find best available player for this machine
        const playerScores = availablePlayers
          .filter((player: string) => !usedPlayers.has(player))
          .map((player: string) => {
            const stats = playerMachineStats[player]?.[machine]
            let score = stats?.pctOfVenue || playerOverallAvg[player] || 100

            // Bonus for experience on this machine
            if (stats && stats.count > 0) {
              score *= (1 + Math.min(stats.count / 5, 1) * 0.2)
            }

            return { player, score }
          })
          .sort((a: { player: string, score: number }, b: { player: string, score: number }) => b.score - a.score)

        const bestPlayer = playerScores[0]?.player
        if (bestPlayer) {
          usedPlayers.add(bestPlayer)
          assignments.push({
            machine,
            players: [bestPlayer]
          })
        }
      }
    } else {
      // For doubles, assign pairs
      for (const machine of machines) {
        // Find best available pair for this machine
        const playerScores = availablePlayers
          .filter((player: string) => !usedPlayers.has(player))
          .map((player: string) => {
            const stats = playerMachineStats[player]?.[machine]
            let score = stats?.pctOfVenue || playerOverallAvg[player] || 100

            // Bonus for experience
            if (stats && stats.count > 0) {
              score *= (1 + Math.min(stats.count / 5, 1) * 0.2)
            }

            return { player, score }
          })
          .sort((a: { player: string, score: number }, b: { player: string, score: number }) => b.score - a.score)
          .slice(0, 2)

        const pair = playerScores.map((p: { player: string, score: number }) => p.player)
        pair.forEach((p: string) => usedPlayers.add(p))

        assignments.push({
          machine,
          players: pair
        })
      }
    }

    return NextResponse.json({ assignments })
  } catch (error) {
    console.error('Error optimizing assignments:', error)
    return NextResponse.json(
      { error: 'Failed to optimize assignments' },
      { status: 500 }
    )
  }
}
