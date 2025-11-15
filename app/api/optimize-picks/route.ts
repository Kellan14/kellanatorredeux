import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { applyVenueMachineListOverrides } from '@/lib/venue-machine-lists'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { venue, opponent, seasonStart, seasonEnd, format, numMachines, availablePlayers } = body

    if (!venue || !opponent || !availablePlayers || availablePlayers.length === 0) {
      return NextResponse.json(
        { error: 'Invalid parameters' },
        { status: 400 }
      )
    }

    const twcTeam = 'The Wrecking Crew'

    // Collect player-machine stats
    const playerMachineStats: Record<string, {
      machines: Record<string, {
        scores: number[]
        avg: number
        pctOfVenue: number
        playsCount: number
      }>
      overallAvgPctOfVenue: number
    }> = {}

    const machineVenueAvg: Record<string, number> = {}
    const machineOpponentPct: Record<string, number> = {}

    // Track machines at venue in most recent season (to match stats page)
    const machinesInLatestSeason = new Set<string>()

    // Initialize player stats
    for (const player of availablePlayers) {
      playerMachineStats[player] = {
        machines: {},
        overallAvgPctOfVenue: 0
      }
    }

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
            if (!game.machine) continue

            const machine = game.machine

            // Track machines in latest season (to match stats page)
            if (season === seasonEnd) {
              machinesInLatestSeason.add(machine)
            }

            // Track venue scores for this machine
            const machineScores: number[] = []
            let twcScores: number[] = []
            let opponentScores: number[] = []

            for (let i = 1; i <= 4; i++) {
              const playerKey = game[`player_${i}`]
              const score = game[`score_${i}`]

              if (!playerKey || score === undefined) continue

              // Find player name and team
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

              machineScores.push(score)

              if (playerTeam.toLowerCase() === twcTeam.toLowerCase() && isRoster) {
                twcScores.push(score)

                // Track individual player stats
                if (availablePlayers.includes(playerName)) {
                  if (!playerMachineStats[playerName].machines[machine]) {
                    playerMachineStats[playerName].machines[machine] = {
                      scores: [],
                      avg: 0,
                      pctOfVenue: 0,
                      playsCount: 0
                    }
                  }
                  playerMachineStats[playerName].machines[machine].scores.push(score)
                }
              } else if (playerTeam.toLowerCase() === opponent.toLowerCase() && isRoster) {
                opponentScores.push(score)
              }
            }

            // Calculate venue average for this game
            if (machineScores.length > 0) {
              const gameVenueAvg = machineScores.reduce((sum, s) => sum + s, 0) / machineScores.length
              if (!machineVenueAvg[machine]) {
                machineVenueAvg[machine] = gameVenueAvg
              } else {
                // Running average
                const currentCount = 1
                machineVenueAvg[machine] = (machineVenueAvg[machine] + gameVenueAvg) / 2
              }
            }

            // Calculate opponent % of venue for this machine
            if (opponentScores.length > 0 && machineVenueAvg[machine] > 0) {
              const opponentAvg = opponentScores.reduce((sum, s) => sum + s, 0) / opponentScores.length
              const opponentPct = (opponentAvg / machineVenueAvg[machine]) * 100

              if (!machineOpponentPct[machine]) {
                machineOpponentPct[machine] = opponentPct
              } else {
                machineOpponentPct[machine] = (machineOpponentPct[machine] + opponentPct) / 2
              }
            }
          }
        }
      }
    }

    // Calculate player averages and pct of venue for each machine
    for (const player of availablePlayers) {
      let totalPct = 0
      let machineCount = 0

      for (const machine of Object.keys(playerMachineStats[player].machines)) {
        const stats = playerMachineStats[player].machines[machine]
        stats.avg = stats.scores.reduce((sum, s) => sum + s, 0) / stats.scores.length
        stats.playsCount = stats.scores.length

        if (machineVenueAvg[machine] > 0) {
          stats.pctOfVenue = (stats.avg / machineVenueAvg[machine]) * 100
          totalPct += stats.pctOfVenue
          machineCount++
        }
      }

      // Calculate overall average % of venue for this player
      if (machineCount > 0) {
        playerMachineStats[player].overallAvgPctOfVenue = totalPct / machineCount
      }
    }

    // Apply venue machine list overrides (to match stats page)
    let finalMachineList = Array.from(machinesInLatestSeason)
    finalMachineList = applyVenueMachineListOverrides(venue, finalMachineList)

    // Calculate player-machine scores using app.py algorithm
    const playerMachineScores: Record<string, Record<string, number>> = {}

    for (const player of availablePlayers) {
      playerMachineScores[player] = {}

      for (const machine of finalMachineList) {
        const playerStats = playerMachineStats[player]
        const machineStats = playerStats.machines[machine]
        const playerOverallAvg = playerStats.overallAvgPctOfVenue
        const opponentPct = machineOpponentPct[machine] || 100

        let finalScore = 0

        if (machineStats && machineStats.playsCount > 0) {
          // Player has played this machine before
          const playerPct = machineStats.pctOfVenue
          const playsCount = machineStats.playsCount

          // Confidence factor based on number of plays (maxes out at 3+ plays)
          const confidence = Math.min(playsCount / 3, 1.0)

          // Calculate player's advantage over opponent average
          let playerAdvantage
          if (opponentPct > 0) {
            playerAdvantage = playerPct - opponentPct
          } else {
            // Opponent hasn't played this machine - big advantage
            playerAdvantage = playerPct * 0.5  // Scale factor to avoid overly favoring unknown machines
          }

          // Calculate final score considering confidence
          finalScore = playerAdvantage * confidence
        } else {
          // Player hasn't played this machine - use overall average as estimate
          if (playerOverallAvg > 0) {
            let playerAdvantage
            if (opponentPct > 0) {
              // Estimate advantage based on overall player average
              playerAdvantage = playerOverallAvg - opponentPct
            } else {
              // Neither player nor opponent has played this
              playerAdvantage = 0
            }

            // Very low confidence for machines the player hasn't played
            finalScore = playerAdvantage * 0.3
          } else {
            // No data for this player at all
            finalScore = 0
          }
        }

        playerMachineScores[player][machine] = finalScore
      }
    }

    // Optimize based on format
    let recommendations: Array<{
      machine: string
      players: string[]
      score?: number
    }> = []

    if (format === 'singles') {
      recommendations = optimizeSingles(
        playerMachineScores,
        finalMachineList,
        availablePlayers,
        numMachines
      )
    } else {
      recommendations = optimizeDoubles(
        playerMachineScores,
        finalMachineList,
        availablePlayers,
        numMachines
      )
    }

    return NextResponse.json({ recommendations })
  } catch (error) {
    console.error('Error optimizing picks:', error)
    return NextResponse.json(
      { error: 'Failed to optimize picks' },
      { status: 500 }
    )
  }
}

