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
    }
  }
}
