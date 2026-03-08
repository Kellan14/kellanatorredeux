import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { getVenueVariations } from '@/lib/venue-mappings'
import { getAllMachineVariations } from '@/lib/machine-mappings'

export const dynamic = 'force-dynamic';

type StatsMap = Map<string, Map<string, { total: number; count: number }>>

function buildPlayerMachineStats(games: any[], availablePlayers: string[]): StatsMap {
  const stats: StatsMap = new Map()
  for (const game of games) {
    for (let i = 1; i <= 4; i++) {
      const playerName = game[`player_${i}_name`]
      const score = game[`player_${i}_score`]
      if (!playerName || score == null || !availablePlayers.includes(playerName)) continue
      if (!stats.has(playerName)) stats.set(playerName, new Map())
      const playerStats = stats.get(playerName)!
      if (!playerStats.has(game.machine)) playerStats.set(game.machine, { total: 0, count: 0 })
      const ms = playerStats.get(game.machine)!
      ms.total += score
      ms.count++
    }
  }
  return stats
}

function getBlendedAvg(
  player: string,
  machine: string,
  venueStats: StatsMap,
  allStats: StatsMap,
  venueWeight: number
): { avg: number; source: 'venue' | 'all' | 'blended' | 'none' } {
  const vs = venueStats.get(player)?.get(machine)
  const as_ = allStats.get(player)?.get(machine)
  const venueAvg = vs ? vs.total / vs.count : null
  const allAvg = as_ ? as_.total / as_.count : null

  if (venueAvg !== null && allAvg !== null) {
    return { avg: venueAvg * venueWeight + allAvg * (1 - venueWeight), source: 'blended' }
  } else if (venueAvg !== null) {
    return { avg: venueAvg, source: 'venue' }
  } else if (allAvg !== null) {
    return { avg: allAvg, source: 'all' }
  }
  return { avg: 0, source: 'none' }
}

interface AdvantageData {
  twcPctOfVenue: number
  opponentPctOfVenue: number
  statisticalAdvantage: number
  experienceAdvantage: number
  advantageLevel: string
  compositeScore: number
  twcPlays: number
}

