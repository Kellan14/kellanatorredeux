import { type ProcessedScore } from '@/lib/tournament-data'
import { standardizeVenueName } from '@/lib/venue-mappings'
import { machineMappings } from '@/lib/machine-mappings'

/**
 * Convert raw `games` table rows into flat ProcessedScore rows.
 *
 * The same player-1..4 expansion was hand-rolled in ~14 routes and had already
 * drifted (some normalized machine names via mappings, some only lowercased,
 * some carried game_number, some didn't). Centralizing it keeps the pick logic,
 * venue standardization, and game_number handling consistent everywhere.
 *
 * @param games        rows from the `games` table (denormalized player columns)
 * @param teamNameMap  team_key -> display name
 * @param opts.mapMachine  when true, resolve machine aliases via machineMappings
 *                         before lowercasing (matches machine-stats); otherwise
 *                         just lowercase the raw machine (matches processed-scores)
 */
export function gamesToProcessedScores(
  games: any[],
  teamNameMap: Record<string, string>,
  opts: { mapMachine?: boolean } = {}
): ProcessedScore[] {
  const out: ProcessedScore[] = []

  for (const game of games) {
    const rawMachine = (game.machine || '').toLowerCase()
    const machine = opts.mapMachine
      ? (machineMappings[rawMachine] ? machineMappings[rawMachine].toLowerCase() : rawMachine)
      : rawMachine

    for (let i = 1; i <= 4; i++) {
      const playerKey = game[`player_${i}_key`]
      const playerName = game[`player_${i}_name`]
      const score = game[`player_${i}_score`]
      const points = game[`player_${i}_points`]
      const teamKey = game[`player_${i}_team`]

      if (!playerKey || score === null || score === undefined) continue

      // Per MNP rules: away team picks rounds 1 (doubles) and 3 (singles);
      // home team picks rounds 2 (singles) and 4 (doubles).
      const isHomeTeam = teamKey === game.home_team
      const isPick = game.round_number % 2 === 1 ? !isHomeTeam : isHomeTeam

      out.push({
        season: game.season || 0,
        week: game.week,
        match: game.match_key,
        round: game.round_number,
        game: game.game_number,
        venue: standardizeVenueName(game.venue) || '',
        machine,
        player_name: playerName || 'Unknown',
        team: teamKey || '',
        team_name: teamNameMap[teamKey] || teamKey || '',
        score,
        points: points || 0,
        is_pick: isPick,
        is_roster_player: true,
      })
    }
  }

  return out
}

/**
 * Build a team_key -> team_name map for a set of games by looking up every team
 * key that appears (player teams + home/away) in the teams table.
 */
export async function buildTeamNameMap(
  supabase: any,
  games: any[]
): Promise<Record<string, string>> {
  const teamKeys = new Set<string>()
  for (const game of games) {
    for (let i = 1; i <= 4; i++) {
      const team = game[`player_${i}_team`]
      if (team) teamKeys.add(team)
    }
    if (game.home_team) teamKeys.add(game.home_team)
    if (game.away_team) teamKeys.add(game.away_team)
  }

  const { data: teamsData } = await supabase
    .from('teams')
    .select('team_key, team_name')
    .in('team_key', Array.from(teamKeys))

  const map: Record<string, string> = {}
  for (const team of teamsData || []) {
    map[team.team_key] = team.team_name
  }
  return map
}
