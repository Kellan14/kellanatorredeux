import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET() {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get login history with aggregated stats
    const { data: loginHistory, error } = await supabase
      .from('login_history')
      .select('*')
      .order('login_at', { ascending: false })

    if (error) {
      console.error('Error fetching login history:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Aggregate by user
    const userStats: Record<string, {
      email: string
      player_name: string | null
      login_count: number
      first_login: string
      last_login: string
    }> = {}

    for (const login of loginHistory || []) {
      const key = login.user_id
      if (!userStats[key]) {
        userStats[key] = {
          email: login.email,
          player_name: login.player_name,
          login_count: 0,
          first_login: login.login_at,
          last_login: login.login_at
        }
      }
      userStats[key].login_count++
      // Update first/last login times
      if (login.login_at < userStats[key].first_login) {
        userStats[key].first_login = login.login_at
      }
      if (login.login_at > userStats[key].last_login) {
        userStats[key].last_login = login.login_at
      }
      // Update player_name if available
      if (login.player_name && !userStats[key].player_name) {
        userStats[key].player_name = login.player_name
      }
    }

    // Convert to array and sort by login count
    const users = Object.entries(userStats)
      .map(([user_id, stats]) => ({
        user_id,
        ...stats
      }))
      .sort((a, b) => b.login_count - a.login_count)

    return NextResponse.json({
      users,
      totalLogins: loginHistory?.length || 0,
      uniqueUsers: users.length,
      recentLogins: (loginHistory || []).slice(0, 20).map(l => ({
        email: l.email,
        player_name: l.player_name,
        login_at: l.login_at
      }))
    })
  } catch (error) {
    console.error('Error in login-stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch login stats' },
      { status: 500 }
    )
  }
}
