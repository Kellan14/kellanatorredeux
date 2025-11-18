import { supabase, fetchAllRecords } from '@/lib/supabase'
import type { PlayerMachineStats } from '@/types/strategy'

/**
 * Calculate player-machine stats from games table
 * This computes everything on-the-fly from historical game data
 *
 * NOTE: The games table structure is:
 * - Each row is ONE player's performance in ONE game
 * - Columns: player_name, score, machine, season, match, round, points
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

  // Group games by match+round to find opponents
  const gamesByMatchRound = new Map<string, Array<any>>()
  for (const game of gamesData) {
    const matchRoundKey = `${game.match}|${game.round}|${game.machine}`
    if (!gamesByMatchRound.has(matchRoundKey)) {
      gamesByMatchRound.set(matchRoundKey, [])
    }
    gamesByMatchRound.get(matchRoundKey)!.push(game)
  }

  // Process each game record (one row per player)
  for (const game of gamesData) {
    const playerName = game.player_name
    const playerScore = game.score

    if (!playerName || !playerNames.includes(playerName) || !playerScore) continue
    if (!machines.includes(game.machine)) continue

    // Find opponents in the same match+round+machine
    const matchRoundKey = `${game.match}|${game.round}|${game.machine}`
    const matchGames = gamesByMatchRound.get(matchRoundKey) || []

    // Get opponent scores (all other players in this match+round on same machine)
    const opponentScores = matchGames
      .filter((g: any) => g.player_name !== playerName)
      .map((g: any) => g.score)
      .filter((score: number) => score != null)

    const opponentScore = opponentScores.length > 0
      ? Math.max(...opponentScores)
      : 0

    // Determine if player won based on points (more reliable than score comparison)
    // In IFPA scoring: 3pts = win, 1.5pts = tie, 0pts = loss
    const won = game.points >= 1.5

    const key = `${playerName}|${game.machine}`
    if (!gamesByPlayerMachine.has(key)) {
      gamesByPlayerMachine.set(key, [])
    }

    gamesByPlayerMachine.get(key)!.push({
      score: playerScore,
      opponentScore,
      won,
      date: game.created_at || new Date().toISOString()
    })
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
    const confidenceScore = Math.min(gamesPlayed, 10)

    // Find last played date
    const lastPlayed = sortedGames.length > 0 ? sortedGames[0].date : undefined

    const stats: PlayerMachineStats = {
      id: `${playerName}-${machine}`,
      player_id: playerName,
      machine_id: machine,
      games_played: gamesPlayed,
      wins,
      losses,
      win_rate: winRate,
      avg_score: avgScore,
      high_score: highScore,
      recent_form: recentForm,
      streak_type: streakType,
      streak_count: streakCount,
      confidence_score: confidenceScore,
      last_played: lastPlayed
    }

    statsMap.get(playerName)!.set(machine, stats)
  }

  return statsMap
}
