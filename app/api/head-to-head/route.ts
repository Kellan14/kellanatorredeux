import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'
import { standardizeVenueName } from '@/lib/venue-mappings'
import { orEqAcrossColumnsMulti } from '@/lib/pg-filter'
import { getAllPlayerNames, getCanonicalPlayerName } from '@/lib/players'

const PLAYER_NAME_COLUMNS = ['player_1_name', 'player_2_name', 'player_3_name', 'player_4_name']

// Helper to check if a player name matches (considering sub variants)
function playerMatches(gameName: string | null, targetName: string): boolean {
  if (!gameName) return false
  const canonicalGame = getCanonicalPlayerName(gameName)
  const canonicalTarget = getCanonicalPlayerName(targetName)
  return canonicalGame === canonicalTarget || canonicalGame === targetName || gameName === targetName
}

export const dynamic = 'force-dynamic'

interface GameRecord {
  id: number
  match_key: string
  season: number
  week: number
  round_number: number
  machine: string
  venue: string
  player_1_name: string | null
  player_1_score: number | null
  player_1_points: number | null
  player_1_team: string | null
  player_2_name: string | null
  player_2_score: number | null
  player_2_points: number | null
  player_2_team: string | null
  player_3_name: string | null
  player_3_score: number | null
  player_3_points: number | null
  player_3_team: string | null
  player_4_name: string | null
  player_4_score: number | null
  player_4_points: number | null
  player_4_team: string | null
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const player1 = searchParams.get('player1')
    const player2 = searchParams.get('player2')
    const matchKey = searchParams.get('match') // Optional: get details for specific match
    const machineFilter = searchParams.get('machine') // Optional: get all scores for a specific machine

    // If no players specified, return list of all players
    // (served from the cache_players table — see lib/players.ts)
    if (!player1 && !player2) {
      const players = await getAllPlayerNames()
      return NextResponse.json(
        { players },
        {
          headers: {
            'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
          },
        }
      )
    }

    if (!player1 || !player2) {
      return NextResponse.json(
        { error: 'Both player1 and player2 parameters are required' },
        { status: 400 }
      )
    }

    // Fetch all games where either player participated (including sub variants)
    // IMPORTANT: Must use .order('id') for consistent pagination
    const player1Sub = `${player1} (sub)`
    const games = await fetchAllRecords<GameRecord>(() =>
      supabase
        .from('games')
        .select('*')
        .gte('season', 2)
        .or(orEqAcrossColumnsMulti(PLAYER_NAME_COLUMNS, [player1, player1Sub]))
        .order('id', { ascending: true })
    )

    // Filter to games where both players participated (using canonical name matching)
    const sharedGames = games.filter(game => {
      const gamePlayerNames = [game.player_1_name, game.player_2_name, game.player_3_name, game.player_4_name]
      const hasPlayer1 = gamePlayerNames.some(name => playerMatches(name, player1))
      const hasPlayer2 = gamePlayerNames.some(name => playerMatches(name, player2))
      return hasPlayer1 && hasPlayer2
    })

    // Group games by match_key
    const matchMap = new Map<string, GameRecord[]>()
    for (const game of sharedGames) {
      if (!matchMap.has(game.match_key)) {
        matchMap.set(game.match_key, [])
      }
      matchMap.get(game.match_key)!.push(game)
    }

    // Build match summaries
    const matches = Array.from(matchMap.entries()).map(([matchKey, games]) => {
      const firstGame = games[0]

      // Count head-to-head rounds (both players in same game row)
      let h2hRounds = 0
      let player1Wins = 0
      let player2Wins = 0
      let ties = 0

      for (const game of games) {
        const players = [
          { name: game.player_1_name, score: game.player_1_score, points: game.player_1_points },
          { name: game.player_2_name, score: game.player_2_score, points: game.player_2_points },
          { name: game.player_3_name, score: game.player_3_score, points: game.player_3_points },
          { name: game.player_4_name, score: game.player_4_score, points: game.player_4_points },
        ]

        const p1Data = players.find(p => playerMatches(p.name, player1))
        const p2Data = players.find(p => playerMatches(p.name, player2))

        if (p1Data && p2Data && p1Data.score != null && p2Data.score != null) {
          h2hRounds++
          if (p1Data.score > p2Data.score) player1Wins++
          else if (p2Data.score > p1Data.score) player2Wins++
          else ties++
        }
      }

      return {
        matchKey,
        season: firstGame.season,
        week: firstGame.week,
        venue: standardizeVenueName(firstGame.venue) || firstGame.venue,
        totalRounds: games.length,
        h2hRounds,
        player1Wins,
        player2Wins,
        ties
      }
    }).sort((a, b) => {
      if (a.season !== b.season) return b.season - a.season
      return b.week - a.week
    })

