import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const playerName = searchParams.get('player')
    const currentSeason = 22

    if (!playerName) {
      return NextResponse.json(
        { error: 'Player parameter is required' },
        { status: 400 }
      )
    }

    console.log('Finding top 10 achievements for player:', playerName)

    interface Score {
      player: string
      score: number
      venue: string
      season: number
      machine: string
    }

    const allScores: Score[] = []

    // Get all scores from match data
    for (let season = 20; season <= 22; season++) {
      const seasonDir = path.join(process.cwd(), 'public', 'mnp-data-archive', `season-${season}`, 'matches')

      if (!fs.existsSync(seasonDir)) continue

      const files = fs.readdirSync(seasonDir)

      for (const file of files) {
        if (!file.endsWith('.json')) continue

        const matchData = JSON.parse(fs.readFileSync(path.join(seasonDir, file), 'utf-8'))
        const matchVenue = matchData.venue?.name || ''

        const rounds = matchData.rounds || []
        for (const round of rounds) {
          const games = round.games || []
          for (const game of games) {
            // Check all player positions
            for (let i = 1; i <= 4; i++) {
              const playerKey = game[`player_${i}`]
              const score = game[`score_${i}`]

              if (!playerKey || score === undefined) continue

              // Find player name
              let foundPlayerName = ''

              if (matchData.home?.lineup) {
                const p = matchData.home.lineup.find((pl: any) => pl.key === playerKey)
                if (p) foundPlayerName = p.name
              }

              if (!foundPlayerName && matchData.away?.lineup) {
                const p = matchData.away.lineup.find((pl: any) => pl.key === playerKey)
                if (p) foundPlayerName = p.name
              }

              if (foundPlayerName) {
                allScores.push({
                  player: foundPlayerName,
                  score,
                  venue: matchVenue,
                  season,
                  machine: game.machine
                })
              }
            }
          }
        }
      }
    }

    console.log(`Found ${allScores.length} total scores across all players`)

    // Find achievements for this player
    const achievements: any[] = []

    // Group scores by machine
    const scoresByMachine = allScores.reduce((acc, score) => {
      if (!acc[score.machine]) acc[score.machine] = []
      acc[score.machine].push(score)
      return acc
    }, {} as Record<string, Score[]>)

    // For each machine, check if player has top 10 scores
    for (const [machine, machineScores] of Object.entries(scoresByMachine)) {
      // League-wide this season
      const seasonScores = machineScores
        .filter(s => s.season === currentSeason)
        .sort((a, b) => b.score - a.score)

      const playerSeasonScores = seasonScores.filter(s => s.player === playerName)

      playerSeasonScores.forEach(playerScore => {
        const rank = seasonScores.findIndex(s => s.score === playerScore.score && s.player === playerName && s.venue === playerScore.venue) + 1
        if (rank <= 10) {
          achievements.push({
            machine,
            score: playerScore.score,
            rank,
            context: 'League-Wide This Season',
            venue: playerScore.venue,
            season: currentSeason
          })
        }
      })

      // League-wide all-time
      const allTimeScores = [...machineScores].sort((a, b) => b.score - a.score)
      const playerAllTimeScores = allTimeScores.filter(s => s.player === playerName)

      playerAllTimeScores.forEach(playerScore => {
        const rank = allTimeScores.findIndex(s => s.score === playerScore.score && s.player === playerName && s.venue === playerScore.venue) + 1
        if (rank <= 10) {
          // Don't duplicate if already in season top 10
          const alreadyListed = achievements.some(a =>
            a.machine === machine &&
            a.score === playerScore.score &&
            a.venue === playerScore.venue &&
            a.context === 'League-Wide This Season'
          )
          if (!alreadyListed) {
            achievements.push({
              machine,
              score: playerScore.score,
              rank,
              context: 'League-Wide All-Time',
              venue: playerScore.venue,
              season: playerScore.season
            })
          }
        }
      })

      // Venue-specific this season
      const venueGroups = machineScores
        .filter(s => s.season === currentSeason)
        .reduce((acc, score) => {
          if (!acc[score.venue]) acc[score.venue] = []
          acc[score.venue].push(score)
          return acc
        }, {} as Record<string, Score[]>)

      for (const [venue, venueScores] of Object.entries(venueGroups)) {
        const sortedVenueScores = venueScores.sort((a, b) => b.score - a.score)
        const playerVenueScores = sortedVenueScores.filter(s => s.player === playerName)

        playerVenueScores.forEach(playerScore => {
          const rank = sortedVenueScores.findIndex(s => s.score === playerScore.score && s.player === playerName) + 1
          if (rank <= 10) {
            const alreadyListed = achievements.some(a =>
              a.machine === machine &&
              a.score === playerScore.score &&
              a.venue === venue &&
              (a.context === 'League-Wide This Season' || a.context === 'League-Wide All-Time')
            )
            if (!alreadyListed) {
              achievements.push({
                machine,
                score: playerScore.score,
                rank,
                context: `This Season at ${venue}`,
                venue,
                season: currentSeason
              })
            }
          }
        })
      }

      // Venue-specific all-time
      const allTimeVenueGroups = machineScores.reduce((acc, score) => {
        if (!acc[score.venue]) acc[score.venue] = []
        acc[score.venue].push(score)
        return acc
      }, {} as Record<string, Score[]>)

      for (const [venue, venueScores] of Object.entries(allTimeVenueGroups)) {
        const sortedVenueScores = venueScores.sort((a, b) => b.score - a.score)
        const playerVenueScores = sortedVenueScores.filter(s => s.player === playerName)

        playerVenueScores.forEach(playerScore => {
          const rank = sortedVenueScores.findIndex(s => s.score === playerScore.score && s.player === playerName) + 1
          if (rank <= 10) {
            const alreadyListed = achievements.some(a =>
              a.machine === machine &&
              a.score === playerScore.score &&
              a.venue === venue &&
              a.context !== `All-Time at ${venue}`
            )
            if (!alreadyListed) {
              achievements.push({
                machine,
                score: playerScore.score,
                rank,
                context: `All-Time at ${venue}`,
                venue,
                season: playerScore.season
              })
            }
          }
        })
      }
    }

    // Sort achievements by rank
    achievements.sort((a, b) => a.rank - b.rank)

    console.log(`Found ${achievements.length} top 10 achievements for ${playerName}`)

    return NextResponse.json({ achievements })
  } catch (error) {
    console.error('Error fetching player achievements:', error)
    return NextResponse.json(
      { error: 'Failed to fetch achievements' },
      { status: 500 }
    )
  }
}
