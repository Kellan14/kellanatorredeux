import { hungarianAlgorithm, greedyAssignment } from './hungarian'
import {
  calculatePerformanceScore,
  calculateConfidenceLevel,
  buildCostMatrix,
  generateSuggestions,
  calculateTeamMetrics,
  calculatePairSynergy,
  type ScoreWeights
} from './calculator'
import { calculatePlayerMachineStats, calculatePairStats, type UserInputData, type AvgMethod } from './stats-calculator'
import { getAllMachineVariations, getCanonicalMachineKey } from '../machine-mappings'
import { createClient } from '@supabase/supabase-js'
import type {
  OptimizationResult,
  Assignment,
  PairAssignment,
  PlayerMachineStats
} from '@/types/strategy'

/**
 * Fetch user-reported inputs (averages + confidence) from user_machine_inputs table.
 */
async function fetchUserInputs(
  playerNames: string[],
  machines: string[],
  venue?: string
): Promise<Map<string, Map<string, UserInputData>>> {
  const result = new Map<string, Map<string, UserInputData>>()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) return result

  // Query all machine name variations since user_machine_inputs stores display names
  const machineVariations = getAllMachineVariations(machines)

  const supabase = createClient(supabaseUrl, supabaseKey)
  let query = supabase
    .from('user_machine_inputs')
    .select('player_name, machine, user_average, user_confidence')
    .in('player_name', playerNames)
    .in('machine', machineVariations)

  if (venue) {
    query = query.in('venue', [venue, ''])
  }

  const { data, error } = await query

  if (error || !data) return result

  for (const row of data) {
    // Normalize stored machine name to canonical key for matching
    const canonical = getCanonicalMachineKey(row.machine)
    const machineKey = machines.includes(canonical) ? canonical
      : machines.find(m => m.toLowerCase() === canonical.toLowerCase()) || canonical
    if (!result.has(row.player_name)) {
      result.set(row.player_name, new Map())
    }
    result.get(row.player_name)!.set(machineKey, {
      userAverage: row.user_average,
      userConfidence: row.user_confidence,
    })
  }

  return result
}

/**
 * Fetch venue-specific and all-venue stats, then blend them using venueWeight.
 * Returns a single blended statsMap.
 */
