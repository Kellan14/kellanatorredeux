import { createClient } from '@supabase/supabase-js'

// Singleton instance - only create once
let supabaseInstance: ReturnType<typeof createClient<Database>> | null = null

// Get the Supabase client (creates only once)
export const supabase = (() => {
  if (!supabaseInstance) {
    supabaseInstance = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return supabaseInstance
})()

// Export the same instance for compatibility
export const createSupabaseClient = () => supabase

// Helper function to fetch all records with pagination (bypassing 1000 record limit)
// Accepts a function that creates a fresh query builder for each page to avoid query builder mutation
export async function fetchAllRecords<T>(
  createQueryBuilder: () => any,
  pageSize: number = 1000
): Promise<T[]> {
  const allRecords: T[] = []
  let offset = 0
  let hasMore = true

  while (hasMore) {
    // Create a fresh query builder for each page to avoid mutation issues
    const queryBuilder = createQueryBuilder()
    const { data, error } = await queryBuilder
      .range(offset, offset + pageSize - 1)

    if (error) {
      throw error
    }

    if (data && data.length > 0) {
      allRecords.push(...data)
      offset += pageSize
      hasMore = data.length === pageSize
    } else {
      hasMore = false
    }
  }

  return allRecords
}

export type Database = {
  public: {
    Tables: {
      matches: {
        Row: {
          id: number
          match_key: string
          season: number
          week: number
          home_team: string | null
          away_team: string | null
          venue_name: string | null
          state: string | null
          data: any // JSONB - contains full match data
          created_at: string
        }
        Insert: {
          id?: number
          match_key: string
          season: number
          week: number
          home_team?: string | null
          away_team?: string | null
          venue_name?: string | null
          state?: string | null
          data: any
          created_at?: string
        }
        Update: {
          id?: number
          match_key?: string
          season?: number
          week?: number
          home_team?: string | null
          away_team?: string | null
          venue_name?: string | null
          state?: string | null
          data?: any
          created_at?: string
        }
      }
      player_stats: {
        Row: {
          id: number
          player_name: string
          player_key: string | null
          season: number
          team: string | null
          ipr: number | null
          matches_played: number
          last_match_week: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          player_name: string
          player_key?: string | null
          season: number
          team?: string | null
          ipr?: number | null
          matches_played?: number
          last_match_week?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          player_name?: string
          player_key?: string | null
          season?: number
          team?: string | null
          ipr?: number | null
          matches_played?: number
          last_match_week?: number | null
          created_at?: string
          updated_at?: string
        }
      }
      games: {
        Row: {
          id: number
          match_id: number | null
          season: number
          week: number
          venue: string | null
          match_key: string
          round_number: number
          game_number: number
          machine: string
          player_1_key: string | null
          player_1_name: string | null
          player_1_score: number | null
          player_1_points: number | null
          player_1_team: string | null
          player_1_is_pick: boolean | null
          player_2_key: string | null
          player_2_name: string | null
          player_2_score: number | null
          player_2_points: number | null
          player_2_team: string | null
          player_2_is_pick: boolean | null
          player_3_key: string | null
          player_3_name: string | null
          player_3_score: number | null
          player_3_points: number | null
          player_3_team: string | null
          player_3_is_pick: boolean | null
          player_4_key: string | null
          player_4_name: string | null
          player_4_score: number | null
          player_4_points: number | null
          player_4_team: string | null
          player_4_is_pick: boolean | null
          home_team: string | null
          away_team: string | null
          away_points: number | null
          home_points: number | null
          created_at: string
        }
        Insert: {
          id?: number
          match_id?: number | null
          season: number
          week: number
          venue?: string | null
          match_key: string
          round_number: number
          game_number: number
          machine: string
          player_1_key?: string | null
          player_1_name?: string | null
          player_1_score?: number | null
          player_1_points?: number | null
          player_1_team?: string | null
          player_1_is_pick?: boolean | null
          player_2_key?: string | null
          player_2_name?: string | null
          player_2_score?: number | null
          player_2_points?: number | null
          player_2_team?: string | null
          player_2_is_pick?: boolean | null
          player_3_key?: string | null
          player_3_name?: string | null
          player_3_score?: number | null
          player_3_points?: number | null
          player_3_team?: string | null
          player_3_is_pick?: boolean | null
          player_4_key?: string | null
          player_4_name?: string | null
          player_4_score?: number | null
          player_4_points?: number | null
          player_4_team?: string | null
          player_4_is_pick?: boolean | null
          home_team?: string | null
          away_team?: string | null
          away_points?: number | null
          home_points?: number | null
          created_at?: string
        }
        Update: {
          id?: number
          match_id?: number | null
          season?: number
          week?: number
          venue?: string | null
          match_key?: string
          round_number?: number
          game_number?: number
          machine?: string
          player_1_key?: string | null
          player_1_name?: string | null
          player_1_score?: number | null
          player_1_points?: number | null
          player_1_team?: string | null
          player_1_is_pick?: boolean | null
          player_2_key?: string | null
          player_2_name?: string | null
          player_2_score?: number | null
          player_2_points?: number | null
          player_2_team?: string | null
          player_2_is_pick?: boolean | null
          player_3_key?: string | null
          player_3_name?: string | null
          player_3_score?: number | null
          player_3_points?: number | null
          player_3_team?: string | null
          player_3_is_pick?: boolean | null
          player_4_key?: string | null
          player_4_name?: string | null
          player_4_score?: number | null
          player_4_points?: number | null
          player_4_team?: string | null
          player_4_is_pick?: boolean | null
          home_team?: string | null
          away_team?: string | null
          away_points?: number | null
          home_points?: number | null
          created_at?: string
        }
      }
      player_match_participation: {
        Row: {
          id: number
          match_id: number | null
          match_key: string
          player_key: string
          player_name: string
          season: number
          week: number
          team: string
          ipr_at_match: number | null
          num_played: number
          is_sub: boolean
          created_at: string
        }
        Insert: {
          id?: number
          match_id?: number | null
          match_key: string
          player_key: string
          player_name: string
          season: number
          week: number
          team: string
          ipr_at_match?: number | null
          num_played?: number
          is_sub?: boolean
          created_at?: string
        }
        Update: {
          id?: number
          match_id?: number | null
          match_key?: string
          player_key?: string
          player_name?: string
          season?: number
          week?: number
          team?: string
          ipr_at_match?: number | null
          num_played?: number
          is_sub?: boolean
          created_at?: string
        }
      }
      profiles: {
        Row: {
          id: string
          username: string | null
          full_name: string | null
          avatar_url: string | null
          team_affiliation: string | null
          favorite_machines: string[] | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          username?: string | null
          full_name?: string | null
          avatar_url?: string | null
          team_affiliation?: string | null
          favorite_machines?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          username?: string | null
          full_name?: string | null
          avatar_url?: string | null
          team_affiliation?: string | null
          favorite_machines?: string[] | null
          created_at?: string
          updated_at?: string
        }
      }
      user_stats: {
        Row: {
          id: string
          user_id: string
          tournament_id: string
          machine_played: string
          score: number
          position: number | null
          played_at: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          tournament_id: string
          machine_played: string
          score: number
          position?: number | null
          played_at: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          tournament_id?: string
          machine_played?: string
          score?: number
          position?: number | null
          played_at?: string
          created_at?: string
        }
      }
      user_notes: {
        Row: {
          id: string
          user_id: string
          machine_name: string | null
          venue_name: string | null
          note: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          machine_name?: string | null
          venue_name?: string | null
          note: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          machine_name?: string | null
          venue_name?: string | null
          note?: string
          created_at?: string
        }
      }
      teams: {
        Row: {
          team_key: string
          team_name: string
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          team_key: string
          team_name: string
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          team_key?: string
          team_name?: string
          active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      user_machine_scores: {
        Row: {
          id: number
          user_id: string
          player_name: string
          machine: string
          score: number
          venue: string | null
          season: number | null
          include_in_calculations: boolean | null
          played_at: string
          created_at: string
        }
        Insert: {
          id?: number
          user_id: string
          player_name: string
          machine: string
          score: number
          venue?: string | null
          season?: number | null
          include_in_calculations?: boolean | null
          played_at?: string
          created_at?: string
        }
        Update: {
          id?: number
          user_id?: string
          player_name?: string
          machine?: string
          score?: number
          venue?: string | null
          season?: number | null
          include_in_calculations?: boolean | null
          played_at?: string
          created_at?: string
        }
      }
      player_name_mappings: {
        Row: {
          id: number
          alias: string
          canonical_name: string
          created_at: string
        }
        Insert: {
          id?: number
          alias: string
          canonical_name: string
          created_at?: string
        }
        Update: {
          id?: number
          alias?: string
          canonical_name?: string
          created_at?: string
        }
      }
      player_name_update_log: {
        Row: {
          id: number
          old_name: string
          new_name: string
          records_updated: number
          created_at: string
        }
        Insert: {
          id?: number
          old_name: string
          new_name: string
          records_updated: number
          created_at?: string
        }
        Update: {
          id?: number
          old_name?: string
          new_name?: string
          records_updated?: number
          created_at?: string
        }
      }
      login_history: {
        Row: {
          id: number
          user_id: string
          email: string | null
          player_name: string | null
          login_at: string
          user_agent: string | null
          created_at: string
        }
        Insert: {
          id?: number
          user_id: string
          email?: string | null
          player_name?: string | null
          login_at?: string
          user_agent?: string | null
          created_at?: string
        }
        Update: {
          id?: number
          user_id?: string
          email?: string | null
          player_name?: string | null
          login_at?: string
          user_agent?: string | null
          created_at?: string
        }
      }
    }
  }
}