function optimizeSingles(
  playerMachineScores: Record<string, Record<string, number>>,
  availableMachines: string[],
  availablePlayers: string[],
  numMachinesToPick: number
): Array<{ machine: string; players: string[]; score: number }> {
  // Ensure we don't try to pick more machines than available
  numMachinesToPick = Math.min(numMachinesToPick, availableMachines.length, availablePlayers.length)

  if (numMachinesToPick === 0) {
    return []
  }

  // Create all player-machine assignments with scores
  const assignments: Array<{ player: string; machine: string; score: number }> = []

  for (const player of availablePlayers) {
    for (const machine of availableMachines) {
      const score = playerMachineScores[player][machine] || 0
      assignments.push({ player, machine, score })
    }
  }

  // Sort by score (highest first)
  assignments.sort((a, b) => b.score - a.score)

  // Greedy selection: take top assignments ensuring no player or machine is used twice
  const selectedAssignments: Array<{ player: string; machine: string; score: number }> = []
  const usedPlayers = new Set<string>()
  const usedMachines = new Set<string>()

  for (const assignment of assignments) {
    if (selectedAssignments.length >= numMachinesToPick) break
    if (usedPlayers.has(assignment.player) || usedMachines.has(assignment.machine)) continue

    selectedAssignments.push(assignment)
    usedPlayers.add(assignment.player)
    usedMachines.add(assignment.machine)
  }

  // Convert to recommendations format
  return selectedAssignments.map(a => ({
    machine: a.machine,
    players: [a.player],
    score: a.score
  }))
}

function optimizeDoubles(
  playerMachineScores: Record<string, Record<string, number>>,
  availableMachines: string[],
  availablePlayers: string[],
  numMachinesToPick: number
): Array<{ machine: string; players: string[]; score: number }> {
  // Ensure we have enough players for doubles
  if (availablePlayers.length < numMachinesToPick * 2) {
    return []
  }

  // Generate all possible player pairs
  const playerPairs: Array<[string, string]> = []
  for (let i = 0; i < availablePlayers.length; i++) {
    for (let j = i + 1; j < availablePlayers.length; j++) {
      playerPairs.push([availablePlayers[i], availablePlayers[j]])
    }
  }

  // Calculate scores for all pair-machine combinations
  const allCombinations: Array<{ pair: [string, string]; machine: string; score: number }> = []

  for (const pair of playerPairs) {
    const [player1, player2] = pair

    for (const machine of availableMachines) {
      const score1 = playerMachineScores[player1][machine] || 0
      const score2 = playerMachineScores[player2][machine] || 0

      // We want pairs where both players are good, not just one excellent player
      // This is a weighted average that favors balanced pairs
      const combinedScore = (score1 + score2) * 0.5 + Math.min(score1, score2) * 0.5

      allCombinations.push({ pair, machine, score: combinedScore })
    }
  }

  // Sort by score (highest first)
  allCombinations.sort((a, b) => b.score - a.score)

  // Greedy selection: take top combinations ensuring no player or machine is used twice
  const selectedCombinations: Array<{ pair: [string, string]; machine: string; score: number }> = []
  const usedPlayers = new Set<string>()
  const usedMachines = new Set<string>()

  for (const combo of allCombinations) {
    if (selectedCombinations.length >= numMachinesToPick) break

    const [player1, player2] = combo.pair
    if (usedPlayers.has(player1) || usedPlayers.has(player2) || usedMachines.has(combo.machine)) {
      continue
    }

    selectedCombinations.push(combo)
    usedPlayers.add(player1)
    usedPlayers.add(player2)
    usedMachines.add(combo.machine)
  }

  // Convert to recommendations format
  return selectedCombinations.map(c => ({
    machine: c.machine,
    players: [c.pair[0], c.pair[1]],
    score: c.score
  }))
}
