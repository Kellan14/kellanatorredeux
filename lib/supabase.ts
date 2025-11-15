import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'

// For client components
export const createSupabaseClient = () => {
  return createClientComponentClient()
}

// For server-side operations
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type Database = {
  public: {
    Tables: {
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
