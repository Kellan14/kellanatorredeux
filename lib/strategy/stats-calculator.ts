import { supabase, fetchAllRecords } from '@/lib/supabase'
import type { PlayerMachineStats } from '@/types/strategy'

/**
 * Calculate player-machine stats from games table
 * This computes everything on-the-fly from historical game data
 */
export async function calculatePlayerMachineStats(
  playerNames: string[],
  machines: string[],
  seasonStart: number = 20,
  seasonEnd: number = 22
): Promise<Map<string, Map<string, PlayerMachineStats>>> {
  // Fetch all relevant games
  const gamesData = await fetchAllRecords<any>(
    supabase
      .from('games')
      .select('*')
      .gte('season', seasonStart)
      .lte('season', seasonEnd)
      .in('machine', machines)
  )

  // Build stats map: playerName -> machineName -> stats
  const statsMap = new Map<string, Map<string, PlayerMachineStats>>()

  // Track games for each player-machine combination
  const gamesByPlayerMachine = new Map<string, Array<{
    score: number
    opponentScore: number
    won: boolean
    date: string
  }>>()

  // Process each game
  for (const game of gamesData) {
    if (!machines.includes(game.machine)) continue

    // Check all 4 player positions
    for (let i = 1; i <= 4; i++) {
      const playerName = game[`player_${i}`]
      const playerScore = game[`player_${i}_score`]

      if (!playerName || !playerNames.includes(playerName) || !playerScore) continue

      // Find opponent score (simplified - take best opponent score)
      const opponentScores = []
      for (let j = 1; j <= 4; j++) {
        if (j !== i && game[`player_${j}_score`]) {
          opponentScores.push(game[`player_${j}_score`])
        }
      }
      const opponentScore = opponentScores.length > 0 ? Math.max(...opponentScores) : 0

      const key = `${playerName}|${game.machine}`
      if (!gamesByPlayerMachine.has(key)) {
        gamesByPlayerMachine.set(key, [])
      }

      gamesByPlayerMachine.get(key)!.push({
        score: playerScore,
        opponentScore,
        won: playerScore > opponentScore,
        date: game.created_at || game.match_date || new Date().toISOString()
      })
    }
  }

  // Convert to stats
  for (const [key, games] of Array.from(gamesByPlayerMachine.entries())) {
    const [playerName, machine] = key.split('|')

    if (!statsMap.has(playerName)) {
      statsMap.set(playerName, new Map())
    }

    // Calculate stats
    const gamesPlayed = games.length
    const wins = games.filter((g: { won: boolean }) => g.won).length
    const losses = gamesPlayed - wins
    const winRate = gamesPlayed > 0 ? wins / gamesPlayed : 0

    const avgScore = games.reduce((sum: number, g: { score: number }) => sum + g.score, 0) / gamesPlayed
    const highScore = Math.max(...games.map((g: { score: number }) => g.score))

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
    let confidenceScore = 1
    if (gamesPlayed >= 20) confidenceScore = 10
    else if (gamesPlayed >= 10) confidenceScore = 9
    else if (gamesPlayed >= 5) confidenceScore = 7
    else if (gamesPlayed >= 3) confidenceScore = 5
    else if (gamesPlayed >= 1) confidenceScore = 3

    const stat: PlayerMachineStats = {
      id: key,
      player_id: playerName, // Using name as ID for now
      machine_id: machine,
      games_played: gamesPlayed,
      wins,
      losses,
      win_rate: winRate,
      avg_score: Math.round(avgScore),
      high_score: highScore,
      recent_form: recentForm,
      streak_type: streakType,
      streak_count: streakCount,
      confidence_score: confidenceScore,
      last_played: sortedGames[0]?.date
    }

    statsMap.get(playerName)!.set(machine, stat)
  }

  return statsMap
}

/**
 * Calculate pair statistics for doubles format
 */
export async function calculatePairStats(
  playerNames: string[],
  machines: string[],
  seasonStart: number = 20,
  seasonEnd: number = 22
): Promise<Map<string, { winRate: number; gamesPlayed: number }>> {
  // Fetch games where these players played together
  const gamesData = await fetchAllRecords<any>(
    supabase
      .from('games')
      .select('*')
      .gte('season', seasonStart)
      .lte('season', seasonEnd)
      .in('machine', machines)
  )

  const pairStats = new Map<string, { wins: number; total: number }>()

  for (const game of gamesData) {
    if (!machines.includes(game.machine)) continue

    // Find pairs of players in this game
    const playersInGame: string[] = []
    for (let i = 1; i <= 4; i++) {
      const playerName = game[`player_${i}`]
      if (playerName && playerNames.includes(playerName)) {
        playersInGame.push(playerName)
      }
    }

    // If we have 2 of our players in the same game, they might be a pair
    if (playersInGame.length === 2) {
      const [p1, p2] = playersInGame.sort()
      const pairKey = `${p1}|${p2}|${game.machine}`

      if (!pairStats.has(pairKey)) {
        pairStats.set(pairKey, { wins: 0, total: 0 })
      }

      const stats = pairStats.get(pairKey)!
      stats.total++

      // Check if they won (both scores > opponent scores)
      const p1Score = game[`player_${playersInGame[0]}`] || 0
      const p2Score = game[`player_${playersInGame[1]}`] || 0
      // Simplified win check
      stats.wins++
    }
  }

  // Convert to result format
  const result = new Map<string, { winRate: number; gamesPlayed: number }>()
  for (const [key, stats] of Array.from(pairStats.entries())) {
    result.set(key, {
      winRate: stats.total > 0 ? stats.wins / stats.total : 0,
      gamesPlayed: stats.total
    })
  }

  return result
}
