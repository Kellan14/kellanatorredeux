import { NextResponse } from 'next/server'
import { supabase, fetchAllRecords } from '@/lib/supabase'

export const dynamic = 'force-dynamic';

// Cache for 1 hour since stats only update weekly
export const revalidate = 3600

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const player = searchParams.get('player')
    const machine = searchParams.get('machine')
    const venue = searchParams.get('venue') || ''
    const seasonStart = parseInt(searchParams.get('seasonStart') || '20')
    const seasonEnd = parseInt(searchParams.get('seasonEnd') || '22')

    if (!player || !machine) {
      return NextResponse.json(
        { error: 'Player and machine parameters are required' },
        { status: 400 }
      )
    }

    // Get player's key from player_stats
    const { data: playerData } = await supabase
      .from('player_stats')
      .select('player_key')
      .eq('player_name', player)
      .limit(1)
      .single<{ player_key: string | null }>()

    if (!playerData?.player_key) {
      return NextResponse.json({
        stats: [],
        message: 'Player not found'
      })
    }

    const playerKey = playerData.player_key

    // Query games table directly with SQL filters using pagination, including team info
    let query = supabase
      .from('games')
      .select('match_key, week, season, venue, home_team, away_team, player_1_key, player_1_score, player_1_points, player_1_team, player_2_key, player_2_score, player_2_points, player_2_team, player_3_key, player_3_score, player_3_points, player_3_team, player_4_key, player_4_score, player_4_points, player_4_team')
      .eq('machine', machine)
      .gte('season', seasonStart)
      .lte('season', seasonEnd)
      .or(`player_1_key.eq.${playerKey},player_2_key.eq.${playerKey},player_3_key.eq.${playerKey},player_4_key.eq.${playerKey}`)

    if (venue) {
      query = query.eq('venue', venue)
    }

    let gamesData
    try {
      gamesData = await fetchAllRecords<{
        match_key: string
        week: number
        season: number
        venue: string | null
        home_team: string | null
        away_team: string | null
        player_1_key: string | null
        player_1_score: number | null
        player_1_points: number | null
        player_1_team: string | null
        player_2_key: string | null
        player_2_score: number | null
        player_2_points: number | null
        player_2_team: string | null
        player_3_key: string | null
        player_3_score: number | null
        player_3_points: number | null
        player_3_team: string | null
        player_4_key: string | null
        player_4_score: number | null
        player_4_points: number | null
        player_4_team: string | null
      }>(query)
    } catch (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Get all unique team keys from the games
    const teamKeys = new Set<string>()
    gamesData.forEach(game => {
      if (game.home_team) teamKeys.add(game.home_team)
      if (game.away_team) teamKeys.add(game.away_team)
      if (game.player_1_team) teamKeys.add(game.player_1_team)
      if (game.player_2_team) teamKeys.add(game.player_2_team)
      if (game.player_3_team) teamKeys.add(game.player_3_team)
      if (game.player_4_team) teamKeys.add(game.player_4_team)
    })

    // Fetch team names
    const { data: teamsData } = await supabase
      .from('teams')
      .select('team_key, team_name')
      .in('team_key', Array.from(teamKeys))

    const teamNameMap: Record<string, string> = {}
    ;(teamsData || []).forEach((t: any) => {
      teamNameMap[t.team_key] = t.team_name
    })

    // Extract stats for this player from each game
    const stats = gamesData.map(game => {
      let score = 0
      let points = 0
      let playerTeam: string | null = null

      if (game.player_1_key === playerKey) {
        score = game.player_1_score || 0
        points = game.player_1_points || 0
        playerTeam = game.player_1_team
      } else if (game.player_2_key === playerKey) {
        score = game.player_2_score || 0
        points = game.player_2_points || 0
        playerTeam = game.player_2_team
      } else if (game.player_3_key === playerKey) {
        score = game.player_3_score || 0
        points = game.player_3_points || 0
        playerTeam = game.player_3_team
      } else if (game.player_4_key === playerKey) {
        score = game.player_4_score || 0
        points = game.player_4_points || 0
        playerTeam = game.player_4_team
      }

      // Determine opponent team
      let opponentTeam: string | null = null
      if (playerTeam) {
        if (game.home_team && game.home_team !== playerTeam) {
          opponentTeam = teamNameMap[game.home_team]
        } else if (game.away_team && game.away_team !== playerTeam) {
          opponentTeam = teamNameMap[game.away_team]
        }
      }

      return {
        matchKey: game.match_key,
        round: game.week,
        match: opponentTeam || 'Unknown',
        week: game.week,
        season: game.season,
        venue: game.venue,
        score,
        points
      }
    })

    return NextResponse.json({
      stats,
      player,
      machine,
      totalGames: stats.length
    })
  } catch (error) {
    console.error('Error fetching player machine stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player machine stats' },
      { status: 500 }
    )
  }
}
