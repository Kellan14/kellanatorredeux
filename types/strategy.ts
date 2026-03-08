// Strategy system type definitions
export interface Player {
  id: string
  team_id: string
  name: string
  email?: string
  active: boolean
}

export interface Machine {
  id: string
  name: string
  manufacturer?: string
  year_released?: number
  skill_level: 'easy' | 'medium' | 'hard' | 'expert'
  active: boolean
}

// Individual score data for detailed breakdown
export interface ScoreEntry {
  score: number
  venue: string
  venueAvg: number
  ratio: number  // score / venueAvg
  date?: string
  won?: boolean
  weight: number  // 1 for individual scores, 3 for self-reported average
  source: 'league' | 'user_score' | 'user_input'  // Where this score came from
}

// Detailed breakdown of how stats were calculated
export interface ScoreBreakdown {
  leagueScores: ScoreEntry[]
  userScores: ScoreEntry[]
  userInputAverage: ScoreEntry | null
  overallVenueAvg: number
  leagueVenueAdjustedAvg: number
  userVenueAdjustedAvg: number | null
  finalVenueAdjustedAvg: number
  userInputWeightApplied: number
}

export interface PlayerMachineStats {
  id: string
  player_id: string
  machine_id: string
  games_played: number
  wins: number
  losses: number
  win_rate: number
  avg_score: number
  venue_adjusted_avg: number
  high_score: number
  recent_form: number
  streak_type: 'win' | 'loss' | null
  streak_count: number
  confidence_score: number
  user_confidence?: number
  last_played?: string
  scoreBreakdown?: ScoreBreakdown
}

export interface Assignment {
  player_id: string
  machine_id: string
  expected_score: number
  confidence: number
  venue_adjusted_avg?: number
  user_average?: number | null
  user_confidence?: number | null
}

export interface PairAssignment {
  player1_id: string
  player2_id: string
  machine_id: string
  expected_score: number
  synergy_bonus: number
  player1_venue_adjusted_avg?: number
  player2_venue_adjusted_avg?: number
  player1_user_average?: number | null
  player2_user_average?: number | null
  player1_user_confidence?: number | null
  player2_user_confidence?: number | null
}

export interface AssumedOpponent {
  player: string
  avgScore: number
  venueAvg: number
  venueGames: number
  venueWinRate: number
  allAvg: number
  allGames: number
  allWinRate: number
}

export interface OptimizationResult {
  format: '7x7' | '4x2'
  assignments: (Assignment | PairAssignment)[]
  total_score: number
  win_probability: number
  alternative_assignments?: (Assignment | PairAssignment)[][]
  suggestions: string[]
  benched?: string[]
  assumedOpponents?: Record<string, AssumedOpponent[]>
}

export interface PairStats {
  id: string
  team_id: string
  player1_id: string
  player2_id: string
  machine_id: string | null
  games_together: number
  wins: number
  win_rate: number
  synergy_score: number
  last_paired?: string
}

export interface GameResult {
  id: string
  match_id: string | null
  team_id: string
  machine_id: string
  player_id: string
  opponent_team_id: string | null
  opponent_player_id: string | null
  player_score: number
  opponent_score: number
  won: boolean
  match_format: '7x7' | '4x2' | null
  game_date: string
}

export interface StrategyCache {
  id: string
  cache_key: string
  cache_value: any
  cache_type: string
  expires_at: string
  created_at: string
}
