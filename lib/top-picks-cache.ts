export interface CachedTeamPick {
  generation: string
  game_id: number
  team_key: string
  season: number
  machine: string
  player_names: string[]
}

/** One row per game picked by a team, not one row per player in doubles. */
export function collectTeamPicks(games: any[], generation: string): CachedTeamPick[] {
  const picks: CachedTeamPick[] = []
  for (const game of games) {
    // The fifth round is a tiebreaker; neither side picks its machine.
    if (![1, 2, 3, 4].includes(game.round_number)) continue
    const teamKey = game.round_number % 2 === 1 ? game.away_team : game.home_team
    if (!teamKey || !game.machine || game.season == null) continue

    const playerNames: string[] = []
    for (let slot = 1; slot <= 4; slot++) {
      if (game[`player_${slot}_team`] !== teamKey || !game[`player_${slot}_key`] ||
          game[`player_${slot}_score`] == null) continue
      const name = game[`player_${slot}_name`]
      if (name) playerNames.push(name)
    }
    if (playerNames.length === 0) continue

    picks.push({
      generation,
      game_id: game.id,
      team_key: teamKey,
      season: game.season,
      machine: String(game.machine).toLowerCase(),
      player_names: Array.from(new Set(playerNames)),
    })
  }
  return picks
}

export function rankTeamPicks(
  picks: CachedTeamPick[], seasonStart: number, seasonEnd: number,
  venueMachines: string[], rosterPlayers: string[], limit = 10
): Array<{ machine: string; timesPicked: number }> {
  const allowedMachines = new Set(venueMachines.map(machine => machine.toLowerCase()))
  const allowedPlayers = rosterPlayers.length > 0 ? new Set(rosterPlayers) : null
  const counts = new Map<string, number>()
  for (const pick of picks) {
    if (pick.season < seasonStart || pick.season > seasonEnd || !allowedMachines.has(pick.machine)) continue
    if (allowedPlayers && !pick.player_names.some(name => allowedPlayers.has(name))) continue
    counts.set(pick.machine, (counts.get(pick.machine) || 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([machine, timesPicked]) => ({ machine, timesPicked }))
}

/** Fetch the complete history with keyset pagination (PostgREST caps pages at 1,000). */
export async function fetchAllPickSourceGames(supabase: any): Promise<any[]> {
  const games: any[] = []
  let lastId = 0
  while (true) {
    const { data, error } = await supabase
      .from('games')
      .select('id, season, machine, round_number, home_team, away_team, player_1_key, player_1_name, player_1_team, player_1_score, player_2_key, player_2_name, player_2_team, player_2_score, player_3_key, player_3_name, player_3_team, player_3_score, player_4_key, player_4_name, player_4_team, player_4_score')
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(1000)
    if (error) throw error
    if (!data?.length) break
    games.push(...data)
    lastId = data[data.length - 1].id
    if (data.length < 1000) break
  }
  return games
}

/** Rebuild after the source sync so corrections and deleted games are reflected. */
export async function rebuildTeamPicksCache(supabase: any, games: any[]) {
  const generation = crypto.randomUUID()
  const picks = collectTeamPicks(games, generation)

  for (let i = 0; i < picks.length; i += 500) {
    const { error } = await supabase.from('cache_team_pick_games').insert(picks.slice(i, i + 500))
    if (error) throw error
  }

  // Publish only after every batch succeeds. Readers continue using the
  // previous complete generation if a rebuild fails midway.
  const { error: publishError } = await supabase.from('cache_team_pick_builds').upsert({
    id: true,
    active_generation: generation,
    refreshed_at: new Date().toISOString(),
  }, { onConflict: 'id' })
  if (publishError) throw publishError

  const { error: cleanupError } = await supabase.from('cache_team_pick_games')
    .delete()
    .neq('generation', generation)
    .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  if (cleanupError) console.error('[top-picks-cache] Old generation cleanup failed:', cleanupError)
  return picks.length
}
