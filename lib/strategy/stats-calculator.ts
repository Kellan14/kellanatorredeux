import { supabase, fetchAllRecords } from '@/lib/supabase'
import type { PlayerMachineStats, ScoreBreakdown, ScoreEntry } from '@/types/strategy'
import { getVenueVariations } from '@/lib/venue-mappings'
import { getMachineVariations, machineMappings } from '@/lib/machine-mappings'
import { getScoreLimits, isScoreValid } from '@/lib/score-limits'

// Helper to standardize machine name using mappings
function standardizeMachineName(machineName: string): string {
  const lowerName = machineName.toLowerCase()
  if (machineMappings[lowerName]) {
    return machineMappings[lowerName]
  }
  return machineName
}

/**
 * Calculate player-machine stats from games table
 * This computes everything on-the-fly from historical game data
 *
 * NOTE: The games table structure is:
 * - Each row is ONE player's performance in ONE game
 * - Columns: player_name, score, machine, season, match, round, points
 */
export interface UserInputData {
  userAverage: number | null
  userConfidence: number | null
}

export async function calculatePlayerMachineStats(
  playerNames: string[],
  machines: string[],
  seasonStart: number = 20,
  seasonEnd: number = 22,
  venue?: string,
  userInputs?: Map<string, Map<string, UserInputData>>,
  userInputWeight: number = 0
): Promise<Map<string, Map<string, PlayerMachineStats>>> {
  // Build a lookup: any machine name variation → original input machine name
  // This ensures DB values like "DP" map back to the input key "DP" even when
  // standardizeMachineName converts "DP" to "Deadpool " (a display name)
  const allMachineVariations: string[] = []
  const variationToInput = new Map<string, string>()
  for (const machine of machines) {
    variationToInput.set(machine.toLowerCase().trim(), machine)
    const standardized = standardizeMachineName(machine)
    variationToInput.set(standardized.toLowerCase().trim(), machine)
    const variations = getMachineVariations(machine)
    for (const v of variations) {
      if (!allMachineVariations.includes(v)) {
        allMachineVariations.push(v)
      }
      variationToInput.set(v.toLowerCase().trim(), machine)
      const stdV = standardizeMachineName(v)
      variationToInput.set(stdV.toLowerCase().trim(), machine)
    }
  }

  // Optionally get venue variations
  const venueVariations = venue ? getVenueVariations(venue) : null

  // Fetch score limits for filtering impossible scores
  const scoreLimits = await getScoreLimits()

  // Fetch all relevant games with proper pagination (MUST use .order('id') for consistent results)
  const gamesData = await fetchAllRecords<any>(() => {
    let query = supabase
      .from('games')
      .select('*')
      .gte('season', seasonStart)
      .lte('season', seasonEnd)
      .in('machine', allMachineVariations)
      .order('id', { ascending: true })

    if (venueVariations) {
      query = query.in('venue', venueVariations)
    }

    return query
  })

  // Fetch user-entered manual scores from user_machine_scores
  // These contribute to the player's average on that machine
  // We fetch all scores for the players and filter by machine in code
  // since machine names may not match exactly (e.g., "007" vs "James Bond 007")
  const userScoresData = await fetchAllRecords<any>(() => {
    let query = supabase
      .from('user_machine_scores')
      .select('*')
      .in('player_name', playerNames)
      .eq('include_in_calculations', true)
      .order('id', { ascending: true })

    // Filter by venue if specified
    if (venueVariations) {
      query = query.in('venue', venueVariations)
    }

    return query
  })

  // Filter user scores by machine in code (more lenient matching)
  const filteredUserScores = (userScoresData || []).filter((score: any) => {
    const scoreMachine = (score.machine || '').toLowerCase().trim()
    // Check if this score's machine matches any of our target machines
    return variationToInput.has(scoreMachine) ||
           machines.some(m => m.toLowerCase().trim() === scoreMachine) ||
           allMachineVariations.some(v => v.toLowerCase() === scoreMachine)
  })

  // Build stats map: playerName -> machineName -> stats
  const statsMap = new Map<string, Map<string, PlayerMachineStats>>()

  // Track venue totals per machine for computing venue averages
  // key: "inputMachine|venue" -> { total, count }
  const venueScoresByMachine = new Map<string, { total: number; count: number }>()

  // First pass: accumulate all scores per machine+venue for venue averages
  for (const game of gamesData) {
    const rawMachine = game.machine || ''
    const inputMachine = variationToInput.get(rawMachine.toLowerCase().trim())
    if (!inputMachine) continue

    const gameVenue = game.venue || 'unknown'
    const vKey = `${inputMachine}|${gameVenue}`
    if (!venueScoresByMachine.has(vKey)) {
      venueScoresByMachine.set(vKey, { total: 0, count: 0 })
    }

    for (let i = 1; i <= 4; i++) {
      const score = game[`player_${i}_score`]
      if (score != null && score > 0 && isScoreValid(inputMachine, score, scoreLimits)) {
        const entry = venueScoresByMachine.get(vKey)!
        entry.total += score
        entry.count++
      }
    }
  }

  // Track games for each player-machine combination
  const gamesByPlayerMachine = new Map<string, Array<{
    score: number
    opponentScore: number
    won: boolean
    date: string
    venue: string
    isUserScore?: boolean
  }>>()

  // Track user-entered scores separately (they don't have opponent data)
  // These will be merged into average calculations but not win rate
  const userScoresByPlayerMachine = new Map<string, Array<{
    score: number
    date: string
    venue: string
  }>>()

  // Process user-entered scores first
  for (const userScore of filteredUserScores) {
    const rawMachine = userScore.machine || ''
    const rawMachineLower = rawMachine.toLowerCase().trim()

    // Try to find the input machine name - check multiple ways
    let inputMachine = variationToInput.get(rawMachineLower)

    // If not found, try standardizing the machine name
    if (!inputMachine) {
      const standardized = standardizeMachineName(rawMachine)
      inputMachine = variationToInput.get(standardized.toLowerCase().trim())
    }

    // If still not found, check if the user score's machine name maps to one of our target machines
    // e.g., "James Bond 007 (Thunderball/Dr No)" -> "007"
    if (!inputMachine) {
      const mappedValue = machineMappings[rawMachineLower] || machineMappings[rawMachine]
      if (mappedValue) {
        const mappedLower = mappedValue.toLowerCase().trim()
        inputMachine = variationToInput.get(mappedLower)
        if (!inputMachine) {
          // Also check if the mapped value is in our machines list
          inputMachine = machines.find(m => m.toLowerCase().trim() === mappedLower)
        }
      }
    }

    // If still not found, try to match against the machines list directly
    if (!inputMachine) {
      for (const m of machines) {
        const mVariations = getMachineVariations(m)
        if (mVariations.some(v => v.toLowerCase() === rawMachineLower)) {
          inputMachine = m
          break
        }
      }
    }

    if (!inputMachine) continue

    // Filter out scores that exceed machine score limits
    if (userScore.score != null && !isScoreValid(inputMachine, userScore.score, scoreLimits)) continue

    const playerName = userScore.player_name
    if (!playerName || !playerNames.includes(playerName)) continue

    const key = `${playerName}|${inputMachine}`
    if (!userScoresByPlayerMachine.has(key)) {
      userScoresByPlayerMachine.set(key, [])
    }

    userScoresByPlayerMachine.get(key)!.push({
      score: userScore.score,
      date: userScore.played_at || new Date().toISOString(),
      venue: userScore.venue || 'unknown'
    })

    // Also add to venue averages
    const gameVenue = userScore.venue || 'unknown'
    const vKey = `${inputMachine}|${gameVenue}`
    if (!venueScoresByMachine.has(vKey)) {
      venueScoresByMachine.set(vKey, { total: 0, count: 0 })
    }
    const entry = venueScoresByMachine.get(vKey)!
    entry.total += userScore.score
    entry.count++
  }

  // Process each game record (wide format: 4 players per row)
  for (const game of gamesData) {
    // Map DB machine name back to the original input machine name
    const rawMachine = game.machine || ''
    const inputMachine = variationToInput.get(rawMachine.toLowerCase().trim())
    if (!inputMachine) continue

    // Loop through all 4 player positions in each game row
    for (let i = 1; i <= 4; i++) {
      const playerName = game[`player_${i}_name`]
      const playerScore = game[`player_${i}_score`]
      const playerPoints = game[`player_${i}_points`]

      // Skip if player doesn't exist, not in our target list, or score exceeds limit
      if (!playerName || !playerNames.includes(playerName) || playerScore == null) continue
      if (!isScoreValid(inputMachine, playerScore, scoreLimits)) continue

      // Get opponent scores (all other players in this same game row)
      const opponentScores: number[] = []
      for (let j = 1; j <= 4; j++) {
        if (j !== i) {
          const oppScore = game[`player_${j}_score`]
          if (oppScore != null && isScoreValid(inputMachine, oppScore, scoreLimits)) {
            opponentScores.push(oppScore)
          }
        }
      }

      const opponentScore = opponentScores.length > 0
        ? Math.max(...opponentScores)
        : 0

      // Determine if player won based on points (more reliable than score comparison)
      // In IFPA scoring: 3pts = win, 1.5pts = tie, 0pts = loss
      const won = playerPoints >= 1.5

      const key = `${playerName}|${inputMachine}`
      if (!gamesByPlayerMachine.has(key)) {
        gamesByPlayerMachine.set(key, [])
      }

      gamesByPlayerMachine.get(key)!.push({
        score: playerScore,
        opponentScore,
        won,
        date: game.created_at || new Date().toISOString(),
        venue: game.venue || 'unknown'
      })
    }
  }

  // Convert to stats
  for (const [key, games] of Array.from(gamesByPlayerMachine.entries())) {
    const [playerName, machine] = key.split('|')

    if (!statsMap.has(playerName)) {
      statsMap.set(playerName, new Map())
    }

    // Get user-entered scores for this player+machine
    const userScores = userScoresByPlayerMachine.get(key) || []

    // Calculate stats (win rate only from league games, not user scores)
    const gamesPlayed = games.length
    const wins = games.filter((g: { won: boolean }) => g.won).length
    const losses = gamesPlayed - wins
    const winRate = gamesPlayed > 0 ? wins / gamesPlayed : 0

    // Calculate LEAGUE-ONLY average (without user data)
    const leagueScoreValues = games.map(g => g.score)
    const leagueAvgScore = leagueScoreValues.length > 0
      ? leagueScoreValues.reduce((sum, score) => sum + score, 0) / leagueScoreValues.length
      : 0

    // High score includes both league and user scores
    const allScoresForHigh = [
      ...leagueScoreValues,
      ...userScores.map(s => s.score)
    ]
    const highScore = allScoresForHigh.length > 0 ? Math.max(...allScoresForHigh) : 0

    // Build score breakdown for league scores
    const leagueScoreEntries: ScoreEntry[] = []

    // Calculate LEAGUE-ONLY venue-adjusted average
    let leagueVenueAdjustedAvg = 1.0
    const leagueRatios: number[] = []
    for (const g of games) {
      const vKey = `${machine}|${g.venue}`
      const venueEntry = venueScoresByMachine.get(vKey)
      if (venueEntry && venueEntry.count > 0) {
        const venueAvg = venueEntry.total / venueEntry.count
        if (venueAvg > 0) {
          const ratio = g.score / venueAvg
          leagueRatios.push(ratio)
          leagueScoreEntries.push({
            score: g.score,
            venue: g.venue,
            venueAvg,
            ratio,
            date: g.date,
            won: g.won,
            weight: 1,
            source: 'league'
          })
        }
      }
    }
    if (leagueRatios.length > 0) {
      leagueVenueAdjustedAvg = leagueRatios.reduce((sum, r) => sum + r, 0) / leagueRatios.length
    }

    // Read user confidence (independent of userInputWeight)
    let userConfidenceValue: number | undefined
    const userData = userInputs?.get(playerName)?.get(machine)
    if (userData?.userConfidence) {
      userConfidenceValue = userData.userConfidence
    }

    // Calculate USER DATA average (user_machine_scores + user_machine_inputs)
    // user_machine_inputs.userAverage counts as 3x weight (like having 3 scores)
    // user_machine_scores individual scores count as 1x weight each
    let userVenueAdjustedAvg: number | null = null
    const userRatios: number[] = []
    const userRatioWeights: number[] = []

    // Build score breakdown for user scores
    const userScoreEntries: ScoreEntry[] = []
    let userInputEntry: ScoreEntry | null = null

    // Get overall venue average for this machine (for converting scores to ratios)
    let overallVenueAvg = 0
    let totalAll = 0
    let countAll = 0
    for (const [vk, entry] of Array.from(venueScoresByMachine.entries())) {
      if (vk.startsWith(`${machine}|`)) {
        totalAll += entry.total
        countAll += entry.count
      }
    }
    if (countAll > 0) {
      overallVenueAvg = totalAll / countAll
    }

    // Add user_machine_scores (individual scores, 1x weight each)
    for (const s of userScores) {
      const vKey = `${machine}|${s.venue}`
      const venueEntry = venueScoresByMachine.get(vKey)
      const venueAvg = (venueEntry && venueEntry.count > 0) ? venueEntry.total / venueEntry.count : overallVenueAvg
      if (venueAvg > 0) {
        const ratio = s.score / venueAvg
        userRatios.push(ratio)
        userRatioWeights.push(1) // Individual score = 1x weight
        userScoreEntries.push({
          score: s.score,
          venue: s.venue,
          venueAvg,
          ratio,
          date: s.date,
          weight: 1,
          source: 'user_score'
        })
      }
    }

    // Add user_machine_inputs.userAverage (3x weight, like having 3 scores)
    if (userData?.userAverage && userData.userAverage > 0 && overallVenueAvg > 0) {
      const ratio = userData.userAverage / overallVenueAvg
      userRatios.push(ratio)
      userRatioWeights.push(3) // Self-reported average = 3x weight
      userInputEntry = {
        score: userData.userAverage,
        venue: 'self-reported',
        venueAvg: overallVenueAvg,
        ratio,
        weight: 3,
        source: 'user_input'
      }
    }

    // Calculate weighted average of user ratios
    if (userRatios.length > 0) {
      const totalWeight = userRatioWeights.reduce((sum, w) => sum + w, 0)
      const weightedSum = userRatios.reduce((sum, r, i) => sum + r * userRatioWeights[i], 0)
      userVenueAdjustedAvg = weightedSum / totalWeight
    }

    // Blend league and user data based on userInputWeight
    // At 0%: use league data only
    // At 100%: use user data only (if available), otherwise fall back to league
    let venueAdjustedAvg = leagueVenueAdjustedAvg
    let avgScore = leagueAvgScore

    if (userInputWeight > 0 && userVenueAdjustedAvg !== null) {
      venueAdjustedAvg = leagueVenueAdjustedAvg * (1 - userInputWeight) + userVenueAdjustedAvg * userInputWeight

      // Also blend the raw average score
      const userScoresList = userScores.map(s => s.score)
      if (userData?.userAverage) {
        // Add userAverage 3 times to simulate 3x weight
        userScoresList.push(userData.userAverage, userData.userAverage, userData.userAverage)
      }
      if (userScoresList.length > 0) {
        const userAvgScore = userScoresList.reduce((sum, s) => sum + s, 0) / userScoresList.length
        avgScore = leagueAvgScore * (1 - userInputWeight) + userAvgScore * userInputWeight
      }
    } else if (leagueScoreValues.length === 0 && userVenueAdjustedAvg !== null) {
      // No league data, use user data regardless of weight
      venueAdjustedAvg = userVenueAdjustedAvg
      const userScoresList = userScores.map(s => s.score)
      if (userData?.userAverage) {
        userScoresList.push(userData.userAverage, userData.userAverage, userData.userAverage)
      }
      if (userScoresList.length > 0) {
        avgScore = userScoresList.reduce((sum, s) => sum + s, 0) / userScoresList.length
      }
    }

    // Calculate recent form (last 5 games)
    const recentGames = games
      .sort((a: { date: string }, b: { date: string }) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5)
    const recentForm = recentGames.length > 0
      ? recentGames.filter((g: { won: boolean }) => g.won).length / recentGames.length
      : winRate

    // Calculate streak
    const sortedGames = [...games].sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    )
    let streakType: 'win' | 'loss' | null = null
    let streakCount = 0

    if (sortedGames.length > 0) {
      streakType = sortedGames[0].won ? 'win' : 'loss'
      streakCount = 1

      for (let i = 1; i < sortedGames.length; i++) {
        if (sortedGames[i].won === (streakType === 'win')) {
          streakCount++
        } else {
          break
        }
      }
    }

    // Confidence score based on games played
    const confidenceScore = Math.min(gamesPlayed, 10)

    // Find last played date
    const lastPlayed = sortedGames.length > 0 ? sortedGames[0].date : undefined

    // Build score breakdown
    const scoreBreakdown: ScoreBreakdown = {
      leagueScores: leagueScoreEntries,
      userScores: userScoreEntries,
      userInputAverage: userInputEntry,
      overallVenueAvg,
      leagueVenueAdjustedAvg,
      userVenueAdjustedAvg,
      finalVenueAdjustedAvg: venueAdjustedAvg,
      userInputWeightApplied: userInputWeight
    }

    const stats: PlayerMachineStats = {
      id: `${playerName}-${machine}`,
      player_id: playerName,
      machine_id: machine,
      games_played: gamesPlayed,
      wins,
      losses,
      win_rate: winRate,
      avg_score: avgScore,
      venue_adjusted_avg: venueAdjustedAvg,
      high_score: highScore,
      recent_form: recentForm,
      streak_type: streakType,
      streak_count: streakCount,
      confidence_score: confidenceScore,
      user_confidence: userConfidenceValue,
      last_played: lastPlayed,
      scoreBreakdown
    }

    statsMap.get(playerName)!.set(machine, stats)
  }

  // Create stats entries for player+machine combos that have user scores but no league games
  for (const [key, userScores] of Array.from(userScoresByPlayerMachine.entries())) {
    const [playerName, machine] = key.split('|')

    // Skip if stats already exist (from league games)
    if (statsMap.get(playerName)?.has(machine)) continue

    if (!statsMap.has(playerName)) {
      statsMap.set(playerName, new Map())
    }

    // Get user input data
    const userData = userInputs?.get(playerName)?.get(machine)
    let userConfidenceValue: number | undefined
    if (userData?.userConfidence) {
      userConfidenceValue = userData.userConfidence
    }

    // Get overall venue average for this machine
    let overallVenueAvg = 0
    let totalAll = 0
    let countAll = 0
    for (const [vk, entry] of Array.from(venueScoresByMachine.entries())) {
      if (vk.startsWith(`${machine}|`)) {
        totalAll += entry.total
        countAll += entry.count
      }
    }
    if (countAll > 0) {
      overallVenueAvg = totalAll / countAll
    }

    // Calculate weighted average from user data
    // user_machine_scores = 1x weight each
    // user_machine_inputs.userAverage = 3x weight
    const userRatios: number[] = []
    const userRatioWeights: number[] = []
    const scoresList: number[] = []

    // Build score breakdown for user scores
    const userScoreEntries: ScoreEntry[] = []
    let userInputEntry: ScoreEntry | null = null

    // Add user_machine_scores
    for (const s of userScores) {
      scoresList.push(s.score)
      const vKey = `${machine}|${s.venue}`
      const venueEntry = venueScoresByMachine.get(vKey)
      const venueAvg = (venueEntry && venueEntry.count > 0) ? venueEntry.total / venueEntry.count : overallVenueAvg
      if (venueAvg > 0) {
        const ratio = s.score / venueAvg
        userRatios.push(ratio)
        userRatioWeights.push(1)
        userScoreEntries.push({
          score: s.score,
          venue: s.venue,
          venueAvg,
          ratio,
          date: s.date,
          weight: 1,
          source: 'user_score'
        })
      }
    }

    // Add user_machine_inputs.userAverage with 3x weight
    if (userData?.userAverage && userData.userAverage > 0) {
      scoresList.push(userData.userAverage, userData.userAverage, userData.userAverage) // 3x
      if (overallVenueAvg > 0) {
        const ratio = userData.userAverage / overallVenueAvg
        userRatios.push(ratio)
        userRatioWeights.push(3)
        userInputEntry = {
          score: userData.userAverage,
          venue: 'self-reported',
          venueAvg: overallVenueAvg,
          ratio,
          weight: 3,
          source: 'user_input'
        }
      }
    }

    // Calculate weighted venue-adjusted average
    let venueAdjustedAvg = 1.0
    if (userRatios.length > 0) {
      const totalWeight = userRatioWeights.reduce((sum, w) => sum + w, 0)
      const weightedSum = userRatios.reduce((sum, r, i) => sum + r * userRatioWeights[i], 0)
      venueAdjustedAvg = weightedSum / totalWeight
    }

    // Calculate average score
    const avgScore = scoresList.length > 0
      ? scoresList.reduce((sum, s) => sum + s, 0) / scoresList.length
      : 0
    const highScore = userScores.length > 0 ? Math.max(...userScores.map(s => s.score)) : 0

    const sortedScores = [...userScores].sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    )

    // Build score breakdown
    const scoreBreakdown: ScoreBreakdown = {
      leagueScores: [],
      userScores: userScoreEntries,
      userInputAverage: userInputEntry,
      overallVenueAvg,
      leagueVenueAdjustedAvg: 1.0,
      userVenueAdjustedAvg: venueAdjustedAvg,
      finalVenueAdjustedAvg: venueAdjustedAvg,
      userInputWeightApplied: userInputWeight
    }

    statsMap.get(playerName)!.set(machine, {
      id: `${playerName}-${machine}`,
      player_id: playerName,
      machine_id: machine,
      games_played: 0, // No league games
      wins: 0,
      losses: 0,
      win_rate: 0,
      avg_score: avgScore,
      venue_adjusted_avg: venueAdjustedAvg,
      high_score: highScore,
      recent_form: 0,
      streak_type: null,
      streak_count: 0,
      confidence_score: Math.min(userScores.length, 5), // Some confidence from manual scores
      user_confidence: userConfidenceValue,
      last_played: sortedScores.length > 0 ? sortedScores[0].date : undefined,
      scoreBreakdown
    })
  }

  // Create stats entries for player+machine combos that have user inputs but no games
  if (userInputs) {
    for (const playerName of playerNames) {
      for (const machineName of machines) {
        // Skip if stats already exist
        if (statsMap.get(playerName)?.has(machineName)) continue

        const userData = userInputs.get(playerName)?.get(machineName)
        if (!userData) continue

        // Only create if there's at least confidence or average data
        if (!userData.userConfidence && !userData.userAverage) continue

        if (!statsMap.has(playerName)) {
          statsMap.set(playerName, new Map())
        }

        statsMap.get(playerName)!.set(machineName, {
          id: `${playerName}-${machineName}`,
          player_id: playerName,
          machine_id: machineName,
          games_played: 0,
          wins: 0,
          losses: 0,
          win_rate: 0,
          avg_score: 0,
          venue_adjusted_avg: 1.0,
          high_score: 0,
          recent_form: 0,
          streak_type: null,
          streak_count: 0,
          confidence_score: 1,
          user_confidence: userData.userConfidence ?? undefined,
          last_played: undefined
        })
      }
    }
  }

  return statsMap
}

