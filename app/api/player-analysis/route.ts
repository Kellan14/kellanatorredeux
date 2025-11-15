import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { cache, createCacheKey, TTL } from '@/lib/cache'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const player = searchParams.get('player')
    const venue = searchParams.get('venue')
    const seasonStart = parseInt(searchParams.get('seasonStart') || '20')
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '22')
    const allVenues = searchParams.get('allVenues') === 'true'

    if (!player || !venue) {
      return NextResponse.json(
        { error: 'Player and venue parameters are required' },
        { status: 400 }
      )
    }

    // Check cache first
    const cacheKey = createCacheKey('player-analysis', {
      player,
      venue,
      seasonStart,
      seasonEnd,
      allVenues
    })

    const cachedData = cache.get(cacheKey)
    if (cachedData) {
      console.log('Cache HIT for player-analysis:', cacheKey)
      return NextResponse.json(cachedData)
    }

    console.log('Cache MISS for player-analysis:', cacheKey)

    // Get all machines at the venue first
    const venuesResponse = await fetch(`${request.url.split('/api')[0]}/api/venues`)
    const venuesData = await venuesResponse.json()
    const selectedVenue = venuesData.venues.find((v: any) =>
      v.name.toLowerCase() === venue.toLowerCase()
    )
    const venueMachines = new Set(selectedVenue?.machines || [])

    // Collect player data
    const playerData: any[] = []
    let totalGames = 0
    let uniqueVenues = new Set<string>()
    const machineStats: Record<string, {
      scores: number[],
      venues: Set<string>,
      venueBreakdown: Record<string, { scores: number[], count: number }>
    }> = {}

    // Search through seasons
    for (let season = seasonStart; season <= seasonEnd; season++) {
      const seasonDir = path.join(process.cwd(), 'public', 'mnp-data-archive', `season-${season}`, 'matches')

      if (!fs.existsSync(seasonDir)) continue

      const files = fs.readdirSync(seasonDir)

      for (const file of files) {
        if (!file.endsWith('.json')) continue

        const matchData = JSON.parse(fs.readFileSync(path.join(seasonDir, file), 'utf-8'))
        const matchVenue = matchData.venue?.name || ''

        // Filter by venue if not showing all venues
        if (!allVenues && matchVenue.toLowerCase() !== venue.toLowerCase()) {
          continue
        }

        // Process rounds and games
        const rounds = matchData.rounds || []
        for (const round of rounds) {
          const games = round.games || []
          for (const game of games) {
            const machine = game.machine

            // Only process machines that exist at the selected venue
            if (!machine || !venueMachines.has(machine)) continue

            // Check all player positions
            for (let i = 1; i <= 4; i++) {
              const playerKey = game[`player_${i}`]
              const score = game[`score_${i}`]

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
                totalGames++
                uniqueVenues.add(matchVenue)

                if (!machineStats[machine]) {
                  machineStats[machine] = {
                    scores: [],
                    venues: new Set<string>(),
                    venueBreakdown: {}
                  }
                }

                machineStats[machine].scores.push(score)
                machineStats[machine].venues.add(matchVenue)

                if (!machineStats[machine].venueBreakdown[matchVenue]) {
                  machineStats[machine].venueBreakdown[matchVenue] = { scores: [], count: 0 }
                }
                machineStats[machine].venueBreakdown[matchVenue].scores.push(score)
                machineStats[machine].venueBreakdown[matchVenue].count++

                break // Only count once per game
              }
            }
          }
        }
      }
    }

    // Get venue averages for comparison
    const venueAverages: Record<string, number> = {}
    for (let season = seasonStart; season <= seasonEnd; season++) {
      const seasonDir = path.join(process.cwd(), 'public', 'mnp-data-archive', `season-${season}`, 'matches')

      if (!fs.existsSync(seasonDir)) continue

      const files = fs.readdirSync(seasonDir)

      for (const file of files) {
        if (!file.endsWith('.json')) continue

        const matchData = JSON.parse(fs.readFileSync(path.join(seasonDir, file), 'utf-8'))
        const matchVenue = matchData.venue?.name || ''

        // Only get averages for the selected venue
        if (matchVenue.toLowerCase() !== venue.toLowerCase()) continue

        const rounds = matchData.rounds || []
        for (const round of rounds) {
          const games = round.games || []
          for (const game of games) {
            const machine = game.machine
            if (!machine || !venueMachines.has(machine)) continue

            if (!venueAverages[machine]) {
              venueAverages[machine] = 0
            }

            let totalScore = 0
            let playerCount = 0

            for (let i = 1; i <= 4; i++) {
              const score = game[`score_${i}`]
              if (score !== undefined) {
                totalScore += score
                playerCount++
              }
            }

            if (playerCount > 0) {
              // Store all scores for proper averaging later
              if (!venueAverages[machine]) {
                venueAverages[machine] = totalScore / playerCount
              } else {
                venueAverages[machine] = (venueAverages[machine] + totalScore / playerCount) / 2
              }
            }
          }
        }
      }
    }

    // Calculate machine performance
    const machinePerformance = Object.entries(machineStats).map(([machine, stats]) => {
      const avgScore = stats.scores.reduce((sum, s) => sum + s, 0) / stats.scores.length
      const venueAvg = venueAverages[machine] || 0
      const pctOfVenue = venueAvg > 0 ? (avgScore / venueAvg * 100) : 0
      const timesPlayed = stats.scores.length
      const venuesPlayed = stats.venues.size

      // Find best venue for this machine
      let bestVenue = 'N/A'
      let bestVenueAvg = 0

      Object.entries(stats.venueBreakdown).forEach(([venueName, data]) => {
        const venueAvgScore = data.scores.reduce((sum, s) => sum + s, 0) / data.scores.length
        if (venueAvgScore > bestVenueAvg) {
          bestVenueAvg = venueAvgScore
          bestVenue = venueName
        }
      })

      return {
        machine,
        avgScore,
        pctOfVenue,
        timesPlayed,
        venuesPlayed,
        bestVenue,
        bestVenueAvg
      }
    })

    // Sort by % of venue (descending)
    machinePerformance.sort((a, b) => b.pctOfVenue - a.pctOfVenue)

    const result = {
      player,
      totalGames,
      uniqueMachines: Object.keys(machineStats).length,
      venuesPlayed: uniqueVenues.size,
      machinePerformance,
      allVenues
    }

    // Cache the result for 24 hours
    cache.set(cacheKey, result, TTL.ONE_DAY)

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching player analysis:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player analysis' },
      { status: 500 }
    )
  }
}
