import { NextRequest, NextResponse } from 'next/server'
import { LineupOptimizer } from '@/lib/strategy/optimizer'
import { calculatePairStats } from '@/lib/strategy/stats-calculator'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { getVenueVariations } from '@/lib/venue-mappings'
import { getAllMachineVariations } from '@/lib/machine-mappings'
import { hungarianAlgorithm } from '@/lib/strategy/hungarian'
import { buildCostMatrix, calculatePerformanceScore, calculatePairSynergy } from '@/lib/strategy/calculator'
import { getScoreLimits, isScoreValid } from '@/lib/score-limits'

export const dynamic = 'force-dynamic'

/**
 * Generate all combinations of size k from array
 */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const results: T[][] = []
  const [first, ...rest] = arr
  for (const combo of combinations(rest, k - 1)) {
    results.push([first, ...combo])
  }
  for (const combo of combinations(rest, k)) {
    results.push(combo)
  }
  return results
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      format,
      playerNames,
      machines,
      seasonStart = 20,
      seasonEnd = 22,
      venue,
      venueWeight: rawVenueWeight,
      // When true (strategy page's default), the venueWeight blend is
      // bypassed — venueWeight is forced to 1 so prefetchStats /
      // getBlendedAvg use venue-only data when venue is set, falling back
      // to non-venue when it isn't. Approximates per-game-normalized at
      // this layer without rebuilding lib/strategy internals.
      usePerGameNormalized = true,
      exclusions = {},
      mustPlay = [],
      userInputWeight = 0,
      confidenceBoost = 0,
      scoreWeights,
      forcedAssignments = [],  // Array of { player: string, machine: string }
      opponentWeight = 0,
      opponentPlayers,
      opponent,
      useNashEquilibrium = true,
      assignAll = false,  // When true, greedily assign remaining players after normal optimization
      avgMethod = 'mean',
      trimPct = 0.1,
      // When true (and the venue has more candidate machines than the round
      // requires), enumerate machine subsets and pick the one whose Nash
      // equilibrium value is best for TWC. Without this, TWC's machine
      // choice is greedy (its own Hungarian on pure strength); with this,
      // it's a true minimax over machine selection. Caps subset search
      // at SUBSET_SEARCH_LIMIT — beyond that, falls back to non-search.
      searchMachineSubsets = false,
    } = body

    if (!format || !playerNames || !machines) {
      return NextResponse.json(
        { error: 'Missing required fields: format, playerNames, machines' },
        { status: 400 }
      )
    }

    if (!['7x7', '4x2'].includes(format)) {
      return NextResponse.json(
        { error: 'Format must be either "7x7" or "4x2"' },
        { status: 400 }
      )
    }

    const requiredPlayers = format === '7x7' ? 7 : 8
    const requiredMachines = format === '7x7' ? 7 : 4

    if (machines.length < requiredMachines) {
      return NextResponse.json(
        { error: `${format} format requires at least ${requiredMachines} machines, have ${machines.length}` },
        { status: 400 }
      )
    }

    const mustPlaySet = new Set(mustPlay as string[])
    if (mustPlaySet.size > requiredPlayers) {
      return NextResponse.json(
        { error: `Too many must-play players (${mustPlaySet.size}) for ${requiredPlayers} slots` },
        { status: 400 }
      )
    }

    // Handle forced assignments - these players/machines are locked
    const forcedPlayerSet = new Set<string>()
    const forcedMachineSet = new Set<string>()
    // machine -> list of forced players (length 1 for singles; up to 2 for doubles)
    const forcedAssignmentMap = new Map<string, string[]>()

    for (const fa of forcedAssignments as { player: string; machine: string }[]) {
      forcedPlayerSet.add(fa.player)
      forcedMachineSet.add(fa.machine)
      const list = forcedAssignmentMap.get(fa.machine) || []
      if (!list.includes(fa.player)) list.push(fa.player)
      forcedAssignmentMap.set(fa.machine, list)
    }

    // Classify doubles forced machines:
    //  - fully-locked: 2 forced players on the same machine (a complete pair) —
    //    removed from the optimizer pool entirely, added back by mergeForced.
    //  - half-locked: 1 forced player on the machine — passed to the doubles
    //    Hungarian as a fixedSeed, which picks the best partner from the
    //    remaining open players. The forced player stays in `allPlayers` and
    //    the machine stays in `selectedMachines` so they participate in the
    //    optimizer's globally-optimal search.
    const fullyLockedDoublesMachines = new Set<string>()
    const fullyLockedDoublesPlayers = new Set<string>()
    const halfLockedDoublesSeeds: Array<{ player: string; machine: string }> = []
    if (format === '4x2') {
      for (const [m, players] of Array.from(forcedAssignmentMap.entries())) {
        if (players.length >= 2) {
          fullyLockedDoublesMachines.add(m)
          for (const p of players) fullyLockedDoublesPlayers.add(p)
        } else if (players.length === 1) {
          halfLockedDoublesSeeds.push({ player: players[0], machine: m })
        }
      }
    }

    // Filter out forced players from the optimization pool.
    // Singles: forced players AND machines are stripped — added by mergeForced.
    // Doubles: only fully-locked-pair players/machines are stripped.
    //   Half-locked seeds stay in the pool and are passed to the Hungarian as
    //   constraints, so the partner search happens inside the optimizer.
    const allPlayers = format === '7x7'
      ? (playerNames as string[]).filter(p => !forcedPlayerSet.has(p))
      : (playerNames as string[]).filter(p => !fullyLockedDoublesPlayers.has(p))
    const selectedMachines = format === '7x7'
      ? (machines as string[]).filter(m => !forcedMachineSet.has(m))
      : (machines as string[]).filter(m => !fullyLockedDoublesMachines.has(m))
    const optimizer = new LineupOptimizer()

    // Pre-fetch stats for ALL players (including forced ones for merging back)
    const allPlayersForStats = [...allPlayers, ...Array.from(forcedPlayerSet)]
    const allMachinesForStats = [...selectedMachines, ...Array.from(forcedMachineSet)]
    const venueWeight = usePerGameNormalized ? 1 : rawVenueWeight
    const { statsMap, userInputs } = await optimizer.prefetchStats(
      allPlayersForStats, allMachinesForStats, seasonStart, seasonEnd, venue, venueWeight, userInputWeight, confidenceBoost, avgMethod, trimPct
    )

    // Fetch score limits for filtering impossible scores
    const scoreLimits = await getScoreLimits()

    // Compute opponent edge bonuses per machine (does NOT mutate statsMap)
    const ow = Math.max(0, Math.min(1, opponentWeight || 0))
    const vw = Math.max(0, Math.min(1, venueWeight || 0.7))
    let assumedOpponents: Record<string, any[]> | null = null
    const machineEdgeBonuses = new Map<string, number>()
    let oppDataForDisplay: {
      oppPlayerList: string[]
      oppPlayerStats: Map<string, Map<string, { vTotal: number; vCount: number; nvTotal: number; nvCount: number }>>
      getBlendedAvg: (player: string, machine: string) => number
      getOppCellValue: (player: string, machine: string) => number
      allGames: any[]
      venueVariations: string[]
      teamNameMap: Record<string, string>
      venueAvgPerMachine: Map<string, { total: number; count: number }>
    } | null = null

    // Pre-fetch pair stats for doubles BEFORE the Nash loop so the doubles
    // Hungarian inside runNashFor can use them. (For singles this is a no-op.)
    let pairStatsMap = new Map<string, { winRate: number; gamesPlayed: number }>()
    if (format === '4x2') {
      const pairStatsData = await calculatePairStats(allPlayersForStats, allMachinesForStats, seasonStart, seasonEnd)
      for (const [key, stats] of Array.from(pairStatsData.entries())) {
        pairStatsMap.set(key, stats)
      }
    }

    if (ow > 0 && venue && opponent) {
      const venueVariations = getVenueVariations(venue)
      const machineVariationToCanonical = new Map<string, string>()
      for (const machine of allMachinesForStats) {
        for (const variation of getAllMachineVariations([machine])) {
          machineVariationToCanonical.set(variation, machine)
        }
      }

      const allGames = await fetchAllRecords<any>(
        () => supabase
          .from('games')
          .select('*')
          .gte('season', seasonStart)
          .lte('season', seasonEnd)
          .order('id', { ascending: true })
      )

      // Normalize machine names and separate venue/non-venue
      const venueGames: any[] = []
      const nonVenueGames: any[] = []
      for (const game of allGames) {
        const canonical = machineVariationToCanonical.get(game.machine)
        if (!canonical) continue
        game.machine = canonical
        if (venueVariations.includes(game.venue)) venueGames.push(game)
        else nonVenueGames.push(game)
      }

      // Build team name map
      const teamKeys = new Set<string>()
      for (const game of allGames) {
        for (let i = 1; i <= 4; i++) {
          const tk = game[`player_${i}_team`]
          if (tk) teamKeys.add(tk)
        }
      }
      const { data: teamsData } = await supabase
        .from('teams')
        .select('team_key, team_name')
        .in('team_key', Array.from(teamKeys))
      const teamNameMap: Record<string, string> = {}
      ;(teamsData || []).forEach((t: any) => { teamNameMap[t.team_key] = t.team_name })

      // Build venue avg per machine (all scores at venue on that machine)
      const venueAvgPerMachine = new Map<string, { total: number; count: number }>()
      for (const game of venueGames) {
        for (let i = 1; i <= 4; i++) {
          const score = game[`player_${i}_score`]
          if (!score || !isScoreValid(game.machine, score, scoreLimits)) continue
          const entry = venueAvgPerMachine.get(game.machine) || { total: 0, count: 0 }
          entry.total += score
          entry.count++
          venueAvgPerMachine.set(game.machine, entry)
        }
      }

      // Discover opponent players from games or use provided list
      const oppPlayerSet = new Set<string>()
      if (opponentPlayers && opponentPlayers.length > 0) {
        for (const p of opponentPlayers) oppPlayerSet.add(p)
      } else {
        for (const game of allGames) {
          for (let i = 1; i <= 4; i++) {
            const teamKey = game[`player_${i}_team`]
            const playerName = game[`player_${i}_name`]
            if (teamKey && playerName && teamNameMap[teamKey] === opponent) {
              oppPlayerSet.add(playerName)
            }
          }
        }
      }
      const oppPlayerList = Array.from(oppPlayerSet)

      // Build per-opponent-player stats: venue and non-venue scores per machine
      const oppPlayerStats = new Map<string, Map<string, { vTotal: number; vCount: number; nvTotal: number; nvCount: number }>>()
      for (const p of oppPlayerList) {
        oppPlayerStats.set(p, new Map())
      }

      const collectOppStats = (games: any[], isVenue: boolean) => {
        for (const game of games) {
          for (let i = 1; i <= 4; i++) {
            const playerName = game[`player_${i}_name`]
            const teamKey = game[`player_${i}_team`]
            const score = game[`player_${i}_score`]
            if (!score || !teamKey || !playerName) continue
            if (!isScoreValid(game.machine, score, scoreLimits)) continue
            if (!oppPlayerSet.has(playerName)) continue
            if (teamNameMap[teamKey] !== opponent) continue
            const playerMap = oppPlayerStats.get(playerName)!
            const entry = playerMap.get(game.machine) || { vTotal: 0, vCount: 0, nvTotal: 0, nvCount: 0 }
            if (isVenue) { entry.vTotal += score; entry.vCount++ }
            else { entry.nvTotal += score; entry.nvCount++ }
            playerMap.set(game.machine, entry)
          }
        }
      }
      collectOppStats(venueGames, true)
      collectOppStats(nonVenueGames, false)

      // Per-(opp player, machine, venue) buckets and per-(machine, venue)
      // baselines, used by the per-game-normalized branch. Same idea as the
      // machine-advantages perVenueTeamStats / perVenueBaseline maps.
      const oppPerVenue = new Map<string, Map<string, Map<string, { total: number; count: number }>>>()
      const venueAvgByMV = new Map<string, Map<string, { total: number; count: number }>>()
      if (usePerGameNormalized) {
        for (const game of allGames) {
          const v = game.venue
          if (!v) continue
          for (let i = 1; i <= 4; i++) {
            const playerName = game[`player_${i}_name`]
            const teamKey = game[`player_${i}_team`]
            const score = game[`player_${i}_score`]
            if (!score) continue
            if (!isScoreValid(game.machine, score, scoreLimits)) continue
            // Baselines: every valid score contributes to the venue avg.
            if (!venueAvgByMV.has(game.machine)) venueAvgByMV.set(game.machine, new Map())
            const venueMapForMachine = venueAvgByMV.get(game.machine)!
            const baseEntry = venueMapForMachine.get(v) || { total: 0, count: 0 }
            baseEntry.total += score
            baseEntry.count++
            venueMapForMachine.set(v, baseEntry)
            // Opponent player buckets.
            if (!teamKey || !playerName) continue
            if (!oppPlayerSet.has(playerName)) continue
            if (teamNameMap[teamKey] !== opponent) continue
            if (!oppPerVenue.has(playerName)) oppPerVenue.set(playerName, new Map())
            const machineMap = oppPerVenue.get(playerName)!
            if (!machineMap.has(game.machine)) machineMap.set(game.machine, new Map())
            const inner = machineMap.get(game.machine)!
            const entry = inner.get(v) || { total: 0, count: 0 }
            entry.total += score
            entry.count++
            inner.set(v, entry)
          }
        }
      }

      // Per-game-normalized opponent "score" — mean of (score / venueAvg(M, V))
      // across the player's games. Returns a ratio centered around 1.0 (so the
      // Hungarian matrix is consistent with the legacy raw-avg path's units;
      // the optimizer just needs comparable values within one matrix).
      const getPgnOppRatio = (player: string, machine: string): number => {
        const machineMap = oppPerVenue.get(player)
        if (!machineMap) return 0
        const venueMap = machineMap.get(machine)
        if (!venueMap) return 0
        let sumRatio = 0
        let games = 0
        for (const [v, entry] of Array.from(venueMap.entries())) {
          const baseline = venueAvgByMV.get(machine)?.get(v)
          if (!baseline || baseline.count === 0) continue
          const venueAvg = baseline.total / baseline.count
          if (venueAvg <= 0) continue
          sumRatio += entry.total / venueAvg
          games += entry.count
        }
        return games > 0 ? sumRatio / games : 0
      }

      // Legacy blended-avg path. Kept so the toggle can fall back cleanly.
      const getBlendedAvg = (player: string, machine: string): number => {
        const playerMap = oppPlayerStats.get(player)
        if (!playerMap) return 0
        const entry = playerMap.get(machine)
        if (!entry) return 0
        const vAvg = entry.vCount > 0 ? entry.vTotal / entry.vCount : null
        const nvAvg = entry.nvCount > 0 ? entry.nvTotal / entry.nvCount : null
        if (vAvg !== null && nvAvg !== null) return vAvg * vw + nvAvg * (1 - vw)
        if (vAvg !== null) return vAvg
        if (nvAvg !== null) return nvAvg
        return 0
      }

      // Single accessor switches based on the toggle. Both functions return
      // values comparable within their own matrix — Hungarian doesn't care
      // about absolute units, just monotonic ordering.
      const getOppCellValue = usePerGameNormalized ? getPgnOppRatio : getBlendedAvg

      // Nash Equilibrium via Iterative Best Response
      // TWC picks first, opponent responds, TWC re-responds, until convergence.
      // Each iteration is one Hungarian (O(n³)), guaranteed to converge for zero-sum games.
      //
      // 1. TWC picks optimal lineup (pure strength, no opponent consideration)
      // 2. Opponent responds: Hungarian assigns their best players to TWC's chosen machines
      // 3. TWC re-responds: Hungarian with edge bonuses against that opponent lineup
      // 4. Repeat until neither side changes

      const playersPerMachine = format === '4x2' ? 2 : 1

      // Helper: run opponent Hungarian against a set of machines, return machine -> oppAvg map
      const runOpponentHungarian = (targetMachines: string[]): Map<string, number[]> => {
        if (oppPlayerList.length === 0 || targetMachines.length === 0) return new Map()

        const mSlots: { machine: string; slotIndex: number }[] = []
        for (const machine of targetMachines) {
          for (let s = 0; s < playersPerMachine; s++) {
            mSlots.push({ machine, slotIndex: s })
          }
        }

        const d = Math.max(oppPlayerList.length, mSlots.length)
        const matrix: number[][] = []
        for (let r = 0; r < d; r++) {
          const row: number[] = []
          for (let c = 0; c < d; c++) {
            if (r < oppPlayerList.length && c < mSlots.length) {
              row.push(getOppCellValue(oppPlayerList[r], mSlots[c].machine))
            } else {
              row.push(-1e9)
            }
          }
          matrix.push(row)
        }

        const result = hungarianAlgorithm(matrix, true)
        const oppAvgMap = new Map<string, number[]>()
        for (let r = 0; r < oppPlayerList.length; r++) {
          const col = result.assignments[r]
          if (col < 0 || col >= mSlots.length) continue
          const { machine } = mSlots[col]
          const avg = getOppCellValue(oppPlayerList[r], machine)
          if (avg <= 0) continue
          const list = oppAvgMap.get(machine) || []
          list.push(avg)
          oppAvgMap.set(machine, list)
        }
        return oppAvgMap
      }

      // Helper: compute per-player-per-machine edge bonuses from opponent assignments.
      // Each TWC player's venue-adjusted ratio is compared against the specific
      // opponent assigned to that machine.
      //
      // Per-game-normalized branch: getOppCellValue already returns a ratio
      // (mean of per-game (score / venueAvg)), directly comparable to the TWC
      // player's venue_adjusted_avg from calculatePlayerMachineStats — both
      // are per-game-normalized around 1.0. No further division needed.
      //
      // Legacy branch: getOppCellValue returns a raw avg, which is divided by
      // the (single-venue) venueAvg to get the opp's ratio.
      const computeEdgeBonuses = (oppAvgMap: Map<string, number[]>): Map<string, number> => {
        const bonuses = new Map<string, number>()
        for (const machine of allMachinesForStats) {
          const oppAvgs = oppAvgMap.get(machine)
          if (!oppAvgs || oppAvgs.length === 0) continue
          const oppAvg = oppAvgs.reduce((a, b) => a + b, 0) / oppAvgs.length
          if (oppAvg <= 0) continue

          let oppRatio: number
          if (usePerGameNormalized) {
            oppRatio = oppAvg
          } else {
            const venueEntry = venueAvgPerMachine.get(machine)
            const venueAvg = venueEntry && venueEntry.count > 0 ? venueEntry.total / venueEntry.count : 0
            if (venueAvg <= 0) continue
            oppRatio = oppAvg / venueAvg
          }

          for (const player of allPlayers) {
            const twcRatio = statsMap.get(player)?.get(machine)?.venue_adjusted_avg || 0
            if (twcRatio <= 0) continue

            const edge = Math.max(-0.5, Math.min(0.5, (twcRatio - oppRatio) / Math.max(twcRatio, oppRatio)))
            bonuses.set(`${player}|${machine}`, ow * edge)
          }
        }
        return bonuses
      }

      // Run Nash equilibrium for a fixed (or pivoting) TWC machine choice.
      //
      // Uses fictitious play (Robinson 1951) — each iteration the opponent
      // best-responds to TWC's latest, but the bonuses TWC sees are
      // computed from the time-averaged opponent strategy across all
      // iterations. In zero-sum games this provably converges to the
      // game's value, even when no pure NE exists (rock-paper-scissors).
      //
      // Detects cycles via a sliding window of recent bonus keys: if the
      // current key matches any of the last 4, we're in a cycle and
      // exit. The returned bonuses are still the most-recent time-average,
      // which is the FP equilibrium estimate.
      //
      // allowMachinePivot=true lets TWC's Hungarian re-pick which machines
      // to play each iteration as bonuses shift (the original behavior,
      // a cheap heuristic for machine selection). When false, TWC commits
      // to the input subset — used by the outer machine-subset search.
      type NashResult = {
        bonuses: Map<string, number>
        twcMachines: string[]
        twcScore: number
        cycle: boolean
        iterations: number
      }
      const runNashFor = (twcMachinesIn: string[], allowMachinePivot: boolean): NashResult => {
        let twcMachines = [...twcMachinesIn]
        const cumOppAvg = new Map<string, number>()
        const cumOppCount = new Map<string, number>()
        const recentKeys: string[] = []
        const bonuses = new Map<string, number>()
        let cycle = false
        const maxIter = useNashEquilibrium ? 30 : 1
        let iter = 0

        for (iter = 0; iter < maxIter; iter++) {
          const oppAvgMap = runOpponentHungarian(twcMachines.length > 0 ? twcMachines : selectedMachines)

          // Accumulate opp avgs across iterations for fictitious play.
          for (const [machine, avgs] of Array.from(oppAvgMap.entries())) {
            if (avgs.length === 0) continue
            const m = avgs.reduce((a, b) => a + b, 0) / avgs.length
            cumOppAvg.set(machine, (cumOppAvg.get(machine) || 0) + m)
            cumOppCount.set(machine, (cumOppCount.get(machine) || 0) + 1)
          }
          const tavgOppMap = new Map<string, number[]>()
          for (const [machine, sum] of Array.from(cumOppAvg.entries())) {
            const cnt = cumOppCount.get(machine) || 1
            tavgOppMap.set(machine, [sum / cnt])
          }
          const newBonuses = computeEdgeBonuses(tavgOppMap)

          const key = Array.from(newBonuses.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([m, v]) => `${m}:${v.toFixed(4)}`)
            .join('|')

          if (recentKeys.length > 0 && recentKeys.includes(key)) {
            // Either converged (key === last) or cycling (key matches an earlier one).
            if (recentKeys[recentKeys.length - 1] !== key) cycle = true
            bonuses.clear()
            for (const [m, v] of Array.from(newBonuses.entries())) bonuses.set(m, v)
            iter++
            break
          }
          recentKeys.push(key)
          if (recentKeys.length > 4) recentKeys.shift()

          bonuses.clear()
          for (const [m, v] of Array.from(newBonuses.entries())) bonuses.set(m, v)

          if (allowMachinePivot) {
            if (format === '4x2') {
              // Doubles: pair-partition Hungarian picks both the machine
              // subset AND the pair-to-machine assignment under current bonuses.
              const r = optimizer.optimize4x2Hungarian(
                allPlayers, selectedMachines, statsMap, userInputs, pairStatsMap,
                exclusions, confidenceBoost, scoreWeights, bonuses, undefined, halfLockedDoublesSeeds
              )
              if (r && r.assignments.length > 0) {
                twcMachines = r.assignments.map((a: any) => a.machine_id)
              }
            } else {
              const { matrix: twcMatrix, realRows: rr, realCols: rc } = buildCostMatrix(
                allPlayers, selectedMachines, statsMap, confidenceBoost, scoreWeights
              )
              for (let i = 0; i < rr; i++) {
                for (let j = 0; j < rc; j++) {
                  const b = bonuses.get(`${allPlayers[i]}|${selectedMachines[j]}`)
                  if (b == null) continue
                  twcMatrix[i][j] *= (1 + b)
                }
              }
              const r = hungarianAlgorithm(twcMatrix, true)
              twcMachines = []
              for (let i = 0; i < rr; i++) {
                const mIdx = r.assignments[i]
                if (mIdx >= 0 && mIdx < rc) twcMachines.push(selectedMachines[mIdx])
              }
            }
          }
        }

        // Final TWC score under bonuses. Uses the same Hungarian that produces
        // the actual assignment (pair-aware for doubles, player-aware for
        // singles) so the score is comparable to what the final runOptimize
        // call will produce.
        let twcScore = 0
        if (twcMachines.length > 0) {
          if (format === '4x2') {
            // For the final score we may be evaluating a subset of machines
            // (during machine-subset search). Only pass seeds whose machine is
            // in the current twcMachines list — others don't apply here.
            const seedsForSubset = halfLockedDoublesSeeds.filter(s => twcMachines.includes(s.machine))
            const r = optimizer.optimize4x2Hungarian(
              allPlayers, twcMachines, statsMap, userInputs, pairStatsMap,
              exclusions, confidenceBoost, scoreWeights, bonuses, undefined, seedsForSubset
            )
            twcScore = r?.total_score ?? 0
          } else {
            const { matrix, realRows, realCols } = buildCostMatrix(
              allPlayers, twcMachines, statsMap, confidenceBoost, scoreWeights
            )
            for (let i = 0; i < realRows; i++) {
              for (let j = 0; j < realCols; j++) {
                const b = bonuses.get(`${allPlayers[i]}|${twcMachines[j]}`)
                if (b == null) continue
                matrix[i][j] *= (1 + b)
              }
            }
            const r = hungarianAlgorithm(matrix, true)
            for (let i = 0; i < realRows; i++) {
              const j = r.assignments[i]
              if (j >= 0 && j < realCols) twcScore += matrix[i][j]
            }
          }
        }

        return { bonuses, twcMachines, twcScore, cycle, iterations: iter }
      }

      // Decide whether to enumerate machine subsets or use the original
      // greedy-machine-pick + Nash flow.
      const SUBSET_SEARCH_LIMIT = 250
      const binom = (n: number, k: number): number => {
        if (k < 0 || k > n) return 0
        let v = 1
        for (let i = 0; i < k; i++) v = (v * (n - i)) / (i + 1)
        return Math.round(v)
      }
      const enumerateSubsets = (arr: string[], k: number): string[][] => {
        const out: string[][] = []
        const buf: string[] = []
        const rec = (start: number, need: number) => {
          if (need === 0) { out.push([...buf]); return }
          for (let i = start; i <= arr.length - need; i++) {
            buf.push(arr[i])
            rec(i + 1, need - 1)
            buf.pop()
          }
        }
        rec(0, k)
        return out
      }

      const wantSubsetSearch = searchMachineSubsets &&
        selectedMachines.length > requiredMachines &&
        binom(selectedMachines.length, requiredMachines) <= SUBSET_SEARCH_LIMIT

      let nashResult: NashResult
      if (wantSubsetSearch) {
        const subsets = enumerateSubsets(selectedMachines, requiredMachines)
        let best: NashResult | null = null
        for (const subset of subsets) {
          const r = runNashFor(subset, false)
          if (!best || r.twcScore > best.twcScore) best = r
        }
        nashResult = best ?? runNashFor(selectedMachines, true)
      } else {
        // Original behavior: TWC picks machines via initial pure-strength
        // Hungarian (player-aware for singles, pair-aware for doubles), then
        // Nash iteration pivots machines as bonuses shift.
        let initialMachines: string[] = []
        if (format === '4x2') {
          const r = optimizer.optimize4x2Hungarian(
            allPlayers, selectedMachines, statsMap, userInputs, pairStatsMap,
            exclusions, confidenceBoost, scoreWeights, undefined, undefined, halfLockedDoublesSeeds
          )
          if (r && r.assignments.length > 0) {
            initialMachines = r.assignments.map((a: any) => a.machine_id)
          }
        } else {
          const { matrix: twcInitMatrix, realRows: twcRows, realCols: twcCols } = buildCostMatrix(
            allPlayers, selectedMachines, statsMap, confidenceBoost, scoreWeights
          )
          const twcInitResult = hungarianAlgorithm(twcInitMatrix, true)
          for (let i = 0; i < twcRows; i++) {
            const mIdx = twcInitResult.assignments[i]
            if (mIdx >= 0 && mIdx < twcCols) initialMachines.push(selectedMachines[mIdx])
          }
        }
        nashResult = runNashFor(initialMachines, true)
      }

      // Apply Nash result to the per-machine edge bonuses used downstream.
      machineEdgeBonuses.clear()
      for (const [k, v] of Array.from(nashResult.bonuses.entries())) {
        machineEdgeBonuses.set(k, v)
      }

      // Save data for post-optimization opponent assignment display
      oppDataForDisplay = { oppPlayerList, oppPlayerStats, getBlendedAvg, getOppCellValue, allGames, venueVariations, teamNameMap, venueAvgPerMachine }
    }

    const runOptimize = (players: string[]) => {
      if (format === '7x7') {
        return optimizer.optimize7x7WithStats(players, selectedMachines, statsMap, userInputs, exclusions, confidenceBoost, scoreWeights, machineEdgeBonuses.size > 0 ? machineEdgeBonuses : undefined)
      }
      // Doubles: try the partition-enumerating Hungarian first (globally optimal
      // pair-to-machine assignment, respects per-(player, machine) edge bonuses
      // from the Nash loop). Falls back to greedy if the partition count exceeds
      // the cap (only happens with very large lineups).
      const bonuses = machineEdgeBonuses.size > 0 ? machineEdgeBonuses : undefined
      const hungarianResult = optimizer.optimize4x2Hungarian(
        players, selectedMachines, statsMap, userInputs, pairStatsMap, exclusions, confidenceBoost, scoreWeights, bonuses, undefined, halfLockedDoublesSeeds
      )
      if (hungarianResult !== null) return hungarianResult
      return optimizer.optimize4x2WithStats(players, selectedMachines, statsMap, userInputs, pairStatsMap, exclusions, confidenceBoost, scoreWeights)
    }

    // Adjust required counts for forced assignments
    // For singles: forced players/machines are removed from pool
    // For doubles: only forced players are removed (machines stay, partner will be assigned)
    const adjustedRequiredPlayers = requiredPlayers - forcedPlayerSet.size
    const adjustedRequiredMachines = format === '7x7'
      ? requiredMachines - forcedMachineSet.size
      : requiredMachines  // Doubles: machines stay in pool

    // Helper to merge forced assignments back into result
    const mergeForced = (result: any) => {
      if (format === '7x7') {
        // For singles: add forced assignments directly (one player per machine).
        for (const [machine, players] of Array.from(forcedAssignmentMap.entries())) {
          const player = players[0]
          if (!player) continue
          const playerStats = statsMap.get(player)?.get(machine)
          const userInput = userInputs?.get(player)?.get(machine)
          result.assignments.push({
            player_id: player,
            machine_id: machine,
            expected_score: playerStats?.venue_adjusted_avg || 1,
            confidence: playerStats?.confidence_score || 0,
            venue_adjusted_avg: playerStats?.venue_adjusted_avg,
            user_average: userInput?.userAverage,
            user_confidence: userInput?.userConfidence,
            forced: true
          })
        }
      } else {
        // For doubles: only fully-locked pairs (2 forced players on a machine)
        // need merging here — the machine was excluded from the optimizer pool
        // so no existing assignment exists. Half-locked seeds (1 forced player)
        // are handled inside optimize4x2Hungarian via fixedSeeds, which picks
        // the globally-best partner. Those already appear in result.assignments
        // with `forced: true` set.
        for (const [forcedMachine, forcedPlayers] of Array.from(forcedAssignmentMap.entries())) {
          if (forcedPlayers.length < 2) continue
          const [a, b] = forcedPlayers
          const aStats = statsMap.get(a)?.get(forcedMachine)
          const bStats = statsMap.get(b)?.get(forcedMachine)
          const aUI = userInputs?.get(a)?.get(forcedMachine)
          const bUI = userInputs?.get(b)?.get(forcedMachine)
          const pairKey = [a, b].sort().join('|') + '|' + forcedMachine
          const pairStats = pairStatsMap.get(pairKey)
          result.assignments.push({
            player1_id: a,
            player2_id: b,
            machine_id: forcedMachine,
            expected_score: (aStats?.venue_adjusted_avg || 1) + (bStats?.venue_adjusted_avg || 1),
            confidence: ((aStats?.confidence_score || 0) + (bStats?.confidence_score || 0)) / 2,
            player1_venue_adjusted_avg: aStats?.venue_adjusted_avg,
            player2_venue_adjusted_avg: bStats?.venue_adjusted_avg,
            player1_user_average: aUI?.userAverage,
            player2_user_average: bUI?.userAverage,
            player1_user_confidence: aUI?.userConfidence,
            player2_user_confidence: bUI?.userConfidence,
            pair_win_rate: pairStats?.winRate,
            pair_games_played: pairStats?.gamesPlayed,
            forced: true,
            forced_player: `${a} & ${b}`
          })
        }
      }
      return result
    }

    // After TWC optimization, compute assumed opponents via Hungarian for display
    const computeAssumedOpponents = (assignedMachines: string[]) => {
      if (!oppDataForDisplay) return null
      // getOppCellValue drives the Hungarian (per-game-normalized when the
      // toggle is on); getBlendedAvg stays for the displayed raw avg score.
      const { oppPlayerList, getBlendedAvg, getOppCellValue, allGames, venueVariations, teamNameMap, venueAvgPerMachine } = oppDataForDisplay

      // Build opponent cost matrix for the machines that TWC is actually playing
      const playersPerMachine = format === '4x2' ? 2 : 1
      const machineSlots: { machine: string; slotIndex: number }[] = []
      for (const machine of assignedMachines) {
        for (let s = 0; s < playersPerMachine; s++) {
          machineSlots.push({ machine, slotIndex: s })
        }
      }

      if (oppPlayerList.length === 0 || machineSlots.length === 0) return null

      const dim = Math.max(oppPlayerList.length, machineSlots.length)
      const oppCostMatrix: number[][] = []
      for (let r = 0; r < dim; r++) {
        const row: number[] = []
        for (let c = 0; c < dim; c++) {
          if (r < oppPlayerList.length && c < machineSlots.length) {
            row.push(getOppCellValue(oppPlayerList[r], machineSlots[c].machine))
          } else {
            row.push(-1e9)
          }
        }
        oppCostMatrix.push(row)
      }

      const oppResult = hungarianAlgorithm(oppCostMatrix, true)

      // DEBUG: Log opponent assignment (raw avg for human readability)
      console.log('\n--- Assumed Opponent Assignments ---')
      for (let r = 0; r < oppPlayerList.length; r++) {
        const col = oppResult.assignments[r]
        const machine = col >= 0 && col < machineSlots.length ? machineSlots[col].machine : 'DUMMY'
        const avg = col >= 0 && col < machineSlots.length ? getBlendedAvg(oppPlayerList[r], machine) : 0
        console.log(`  ${oppPlayerList[r]} -> ${machine} (blendedAvg: ${avg.toFixed(1)})`)
      }

      // Map assignments and build detailed stats
      const result: Record<string, any[]> = {}
      for (let r = 0; r < oppPlayerList.length; r++) {
        const col = oppResult.assignments[r]
        if (col < 0 || col >= machineSlots.length) continue
        const { machine } = machineSlots[col]
        const blendedAvg = getBlendedAvg(oppPlayerList[r], machine)

        // Compute per-player detailed stats
        const playerName = oppPlayerList[r]
        let vTotal = 0, vCount = 0, vWins = 0, allTotal = 0, allCount = 0, allWins = 0
        for (const game of allGames) {
          for (let i = 1; i <= 4; i++) {
            const pn = game[`player_${i}_name`]
            const tk = game[`player_${i}_team`]
            const score = game[`player_${i}_score`]
            if (pn !== playerName || !tk || !score) continue
            if (!isScoreValid(game.machine, score, scoreLimits)) continue
            if (teamNameMap[tk] !== opponent) continue
            const isVenueGame = venueVariations.includes(game.venue)
            // Win = player's team scored more total points than the other team(s) in this game.
            // Works across formats: singles (each player is their own team) and doubles (2v2 teams).
            const teamPoints = new Map<string, number>()
            for (let j = 1; j <= 4; j++) {
              const jt = game[`player_${j}_team`]
              const jp = game[`player_${j}_points`]
              if (!jt || typeof jp !== 'number') continue
              teamPoints.set(jt, (teamPoints.get(jt) || 0) + jp)
            }
            const myTeamPts = teamPoints.get(tk) ?? -Infinity
            let won = teamPoints.size >= 2
            for (const [otherTk, pts] of Array.from(teamPoints.entries())) {
              if (otherTk === tk) continue
              if (pts >= myTeamPts) { won = false; break }
            }
            if (isVenueGame) { vTotal += score; vCount++; if (won) vWins++ }
            allTotal += score; allCount++; if (won) allWins++
          }
        }

        const venueEntry = venueAvgPerMachine.get(machine)
        const machineVenueAvg = venueEntry && venueEntry.count > 0 ? venueEntry.total / venueEntry.count : 0

        if (!result[machine]) result[machine] = []
        result[machine].push({
          player: playerName,
          avgScore: Math.round(blendedAvg),
          venueAvg: Math.round(machineVenueAvg),
          venueGames: vCount,
          venueWinRate: vCount > 0 ? Math.round((vWins / vCount) * 100) : 0,
          allAvg: allCount > 0 ? Math.round(allTotal / allCount) : 0,
          allGames: allCount,
          allWinRate: allCount > 0 ? Math.round((allWins / allCount) * 100) : 0,
        })
      }
      return result
    }

    // Helper: greedily assign remaining (benched) players to their best machines
    // Used when assignAll is true to extend the normal optimization
    const greedyAssignRemaining = (merged: any, benchedPlayers: string[]) => {
      if (!assignAll || benchedPlayers.length === 0) return
      const regularCount = merged.assignments.length
      merged.regularCount = regularCount

      const assignedMachineSet = new Set<string>(merged.assignments.map((a: any) => a.machine_id))
      const usedPlayers = new Set<string>()
      for (const a of merged.assignments) {
        if (a.player_id) usedPlayers.add(a.player_id)
        if (a.player1_id) usedPlayers.add(a.player1_id)
        if (a.player2_id) usedPlayers.add(a.player2_id)
      }

      const remainingPlayers = benchedPlayers.filter(p => !usedPlayers.has(p))
      // All machines at venue (including already-used ones for reuse)
      const allMachines = machines as string[]

      if (format === '7x7') {
        // Singles: greedily assign each remaining player to their best machine
        for (const player of remainingPlayers) {
          let bestMachine = ''
          let bestScore = -Infinity
          let bestStats: any = null

          for (const machine of allMachines) {
            const stats = statsMap.get(player)?.get(machine) || null
            const score = calculatePerformanceScore(stats, confidenceBoost, scoreWeights)
            // Prefer unused machines
            const bonus = assignedMachineSet.has(machine) ? 0 : 0.001
            if (score + bonus > bestScore) {
              bestScore = score + bonus
              bestMachine = machine
              bestStats = stats
            }
          }

          if (bestMachine) {
            const ui = userInputs?.get(player)?.get(bestMachine)
            merged.assignments.push({
              player_id: player,
              machine_id: bestMachine,
              expected_score: bestScore,
              confidence: bestStats?.confidence_score || 0,
              venue_adjusted_avg: bestStats?.venue_adjusted_avg,
              user_average: ui?.userAverage ?? null,
              user_confidence: ui?.userConfidence ?? null,
              isExtra: true,
            })
            assignedMachineSet.add(bestMachine)
          }
        }
      } else {
        // Doubles: pair remaining players and assign to best machine
        const remaining = [...remainingPlayers]
        while (remaining.length >= 2) {
          let bestMachine = ''
          let bestPair: [string, string] | null = null
          let bestScore = -Infinity

          for (let i = 0; i < remaining.length; i++) {
            for (let j = i + 1; j < remaining.length; j++) {
              const p1 = remaining[i], p2 = remaining[j]
              for (const machine of allMachines) {
                const stats1 = statsMap.get(p1)?.get(machine) || null
                const stats2 = statsMap.get(p2)?.get(machine) || null
                const score1 = calculatePerformanceScore(stats1, confidenceBoost, scoreWeights)
                const score2 = calculatePerformanceScore(stats2, confidenceBoost, scoreWeights)
                const pairKey1 = `${p1}|${p2}|${machine}`
                const pairKey2 = `${p2}|${p1}|${machine}`
                const pStats = pairStatsMap.get(pairKey1) || pairStatsMap.get(pairKey2)
                const synergy = calculatePairSynergy(stats1, stats2, pStats?.winRate, confidenceBoost, scoreWeights)
                const combined = score1 + score2 + synergy
                const bonus = assignedMachineSet.has(machine) ? 0 : 0.001
                if (combined + bonus > bestScore) {
                  bestScore = combined + bonus
                  bestMachine = machine
                  bestPair = [p1, p2]
                }
              }
            }
          }

          if (bestPair && bestMachine) {
            const stats1 = statsMap.get(bestPair[0])?.get(bestMachine)
            const stats2 = statsMap.get(bestPair[1])?.get(bestMachine)
            const ui1 = userInputs?.get(bestPair[0])?.get(bestMachine)
            const ui2 = userInputs?.get(bestPair[1])?.get(bestMachine)
            merged.assignments.push({
              player1_id: bestPair[0],
              player2_id: bestPair[1],
              machine_id: bestMachine,
              expected_score: bestScore,
              confidence: ((stats1?.confidence_score || 0) + (stats2?.confidence_score || 0)) / 2,
              player1_venue_adjusted_avg: stats1?.venue_adjusted_avg,
              player2_venue_adjusted_avg: stats2?.venue_adjusted_avg,
              player1_user_average: ui1?.userAverage ?? null,
              player2_user_average: ui2?.userAverage ?? null,
              player1_user_confidence: ui1?.userConfidence ?? null,
              player2_user_confidence: ui2?.userConfidence ?? null,
              isExtra: true,
            })
            assignedMachineSet.add(bestMachine)
            remaining.splice(remaining.indexOf(bestPair[1]), 1)
            remaining.splice(remaining.indexOf(bestPair[0]), 1)
          } else {
            break
          }
        }
      }

      // Clear benched since all are now assigned
      merged.benched = []
    }

    // Exact match or fewer players — run directly
    if (allPlayers.length <= adjustedRequiredPlayers) {
      const result = runOptimize(allPlayers)
      result.benched = []
      const merged = mergeForced(result)
      if (assignAll) merged.regularCount = merged.assignments.length
      const assignedMachines = merged.assignments.map((a: any) => a.machine_id)
      assumedOpponents = computeAssumedOpponents(assignedMachines)
      return NextResponse.json({ ...merged, ...(assumedOpponents ? { assumedOpponents } : {}), ...(assignAll ? { regularCount: merged.regularCount } : {}) })
    }

    // More players than required — exhaustive combination search
    const mustPlayPlayers = allPlayers.filter(p => mustPlaySet.has(p))
    const flexPlayers = allPlayers.filter(p => !mustPlaySet.has(p))
    const slotsToFill = adjustedRequiredPlayers - mustPlayPlayers.length

    const flexCombos = combinations(flexPlayers, slotsToFill)

    if (flexCombos.length === 0) {
      // If no flex combos but we have forced assignments, just return those
      if (forcedAssignmentMap.size > 0) {
        const result = {
          format,
          assignments: [],
          total_score: 0,
          win_probability: 0,
          benched: flexPlayers
        }
        return NextResponse.json(mergeForced(result))
      }
      return NextResponse.json(
        { error: `Not enough players to fill ${requiredPlayers} slots` },
        { status: 400 }
      )
    }

    // DEBUG: Log per-player per-machine performance scores
    console.log('\n=== OPTIMIZER DEBUG: Per-Player Per-Machine Scores ===')
    for (const player of allPlayers) {
      const scores: Record<string, string> = {}
      for (const machine of selectedMachines) {
        const stats = statsMap.get(player)?.get(machine)
        const perfScore = stats ? (stats.venue_adjusted_avg || 0).toFixed(3) : 'NO_STATS'
        const gamesPlayed = stats?.games_played || 0
        scores[machine] = `${perfScore} (${gamesPlayed}g)`
      }
      console.log(`  ${player}: ${JSON.stringify(scores)}`)
    }

    let bestResult: any = null
    let bestScore = -Infinity
    let bestBenched: string[] = []
    const comboResults: { players: string[]; benched: string[]; score: number; assignments: string }[] = []

    for (const flexCombo of flexCombos) {
      const comboPlayers = [...mustPlayPlayers, ...flexCombo]
      const benched = flexPlayers.filter(p => !flexCombo.includes(p))

      const result = runOptimize(comboPlayers)

      comboResults.push({
        players: comboPlayers,
        benched,
        score: result.total_score,
        assignments: result.assignments.map((a: any) => `${a.player_id}->${a.machine_id}(${a.expected_score.toFixed(3)})`).join(', ')
      })

      if (result.total_score > bestScore) {
        bestScore = result.total_score
        bestResult = result
        bestBenched = benched
      }
    }

    // DEBUG: Log all combo results sorted by score
    console.log('\n=== OPTIMIZER DEBUG: Combo Results (sorted by score) ===')
    comboResults.sort((a, b) => b.score - a.score)
    for (const c of comboResults.slice(0, 10)) {
      console.log(`  Score: ${c.score.toFixed(4)} | Benched: [${c.benched.join(', ')}]`)
      console.log(`    Assignments: ${c.assignments}`)
    }
    console.log(`  Total combos evaluated: ${comboResults.length}`)
    console.log(`  Best score: ${bestScore.toFixed(4)}, Benched: [${bestBenched.join(', ')}]`)
    console.log('=== END OPTIMIZER DEBUG ===\n')

    bestResult.benched = bestBenched
    const merged = mergeForced(bestResult)
    greedyAssignRemaining(merged, bestBenched)
    const assignedMachines = merged.assignments.map((a: any) => a.machine_id)
    assumedOpponents = computeAssumedOpponents(assignedMachines)
    return NextResponse.json({ ...merged, ...(assumedOpponents ? { assumedOpponents } : {}), ...(assignAll ? { regularCount: merged.regularCount } : {}) })
  } catch (error: any) {
    console.error('Optimization error:', error)
    return NextResponse.json(
      {
        error: error.message || 'Optimization failed',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    )
  }
}