function computePlayerAdvantage(
  assignedPlayers: string[],
  machine: string,
  venueGames: any[],
  nonVenueGames: any[],
  opponentName: string,
  teamNameMap: Record<string, string>,
  vw: number,
  teamName: string,
  opponentPlayers?: string[]
): AdvantageData {
  // Build TWC stats from assigned players only
  let twcVenueTotal = 0, twcVenueCount = 0, twcNonVenueTotal = 0, twcNonVenueCount = 0
  let oppVenueTotal = 0, oppVenueCount = 0, oppNonVenueTotal = 0, oppNonVenueCount = 0

  const processGames = (games: any[], isVenue: boolean) => {
    for (const game of games) {
      if (game.machine !== machine) continue
      for (let i = 1; i <= 4; i++) {
        const playerName = game[`player_${i}_name`]
        const teamKey = game[`player_${i}_team`]
        const score = game[`player_${i}_score`]
        if (!score || !teamKey) continue
        const teamDisplayName = teamNameMap[teamKey]
        if (!teamDisplayName) continue

        // TWC side: only assigned players
        if (teamDisplayName === teamName && assignedPlayers.includes(playerName)) {
          if (isVenue) { twcVenueTotal += score; twcVenueCount++ }
          else { twcNonVenueTotal += score; twcNonVenueCount++ }
        }
        // Opponent side: filter by opponentPlayers if provided
        if (teamDisplayName === opponentName) {
          if (!opponentPlayers || opponentPlayers.length === 0 || opponentPlayers.includes(playerName)) {
            if (isVenue) { oppVenueTotal += score; oppVenueCount++ }
            else { oppNonVenueTotal += score; oppNonVenueCount++ }
          }
        }
      }
    }
  }

  processGames(venueGames, true)
  processGames(nonVenueGames, false)

  // Blend TWC (assigned players only)
  const twcVenueAvg = twcVenueCount > 0 ? twcVenueTotal / twcVenueCount : null
  const twcNonVenueAvg = twcNonVenueCount > 0 ? twcNonVenueTotal / twcNonVenueCount : null
  let twcAvg = 0, twcCount = 0
  if (twcVenueAvg !== null && twcNonVenueAvg !== null) {
    twcAvg = twcVenueAvg * vw + twcNonVenueAvg * (1 - vw)
    twcCount = twcVenueCount + twcNonVenueCount
  } else if (twcVenueAvg !== null) {
    twcAvg = twcVenueAvg; twcCount = twcVenueCount
  } else if (twcNonVenueAvg !== null) {
    twcAvg = twcNonVenueAvg; twcCount = twcNonVenueCount
  }

  // Blend opponent
  const oppVenueAvg = oppVenueCount > 0 ? oppVenueTotal / oppVenueCount : null
  const oppNonVenueAvg = oppNonVenueCount > 0 ? oppNonVenueTotal / oppNonVenueCount : null
  let oppAvg = 0, oppCount = 0
  if (oppVenueAvg !== null && oppNonVenueAvg !== null) {
    oppAvg = oppVenueAvg * vw + oppNonVenueAvg * (1 - vw)
    oppCount = oppVenueCount + oppNonVenueCount
  } else if (oppVenueAvg !== null) {
    oppAvg = oppVenueAvg; oppCount = oppVenueCount
  } else if (oppNonVenueAvg !== null) {
    oppAvg = oppNonVenueAvg; oppCount = oppNonVenueCount
  }

  // Venue average baseline (all scores at venue on this machine)
  const venueScores: number[] = []
  for (const game of venueGames) {
    if (game.machine !== machine) continue
    for (let i = 1; i <= 4; i++) {
      const score = game[`player_${i}_score`]
      if (score) venueScores.push(score)
    }
  }
  const venueBaseline = venueScores.length > 0 ? venueScores.reduce((a, b) => a + b, 0) / venueScores.length : 0

  let twcPctOfVenue: number, opponentPctOfVenue: number, statisticalAdvantage: number
  if (venueBaseline > 0) {
    twcPctOfVenue = (twcAvg / venueBaseline) * 100
    opponentPctOfVenue = (oppAvg / venueBaseline) * 100
    statisticalAdvantage = twcPctOfVenue - opponentPctOfVenue
  } else {
    const maxAvg = Math.max(twcAvg, oppAvg, 1)
    twcPctOfVenue = (twcAvg / maxAvg) * 100
    opponentPctOfVenue = (oppAvg / maxAvg) * 100
    statisticalAdvantage = twcPctOfVenue - opponentPctOfVenue
  }

  const experienceAdvantage = twcCount - oppCount
  let advantageLevel = 'Low'
  if (statisticalAdvantage > 10 || experienceAdvantage > 10) advantageLevel = 'High'
  else if (statisticalAdvantage > 5 || experienceAdvantage > 5) advantageLevel = 'Medium'

  return {
    twcPctOfVenue,
    opponentPctOfVenue,
    statisticalAdvantage,
    experienceAdvantage,
    advantageLevel,
    compositeScore: statisticalAdvantage + (experienceAdvantage * 0.5),
    twcPlays: twcCount,
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { venue, opponent, seasonStart = 20, seasonEnd = 22, format, machines, availablePlayers, venueWeight = 0.7, exclusions = {}, mustPlay = [], opponentPlayers } = body

    if (!venue || !opponent || !machines || !availablePlayers || availablePlayers.length === 0) {
      return NextResponse.json(
        { error: 'Invalid parameters' },
        { status: 400 }
      )
    }

    const vw = Math.max(0, Math.min(1, venueWeight))
    const playersPerMachine = format === 'singles' ? 1 : 2

    if (availablePlayers.length < machines.length * playersPerMachine) {
      return NextResponse.json(
        { error: `Not enough players. Need ${machines.length * playersPerMachine}, have ${availablePlayers.length}` },
        { status: 400 }
      )
    }

    // Build machine variation lookup for normalizing game machine names
    const machineVariationToCanonical = new Map<string, string>()
    for (const machine of machines) {
      for (const variation of getAllMachineVariations([machine as string])) {
        machineVariationToCanonical.set(variation, machine as string)
      }
    }

    // Fetch venue-specific games (all machines at venue for advantage baseline)
    const venueVariations = getVenueVariations(venue)
    let venueGames: any[] = []
    try {
      venueGames = await fetchAllRecords<any>(
        () => supabase
          .from('games')
          .select('*')
          .in('venue', venueVariations)
          .gte('season', seasonStart)
          .lte('season', seasonEnd)
          .order('id', { ascending: true })
      )
    } catch (error) {
      console.error('Error fetching venue games:', error)
    }

    // Normalize machine names to canonical
    for (const game of venueGames) {
      const canonical = machineVariationToCanonical.get(game.machine)
      if (canonical) game.machine = canonical
    }

    // Fetch all-venue games (excluding venue-specific)
    let allVenueGames: any[] = []
    try {
      const allGames = await fetchAllRecords<any>(
        () => supabase
          .from('games')
          .select('*')
          .gte('season', seasonStart)
          .lte('season', seasonEnd)
          .order('id', { ascending: true })
      )
      const venueGameIds = new Set(venueGames.map(g => g.id))
      allVenueGames = allGames.filter(g => !venueGameIds.has(g.id))
    } catch (error) {
      console.error('Error fetching all-venue games:', error)
    }

    // Normalize non-venue game machine names too
    for (const game of allVenueGames) {
      const canonical = machineVariationToCanonical.get(game.machine)
      if (canonical) game.machine = canonical
    }

    // Build team name map for advantage calculation
    const teamKeys = new Set<string>()
    const allGamesForTeams = [...venueGames, ...allVenueGames]
    for (const game of allGamesForTeams) {
      for (let i = 1; i <= 4; i++) {
        const teamKey = game[`player_${i}_team`]
        if (teamKey) teamKeys.add(teamKey)
      }
    }
    const { data: teamsData } = await supabase
      .from('teams')
      .select('team_key, team_name')
      .in('team_key', Array.from(teamKeys))
    const teamNameMap: Record<string, string> = {}
    ;(teamsData || []).forEach((t: any) => { teamNameMap[t.team_key] = t.team_name })
    const teamName = 'The Wrecking Crew'

    // Filter games to only requested machines for player stats
    const machineSet = new Set(machines as string[])
    const venueGamesFiltered = venueGames.filter(g => machineSet.has(g.machine))
    const allVenueGamesFiltered = allVenueGames.filter(g => machineSet.has(g.machine))

    // Build stats maps
    const venuePlayerStats = buildPlayerMachineStats(venueGamesFiltered, availablePlayers)
    const allPlayerStats = buildPlayerMachineStats(allVenueGamesFiltered, availablePlayers)

    // Compute venue averages per machine (for pctOfVenue calculation)
    const machineVenueAvgs = new Map<string, number>()
    for (const machine of machines) {
      const machineStr = machine as string
      const machineGames = venueGames.filter(g => g.machine === machineStr)
      const scores: number[] = []
      for (const g of machineGames) {
        for (let i = 1; i <= 4; i++) {
          const s = g[`player_${i}_score`]
          if (s != null && s > 0) scores.push(s)
        }
      }
      if (scores.length > 0) {
        machineVenueAvgs.set(machineStr, scores.reduce((a, b) => a + b, 0) / scores.length)
      }
    }

    // Fetch user inputs for all players/machines
    let userInputMap = new Map<string, { average: number | null; confidence: number | null }>()
    try {
      const { data: userInputs } = await supabase
        .from('user_machine_inputs')
        .select('player_name, machine_name, venue, average_score, confidence')
        .in('player_name', availablePlayers)
        .in('machine_name', machines)
        .eq('venue', venue) as { data: Array<{ player_name: string; machine_name: string; average_score: number | null; confidence: number | null }> | null }
      if (userInputs) {
        for (const ui of userInputs) {
          const key = `${ui.player_name}|${ui.machine_name}`
          userInputMap.set(key, { average: ui.average_score, confidence: ui.confidence })
        }
      }
    } catch (e) {
      // non-critical
    }

    // Greedy assignment: assign best player to each machine using blended scores
    // mustPlay players (sat out) are prioritized to ensure they get assigned
    const mustPlaySet = new Set<string>(mustPlay as string[])
    const assignments: Array<{
      machine: string
      players: string[]
      expectedAvg: number
      dataSource: string
      blendedScore: number
      stats: Array<{
        player: string
        pctOfVenue: number | null
        playsCount: number
        avgScore: number
        userAverage: number | null
        userConfidence: number | null
      }>
      advantage: AdvantageData
    }> = []
    const assignedPlayers = new Set<string>()

    for (const machine of machines) {
      const machineExclusions: string[] = exclusions[machine] || []
      const unassignedMustPlay = (availablePlayers as string[]).filter((p: string) => mustPlaySet.has(p) && !assignedPlayers.has(p))
      const hasMustPlayRemaining = unassignedMustPlay.length > 0
      const playersToAssign: Array<{ player: string; avg: number; source: string; isMustPlay: boolean }> = []

      for (const player of availablePlayers) {
        if (assignedPlayers.has(player)) continue
        if (machineExclusions.includes(player)) continue
        const blended = getBlendedAvg(player, machine, venuePlayerStats, allPlayerStats, vw)
        playersToAssign.push({ player, avg: blended.avg, source: blended.source, isMustPlay: mustPlaySet.has(player) })
      }

      playersToAssign.sort((a, b) => {
        if (hasMustPlayRemaining) {
          if (a.isMustPlay !== b.isMustPlay) return a.isMustPlay ? -1 : 1
        }
        return b.avg - a.avg
      })
      const selectedPlayers = playersToAssign.slice(0, playersPerMachine)

      selectedPlayers.forEach(p => assignedPlayers.add(p.player))

      const expectedAvg = selectedPlayers.reduce((sum, p) => sum + p.avg, 0) / selectedPlayers.length

      const sources = new Set(selectedPlayers.map(p => p.source))
      let dataSource = 'none'
      if (sources.has('blended')) dataSource = 'blended'
      else if (sources.has('venue')) dataSource = 'venue'
      else if (sources.has('all')) dataSource = 'all'

      // Build per-player stats
      const venueAvg = machineVenueAvgs.get(machine as string)
      const stats = selectedPlayers.map(p => {
        const vs = venuePlayerStats.get(p.player)?.get(machine as string)
        const as_ = allPlayerStats.get(p.player)?.get(machine as string)
        const totalPlays = (vs?.count || 0) + (as_?.count || 0)
        const pctOfVenue = venueAvg && p.avg > 0 ? Math.round((p.avg / venueAvg) * 100) : null
        const userInput = userInputMap.get(`${p.player}|${machine}`)
        return {
          player: p.player,
          pctOfVenue,
          playsCount: totalPlays,
          avgScore: Math.round(p.avg),
          userAverage: userInput?.average ?? null,
          userConfidence: userInput?.confidence ?? null,
        }
      })

      // Compute per-assignment advantage (TWC side = assigned players only)
      const advantage = computePlayerAdvantage(
        selectedPlayers.map(p => p.player),
        machine as string,
        venueGames,
        allVenueGames,
        opponent,
        teamNameMap,
        vw,
        teamName,
        opponentPlayers
      )

      assignments.push({
        machine: machine as string,
        players: selectedPlayers.map(p => p.player),
        expectedAvg,
        dataSource,
        blendedScore: Math.round(expectedAvg),
        stats,
        advantage,
      })
    }

    return NextResponse.json({
      assignments,
      format,
      totalExpectedScore: assignments.reduce((sum, a) => sum + a.expectedAvg, 0),
      venueWeight: vw
    })
  } catch (error) {
    console.error('Error optimizing assignments:', error)
    return NextResponse.json(
      { error: 'Failed to optimize assignments' },
      { status: 500 }
    )
  }
}
