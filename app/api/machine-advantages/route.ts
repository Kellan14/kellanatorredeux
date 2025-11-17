import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { applyVenueMachineListOverrides } from '@/lib/venue-machine-lists'

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const venue = searchParams.get('venue')
    const opponent = searchParams.get('opponent')
    const teamName = searchParams.get('teamName') || 'The Wrecking Crew'
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

    // Get machines at venue from latest season
    const latestSeason = seasonEnd
    let venueMachinesData
    try {
      venueMachinesData = await fetchAllRecords<{ machine: string }>(
        supabase
          .from('games')
          .select('machine')
          .eq('venue', venue)
          .eq('season', latestSeason)
      )
    } catch (error) {
      console.error('Error fetching venue machines:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    let machinesAtVenue = Array.from(new Set(venueMachinesData?.map(g => g.machine) || []))
    machinesAtVenue = applyVenueMachineListOverrides(venue, machinesAtVenue)

    // Query all games for both teams
    let gamesData
    try {
      gamesData = await fetchAllRecords<any>(
        supabase
          .from('games')
          .select('*')
          .gte('season', seasonStart)
          .lte('season', seasonEnd)
      )
    } catch (error) {
      console.error('Error fetching games:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Build team name map
    const teamKeys = new Set<string>()
    gamesData.forEach((game: any) => {
      for (let i = 1; i <= 4; i++) {
        const teamKey = game[`player_${i}_team`]
        if (teamKey) teamKeys.add(teamKey)
      }
      if (game.home_team) teamKeys.add(game.home_team)
      if (game.away_team) teamKeys.add(game.away_team)
    })

    const { data: teamsData } = await supabase
      .from('teams')
      .select('team_key, team_name')
      .in('team_key', Array.from(teamKeys))

    const teamNameMap: Record<string, string> = {}
    const teamKeyMap: Record<string, string> = {}
    ;(teamsData || []).forEach((t: any) => {
      teamNameMap[t.team_key] = t.team_name
      teamKeyMap[t.team_name] = t.team_key
    })

    const twcTeamKey = teamKeyMap[teamName]
    const opponentTeamKey = teamKeyMap[opponent]

    // Calculate machine advantages
    const machineStats = new Map<string, { twcTotal: number; twcCount: number; oppTotal: number; oppCount: number }>()

    for (const game of gamesData) {
      // Only process machines at venue
      if (!machinesAtVenue.includes(game.machine)) continue

      // Apply venue-specific filtering
      const isTWCVenueMatch = game.venue === venue
      const skipTWC = twcVenueSpecific && !isTWCVenueMatch
      const skipOpp = teamVenueSpecific && !isTWCVenueMatch

      if (!machineStats.has(game.machine)) {
        machineStats.set(game.machine, { twcTotal: 0, twcCount: 0, oppTotal: 0, oppCount: 0 })
      }

      const stats = machineStats.get(game.machine)!

      for (let i = 1; i <= 4; i++) {
        const teamKey = game[`player_${i}_team`]
        const score = game[`player_${i}_score`]
        const teamDisplayName = teamNameMap[teamKey]

        if (!score || !teamDisplayName) continue

        if (teamDisplayName === teamName && !skipTWC) {
          stats.twcTotal += score
          stats.twcCount++
        } else if (teamDisplayName === opponent && !skipOpp) {
          stats.oppTotal += score
          stats.oppCount++
        }
      }
    }

    // Calculate advantages
    const advantages = Array.from(machineStats.entries()).map(([machine, stats]) => {
      const twcAvg = stats.twcCount > 0 ? stats.twcTotal / stats.twcCount : 0
      const oppAvg = stats.oppCount > 0 ? stats.oppTotal / stats.oppCount : 0
      const advantage = twcAvg - oppAvg
      const advantagePct = oppAvg > 0 ? (advantage / oppAvg) * 100 : 0

      // Get venue average for % of venue calculations
      const allGamesOnMachine = gamesData.filter((g: any) => g.machine === machine && g.venue === venue)
      const venueScores = []
      for (const game of allGamesOnMachine) {
        for (let i = 1; i <= 4; i++) {
          const score = game[`player_${i}_score`]
          if (score) venueScores.push(score)
        }
      }
      const venueAvg = venueScores.length > 0 ? venueScores.reduce((a, b) => a + b, 0) / venueScores.length : 0

      const twcPctOfVenue = venueAvg > 0 ? (twcAvg / venueAvg) * 100 : 0
      const opponentPctOfVenue = venueAvg > 0 ? (oppAvg / venueAvg) * 100 : 0
      const statisticalAdvantage = twcPctOfVenue - opponentPctOfVenue
      const experienceAdvantage = stats.twcCount - stats.oppCount

      // Determine advantage level
      let advantageLevel = 'Low'
      if (statisticalAdvantage > 10 || experienceAdvantage > 10) {
        advantageLevel = 'High'
      } else if (statisticalAdvantage > 5 || experienceAdvantage > 5) {
        advantageLevel = 'Medium'
      }

      // Get top TWC players for this machine
      const playerScores = new Map<string, number[]>()
      for (const game of gamesData) {
        if (game.machine !== machine) continue
        if (twcVenueSpecific && game.venue !== venue) continue

        for (let i = 1; i <= 4; i++) {
          const teamKey = game[`player_${i}_team`]
          const player = game[`player_${i}`]
          const score = game[`player_${i}_score`]
          const teamDisplayName = teamNameMap[teamKey]

          if (teamDisplayName === teamName && player && score) {
            if (!playerScores.has(player)) {
              playerScores.set(player, [])
            }
            playerScores.get(player)!.push(score)
          }
        }
      }

      const playerAvgs = Array.from(playerScores.entries()).map(([player, scores]) => ({
        player,
        avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
        count: scores.length
      })).sort((a, b) => b.avgScore - a.avgScore)

      const topTwcPlayers = playerAvgs.slice(0, 3).map(p => p.player)

      const compositeScore = statisticalAdvantage + (experienceAdvantage * 0.5)

      return {
        machine,
        compositeScore,
        twcPctOfVenue,
        opponentPctOfVenue,
        statisticalAdvantage,
        experienceAdvantage,
        advantageLevel,
        topTwcPlayers,
        twcAverage: twcAvg,
        twcTimesPlayed: stats.twcCount,
        opponentAverage: oppAvg,
        opponentTimesPlayed: stats.oppCount,
        advantage,
        advantagePct,
        twcPlays: stats.twcCount
      }
    }).sort((a, b) => b.compositeScore - a.compositeScore)

    // Get all TWC players from player_stats with is_sub info
    let playerStatsData
    try {
      playerStatsData = await fetchAllRecords<{ player_name: string; is_sub: boolean }>(
        supabase
          .from('player_stats')
          .select('player_name, is_sub')
          .order('player_name')
      )
    } catch (error) {
      console.error('Error fetching player_stats:', error)
      // If player_stats fails, continue with empty arrays
      playerStatsData = []
    }

    const allTwcPlayers = Array.from(new Set((playerStatsData || []).map((p: any) => p.player_name))).filter(Boolean)

    // Create a map of player -> is_sub status
    const playerSubStatus = new Map<string, boolean>()
    ;(playerStatsData || []).forEach((p: any) => {
      if (p.player_name) {
        playerSubStatus.set(p.player_name, p.is_sub)
      }
    })

    // Get all TWC players from season 22 games
    const season22Games = gamesData.filter((g: any) => g.season === 22)
    const season22TwcPlayers = new Set<string>()

    for (const game of season22Games) {
      for (let i = 1; i <= 4; i++) {
        const teamKey = game[`player_${i}_team`]
        const player = game[`player_${i}`]
        const teamDisplayName = teamNameMap[teamKey]

        if (teamDisplayName === teamName && player) {
          season22TwcPlayers.add(player)
        }
      }
    }

    // Current roster = season 22 players with is_sub = false
    const rosterPlayers = Array.from(season22TwcPlayers)
      .filter(player => playerSubStatus.get(player) === false)
      .sort()

    // Get sub players who played in the last 3 seasons (20-22) but are NOT current roster
    const last3Seasons = [20, 21, 22]
    const subPlayers = new Set<string>()

    const recentGames = gamesData.filter((g: any) => last3Seasons.includes(g.season))

    for (const game of recentGames) {
      for (let i = 1; i <= 4; i++) {
        const teamKey = game[`player_${i}_team`]
        const player = game[`player_${i}`]
        const teamDisplayName = teamNameMap[teamKey]

        if (teamDisplayName === teamName && player) {
          // Only add if they're not in current roster
          if (!rosterPlayers.includes(player)) {
            subPlayers.add(player)
          }
        }
      }
    }

    const subPlayersList = Array.from(subPlayers).sort()

    return NextResponse.json({
      advantages,
      players: allTwcPlayers,
      rosterPlayers: rosterPlayers,
      subPlayers: subPlayersList,
      venue,
      opponent,
      teamName
    })
  } catch (error) {
    console.error('Error calculating machine advantages:', error)
    return NextResponse.json(
      { error: 'Failed to calculate machine advantages' },
      { status: 500 }
    )
  }
}