/**
 * Calculate pair statistics for doubles format
 * Finds games where two players played together on the same machine
 */
export async function calculatePairStats(
  playerNames: string[],
  machines: string[],
  seasonStart: number = 20,
  seasonEnd: number = 22
): Promise<Map<string, { winRate: number; gamesPlayed: number }>> {
  // Build variation lookup (same approach as calculatePlayerMachineStats)
  const allMachineVariations: string[] = []
  const variationToInput = new Map<string, string>()
  for (const machine of machines) {
    variationToInput.set(machine.toLowerCase().trim(), machine)
    const standardized = standardizeMachineName(machine)
    variationToInput.set(standardized.toLowerCase().trim(), machine)
    const variations = getMachineVariations(machine)
    for (const v of variations) {
      if (!allMachineVariations.includes(v)) {
        allMachineVariations.push(v)
      }
      variationToInput.set(v.toLowerCase().trim(), machine)
      const stdV = standardizeMachineName(v)
      variationToInput.set(stdV.toLowerCase().trim(), machine)
    }
  }

  // Fetch all relevant games with proper pagination (MUST use .order('id') for consistent results)
  const gamesData = await fetchAllRecords<any>(
    () => supabase
      .from('games')
      .select('*')
      .gte('season', seasonStart)
      .lte('season', seasonEnd)
      .in('machine', allMachineVariations)
      .order('id', { ascending: true })
  )

  // Track pair stats
  const pairStats = new Map<string, { wins: number; total: number }>()

  // Process each game record (wide format: 4 players per row)
  for (const game of gamesData) {
    // Map DB machine name back to the original input machine name
    const rawMachine = game.machine || ''
    const machine = variationToInput.get(rawMachine.toLowerCase().trim())
    if (!machine) continue

    // Extract all players in this game row
    const playersInGame: Array<{ name: string; points: number }> = []
    for (let i = 1; i <= 4; i++) {
      const playerName = game[`player_${i}_name`]
      const playerPoints = game[`player_${i}_points`]

      if (playerName && playerNames.includes(playerName) && playerPoints != null) {
        playersInGame.push({ name: playerName, points: playerPoints })
      }
    }

    // If we have at least 2 players from our list in this game, check all pairs
    if (playersInGame.length >= 2) {
      for (let i = 0; i < playersInGame.length; i++) {
        for (let j = i + 1; j < playersInGame.length; j++) {
          const p1 = playersInGame[i]
          const p2 = playersInGame[j]

          // Create pair key (sorted alphabetically for consistency)
          const sortedNames = [p1.name, p2.name].sort()
          const pairKey = `${sortedNames[0]}|${sortedNames[1]}|${machine}`

          if (!pairStats.has(pairKey)) {
            pairStats.set(pairKey, { wins: 0, total: 0 })
          }

          const stats = pairStats.get(pairKey)!

          // Both players won if both got >= 1.5 points (win or tie)
          const bothWon = p1.points >= 1.5 && p2.points >= 1.5

          if (bothWon) {
            stats.wins++
          }
          stats.total++
        }
      }
    }
  }

  // Convert to win rates
  const pairStatsMap = new Map<string, { winRate: number; gamesPlayed: number }>()
  for (const [key, stats] of Array.from(pairStats.entries())) {
    pairStatsMap.set(key, {
      winRate: stats.total > 0 ? stats.wins / stats.total : 0,
      gamesPlayed: stats.total
    })
  }

  return pairStatsMap
}
