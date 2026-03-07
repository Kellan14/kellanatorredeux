import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { standardizeVenueName } from '@/lib/venue-mappings'

export const dynamic = 'force-dynamic';

// Short cache since we check dates
export const revalidate = 300

const DATA_BASE_URL = process.env.MNP_DATA_URL || 'https://raw.githubusercontent.com/Invader-Zim/mnp-data-archive/main'

interface VenueInfo {
  key: string
  name: string
}

interface ScheduleMatch {
  match_key: string
  week: string
  date: string // YYYYMMDD format
  side: string // "vs" (home) or "@" (away)
  opp: {
    key: string
    name: string
  }
}

interface SeasonData {
  key: string
  teams: {
    [teamKey: string]: {
      key: string
      venue: string
      name: string
      schedule: ScheduleMatch[]
    }
  }
}

/**
 * Parse YYYYMMDD date string to Date object in Pacific time
 */
function parseMatchDate(dateStr: string): Date {
  const year = parseInt(dateStr.substring(0, 4))
  const month = parseInt(dateStr.substring(4, 6)) - 1 // 0-indexed
  const day = parseInt(dateStr.substring(6, 8))
  return new Date(year, month, day)
}

/**
 * Get current date in Pacific timezone
 */
function getPacificDate(): Date {
  const now = new Date()
  // Convert to Pacific time
  const pacificTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  return pacificTime
}

export async function GET() {
  try {
    // Get current season from database
    const { data: maxSeasonData } = await supabase
      .from('matches')
      .select('season')
      .order('season', { ascending: false })
      .limit(1)
      .single<{ season: number }>()

    const currentSeason = maxSeasonData?.season || 23

    // Fetch season.json from GitHub for schedule with dates
    let seasonData: SeasonData | null = null
    try {
      const response = await fetch(`${DATA_BASE_URL}/season-${currentSeason}/season.json`, {
        next: { revalidate: 3600 }
      })
      if (response.ok) {
        seasonData = await response.json()
      }
    } catch (e) {
      console.error('Failed to fetch season.json:', e)
    }

    // Fetch venues data to map venue keys to names
    let venuesMap: Record<string, string> = {}
    try {
      const venuesResponse = await fetch(`${DATA_BASE_URL}/venues.json`, {
        next: { revalidate: 3600 }
      })
      if (venuesResponse.ok) {
        const venuesData: Record<string, VenueInfo> = await venuesResponse.json()
        for (const [key, venue] of Object.entries(venuesData)) {
          venuesMap[key] = venue.name
        }
      }
    } catch (e) {
      console.error('Failed to fetch venues.json:', e)
    }

    // If we have season data, use schedule dates to determine next match
    if (seasonData?.teams?.TWC?.schedule) {
      const schedule = seasonData.teams.TWC.schedule
      const pacificNow = getPacificDate()

      // Set to start of today (midnight)
      const today = new Date(pacificNow.getFullYear(), pacificNow.getMonth(), pacificNow.getDate())

      // Find the next upcoming match
      // A match is "upcoming" if its date is today or in the future
      // After midnight Monday (Tuesday), the Monday match is considered past
      for (const match of schedule) {
        const matchDate = parseMatchDate(match.date)

        // Match is upcoming if:
        // - Match date is in the future, OR
        // - Match date is today (Monday) and we're still on Monday
        // After midnight Monday (Tuesday 12:00 AM), that match is past
        const dayAfterMatch = new Date(matchDate)
        dayAfterMatch.setDate(dayAfterMatch.getDate() + 1) // Tuesday after the match

        if (today < dayAfterMatch) {
          // This match is still current or upcoming
          const isHome = match.side === 'vs'

          // Determine venue from season data
          let venueName = 'Georgetown Pizza and Arcade' // default for TWC home
          if (!isHome) {
            // Away game - get opponent's venue key and look up name
            const oppTeam = seasonData.teams[match.opp.key]
            if (oppTeam?.venue) {
              // Look up venue name from key
              venueName = venuesMap[oppTeam.venue] || oppTeam.venue
            }
          }

          // Check if match exists in database to get actual venue (and state)
          const { data: dbMatch } = await supabase
            .from('matches')
            .select('venue_name, state')
            .eq('match_key', match.match_key)
            .single<{ venue_name: string; state: string }>()

          if (dbMatch?.venue_name) {
            venueName = standardizeVenueName(dbMatch.venue_name) || dbMatch.venue_name
          }

          return NextResponse.json({
            venue: venueName,
            opponent: match.opp.name,
            matchKey: match.match_key,
            week: parseInt(match.week),
            season: currentSeason,
            state: dbMatch?.state || 'pregame',
            isUpcoming: true,
            matchDate: match.date
          })
        }
      }

      // All matches are past - return the last one
      const lastMatch = schedule[schedule.length - 1]
      if (lastMatch) {
        const { data: dbMatch } = await supabase
          .from('matches')
          .select('venue_name, state')
          .eq('match_key', lastMatch.match_key)
          .single<{ venue_name: string; state: string }>()

        return NextResponse.json({
          venue: standardizeVenueName(dbMatch?.venue_name || null) || 'Georgetown Pizza and Arcade',
          opponent: lastMatch.opp.name,
          matchKey: lastMatch.match_key,
          week: parseInt(lastMatch.week),
          season: currentSeason,
          state: dbMatch?.state || 'complete',
          isUpcoming: false,
          matchDate: lastMatch.date
        })
      }
    }

    // Fallback to database-only approach if season.json not available
    let matchData: {
      match_key: string
      season: number
      week: number
      home_team: string
      away_team: string
      venue_name: string | null
      state: string
    } | null = null

    const { data: pregameMatches } = await supabase
      .from('matches')
      .select('match_key, season, week, home_team, away_team, venue_name, state')
      .or('home_team.eq.TWC,away_team.eq.TWC')
      .eq('state', 'pregame')
      .order('season', { ascending: false })
      .order('week', { ascending: false })
      .limit(1)

    if (pregameMatches && pregameMatches.length > 0) {
      matchData = pregameMatches[0] as any
    }

    if (!matchData) {
      const { data: recentMatches } = await supabase
        .from('matches')
        .select('match_key, season, week, home_team, away_team, venue_name, state')
        .or('home_team.eq.TWC,away_team.eq.TWC')
        .order('season', { ascending: false })
        .order('week', { ascending: false })
        .limit(1)

      if (recentMatches && recentMatches.length > 0) {
        matchData = recentMatches[0] as any
      }
    }

    if (!matchData) {
      return NextResponse.json({
        venue: 'Georgetown Pizza and Arcade',
        opponent: null,
        matchKey: null,
        week: null,
        isUpcoming: false
      })
    }

    const opponentTeamKey = matchData.home_team === 'TWC' ? matchData.away_team : matchData.home_team

    let opponentName = opponentTeamKey
    if (opponentTeamKey) {
      const { data: teamData } = await supabase
        .from('teams')
        .select('team_name')
        .eq('team_key', opponentTeamKey)
        .single<{ team_name: string }>()

      if (teamData) {
        opponentName = teamData.team_name
      }
    }

    return NextResponse.json({
      venue: standardizeVenueName(matchData.venue_name) || 'Georgetown Pizza and Arcade',
      opponent: opponentName,
      matchKey: matchData.match_key,
      week: matchData.week,
      season: matchData.season,
      state: matchData.state,
      isUpcoming: matchData.state !== 'complete'
    })
  } catch (error) {
    console.error('Error finding latest TWC match:', error)
    return NextResponse.json(
      { error: 'Failed to find latest match' },
      { status: 500 }
    )
  }
}