    // If machine filter requested, return all scores for both players on that machine
    if (machineFilter) {
      // Need to also fetch games where player2 appears (not just player1)
      const player2Sub = `${player2} (sub)`
      const player2Games = await fetchAllRecords<GameRecord>(() =>
        supabase
          .from('games')
          .select('*')
          .gte('season', 2)
          .or(orEqAcrossColumnsMulti(PLAYER_NAME_COLUMNS, [player2, player2Sub]))
          .order('id', { ascending: true })
      )

      // Combine games from both players (dedupe by id)
      const allGamesMap = new Map<number, GameRecord>()
      for (const game of games) {
        allGamesMap.set(game.id, game)
      }
      for (const game of player2Games) {
        allGamesMap.set(game.id, game)
      }
      const allGames = Array.from(allGamesMap.values())

      const player1Scores: Array<{
        score: number
        season: number
        week: number
        venue: string
        matchKey: string
        isH2H: boolean
        won: boolean | null
      }> = []

      const player2Scores: Array<{
        score: number
        season: number
        week: number
        venue: string
        matchKey: string
        isH2H: boolean
        won: boolean | null
      }> = []

      for (const game of allGames) {
        const machineName = game.machine
        if (machineName.toLowerCase() !== machineFilter.toLowerCase() &&
            game.machine.toLowerCase() !== machineFilter.toLowerCase()) {
          continue
        }

        const players = [
          { name: game.player_1_name, score: game.player_1_score },
          { name: game.player_2_name, score: game.player_2_score },
          { name: game.player_3_name, score: game.player_3_score },
          { name: game.player_4_name, score: game.player_4_score },
        ]

        const p1Data = players.find(p => playerMatches(p.name, player1))
        const p2Data = players.find(p => playerMatches(p.name, player2))
        const isH2H = !!(p1Data && p2Data && p1Data.score != null && p2Data.score != null)

        if (p1Data && p1Data.score != null) {
          let won: boolean | null = null
          if (isH2H) {
            won = p1Data.score > p2Data!.score!
          }
          player1Scores.push({
            score: p1Data.score,
            season: game.season,
            week: game.week,
            venue: standardizeVenueName(game.venue) || game.venue,
            matchKey: game.match_key,
            isH2H,
            won
          })
        }

        if (p2Data && p2Data.score != null) {
          let won: boolean | null = null
          if (isH2H) {
            won = p2Data.score > p1Data!.score!
          }
          player2Scores.push({
            score: p2Data.score,
            season: game.season,
            week: game.week,
            venue: standardizeVenueName(game.venue) || game.venue,
            matchKey: game.match_key,
            isH2H,
            won
          })
        }
      }

      // Sort by score descending
      player1Scores.sort((a, b) => b.score - a.score)
      player2Scores.sort((a, b) => b.score - a.score)

      return NextResponse.json({
        player1,
        player2,
        machine: machineFilter,
        player1Scores,
        player2Scores
      })
    }

