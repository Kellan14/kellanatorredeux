import { supabase } from '@/lib/supabase'

export interface LastSeen {
  season: number
  week: number
}

export interface TeamRoster {
  rosterPlayers: string[]
  subPlayers: string[]
  /** For each sub player, the most recent (season, week) they appeared for this team. */
  subPlayerLastSeen: Record<string, LastSeen>
  /** The season treated as "current" (max season this team has appeared in). */
  currentSeason: number | null
}

/**
 * Build a team's roster + sub list from player_match_participation.
 *
 * - Current-season players (max season this team appears in) with is_sub=false → roster.
 * - Everyone else who has ever played for this team → subs, tagged with the (season, week)
 *   of their most recent appearance for this team.
 *
 * No hard-coded season ranges: subs span the team's entire history.
 */
export async function getTeamRoster(teamKey: string): Promise<TeamRoster> {
  const { data } = await supabase
    .from('player_match_participation')
    .select('player_name, season, week, is_sub')
    .eq('team', teamKey) as {
      data: { player_name: string; season: number; week: number; is_sub: boolean }[] | null
    }

  const rows = data || []
  if (rows.length === 0) {
    return { rosterPlayers: [], subPlayers: [], subPlayerLastSeen: {}, currentSeason: null }
  }

  const currentSeason = rows.reduce((m, r) => (r.season > m ? r.season : m), -Infinity)

  const rosterSet = new Set<string>()
  for (const r of rows) {
    if (r.season === currentSeason && !r.is_sub) {
      const name = (r.player_name || '').trim()
      if (name) rosterSet.add(name)
    }
  }

  // For non-roster players: track the most recent (season, week) appearance.
  const lastSeen = new Map<string, LastSeen>()
  for (const r of rows) {
    const name = (r.player_name || '').trim()
    if (!name || rosterSet.has(name)) continue
    const prev = lastSeen.get(name)
    if (!prev || r.season > prev.season || (r.season === prev.season && r.week > prev.week)) {
      lastSeen.set(name, { season: r.season, week: r.week })
    }
  }

  // Sort subs by recency (most recent first), then alphabetically as tiebreaker.
  const subPlayers = Array.from(lastSeen.keys()).sort((a, b) => {
    const A = lastSeen.get(a)!
    const B = lastSeen.get(b)!
    if (A.season !== B.season) return B.season - A.season
    if (A.week !== B.week) return B.week - A.week
    return a.localeCompare(b)
  })

  const subPlayerLastSeen: Record<string, LastSeen> = {}
  for (const [name, ls] of Array.from(lastSeen.entries())) {
    subPlayerLastSeen[name] = ls
  }

  return {
    rosterPlayers: Array.from(rosterSet).sort(),
    subPlayers,
    subPlayerLastSeen,
    currentSeason: Number.isFinite(currentSeason) ? currentSeason : null,
  }
}
