import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { applyVenueMachineListOverrides } from '@/lib/venue-machine-lists'
import { cache, createCacheKey, TTL } from '@/lib/cache'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const venue = searchParams.get('venue')
    const opponent = searchParams.get('opponent')
    const seasonStart = parseInt(searchParams.get('seasonStart') || '20')
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '22')
    const teamVenueSpecific = searchParams.get('teamVenueSpecific') === 'true'
    const twcVenueSpecific = searchParams.get('twcVenueSpecific') === 'true'

    if (!venue || !opponent) {
      return NextResponse.json(
        { error: 'Venue and opponent are required' },
        { status: 400 }
      )
    }

    // Check cache first
    const cacheKey = createCacheKey('machine-advantages', {
      venue,
      opponent,
      seasonStart,
      seasonEnd,
      teamVenueSpecific,
      twcVenueSpecific
    })

    const cachedData = cache.get(cacheKey)
    if (cachedData) {
      console.log('Cache HIT for machine-advantages:', cacheKey)
      return NextResponse.json(cachedData)
    }

    console.log('Cache MISS for machine-advantages:', cacheKey)

    const twcTeam = 'The Wrecking Crew'

    // Collect all player scores for each machine
    const machineData: Record<string, {
      twcScores: number[]
      opponentScores: number[]
      venueScores: number[]
      twcPlayers: Record<string, { scores: number[], count: number }>
    }> = {}

    // Track which machines are at the venue in the MOST RECENT SEASON (to match stats page)
    const machinesAtVenue = new Set<string>()

    for (let season = seasonStart; season <= seasonEnd; season++) {
      const seasonDir = path.join(process.cwd(), 'public', 'mnp-data-archive', `season-${season}`, 'matches')

      if (!fs.existsSync(seasonDir)) continue

      const files = fs.readdirSync(seasonDir)

      for (const file of files) {
        if (!file.endsWith('.json')) continue

        const matchData = JSON.parse(fs.readFileSync(path.join(seasonDir, file), 'utf-8'))

        const matchVenue = matchData.venue?.name || ''
        const isAtVenue = matchVenue.toLowerCase() === venue.toLowerCase()

        const rounds = matchData.rounds || []
        for (const round of rounds) {
          const games = round.games || []
          for (const game of games) {
            if (!game.machine) continue

            const machine = game.machine

            // Track machines at this venue ONLY in the most recent season (to match stats page)
            if (isAtVenue && season === seasonEnd) {
              machinesAtVenue.add(machine)
            }

            if (!machineData[machine]) {
              machineData[machine] = {
                twcScores: [],
                opponentScores: [],
                venueScores: [],
                twcPlayers: {}
              }
            }

            // Process each player position
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

              // Add to venue average (always at this venue for venue average)
              if (isAtVenue) {
                machineData[machine].venueScores.push(score)
              }

              // Add to team-specific data based on venue-specific settings
              if (playerTeam.toLowerCase() === twcTeam.toLowerCase() && isRoster) {
                // Include TWC data if: venue-specific is true AND at venue, OR venue-specific is false
                if ((twcVenueSpecific && isAtVenue) || !twcVenueSpecific) {
                  machineData[machine].twcScores.push(score)

                  if (!machineData[machine].twcPlayers[playerName]) {
                    machineData[machine].twcPlayers[playerName] = { scores: [], count: 0 }
                  }
                  machineData[machine].twcPlayers[playerName].scores.push(score)
                  machineData[machine].twcPlayers[playerName].count++
                }
              } else if (playerTeam.toLowerCase() === opponent.toLowerCase() && isRoster) {
                // Include opponent data if: venue-specific is true AND at venue, OR venue-specific is false
                if ((teamVenueSpecific && isAtVenue) || !teamVenueSpecific) {
                  machineData[machine].opponentScores.push(score)
                }
              }
            }
          }
        }
      }
    }

    // Apply venue machine list overrides (included/excluded machines)
    let finalMachineList = Array.from(machinesAtVenue)
    finalMachineList = applyVenueMachineListOverrides(venue, finalMachineList)

    // Calculate advantages for each machine (only for machines in final list)
    const advantages = Object.entries(machineData)
      .filter(([machine]) => finalMachineList.includes(machine))
      .map(([machine, data]) => {
      const venueAvg = data.venueScores.length > 0
        ? data.venueScores.reduce((sum, s) => sum + s, 0) / data.venueScores.length
        : 0

      const twcAvg = data.twcScores.length > 0
        ? data.twcScores.reduce((sum, s) => sum + s, 0) / data.twcScores.length
        : 0

      const opponentAvg = data.opponentScores.length > 0
        ? data.opponentScores.reduce((sum, s) => sum + s, 0) / data.opponentScores.length
        : 0

      const twcPctOfVenue = venueAvg > 0 ? (twcAvg / venueAvg) * 100 : 100
      const opponentPctOfVenue = venueAvg > 0 ? (opponentAvg / venueAvg) * 100 : 100

      const statisticalAdvantage = twcPctOfVenue - opponentPctOfVenue
      const experienceAdvantage = data.twcScores.length - data.opponentScores.length

      // Calculate composite score (higher is better for TWC)
      const compositeScore = statisticalAdvantage + (experienceAdvantage * 0.1)

      // Determine advantage level
      let advantageLevel = 'Low'
      if (compositeScore > 10) advantageLevel = 'High'
      else if (compositeScore > 0) advantageLevel = 'Medium'

      // Get top TWC players on this machine
      const topPlayers = Object.entries(data.twcPlayers)
        .map(([name, stats]) => ({
          name,
          avg: stats.scores.reduce((sum, s) => sum + s, 0) / stats.scores.length,
          count: stats.count
        }))
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 3)
        .map(p => p.name)

      return {
        machine,
        compositeScore,
        twcPctOfVenue,
        opponentPctOfVenue,
        statisticalAdvantage,
        experienceAdvantage,
        advantageLevel,
        topTwcPlayers: topPlayers,
        twcPlays: data.twcScores.length,
        opponentPlays: data.opponentScores.length
      }
    }).sort((a, b) => b.compositeScore - a.compositeScore)

    // Get all TWC players who have played at this venue
    const allPlayers = new Set<string>()
    const rosterPlayers = new Set<string>()

    for (let season = seasonStart; season <= seasonEnd; season++) {
      const seasonDir = path.join(process.cwd(), 'public', 'mnp-data-archive', `season-${season}`, 'matches')

      if (!fs.existsSync(seasonDir)) continue

      const files = fs.readdirSync(seasonDir)

      for (const file of files) {
        if (!file.endsWith('.json')) continue

        const matchData = JSON.parse(fs.readFileSync(path.join(seasonDir, file), 'utf-8'))

        // Check if TWC played in this match
        const isTwcHome = matchData.home?.name?.toLowerCase() === twcTeam.toLowerCase()
        const isTwcAway = matchData.away?.name?.toLowerCase() === twcTeam.toLowerCase()

        if (isTwcHome && matchData.home?.lineup) {
          matchData.home.lineup.forEach((player: any) => {
            allPlayers.add(player.name)
            if (!player.sub) {
              rosterPlayers.add(player.name)
            }
          })
        }

        if (isTwcAway && matchData.away?.lineup) {
          matchData.away.lineup.forEach((player: any) => {
            allPlayers.add(player.name)
            if (!player.sub) {
              rosterPlayers.add(player.name)
            }
          })
        }
      }
    }

    const result = {
      advantages,
      players: Array.from(allPlayers).sort(),
      rosterPlayers: Array.from(rosterPlayers).sort()
    }

    // Cache the result for 1 hour
    cache.set(cacheKey, result, TTL.ONE_HOUR)

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error calculating machine advantages:', error)
    return NextResponse.json(
      { error: 'Failed to calculate machine advantages' },
      { status: 500 }
    )
  }
}