async function getBlendedStats(
  playerNames: string[],
  machines: string[],
  seasonStart: number,
  seasonEnd: number,
  venue?: string,
  venueWeight: number = 0.7,
  userInputWeight: number = 0,
  confidenceBoost: number = 0,
  avgMethod: AvgMethod = 'mean',
  trimPct: number = 0.1
): Promise<{ statsMap: Map<string, Map<string, PlayerMachineStats>>; userInputs?: Map<string, Map<string, UserInputData>> }> {
  // Fetch user inputs if user input weight or confidence boost is active
  const userInputs = (userInputWeight > 0 || confidenceBoost > 0)
    ? await fetchUserInputs(playerNames, machines, venue)
    : undefined

  if (!venue) {
    const statsMap = await calculatePlayerMachineStats(playerNames, machines, seasonStart, seasonEnd, undefined, userInputs, userInputWeight, avgMethod, trimPct)
    return { statsMap, userInputs }
  }

  // Fetch venue-specific and all-venue stats in parallel
  const [venueStats, allStats] = await Promise.all([
    calculatePlayerMachineStats(playerNames, machines, seasonStart, seasonEnd, venue, userInputs, userInputWeight, avgMethod, trimPct),
    calculatePlayerMachineStats(playerNames, machines, seasonStart, seasonEnd, undefined, userInputs, userInputWeight, avgMethod, trimPct)
  ])

  // Blend the two stat sets
  const blended = new Map<string, Map<string, PlayerMachineStats>>()
  const vw = Math.max(0, Math.min(1, venueWeight))

  for (const player of playerNames) {
    const playerBlended = new Map<string, PlayerMachineStats>()
    const venuePlayerStats = venueStats.get(player)
    const allPlayerStats = allStats.get(player)

    for (const machine of machines) {
      const vs = venuePlayerStats?.get(machine)
      const as_ = allPlayerStats?.get(machine)

      if (!vs && !as_) continue

      if (vs && as_) {
        // Blend the stats
        playerBlended.set(machine, {
          id: vs.id,
          player_id: vs.player_id,
          machine_id: vs.machine_id,
          games_played: as_.games_played,
          wins: as_.wins,
          losses: as_.losses,
          win_rate: vs.win_rate * vw + as_.win_rate * (1 - vw),
          avg_score: vs.avg_score * vw + as_.avg_score * (1 - vw),
          venue_adjusted_avg: vs.venue_adjusted_avg * vw + as_.venue_adjusted_avg * (1 - vw),
          high_score: Math.max(vs.high_score, as_.high_score),
          recent_form: vs.recent_form * vw + as_.recent_form * (1 - vw),
          streak_type: as_.streak_type,
          streak_count: as_.streak_count,
          confidence_score: Math.max(vs.confidence_score, as_.confidence_score),
          user_confidence: vs.user_confidence || as_.user_confidence,
          last_played: vs.last_played || as_.last_played
        })
      } else if (vs) {
        // Only venue stats exist — always use them
        playerBlended.set(machine, vs)
      } else if (as_ && vw < 1) {
        // Only all-venue stats exist — scale by (1 - venueWeight)
        // At venue weight 1.0 (venue only), non-venue data is excluded entirely
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
      blended.set(player, playerBlended)
    }
  }

  return { statsMap: blended, userInputs }
}

export class LineupOptimizer {
  /**
   * Pre-fetch blended stats for all players. Call once, then use
   * optimize7x7WithStats / optimize4x2WithStats for each combo.
   */
  async prefetchStats(
    playerNames: string[],
    machines: string[],
    seasonStart: number,
    seasonEnd: number,
    venue?: string,
    venueWeight?: number,
    userInputWeight: number = 0,
    confidenceBoost: number = 0,
    avgMethod: AvgMethod = 'mean',
    trimPct: number = 0.1
  ) {
    return getBlendedStats(playerNames, machines, seasonStart, seasonEnd, venue, venueWeight, userInputWeight, confidenceBoost, avgMethod, trimPct)
  }

  /**
   * Optimize lineup for 7x7 singles format
   */
  async optimize7x7(
    playerNames: string[],
    machines: string[],
    seasonStart: number = 20,
    seasonEnd: number = 22,
    venue?: string,
    venueWeight?: number,
    exclusions: Record<string, string[]> = {},
    userInputWeight: number = 0,
    confidenceBoost: number = 0,
    scoreWeights?: ScoreWeights
  ): Promise<OptimizationResult> {
    const { statsMap, userInputs } = await getBlendedStats(playerNames, machines, seasonStart, seasonEnd, venue, venueWeight, userInputWeight, confidenceBoost)
    return this.optimize7x7WithStats(playerNames, machines, statsMap, userInputs, exclusions, confidenceBoost, scoreWeights)
  }

  /**
   * Optimize 7x7 with pre-fetched stats (no DB calls)
   */
  optimize7x7WithStats(
    playerNames: string[],
    machines: string[],
    statsMap: Map<string, Map<string, PlayerMachineStats>>,
    userInputs: Map<string, Map<string, UserInputData>> | undefined,
    exclusions: Record<string, string[]> = {},
    confidenceBoost: number = 0,
    scoreWeights?: ScoreWeights,
    machineEdgeBonuses?: Map<string, number>
  ): OptimizationResult {

    // Helper to get extra fields for an assignment
    const getExtraFields = (playerName: string, machine: string) => {
      const stats = statsMap.get(playerName)?.get(machine)
      const ui = userInputs?.get(playerName)?.get(machine)
      return {
        venue_adjusted_avg: stats?.venue_adjusted_avg,
        user_average: ui?.userAverage ?? null,
        user_confidence: ui?.userConfidence ?? null,
      }
    }

    // Build cost matrix (automatically padded to square)
    const { matrix: costMatrix, realRows, realCols } = buildCostMatrix(playerNames, machines, statsMap, confidenceBoost, scoreWeights)

    // Apply per-player-per-machine opponent edge bonuses
    // Each cell gets its own bonus based on how this specific TWC player compares to the assigned opponent
    if (machineEdgeBonuses && machineEdgeBonuses.size > 0) {
      for (let i = 0; i < realRows; i++) {
        for (let j = 0; j < realCols; j++) {
          const bonus = machineEdgeBonuses.get(`${playerNames[i]}|${machines[j]}`)
          if (bonus == null) continue
          costMatrix[i][j] *= (1 + bonus)
        }
      }
    }

    // Apply exclusions: set excluded player-machine combos to a very low score
    for (const [machine, excludedPlayers] of Object.entries(exclusions)) {
      const machineIdx = machines.indexOf(machine)
      if (machineIdx === -1) continue
      for (const player of excludedPlayers) {
        const playerIdx = playerNames.indexOf(player)
        if (playerIdx === -1) continue
        costMatrix[playerIdx][machineIdx] = -10000
      }
    }

    // DEBUG: Log cost matrix
    console.log(`\n--- Hungarian Cost Matrix (${realRows} players x ${realCols} machines) ---`)
    const header = [''.padEnd(20), ...machines.slice(0, realCols).map(m => m.substring(0, 12).padEnd(12))]
    console.log(header.join(' '))
    for (let i = 0; i < realRows; i++) {
      const row = [playerNames[i].padEnd(20), ...costMatrix[i].slice(0, realCols).map((v: number) => v.toFixed(4).padEnd(12))]
      console.log(row.join(' '))
    }

    // Run Hungarian algorithm
    const { assignments: hungarianAssignments } = hungarianAlgorithm(costMatrix, true)

    // DEBUG: Log Hungarian result
    console.log(`--- Hungarian Assignments ---`)
    for (let i = 0; i < realRows; i++) {
      const mIdx = hungarianAssignments[i]
      const machine = mIdx >= 0 && mIdx < realCols ? machines[mIdx] : 'DUMMY'
      const cellScore = mIdx >= 0 && mIdx < realCols ? costMatrix[i][mIdx].toFixed(4) : 'N/A'
      console.log(`  ${playerNames[i]} -> ${machine} (matrix cell: ${cellScore})`)
    }

    // Convert to Assignment objects, filtering out dummy assignments
    const assignments: Assignment[] = []
    for (let i = 0; i < realRows; i++) {
      const machineIdx = hungarianAssignments[i]
      if (machineIdx === -1 || machineIdx >= realCols) continue

      const playerName = playerNames[i]
      const machine = machines[machineIdx]
      const stats = statsMap.get(playerName)?.get(machine)
      const score = calculatePerformanceScore(stats || null, confidenceBoost, scoreWeights)
      const confidence = stats
        ? calculateConfidenceLevel(stats.games_played)
        : 1

      assignments.push({
        player_id: playerName,
        machine_id: machine,
        expected_score: score,
        confidence,
        ...getExtraFields(playerName, machine)
      })
    }

    // Generate alternative assignments using greedy approach
    const { assignments: greedyAssigns } = greedyAssignment(costMatrix, true)
    const alternatives: Assignment[][] = [[]]

    for (let i = 0; i < realRows; i++) {
      const machineIdx = greedyAssigns[i]
      if (machineIdx === -1 || machineIdx >= realCols) continue

      const playerName = playerNames[i]
      const machine = machines[machineIdx]
      const stats = statsMap.get(playerName)?.get(machine)
      const score = calculatePerformanceScore(stats || null, confidenceBoost, scoreWeights)
      const confidence = stats
        ? calculateConfidenceLevel(stats.games_played)
        : 1

      alternatives[0].push({
        player_id: playerName,
        machine_id: machine,
        expected_score: score,
        confidence,
        ...getExtraFields(playerName, machine)
      })
    }

    // Generate suggestions
    const suggestions = generateSuggestions(
      assignments.map(a => ({
        playerId: a.player_id,
        machineId: a.machine_id,
        score: a.expected_score,
        confidence: a.confidence
      })),
      statsMap
    )

    // Calculate team metrics
    const { totalScore, winProbability } = calculateTeamMetrics(
      assignments.map(a => ({
        playerId: a.player_id,
        machineId: a.machine_id,
        score: a.expected_score
      }))
    )

    return {
      format: '7x7',
      assignments,
      total_score: totalScore,
      win_probability: winProbability,
      alternative_assignments: alternatives,
      suggestions
    }
  }

  /**
   * Optimize lineup for 4x2 doubles format
   */
  async optimize4x2(
    playerNames: string[],
    machines: string[],
    seasonStart: number = 20,
    seasonEnd: number = 22,
    venue?: string,
    venueWeight?: number,
    exclusions: Record<string, string[]> = {},
    userInputWeight: number = 0,
    confidenceBoost: number = 0,
    scoreWeights?: ScoreWeights
  ): Promise<OptimizationResult> {
    const { statsMap, userInputs } = await getBlendedStats(playerNames, machines, seasonStart, seasonEnd, venue, venueWeight, userInputWeight, confidenceBoost)
    const pairStatsData = await calculatePairStats(playerNames, machines, seasonStart, seasonEnd)
    const pairStatsMap = new Map<string, { winRate: number; gamesPlayed: number }>()
    for (const [key, stats] of Array.from(pairStatsData.entries())) {
      pairStatsMap.set(key, stats)
    }
    return this.optimize4x2WithStats(playerNames, machines, statsMap, userInputs, pairStatsMap, exclusions, confidenceBoost, scoreWeights)
  }

  /**
   * Optimize 4x2 with pre-fetched stats (no DB calls)
   */
  optimize4x2WithStats(
    playerNames: string[],
    machines: string[],
    statsMap: Map<string, Map<string, PlayerMachineStats>>,
    userInputs: Map<string, Map<string, UserInputData>> | undefined,
    pairStatsMap: Map<string, { winRate: number; gamesPlayed: number }>,
    exclusions: Record<string, string[]> = {},
    confidenceBoost: number = 0,
    scoreWeights?: ScoreWeights
  ): OptimizationResult {
    // Helper to get extra fields for an assignment
    const getExtraFields = (playerName: string, machine: string) => {
      const stats = statsMap.get(playerName)?.get(machine)
      const ui = userInputs?.get(playerName)?.get(machine)
      return {
        venue_adjusted_avg: stats?.venue_adjusted_avg,
        user_average: ui?.userAverage ?? null,
        user_confidence: ui?.userConfidence ?? null,
      }
    }

    // Generate all possible pairs
    const pairs: Array<{ p1: string; p2: string }> = []
    for (let i = 0; i < playerNames.length; i++) {
      for (let j = i + 1; j < playerNames.length; j++) {
        pairs.push({ p1: playerNames[i], p2: playerNames[j] })
      }
    }

    // Greedy approach: iteratively pick the best (machine, pair) combination
    const assignments: PairAssignment[] = []
    const usedPlayers = new Set<string>()
    const usedMachines = new Set<string>()

    for (let round = 0; round < machines.length; round++) {
      let bestMachine = ''
      let bestPair: { p1: string; p2: string; score: number } | null = null

      for (const machine of machines) {
        if (usedMachines.has(machine)) continue

        for (const { p1, p2 } of pairs) {
          if (usedPlayers.has(p1) || usedPlayers.has(p2)) continue

          // Skip if either player is excluded from this machine
          const machineExclusions = exclusions[machine] || []
          if (machineExclusions.includes(p1) || machineExclusions.includes(p2)) continue

          const stats1 = statsMap.get(p1)?.get(machine)
          const stats2 = statsMap.get(p2)?.get(machine)

          const score1 = calculatePerformanceScore(stats1 || null, confidenceBoost, scoreWeights)
          const score2 = calculatePerformanceScore(stats2 || null, confidenceBoost, scoreWeights)

          const pairKey1 = `${p1}|${p2}|${machine}`
          const pairKey2 = `${p2}|${p1}|${machine}`
          const pairStats = pairStatsMap.get(pairKey1) || pairStatsMap.get(pairKey2)

          const synergy = calculatePairSynergy(stats1 || null, stats2 || null, pairStats?.winRate, confidenceBoost, scoreWeights)
          const combinedScore = score1 + score2 + synergy

          if (!bestPair || combinedScore > bestPair.score) {
            bestPair = { p1, p2, score: combinedScore }
            bestMachine = machine
          }
        }
      }

      if (!bestPair || !bestMachine) break

      const stats1 = statsMap.get(bestPair.p1)?.get(bestMachine)
      const stats2 = statsMap.get(bestPair.p2)?.get(bestMachine)
      const pairKey1 = `${bestPair.p1}|${bestPair.p2}|${bestMachine}`
      const pairKey2 = `${bestPair.p2}|${bestPair.p1}|${bestMachine}`
      const pairStats = pairStatsMap.get(pairKey1) || pairStatsMap.get(pairKey2)
      const synergy = calculatePairSynergy(stats1 || null, stats2 || null, pairStats?.winRate, confidenceBoost, scoreWeights)

      const extra1 = getExtraFields(bestPair.p1, bestMachine)
      const extra2 = getExtraFields(bestPair.p2, bestMachine)
      assignments.push({
        player1_id: bestPair.p1,
        player2_id: bestPair.p2,
        machine_id: bestMachine,
        expected_score: bestPair.score,
        synergy_bonus: synergy,
        player1_venue_adjusted_avg: extra1.venue_adjusted_avg,
        player2_venue_adjusted_avg: extra2.venue_adjusted_avg,
        player1_user_average: extra1.user_average,
        player2_user_average: extra2.user_average,
        player1_user_confidence: extra1.user_confidence,
        player2_user_confidence: extra2.user_confidence,
      })

      usedPlayers.add(bestPair.p1)
      usedPlayers.add(bestPair.p2)
      usedMachines.add(bestMachine)
    }

    // Generate suggestions
    const suggestions: string[] = []
    if (assignments.length < machines.length) {
      suggestions.push('Warning: Could not create optimal pairs for all machines')
    }

    const highSynergy = assignments.filter(a => a.synergy_bonus > 0.1)
    if (highSynergy.length > 0) {
      suggestions.push(`${highSynergy.length} pair(s) show strong synergy - excellent!`)
    }

    const lowSynergy = assignments.filter(a => a.synergy_bonus < -0.1)
    if (lowSynergy.length > 0) {
      suggestions.push(`${lowSynergy.length} pair(s) may benefit from different pairing`)
    }

    if (suggestions.length === 0) {
      suggestions.push('Pairs look well balanced for the selected machines')
    }

    // Calculate team metrics
    const totalScore = assignments.reduce((sum, a) => sum + a.expected_score, 0)
    const avgScore = assignments.length > 0 ? totalScore / assignments.length : 0
    const winProbability = 1 / (1 + Math.exp(-10 * (avgScore / 2 - 0.5)))

    return {
      format: '4x2',
      assignments,
      total_score: totalScore,
      win_probability: winProbability,
      suggestions
    }
  }

  /**
   * Optimize 4x2 doubles via pair-partition enumeration + Hungarian.
   *
   * The greedy `optimize4x2WithStats` picks the best (pair, machine) one
   * round at a time and locks it in — globally suboptimal. This version
   * enumerates every way to partition the player pool into N pairs (plus
   * a bench, if any), builds a pair × machine cost matrix for each
   * partition, Hungarian-solves it, and returns the partition + assignment
   * with the highest total score. Also accepts per-(player, machine) edge
   * bonuses from the Nash equilibrium loop — both players in a pair get
   * their bonuses averaged into the cell.
   *
   * Returns null when the partition count exceeds `partitionCap`, signaling
   * the caller to fall back to the greedy. For typical doubles lineups
   * (8–12 players, 4 machines) the count is well under 10K, sub-second.
   */
  optimize4x2Hungarian(
    playerNames: string[],
    machines: string[],
    statsMap: Map<string, Map<string, PlayerMachineStats>>,
    userInputs: Map<string, Map<string, UserInputData>> | undefined,
    pairStatsMap: Map<string, { winRate: number; gamesPlayed: number }>,
    exclusions: Record<string, string[]> = {},
    confidenceBoost: number = 0,
    scoreWeights?: ScoreWeights,
    edgeBonuses?: Map<string, number>,
    partitionCap: number = 50000
  ): OptimizationResult | null {
    const k = Math.min(machines.length, Math.floor(playerNames.length / 2))
    if (k === 0) {
      return { format: '4x2', assignments: [], total_score: 0, win_probability: 0, benched: [...playerNames], suggestions: [] }
    }

    // Count partitions before enumerating so we can fall back early.
    const binom = (n: number, r: number): number => {
      if (r < 0 || r > n) return 0
      let v = 1
      for (let i = 0; i < r; i++) v = (v * (n - i)) / (i + 1)
      return Math.round(v)
    }
    const pairingsOf2k = (kk: number): number => {
      // (2k)! / (2^k · k!)
      let v = 1
      for (let i = 1; i <= kk; i++) v *= (2 * i - 1)
      return v
    }
    const totalPartitions = binom(playerNames.length, 2 * k) * pairingsOf2k(k)
    if (totalPartitions > partitionCap) return null

    const scoreCombo = (p1: string, p2: string, m: string): number => {
      const machExcl = exclusions[m] || []
      if (machExcl.includes(p1) || machExcl.includes(p2)) return -1e9
      const s1 = statsMap.get(p1)?.get(m) || null
      const s2 = statsMap.get(p2)?.get(m) || null
      const perf1 = calculatePerformanceScore(s1, confidenceBoost, scoreWeights)
      const perf2 = calculatePerformanceScore(s2, confidenceBoost, scoreWeights)
      const pairKey = [p1, p2].sort().join('|') + '|' + m
      const pairStats = pairStatsMap.get(pairKey)
      const synergy = calculatePairSynergy(s1, s2, pairStats?.winRate, confidenceBoost, scoreWeights)
      let score = perf1 + perf2 + synergy
      if (edgeBonuses && edgeBonuses.size > 0) {
        const b1 = edgeBonuses.get(`${p1}|${m}`) ?? 0
        const b2 = edgeBonuses.get(`${p2}|${m}`) ?? 0
        score *= 1 + (b1 + b2) / 2
      }
      return score
    }

    // Returns each partition of `arr` into exactly `kk` unordered pairs +
    // (arr.length - 2·kk) benched. Canonical ordering: the smallest-index
    // unbenched player is paired with every possible partner in turn (no
    // duplicate (A,B) vs (B,A)).
    type Partition = { pairs: [string, string][]; bench: string[] }
    const partitions = (arr: string[], kk: number): Partition[] => {
      if (kk === 0) return [{ pairs: [], bench: [...arr] }]
      if (arr.length < 2 * kk) return []
      const out: Partition[] = []
      const first = arr[0]
      const rest = arr.slice(1)
      for (let i = 0; i < rest.length; i++) {
        const partner = rest[i]
        const remaining = [...rest.slice(0, i), ...rest.slice(i + 1)]
        for (const sub of partitions(remaining, kk - 1)) {
          out.push({ pairs: [[first, partner] as [string, string], ...sub.pairs], bench: sub.bench })
        }
      }
      if (rest.length >= 2 * kk) {
        for (const sub of partitions(rest, kk)) {
          out.push({ pairs: sub.pairs, bench: [first, ...sub.bench] })
        }
      }
      return out
    }

    type Best = { pairs: [string, string][]; machineFor: number[]; bench: string[]; score: number }
    let best: Best | null = null

    for (const { pairs, bench } of partitions(playerNames, k)) {
      const dim = Math.max(k, machines.length)
      const matrix: number[][] = Array.from({ length: dim }, () => Array(dim).fill(-1e9))
      let anyValid = false
      for (let i = 0; i < k; i++) {
        for (let j = 0; j < machines.length; j++) {
          const v = scoreCombo(pairs[i][0], pairs[i][1], machines[j])
          matrix[i][j] = v
          if (v > -1e8) anyValid = true
        }
      }
      if (!anyValid) continue

      const { assignments: ha } = hungarianAlgorithm(matrix, true)
      let total = 0
      const machineFor: number[] = new Array(k).fill(-1)
      let valid = true
      for (let i = 0; i < k; i++) {
        const j = ha[i]
        if (j < 0 || j >= machines.length) { valid = false; break }
        const cell = matrix[i][j]
        if (cell <= -1e8) { valid = false; break }
        machineFor[i] = j
        total += cell
      }
      if (!valid) continue
      if (!best || total > best.score) best = { pairs, machineFor, bench, score: total }
    }

    if (!best) {
      return { format: '4x2', assignments: [], total_score: 0, win_probability: 0, benched: [...playerNames], suggestions: [] }
    }

    const assignments: PairAssignment[] = best.pairs.map(([p1, p2], i) => {
      const m = machines[best!.machineFor[i]]
      const s1 = statsMap.get(p1)?.get(m) || null
      const s2 = statsMap.get(p2)?.get(m) || null
      const perf1 = calculatePerformanceScore(s1, confidenceBoost, scoreWeights)
      const perf2 = calculatePerformanceScore(s2, confidenceBoost, scoreWeights)
      const pairKey = [p1, p2].sort().join('|') + '|' + m
      const pairStats = pairStatsMap.get(pairKey)
      const synergy = calculatePairSynergy(s1, s2, pairStats?.winRate, confidenceBoost, scoreWeights)
      const ui1 = userInputs?.get(p1)?.get(m)
      const ui2 = userInputs?.get(p2)?.get(m)
      return {
        player1_id: p1,
        player2_id: p2,
        machine_id: m,
        expected_score: perf1 + perf2 + synergy,
        synergy_bonus: synergy,
        player1_venue_adjusted_avg: s1?.venue_adjusted_avg,
        player2_venue_adjusted_avg: s2?.venue_adjusted_avg,
        player1_user_average: ui1?.userAverage ?? null,
        player2_user_average: ui2?.userAverage ?? null,
        player1_user_confidence: ui1?.userConfidence ?? null,
        player2_user_confidence: ui2?.userConfidence ?? null,
        pair_win_rate: pairStats?.winRate,
        pair_games_played: pairStats?.gamesPlayed,
      }
    })

    const totalScore = assignments.reduce((s, a) => s + a.expected_score, 0)
    const avgScore = assignments.length > 0 ? totalScore / assignments.length : 0
    const winProbability = 1 / (1 + Math.exp(-10 * (avgScore / 2 - 0.5)))

    return {
      format: '4x2',
      assignments,
      total_score: totalScore,
      win_probability: winProbability,
      benched: best.bench,
      suggestions: [],
    }
  }
}
