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

      return {
        machine,
        twcAverage: twcAvg,
        twcTimesPlayed: stats.twcCount,
        opponentAverage: oppAvg,
        opponentTimesPlayed: stats.oppCount,
        advantage,
        advantagePct
      }
    }).sort((a, b) => b.advantage - a.advantage)

    return NextResponse.json({
      advantages,
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
