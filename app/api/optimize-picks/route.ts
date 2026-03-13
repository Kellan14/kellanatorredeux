import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'
import { getVenueVariations } from '@/lib/venue-mappings'
import { getAllMachineVariations, getCanonicalMachineKey } from '@/lib/machine-mappings'
import { calculatePlayerMachineStats, type UserInputData } from '@/lib/strategy/stats-calculator'
import { calculatePerformanceScore, type ScoreWeights } from '@/lib/strategy/calculator'
import { getScoreLimits, isScoreValid } from '@/lib/score-limits'
import type { PlayerMachineStats } from '@/types/strategy'

export const dynamic = 'force-dynamic';

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
  opponentPlayers?: string[],
  scoreLimits?: Record<string, number>
): AdvantageData {
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
        if (scoreLimits && !isScoreValid(machine, score, scoreLimits)) continue
        const teamDisplayName = teamNameMap[teamKey]
        if (!teamDisplayName) continue

        if (teamDisplayName === teamName && assignedPlayers.includes(playerName)) {
          if (isVenue) { twcVenueTotal += score; twcVenueCount++ }
          else { twcNonVenueTotal += score; twcNonVenueCount++ }
        }
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

  const twcVenueAvg = twcVenueCount > 0 ? twcVenueTotal / twcVenueCount : null
  const twcNonVenueAvg = twcNonVenueCount > 0 ? twcNonVenueTotal / twcNonVenueCount : null
  let twcAvg = 0, twcCount = 0
  if (twcVenueAvg !== null && twcNonVenueAvg !== null) {
    twcAvg = twcVenueAvg * vw + twcNonVenueAvg * (1 - vw); twcCount = twcVenueCount + twcNonVenueCount
  } else if (twcVenueAvg !== null) {
    twcAvg = twcVenueAvg; twcCount = twcVenueCount
  } else if (twcNonVenueAvg !== null) {
    twcAvg = twcNonVenueAvg; twcCount = twcNonVenueCount
  }

  const oppVenueAvg = oppVenueCount > 0 ? oppVenueTotal / oppVenueCount : null
  const oppNonVenueAvg = oppNonVenueCount > 0 ? oppNonVenueTotal / oppNonVenueCount : null
  let oppAvg = 0, oppCount = 0
  if (oppVenueAvg !== null && oppNonVenueAvg !== null) {
    oppAvg = oppVenueAvg * vw + oppNonVenueAvg * (1 - vw); oppCount = oppVenueCount + oppNonVenueCount
  } else if (oppVenueAvg !== null) {
    oppAvg = oppVenueAvg; oppCount = oppVenueCount
  } else if (oppNonVenueAvg !== null) {
    oppAvg = oppNonVenueAvg; oppCount = oppNonVenueCount
  }

  const venueScores: number[] = []
  for (const game of venueGames) {
    if (game.machine !== machine) continue
    for (let i = 1; i <= 4; i++) {
      const score = game[`player_${i}_score`]
      if (score && (!scoreLimits || isScoreValid(machine, score, scoreLimits))) venueScores.push(score)
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

/**
 * Blend venue-specific stats with all-venue stats using venueWeight
 */
function blendStats(
  venueStats: Map<string, Map<string, PlayerMachineStats>>,
  allStats: Map<string, Map<string, PlayerMachineStats>>,
  venueWeight: number
): Map<string, Map<string, PlayerMachineStats>> {
  const blended = new Map<string, Map<string, PlayerMachineStats>>()

  // Get all players from both maps
  const allPlayersSet = new Set([...Array.from(venueStats.keys()), ...Array.from(allStats.keys())])
  const allPlayers = Array.from(allPlayersSet)

  for (const player of allPlayers) {
    blended.set(player, new Map())
    const venuePlayerStats = venueStats.get(player)
    const allPlayerStats = allStats.get(player)

    // Get all machines for this player from both maps
    const allMachinesSet = new Set([
      ...(venuePlayerStats ? Array.from(venuePlayerStats.keys()) : []),
      ...(allPlayerStats ? Array.from(allPlayerStats.keys()) : [])
    ])
    const allMachines = Array.from(allMachinesSet)

    for (const machine of allMachines) {
      const vs = venuePlayerStats?.get(machine)
      const as = allPlayerStats?.get(machine)

      if (vs && as) {
        // Blend the stats
        blended.get(player)!.set(machine, {
          ...vs,
          win_rate: vs.win_rate * venueWeight + as.win_rate * (1 - venueWeight),
          avg_score: vs.avg_score * venueWeight + as.avg_score * (1 - venueWeight),
          venue_adjusted_avg: vs.venue_adjusted_avg * venueWeight + as.venue_adjusted_avg * (1 - venueWeight),
          recent_form: vs.recent_form * venueWeight + as.recent_form * (1 - venueWeight),
          games_played: as.games_played,
          confidence_score: Math.max(vs.confidence_score, as.confidence_score),
        })
      } else if (vs) {
        blended.get(player)!.set(machine, vs)
      } else if (as && venueWeight < 1) {
        // Only all-venue stats exist — scale by (1 - venueWeight)
        // At venue weight 1.0 (venue only), non-venue data is excluded entirely
        blended.get(player)!.set(machine, {
          ...as,
          win_rate: as.win_rate * (1 - venueWeight),
          avg_score: as.avg_score * (1 - venueWeight),
          venue_adjusted_avg: as.venue_adjusted_avg * (1 - venueWeight),
          recent_form: as.recent_form * (1 - venueWeight),
        })
      }
    }
  }

  return blended
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      venue,
      opponent,
      seasonStart = 20,
      seasonEnd = 22,
      format,
      numMachines,
      availablePlayers,
      venueWeight = 0.7,
      userInputWeight = 0,
      confidenceBoost = 0,
      scoreWeights,
      exclusions = {},
      mustPlay = [],
      machines: machinesParam,
      opponentPlayers
    } = body

    if (!venue || !opponent || !availablePlayers || availablePlayers.length === 0) {
      return NextResponse.json(
        { error: 'Invalid parameters' },
        { status: 400 }
      )
    }

    const vw = Math.max(0, Math.min(1, venueWeight))
    const uiw = Math.max(0, Math.min(1, userInputWeight))
    const cb = Math.max(0, Math.min(1, confidenceBoost))
    const scoreLimits = await getScoreLimits()
    const ow = Math.max(0, Math.min(1, body.opponentWeight || 0))

    // Parse scoreWeights if provided
    const weights: ScoreWeights | undefined = scoreWeights ? {
      winRate: scoreWeights.winRate ?? 0.4,
      recentForm: scoreWeights.recentForm ?? 0.3,
      venueAdjustedAvg: scoreWeights.venueAdjustedAvg ?? 0.2,
      confidence: scoreWeights.confidence ?? 0.1,
    } : undefined

    // Use machines passed from client (sourced from venues.json with overrides already applied)
    const machinesAtVenue: string[] = machinesParam || []
    if (machinesAtVenue.length === 0) {
      return NextResponse.json({ error: 'No machines provided' }, { status: 400 })
    }

    const venueVariations = getVenueVariations(venue)

    // Fetch user inputs (self-reported averages and confidence) from user_machine_inputs table
    const machineVariations = getAllMachineVariations(machinesAtVenue)
    const userInputMap = new Map<string, Map<string, UserInputData>>()
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (supabaseUrl && supabaseKey) {
      const sb = createClient(supabaseUrl, supabaseKey)
      const { data: uiData } = await sb
        .from('user_machine_inputs')
        .select('player_name, machine, user_average, user_confidence')
        .in('player_name', availablePlayers)
        .in('machine', machineVariations)
        .in('venue', [venue, ''])

      if (uiData) {
        for (const row of uiData) {
          const canonicalMachine = getCanonicalMachineKey(row.machine)
          const machineKey = machinesAtVenue.includes(canonicalMachine) ? canonicalMachine
            : machinesAtVenue.find(m => m.toLowerCase() === canonicalMachine.toLowerCase()) || canonicalMachine
          if (!userInputMap.has(row.player_name)) userInputMap.set(row.player_name, new Map())
          userInputMap.get(row.player_name)!.set(machineKey, {
            userAverage: row.user_average,
            userConfidence: row.user_confidence,
          })
        }
      }
    }

    // Calculate stats using the proper stats calculator
    // This includes user_machine_scores, win_rate, recent_form, venue_adjusted_avg, etc.
    const [venueStats, allStats] = await Promise.all([
      calculatePlayerMachineStats(
        availablePlayers,
        machinesAtVenue,
        seasonStart,
        seasonEnd,
        venue,
        userInputMap,
        uiw
      ),
      calculatePlayerMachineStats(
        availablePlayers,
        machinesAtVenue,
        seasonStart,
        seasonEnd,
        undefined, // all venues
        userInputMap,
        uiw
      )
    ])

    // Blend venue-specific and all-venue stats
    const blendedStats = blendStats(venueStats, allStats, vw)

    // Fetch venue games for advantage calculation (still need raw games for this)
    let venueGames: any[] = []
    let allVenueGames: any[] = []
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
      console.error('Error fetching games for advantage calc:', error)
    }

    // Build venue average per machine (for % of venue display)
    const venueAvgPerMachine = new Map<string, { total: number; count: number }>()
    for (const game of venueGames) {
      if (!machinesAtVenue.includes(game.machine)) continue
      for (let i = 1; i <= 4; i++) {
        const score = game[`player_${i}_score`]
        if (score == null || !isScoreValid(game.machine, score, scoreLimits)) continue
        if (!venueAvgPerMachine.has(game.machine)) venueAvgPerMachine.set(game.machine, { total: 0, count: 0 })
        const entry = venueAvgPerMachine.get(game.machine)!
        entry.total += score
        entry.count++
      }
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

    // Build opponent weakness per machine for opponent weight scoring
    // Store opponent blended avg and venue avg per machine for per-player edge computation
    const oppAvgPerMachine = new Map<string, { oppAvg: number; venueAvg: number }>()
    const oppWeaknessPerMachine = new Map<string, number>() // kept for display
    if (ow > 0) {
      const oppMachineStats = new Map<string, { vTotal: number; vCount: number; nvTotal: number; nvCount: number }>()

      const collectOppStats = (games: any[], isVenue: boolean) => {
        for (const game of games) {
          if (!machinesAtVenue.includes(game.machine)) continue
          for (let i = 1; i <= 4; i++) {
            const playerName = game[`player_${i}_name`]
            const teamKey = game[`player_${i}_team`]
            const score = game[`player_${i}_score`]
            if (!score || !teamKey) continue
            if (!isScoreValid(game.machine, score, scoreLimits)) continue
            if (teamNameMap[teamKey] !== opponent) continue
            if (opponentPlayers && opponentPlayers.length > 0 && !opponentPlayers.includes(playerName)) continue

            if (!oppMachineStats.has(game.machine)) {
              oppMachineStats.set(game.machine, { vTotal: 0, vCount: 0, nvTotal: 0, nvCount: 0 })
            }
            const ms = oppMachineStats.get(game.machine)!
            if (isVenue) { ms.vTotal += score; ms.vCount++ }
            else { ms.nvTotal += score; ms.nvCount++ }
          }
        }
      }

      collectOppStats(venueGames, true)
      collectOppStats(allVenueGames, false)

      for (const machine of machinesAtVenue) {
        const opp = oppMachineStats.get(machine)
        if (!opp) continue

        const oppVAvg = opp.vCount > 0 ? opp.vTotal / opp.vCount : null
        const oppNvAvg = opp.nvCount > 0 ? opp.nvTotal / opp.nvCount : null
        let oppAvg = 0
        if (oppVAvg !== null && oppNvAvg !== null) {
          oppAvg = oppVAvg * vw + oppNvAvg * (1 - vw)
        } else if (oppVAvg !== null) {
          oppAvg = oppVAvg
        } else if (oppNvAvg !== null) {
          oppAvg = oppNvAvg
        }

        const venueEntry = venueAvgPerMachine.get(machine)
        const venueAvg = venueEntry && venueEntry.count > 0 ? venueEntry.total / venueEntry.count : 0

        if (venueAvg > 0 && oppAvg > 0) {
          const weakness = Math.max(-0.5, Math.min(0.5, (venueAvg - oppAvg) / venueAvg))
          oppWeaknessPerMachine.set(machine, weakness)
          oppAvgPerMachine.set(machine, { oppAvg, venueAvg })
        }
      }
    }

    // Joint machine + player selection using performance scores
    const playersPerMachine = format === 'doubles' ? 2 : 1
    const mustPlaySet = new Set<string>(mustPlay as string[])
    const usedPlayers = new Set<string>()
    const usedMachines = new Set<string>()
    const recommendations = []

    for (let round = 0; round < numMachines; round++) {
      let bestMachine = ''
      let bestScore = -Infinity
      let bestPlayers: { player: string; stats: PlayerMachineStats | null; performanceScore: number }[] = []
      const unassignedMustPlay = (availablePlayers as string[]).filter(p => mustPlaySet.has(p) && !usedPlayers.has(p))
      const hasMustPlayRemaining = unassignedMustPlay.length > 0

      // Try unused machines first, then allow reuse if all machines are taken
      const unusedMachines = machinesAtVenue.filter(m => !usedMachines.has(m))
      const machinesToTry = unusedMachines.length > 0 ? unusedMachines : machinesAtVenue

      for (const machine of machinesToTry) {
        const machineExclusions: string[] = exclusions[machine] || []

        const eligible = (availablePlayers as string[])
          .filter((p: string) => !usedPlayers.has(p) && !machineExclusions.includes(p))
          .map((player: string) => {
            const stats = blendedStats.get(player)?.get(machine) || null
            // Calculate performance score using all the weights
            let performanceScore = calculatePerformanceScore(stats, cb, weights)
            // Per-player edge: compare this player's venue_adjusted_avg vs opponent's avg
            if (ow > 0) {
              const oppData = oppAvgPerMachine.get(machine)
              if (oppData && stats?.venue_adjusted_avg) {
                const oppRatio = oppData.oppAvg / oppData.venueAvg
                const twcRatio = stats.venue_adjusted_avg
                const edge = Math.max(-0.5, Math.min(0.5, (twcRatio - oppRatio) / Math.max(twcRatio, oppRatio)))
                performanceScore *= (1 + ow * edge)
              }
            }
            return {
              player,
              stats,
              performanceScore,
              isMustPlay: mustPlaySet.has(player)
            }
          })
          .sort((a, b) => {
            // When must-play players remain, prioritize them
            if (hasMustPlayRemaining) {
              if (a.isMustPlay !== b.isMustPlay) return a.isMustPlay ? -1 : 1
            }
            return b.performanceScore - a.performanceScore
          })

        // Need at least playersPerMachine eligible players
        if (eligible.length < playersPerMachine) continue

        const topN = eligible.slice(0, playersPerMachine)
        const avgScore = topN.reduce((sum, p) => sum + p.performanceScore, 0) / topN.length
        // Bonus for including must-play players when there are unassigned ones
        const mustPlayBonus = hasMustPlayRemaining && topN.some(p => p.isMustPlay) ? 100000 : 0

        if (avgScore + mustPlayBonus > bestScore) {
          bestScore = avgScore + mustPlayBonus
          bestMachine = machine
          bestPlayers = topN
        }
      }

      if (!bestMachine) break // No more viable assignments

      bestPlayers.forEach(p => usedPlayers.add(p.player))
      usedMachines.add(bestMachine)

      // Determine data source
      const hasVenueData = bestPlayers.some(p => venueStats.get(p.player)?.has(bestMachine))
      const hasAllData = bestPlayers.some(p => allStats.get(p.player)?.has(bestMachine))
      let dataSource = 'none'
      if (hasVenueData && hasAllData) dataSource = 'blended'
      else if (hasVenueData) dataSource = 'venue'
      else if (hasAllData) dataSource = 'all'

      // Compute per-player stats for display
      const venueEntry = venueAvgPerMachine.get(bestMachine)
      const machineVenueAvg = venueEntry && venueEntry.count > 0 ? venueEntry.total / venueEntry.count : null

      const playerStatsDisplay = bestPlayers.map(p => {
        const ui = userInputMap.get(p.player)?.get(bestMachine)
        const pctOfVenue = machineVenueAvg && p.stats?.avg_score
          ? (p.stats.avg_score / machineVenueAvg) * 100
          : (p.stats?.venue_adjusted_avg ? p.stats.venue_adjusted_avg * 100 : null)

        return {
          player: p.player,
          pctOfVenue: pctOfVenue != null ? Math.round(pctOfVenue) : null,
          playsCount: p.stats?.games_played || 0,
          avgScore: p.stats?.avg_score ? Math.round(p.stats.avg_score) : 0,
          winRate: p.stats?.win_rate ? Math.round(p.stats.win_rate * 100) : null,
          recentForm: p.stats?.recent_form ? Math.round(p.stats.recent_form * 100) : null,
          confidenceScore: p.stats?.confidence_score || 0,
          performanceScore: Math.round(p.performanceScore * 100),
          userAverage: ui?.userAverage ?? null,
          userConfidence: ui?.userConfidence ?? (p.stats?.user_confidence ?? null),
          scoreBreakdown: p.stats?.scoreBreakdown || null,
        }
      })

      // Compute per-assignment advantage (TWC side = assigned players only)
      const advantage = computePlayerAdvantage(
        bestPlayers.map(p => p.player),
        bestMachine,
        venueGames,
        allVenueGames,
        opponent,
        teamNameMap,
        vw,
        teamName,
        opponentPlayers,
        scoreLimits
      )

      recommendations.push({
        machine: bestMachine,
        players: bestPlayers.map(p => p.player),
        dataSource,
        blendedScore: Math.round(bestScore * 100),
        stats: playerStatsDisplay,
        advantage,
        opponentWeakness: ow > 0 ? (oppWeaknessPerMachine.get(bestMachine) || 0) : 0,
        opponentWeight: ow,
      })
    }

    // Compute assumed opponent assignments for each recommended machine
    // Greedily assigns best opponent player(s) per machine based on their avg scores
    {
      // Build opponent player stats per machine (venue and all-venue separately)
      const oppPlayerMachineStats = new Map<string, Map<string, { venueTotal: number; venueCount: number; venueWins: number; allTotal: number; allCount: number; allWins: number }>>()

      const collectOppPlayerStats = (games: any[], isVenue: boolean) => {
        for (const game of games) {
          for (let i = 1; i <= 4; i++) {
            const playerName = game[`player_${i}_name`]
            const teamKey = game[`player_${i}_team`]
            const score = game[`player_${i}_score`]
            if (!score || !teamKey || !playerName) continue
            if (!isScoreValid(game.machine, score, scoreLimits)) continue
            if (teamNameMap[teamKey] !== opponent) continue
            if (opponentPlayers && opponentPlayers.length > 0 && !opponentPlayers.includes(playerName)) continue

            if (!oppPlayerMachineStats.has(playerName)) oppPlayerMachineStats.set(playerName, new Map())
            const playerMap = oppPlayerMachineStats.get(playerName)!
            if (!playerMap.has(game.machine)) playerMap.set(game.machine, { venueTotal: 0, venueCount: 0, venueWins: 0, allTotal: 0, allCount: 0, allWins: 0 })
            const ms = playerMap.get(game.machine)!

            // Determine if this player won (highest score among all 4 players in the game)
            let maxScore = 0
            for (let j = 1; j <= 4; j++) {
              const s = game[`player_${j}_score`]
              if (s && s > maxScore) maxScore = s
            }
            const won = score >= maxScore

            if (isVenue) {
              ms.venueTotal += score; ms.venueCount++
              if (won) ms.venueWins++
            }
            ms.allTotal += score; ms.allCount++
            if (won) ms.allWins++
          }
        }
      }

      collectOppPlayerStats(venueGames, true)
      collectOppPlayerStats(allVenueGames, false)

      // Greedily assign opponent players to recommended machines
      const usedOppPlayers = new Set<string>()
      for (const rec of recommendations) {
        const machine = rec.machine
        const eligible: { player: string; avgScore: number; venueAvg: number; venueGames: number; venueWinRate: number; allAvg: number; allGames: number; allWinRate: number }[] = []

        for (const [player, machineMap] of Array.from(oppPlayerMachineStats.entries())) {
          if (usedOppPlayers.has(player)) continue
          const ms = machineMap.get(machine)
          if (!ms || ms.allCount === 0) continue

          const venueAvg = ms.venueCount > 0 ? ms.venueTotal / ms.venueCount : 0
          const allAvg = ms.allTotal / ms.allCount
          const blendedAvg = ms.venueCount > 0 ? venueAvg * vw + allAvg * (1 - vw) : allAvg

          eligible.push({
            player,
            avgScore: blendedAvg,
            venueAvg,
            venueGames: ms.venueCount,
            venueWinRate: ms.venueCount > 0 ? ms.venueWins / ms.venueCount : 0,
            allAvg,
            allGames: ms.allCount,
            allWinRate: ms.allCount > 0 ? ms.allWins / ms.allCount : 0,
          })
        }

        eligible.sort((a, b) => b.avgScore - a.avgScore)
        const topN = eligible.slice(0, playersPerMachine)

        // Backfill with unused opponents if not enough have data on this machine
        if (topN.length < playersPerMachine) {
          for (const [player] of Array.from(oppPlayerMachineStats.entries())) {
            if (topN.length >= playersPerMachine) break
            if (usedOppPlayers.has(player)) continue
            if (topN.some(p => p.player === player)) continue
            topN.push({
              player,
              avgScore: 0,
              venueAvg: 0,
              venueGames: 0,
              venueWinRate: 0,
              allAvg: 0,
              allGames: 0,
              allWinRate: 0,
            })
          }
        }

        topN.forEach(p => usedOppPlayers.add(p.player))

        ;(rec as any).assumedOpponents = topN.map(p => ({
          player: p.player,
          avgScore: Math.round(p.avgScore),
          venueAvg: Math.round(p.venueAvg),
          venueGames: p.venueGames,
          venueWinRate: Math.round(p.venueWinRate * 100),
          allAvg: Math.round(p.allAvg),
          allGames: p.allGames,
          allWinRate: Math.round(p.allWinRate * 100),
        }))
      }
    }

    // Debug info
    const userInputDebug: Record<string, Record<string, any>> = {}
    for (const [player, machines] of Array.from(userInputMap.entries())) {
      userInputDebug[player] = {}
      for (const [machine, data] of Array.from(machines.entries())) {
        userInputDebug[player][machine] = data
      }
    }

    // Sample stats for debugging
    const sampleStats: Record<string, any> = {}
    for (const player of (availablePlayers as string[]).slice(0, 2)) {
      const playerStats = blendedStats.get(player)
      if (playerStats) {
        sampleStats[player] = {}
        for (const [machine, stats] of Array.from(playerStats.entries()).slice(0, 2)) {
          sampleStats[player][machine] = {
            games_played: stats.games_played,
            win_rate: stats.win_rate,
            recent_form: stats.recent_form,
            venue_adjusted_avg: stats.venue_adjusted_avg,
            confidence_score: stats.confidence_score,
            user_confidence: stats.user_confidence,
            performanceScore: calculatePerformanceScore(stats, cb, weights),
          }
        }
      }
    }

    return NextResponse.json({
      recommendations,
      machinesAtVenue,
      venue,
      venueWeight: vw,
      debug: {
        venueGamesCount: venueGames.length,
        allVenueGamesCount: allVenueGames.length,
        machinesAtVenueCount: machinesAtVenue.length,
        venuePlayersWithStats: venueStats.size,
        allPlayersWithStats: allStats.size,
        blendedPlayersWithStats: blendedStats.size,
        sampleMachines: machinesAtVenue.slice(0, 5),
        availablePlayers: availablePlayers.slice(0, 5),
        weightsUsed: weights || { winRate: 0.4, recentForm: 0.3, venueAdjustedAvg: 0.2, confidence: 0.1 },
        confidenceBoost: cb,
        userInputWeight: uiw,
        userInputsFound: Object.keys(userInputDebug).length,
        userInputs: userInputDebug,
        sampleStats,
      }
    })
  } catch (error) {
    console.error('Error optimizing picks:', error)
    return NextResponse.json(
      { error: 'Failed to optimize picks' },
      { status: 500 }
    )
  }
}
