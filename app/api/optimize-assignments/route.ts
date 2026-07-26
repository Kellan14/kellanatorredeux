import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'
import { getVenueVariations } from '@/lib/venue-mappings'
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
        if (scoreLimits && !isScoreValid(machine, score, scoreLimits)) continue
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

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { venue, opponent, seasonStart = 20, seasonEnd = 22, format, machines, availablePlayers, venueWeight = 0.7, exclusions = {}, mustPlay = [], opponentPlayers, opponentWeight = 0, userInputWeight = 0, confidenceBoost = 0, scoreWeights, avgMethod = 'mean', trimPct = 0.1 } = body

    if (!venue || !opponent || !machines || !availablePlayers || availablePlayers.length === 0) {
      return NextResponse.json(
        { error: 'Invalid parameters' },
        { status: 400 }
      )
    }

    const vw = Math.max(0, Math.min(1, venueWeight))
    const ow = Math.max(0, Math.min(1, opponentWeight))
    const uiw = Math.max(0, Math.min(1, userInputWeight))
    const cb = Math.max(0, Math.min(1, confidenceBoost))
    const scoreLimits = await getScoreLimits()
    const playersPerMachine = format === 'singles' ? 1 : 2

    // Parse scoreWeights if provided
    const weights: ScoreWeights | undefined = scoreWeights ? {
      winRate: scoreWeights.winRate ?? 0.4,
      recentForm: scoreWeights.recentForm ?? 0.3,
      venueAdjustedAvg: scoreWeights.venueAdjustedAvg ?? 0.2,
      confidence: scoreWeights.confidence ?? 0.1,
    } : undefined

    if (availablePlayers.length < machines.length * playersPerMachine) {
      return NextResponse.json(
        { error: `Not enough players. Need ${machines.length * playersPerMachine}, have ${availablePlayers.length}` },
        { status: 400 }
      )
    }

    // Build machine variation lookup for normalizing game machine names
    const machineVariationToCanonical = new Map<string, string>()
    for (const machine of machines) {
      machineVariationToCanonical.set(machine as string, machine as string)
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

    // Filter games to only requested machines
    const machineSet = new Set(machines as string[])

    // Compute venue averages per machine (for pctOfVenue and opponent weakness)
    const machineVenueAvgs = new Map<string, number>()
    for (const machine of machines) {
      const machineStr = machine as string
      const machineGames = venueGames.filter(g => g.machine === machineStr)
      const scores: number[] = []
      for (const g of machineGames) {
        for (let i = 1; i <= 4; i++) {
          const s = g[`player_${i}_score`]
          if (s != null && s > 0 && isScoreValid(machineStr, s, scoreLimits)) scores.push(s)
        }
      }
      if (scores.length > 0) {
        machineVenueAvgs.set(machineStr, scores.reduce((a, b) => a + b, 0) / scores.length)
      }
    }

    // Fetch user inputs (self-reported averages and confidence)
    const machineVariationsForInputs = machines as string[]
    const userInputMap = new Map<string, Map<string, UserInputData>>()
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (supabaseUrl && supabaseKey) {
      const sb = createClient(supabaseUrl, supabaseKey)
      const { data: uiData } = await sb
        .from('user_machine_inputs')
        .select('player_name, machine, user_average, user_confidence')
        .in('player_name', availablePlayers)
        .in('machine', machineVariationsForInputs)
        .in('venue', [venue, ''])

      if (uiData) {
        for (const row of uiData) {
          const canonicalMachine = row.machine
          const machineKey = (machines as string[]).includes(canonicalMachine) ? canonicalMachine
            : (machines as string[]).find(m => m.toLowerCase() === canonicalMachine.toLowerCase()) || canonicalMachine
          if (!userInputMap.has(row.player_name)) userInputMap.set(row.player_name, new Map())
          userInputMap.get(row.player_name)!.set(machineKey, {
            userAverage: row.user_average,
            userConfidence: row.user_confidence,
          })
        }
      }
    }

    // Calculate stats using the shared stats calculator (includes win_rate, recent_form, venue_adjusted_avg, etc.)
    const [venuePlayerStats, allPlayerStats] = await Promise.all([
      calculatePlayerMachineStats(availablePlayers, machines as string[], seasonStart, seasonEnd, venue, userInputMap, uiw, avgMethod, trimPct),
      calculatePlayerMachineStats(availablePlayers, machines as string[], seasonStart, seasonEnd, undefined, userInputMap, uiw, avgMethod, trimPct)
    ])

    // Blend venue-specific and all-venue stats (same logic as optimizer.ts getBlendedStats)
    const blendedStatsMap = new Map<string, Map<string, PlayerMachineStats>>()
    for (const player of availablePlayers as string[]) {
      const playerBlended = new Map<string, PlayerMachineStats>()
      const venuePS = venuePlayerStats.get(player)
      const allPS = allPlayerStats.get(player)

      for (const machine of machines as string[]) {
        const vs = venuePS?.get(machine)
        const as_ = allPS?.get(machine)

        if (!vs && !as_) continue

        if (vs && as_) {
          playerBlended.set(machine, {
            ...vs,
            games_played: as_.games_played,
            win_rate: vs.win_rate * vw + as_.win_rate * (1 - vw),
            avg_score: vs.avg_score * vw + as_.avg_score * (1 - vw),
            venue_adjusted_avg: vs.venue_adjusted_avg * vw + as_.venue_adjusted_avg * (1 - vw),
            high_score: Math.max(vs.high_score, as_.high_score),
            recent_form: vs.recent_form * vw + as_.recent_form * (1 - vw),
            confidence_score: Math.max(vs.confidence_score, as_.confidence_score),
            user_confidence: vs.user_confidence || as_.user_confidence,
          })
        } else if (vs) {
          playerBlended.set(machine, vs)
        } else if (as_ && vw < 1) {
          playerBlended.set(machine, {
            ...as_,
            win_rate: as_.win_rate * (1 - vw),
            avg_score: as_.avg_score * (1 - vw),
            venue_adjusted_avg: as_.venue_adjusted_avg * (1 - vw),
            recent_form: as_.recent_form * (1 - vw),
          })
        }
      }

      if (playerBlended.size > 0) {
        blendedStatsMap.set(player, playerBlended)
      }
    }

    // Build per-opponent-player stats and greedily assign opponents to machines BEFORE TWC optimization
    const oppWeaknessPerMachine = new Map<string, number>()
    const oppAssignmentsPerMachine = new Map<string, Array<{ player: string; avgScore: number; venueAvg: number; venueGames: number; venueWinRate: number; allAvg: number; allGames: number; allWinRate: number }>>()
    if (ow > 0) {
      const oppPlayerMachineStats = new Map<string, Map<string, { venueTotal: number; venueCount: number; venueWins: number; allTotal: number; allCount: number; allWins: number }>>()

      const collectOppPlayerStats = (games: any[], isVenue: boolean) => {
        for (const game of games) {
          if (!machineSet.has(game.machine)) continue
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

      // Greedily assign opponent players to machines (best blended avg, no repeats)
      const usedOppPlayers = new Set<string>()
      for (const machine of machines) {
        const machineStr = machine as string
        const eligible: { player: string; avgScore: number; venueAvg: number; venueGames: number; venueWinRate: number; allAvg: number; allGames: number; allWinRate: number }[] = []

        for (const [player, machineMap] of Array.from(oppPlayerMachineStats.entries())) {
          if (usedOppPlayers.has(player)) continue
          const ms = machineMap.get(machineStr)
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

        // If not enough opponents with data on this machine, fill remaining slots
        // with unused opponents (no machine-specific data, just their overall stats)
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
        oppAssignmentsPerMachine.set(machineStr, topN)

        // Store opponent avg for per-player edge computation during TWC assignment
        if (topN.length > 0) {
          const assignedOppAvg = topN.reduce((sum, p) => sum + p.avgScore, 0) / topN.length
          const mVenueAvg = machineVenueAvgs.get(machineStr)
          if (mVenueAvg && mVenueAvg > 0 && assignedOppAvg > 0) {
            const weakness = Math.max(-0.5, Math.min(0.5, (mVenueAvg - assignedOppAvg) / mVenueAvg))
            oppWeaknessPerMachine.set(machineStr, weakness)
          }
        }
      }
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
      opponentWeakness: number
      opponentWeight: number
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
        const stats = blendedStatsMap.get(player)?.get(machine as string) || null
        let performanceScore = calculatePerformanceScore(stats, cb, weights)

        // Determine data source
        const hasVenue = venuePlayerStats.get(player)?.has(machine as string)
        const hasAll = allPlayerStats.get(player)?.has(machine as string)
        let source = 'none'
        if (hasVenue && hasAll) source = 'blended'
        else if (hasVenue) source = 'venue'
        else if (hasAll) source = 'all'

        // Per-player edge: compare this player's venue_adjusted_avg vs assigned opponent's avg
        if (ow > 0 && performanceScore > 0) {
          const oppForMachine = oppAssignmentsPerMachine.get(machine as string)
          const mVenueAvg = machineVenueAvgs.get(machine as string)
          if (oppForMachine && oppForMachine.length > 0 && mVenueAvg && mVenueAvg > 0 && stats?.venue_adjusted_avg) {
            const oppAvg = oppForMachine.reduce((sum, p) => sum + p.avgScore, 0) / oppForMachine.length
            if (oppAvg > 0) {
              const twcRatio = stats.venue_adjusted_avg
              const oppRatio = oppAvg / mVenueAvg
              const edge = Math.max(-0.5, Math.min(0.5, (twcRatio - oppRatio) / Math.max(twcRatio, oppRatio)))
              performanceScore *= (1 + ow * edge)
            }
          }
        }
        playersToAssign.push({ player, avg: performanceScore, source, isMustPlay: mustPlaySet.has(player) })
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
        const playerStats = blendedStatsMap.get(p.player)?.get(machine as string)
        const pctOfVenue = venueAvg && playerStats?.avg_score
          ? Math.round((playerStats.avg_score / venueAvg) * 100)
          : (playerStats?.venue_adjusted_avg ? Math.round(playerStats.venue_adjusted_avg * 100) : null)
        const ui = userInputMap.get(p.player)?.get(machine as string)
        return {
          player: p.player,
          pctOfVenue,
          playsCount: playerStats?.games_played || 0,
          avgScore: playerStats?.avg_score ? Math.round(playerStats.avg_score) : 0,
          winRate: playerStats?.win_rate ? Math.round(playerStats.win_rate * 100) : null,
          recentForm: playerStats?.recent_form ? Math.round(playerStats.recent_form * 100) : null,
          confidenceScore: playerStats?.confidence_score || 0,
          performanceScore: Math.round(p.avg * 100),
          userAverage: ui?.userAverage ?? null,
          userConfidence: ui?.userConfidence ?? (playerStats?.user_confidence ?? null),
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
        opponentPlayers,
        scoreLimits
      )

      assignments.push({
        machine: machine as string,
        players: selectedPlayers.map(p => p.player),
        expectedAvg,
        dataSource,
        blendedScore: Math.round(expectedAvg),
        stats,
        advantage,
        opponentWeakness: ow > 0 ? (oppWeaknessPerMachine.get(machine as string) || 0) : 0,
        opponentWeight: ow,
      })
    }

    // Attach pre-computed assumed opponents to each assignment
    for (const assignment of assignments) {
      const oppForMachine = oppAssignmentsPerMachine.get(assignment.machine) || []
      ;(assignment as any).assumedOpponents = oppForMachine.map(p => ({
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