    // If specific match requested, return detailed round-by-round data
    if (matchKey) {
      const matchGames = matchMap.get(matchKey) || []

      // Get ALL scores for both players in this match (not just H2H)
      const allMatchGames = games.filter(g => g.match_key === matchKey)

      const rounds: Array<{
        round: number
        machine: string
        isH2H: boolean
        player1Score: number | null
        player1Points: number | null
        player2Score: number | null
        player2Points: number | null
        winner: 'player1' | 'player2' | 'tie' | null
      }> = []

      // Get unique rounds in this match for both players
      const roundMap = new Map<number, {
        machine: string
        player1Score: number | null
        player1Points: number | null
        player2Score: number | null
        player2Points: number | null
        isH2H: boolean
      }>()

      for (const game of allMatchGames) {
        const players = [
          { name: game.player_1_name, score: game.player_1_score, points: game.player_1_points },
          { name: game.player_2_name, score: game.player_2_score, points: game.player_2_points },
          { name: game.player_3_name, score: game.player_3_score, points: game.player_3_points },
          { name: game.player_4_name, score: game.player_4_score, points: game.player_4_points },
        ]

        const p1Data = players.find(p => playerMatches(p.name, player1))
        const p2Data = players.find(p => playerMatches(p.name, player2))
        const bothInGame = p1Data && p2Data

        if (!roundMap.has(game.round_number)) {
          roundMap.set(game.round_number, {
            machine: game.machine,
            player1Score: null,
            player1Points: null,
            player2Score: null,
            player2Points: null,
            isH2H: false
          })
        }

        const roundData = roundMap.get(game.round_number)!

        if (p1Data) {
          roundData.player1Score = p1Data.score
          roundData.player1Points = p1Data.points
        }
        if (p2Data) {
          roundData.player2Score = p2Data.score
          roundData.player2Points = p2Data.points
        }
        if (bothInGame) {
          roundData.isH2H = true
        }
      }

      // Convert to array and sort by round
      for (const [roundNum, data] of Array.from(roundMap.entries())) {
        let winner: 'player1' | 'player2' | 'tie' | null = null
        if (data.isH2H && data.player1Score != null && data.player2Score != null) {
          if (data.player1Score > data.player2Score) winner = 'player1'
          else if (data.player2Score > data.player1Score) winner = 'player2'
          else winner = 'tie'
        }

        rounds.push({
          round: roundNum,
          machine: data.machine,
          isH2H: data.isH2H,
          player1Score: data.player1Score,
          player1Points: data.player1Points,
          player2Score: data.player2Score,
          player2Points: data.player2Points,
          winner
        })
      }

      rounds.sort((a, b) => a.round - b.round)

      return NextResponse.json({
        player1,
        player2,
        matchKey,
        rounds
      })
    }

    // Calculate overall stats
    let totalH2H = 0
    let totalPlayer1Wins = 0
    let totalPlayer2Wins = 0
    let totalTies = 0

    for (const match of matches) {
      totalH2H += match.h2hRounds
      totalPlayer1Wins += match.player1Wins
      totalPlayer2Wins += match.player2Wins
      totalTies += match.ties
    }

    // Get unique machines played by both players (intersection of all machines each has played)
    // First, get all machines player1 has played
    const player1Machines = new Set<string>()
    for (const game of games) {
      const gamePlayerNames = [game.player_1_name, game.player_2_name, game.player_3_name, game.player_4_name]
      if (gamePlayerNames.some(name => playerMatches(name, player1))) {
        player1Machines.add(game.machine)
      }
    }

    // Then, fetch all games for player2 to get their machines
    const player2Sub = `${player2} (sub)`
    const player2AllGames = await fetchAllRecords<GameRecord>(() =>
      supabase
        .from('games')
        .select('machine, player_1_name, player_2_name, player_3_name, player_4_name')
        .gte('season', 2)
        .or(orEqAcrossColumnsMulti(PLAYER_NAME_COLUMNS, [player2, player2Sub]))
        .order('id', { ascending: true })
    )

    const player2Machines = new Set<string>()
    for (const game of player2AllGames) {
      const gamePlayerNames = [game.player_1_name, game.player_2_name, game.player_3_name, game.player_4_name]
      if (gamePlayerNames.some(name => playerMatches(name, player2))) {
        player2Machines.add(game.machine)
      }
    }

    // Intersection: machines both players have played
    const machines = Array.from(player1Machines)
      .filter(m => player2Machines.has(m))
      .sort((a, b) => a.localeCompare(b))

    return NextResponse.json({
      player1,
      player2,
      matches,
      machines,
      summary: {
        totalMatches: matches.length,
        totalH2HRounds: totalH2H,
        player1Wins: totalPlayer1Wins,
        player2Wins: totalPlayer2Wins,
        ties: totalTies
      }
    })
  } catch (error) {
    console.error('Error in head-to-head API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch head-to-head data' },
      { status: 500 }
    )
  }
}
