import type { Database } from './supabase'

type StoredGame = Database['public']['Tables']['games']['Row']

export type MatchTeam = { key: string; name: string }
export type MatchSummary = {
  key: string; season: number; week: number; venue: string | null
  date: string | null; home: string | null; away: string | null
}
type PointTotals = { home: number | null; away: number | null }
export type MatchGame = {
  number: number; machine: string; points: PointTotals
  players: { slot: number; name: string; team: string | null; score: number | null; points: number | null; picked: boolean }[]
}
export type MatchRound = {
  number: number; type: 'Doubles' | 'Singles' | null; points: PointTotals; games: MatchGame[]
}
export type MatchDetail = MatchSummary & { points: PointTotals; rounds: MatchRound[] }

function addPoints(rows: PointTotals[]): PointTotals {
  const sum = (side: keyof PointTotals) => rows.some(row => row[side] !== null)
    ? rows.reduce((total, row) => total + (row[side] ?? 0), 0)
    : null
  return { home: sum('home'), away: sum('away') }
}

// Show the recorded team points, not a score-based reconstruction. A
// doubles game's team total can include a point for the combined score.
export function formatMatchDetail(summary: MatchSummary, rows: StoredGame[]): MatchDetail {
  const byRound = new Map<number, MatchGame[]>()
  for (const row of rows) {
    const players: MatchGame['players'] = []
    for (const slot of [1, 2, 3, 4] as const) {
      const name = row[`player_${slot}_name`]
      const score = row[`player_${slot}_score`]
      const points = row[`player_${slot}_points`]
      if (!name && !row[`player_${slot}_key`] && score == null && points == null) continue
      players.push({ slot, name: name || 'Unknown player', team: row[`player_${slot}_team`],
        score, points, picked: row[`player_${slot}_is_pick`] === true })
    }
    const game = { number: row.game_number, machine: row.machine, players,
      points: { home: row.home_points, away: row.away_points } }
    const bucket = byRound.get(row.round_number)
    if (bucket) bucket.push(game)
    else byRound.set(row.round_number, [game])
  }
  const rounds = Array.from(byRound, ([number, games]): MatchRound => ({
    number,
    type: number === 1 || number === 4 ? 'Doubles' : number === 2 || number === 3 ? 'Singles' : null,
    games: games.sort((a, b) => a.number - b.number),
    points: addPoints(games.map(game => game.points)),
  })).sort((a, b) => a.number - b.number)
  return { ...summary, rounds, points: addPoints(rounds.map(round => round.points)) }
}
