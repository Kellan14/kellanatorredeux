import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { machineMappings } from '@/lib/machine-mappings'
import { standardizeVenueName } from '@/lib/venue-mappings'

// Vercel Cron job to sync MNP data from GitHub
// Runs every Tuesday at 2am UTC
// Schedule: 0 2 * * 2

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes (requires Pro plan for >60s)

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const CURRENT_SEASON = 23

// Use GitHub API to list actual match files (much faster than brute-forcing team combinations)
async function listMatchFiles(season: number): Promise<string[]> {
  const apiUrl = `https://api.github.com/repos/Invader-Zim/mnp-data-archive/contents/season-${season}/matches`
  try {
    const response = await fetch(apiUrl, {
      cache: 'no-store',
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    })
    if (!response.ok) return []
    const files = await response.json()
    if (!Array.isArray(files)) return []
    return files
      .filter((f: any) => f.name.endsWith('.json'))
      .map((f: any) => f.download_url)
  } catch {
    return []
  }
}

async function fetchMatchData(url: string) {
  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

function isPlayerPick(playerKey: string, homeTeam: string, awayTeam: string, homeLineup: any[], awayLineup: any[]) {
  const isHomePlayer = homeLineup.some((p: any) => p.key === playerKey)
  const isAwayPlayer = awayLineup.some((p: any) => p.key === playerKey)
  if (isHomePlayer) return homeTeam
  if (isAwayPlayer) return awayTeam
  return null
}

export async function GET(request: Request) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow manual runs with query param for testing
    const { searchParams } = new URL(request.url)
    const manualKey = searchParams.get('key')
    if (manualKey !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)
  const { searchParams } = new URL(request.url)
  const fullImport = searchParams.get('full') === 'true'
  const seasons = fullImport ? [20, 21, 22, 23] : [CURRENT_SEASON]

  console.log(`[cron/sync-data] Starting import for seasons: ${seasons.join(', ')}`)

  const matchesBatch: any[] = []
  const gamesBatch: any[] = []
  const participationsBatch: any[] = []
  const teamsMap = new Map<string, string>()
  const playerStatsMap = new Map<string, any>()

  let matchesFound = 0
  let gamesCreated = 0

  try {
    // Clear existing data for the seasons being imported
    if (fullImport) {
      await supabase.from('games').delete().in('season', seasons)
      await supabase.from('player_match_participation').delete().in('season', seasons)
    } else {
      // For incremental, only clear current season
      await supabase.from('games').delete().eq('season', CURRENT_SEASON)
      await supabase.from('player_match_participation').delete().eq('season', CURRENT_SEASON)
    }

    for (const season of seasons) {
      // Use GitHub API to list actual match files (much faster than brute-forcing)
      console.log(`[cron/sync-data] Fetching file list for season ${season}...`)
      const matchUrls = await listMatchFiles(season)
      console.log(`[cron/sync-data] Found ${matchUrls.length} match files for season ${season}`)

      // Fetch matches in parallel batches for speed
      const batchSize = 10
      for (let i = 0; i < matchUrls.length; i += batchSize) {
        const batch = matchUrls.slice(i, i + batchSize)
        const results = await Promise.all(batch.map(url => fetchMatchData(url)))

        for (const matchData of results) {
          if (!matchData) continue
          matchesFound++

          // Extract season/week/teams from matchData
          const week = matchData.week || 0
          const homeTeam = matchData.home?.key || ''
          const awayTeam = matchData.away?.key || ''

          // Track teams
          if (matchData.home?.key && matchData.home?.name) {
            teamsMap.set(matchData.home.key, matchData.home.name)
          }
          if (matchData.away?.key && matchData.away?.name) {
            teamsMap.set(matchData.away.key, matchData.away.name)
          }

          // Store match
          matchesBatch.push({
            match_key: matchData.key,
            season,
            week,
            home_team: homeTeam,
            away_team: awayTeam,
            venue_name: matchData.venue?.name,
            state: matchData.state,
            data: matchData
          })

          const homeLineup = matchData.home?.lineup || []
          const awayLineup = matchData.away?.lineup || []

          // Create player lookup map
          const playerMap = new Map<string, string>()
          ;[...homeLineup, ...awayLineup].forEach((p: any) => {
            if (p.key && p.name) playerMap.set(p.key, p.name)
          })

          // Track player participation
          const seenPlayers = new Set<string>()

          for (const player of homeLineup) {
            if (!player.name || player.name.toLowerCase().includes('no player')) continue
            const participationKey = `${matchData.key}-${player.key}`
            if (!seenPlayers.has(participationKey)) {
              participationsBatch.push({
                match_key: matchData.key,
                player_key: player.key,
                player_name: player.name,
                season,
                week,
                team: matchData.home.key,
                ipr_at_match: player.IPR || player.ipr,
                num_played: player.num_played || 0,
                is_sub: player.sub || false
              })
              seenPlayers.add(participationKey)
            }

            // Track player stats
            const statsKey = `${player.name}-${season}`
            if (!playerStatsMap.has(statsKey)) {
              playerStatsMap.set(statsKey, {
                player_key: player.key,
                player_name: player.name,
                season,
                team: matchData.home.key,
                matches_played: 0,
                total_points: 0,
                last_match_week: 0
              })
            }
            const stats = playerStatsMap.get(statsKey)
            if (!player.sub) {
              stats.matches_played++
              stats.last_match_week = Math.max(stats.last_match_week, week)
            }
          }

          for (const player of awayLineup) {
            if (!player.name || player.name.toLowerCase().includes('no player')) continue
            const participationKey = `${matchData.key}-${player.key}`
            if (!seenPlayers.has(participationKey)) {
              participationsBatch.push({
                match_key: matchData.key,
                player_key: player.key,
                player_name: player.name,
                season,
                week,
                team: matchData.away.key,
                ipr_at_match: player.IPR || player.ipr,
                num_played: player.num_played || 0,
                is_sub: player.sub || false
              })
              seenPlayers.add(participationKey)
            }

            const statsKey = `${player.name}-${season}`
            if (!playerStatsMap.has(statsKey)) {
              playerStatsMap.set(statsKey, {
                player_key: player.key,
                player_name: player.name,
                season,
                team: matchData.away.key,
                matches_played: 0,
                total_points: 0,
                last_match_week: 0
              })
            }
            const stats = playerStatsMap.get(statsKey)
            if (!player.sub) {
              stats.matches_played++
              stats.last_match_week = Math.max(stats.last_match_week, week)
            }
          }

          // Process rounds and games
          const rounds = matchData.rounds || []
          for (const round of rounds) {
            const roundNumber = round.n || 0
            const games = round.games || []

            for (const game of games) {
              const gameNumber = game.n || 0
              if (!game.machine) continue

              const player1Team = isPlayerPick(game.player_1, homeTeam, awayTeam, homeLineup, awayLineup)
              const player2Team = isPlayerPick(game.player_2, homeTeam, awayTeam, homeLineup, awayLineup)
              const player3Team = isPlayerPick(game.player_3, homeTeam, awayTeam, homeLineup, awayLineup)
              const player4Team = isPlayerPick(game.player_4, homeTeam, awayTeam, homeLineup, awayLineup)

              // Per MNP rules: away team picks rounds 1 (doubles) and 3 (singles);
              // home team picks rounds 2 (singles) and 4 (doubles).
              const pickingTeam =
                roundNumber === 1 || roundNumber === 3 ? awayTeam :
                roundNumber === 2 || roundNumber === 4 ? homeTeam :
                null

              gamesBatch.push({
                match_key: matchData.key,
                season,
                week,
                venue: matchData.venue?.name,
                round_number: roundNumber,
                game_number: gameNumber,
                machine: game.machine,
                player_1_key: game.player_1 || null,
                player_1_name: game.player_1 ? playerMap.get(game.player_1) : null,
                player_1_score: game.score_1 || null,
                player_1_points: game.points_1 !== undefined ? game.points_1 : null,
                player_1_team: player1Team,
                player_1_is_pick: pickingTeam !== null && player1Team === pickingTeam,
                player_2_key: game.player_2 || null,
                player_2_name: game.player_2 ? playerMap.get(game.player_2) : null,
                player_2_score: game.score_2 || null,
                player_2_points: game.points_2 !== undefined ? game.points_2 : null,
                player_2_team: player2Team,
                player_2_is_pick: pickingTeam !== null && player2Team === pickingTeam,
                player_3_key: game.player_3 || null,
                player_3_name: game.player_3 ? playerMap.get(game.player_3) : null,
                player_3_score: game.score_3 || null,
                player_3_points: game.points_3 !== undefined ? game.points_3 : null,
                player_3_team: player3Team,
                player_3_is_pick: pickingTeam !== null && player3Team === pickingTeam,
                player_4_key: game.player_4 || null,
                player_4_name: game.player_4 ? playerMap.get(game.player_4) : null,
                player_4_score: game.score_4 || null,
                player_4_points: game.points_4 !== undefined ? game.points_4 : null,
                player_4_team: player4Team,
                player_4_is_pick: pickingTeam !== null && player4Team === pickingTeam,
                home_team: homeTeam,
                away_team: awayTeam,
                home_points: game.home_points !== undefined ? game.home_points : null,
                away_points: game.away_points !== undefined ? game.away_points : null
              })

              gamesCreated++

              // Track points for player stats
              for (let idx = 1; idx <= 4; idx++) {
                const playerKey = game[`player_${idx}`]
                const points = game[`points_${idx}`] || 0
                if (playerKey) {
                  const playerName = playerMap.get(playerKey)
                  if (playerName) {
                    const statsKey = `${playerName}-${season}`
                    if (playerStatsMap.has(statsKey)) {
                      playerStatsMap.get(statsKey).total_points += points
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // Insert matches and get back IDs
    const matchKeyToId = new Map<string, number>()
    if (matchesBatch.length > 0) {
      const { data: insertedMatches, error } = await supabase
        .from('matches')
        .upsert(matchesBatch, { onConflict: 'match_key' })
        .select('id, match_key')
      if (error) {
        console.error('[cron/sync-data] Error inserting matches:', error.message)
      } else if (insertedMatches) {
        for (const m of insertedMatches) {
          matchKeyToId.set(m.match_key, m.id)
        }
      }
    }

    // If we didn't get IDs back (upsert returns empty on conflict), fetch them
    if (matchKeyToId.size === 0 && matchesBatch.length > 0) {
      const matchKeys = matchesBatch.map(m => m.match_key)
      const { data: existingMatches } = await supabase
        .from('matches')
        .select('id, match_key')
        .in('match_key', matchKeys)
      if (existingMatches) {
        for (const m of existingMatches) {
          matchKeyToId.set(m.match_key, m.id)
        }
      }
    }

    // Add match_id to games
    for (const game of gamesBatch) {
      const matchId = matchKeyToId.get(game.match_key)
      if (matchId) {
        game.match_id = matchId
      }
    }

    // Insert games in batches
    if (gamesBatch.length > 0) {
      const insertBatchSize = 500
      for (let i = 0; i < gamesBatch.length; i += insertBatchSize) {
        const batch = gamesBatch.slice(i, i + insertBatchSize)
        const { error } = await supabase.from('games').insert(batch)
        if (error) console.error(`[cron/sync-data] Error inserting games batch ${i}:`, error.message)
      }
    }

    // Add match_id to participations (same as games - required by NOT NULL constraint)
    for (const participation of participationsBatch) {
      const matchId = matchKeyToId.get(participation.match_key)
      if (matchId) {
        participation.match_id = matchId
      }
    }

    // Insert participations (use insert, not upsert - we delete first so no conflicts)
    if (participationsBatch.length > 0) {
      console.log(`[cron/sync-data] Inserting ${participationsBatch.length} participations...`)
      const insertBatchSize = 500
      for (let i = 0; i < participationsBatch.length; i += insertBatchSize) {
        const batch = participationsBatch.slice(i, i + insertBatchSize)
        const { error } = await supabase
          .from('player_match_participation')
          .insert(batch)
        if (error) console.error(`[cron/sync-data] Error inserting participations batch ${i}:`, error.message)
      }
    }

    // Insert teams
    if (teamsMap.size > 0) {
      const teamsBatch = Array.from(teamsMap.entries()).map(([key, name]) => ({
        team_key: key,
        team_name: name,
        active: true
      }))
      const { error } = await supabase
        .from('teams')
        .upsert(teamsBatch, { onConflict: 'team_key' })
      if (error) console.error('[cron/sync-data] Error upserting teams:', error.message)
    }

    // Calculate and insert player stats
    if (playerStatsMap.size > 0) {
      const statsBatch = []
      for (const [, stats] of Array.from(playerStatsMap.entries())) {
        const ipr = stats.matches_played > 0
          ? Math.round((stats.total_points / stats.matches_played) * 100) / 100
          : 0
        statsBatch.push({
          player_name: stats.player_name,
          player_key: stats.player_key,
          season: stats.season,
          team: stats.team,
          ipr,
          matches_played: stats.matches_played,
          last_match_week: stats.last_match_week
        })
      }
      const { error } = await supabase
        .from('player_stats')
        .upsert(statsBatch, { onConflict: 'player_name,season' })
      if (error) console.error('[cron/sync-data] Error upserting player stats:', error.message)
    }

    console.log(`[cron/sync-data] Complete: ${matchesFound} matches, ${gamesCreated} games`)

    // Apply name standardizations from player_name_mappings
    console.log('[cron/sync-data] Applying name standardizations...')
    let standardizationsApplied = 0
    try {
      const { data: mappings } = await supabase
        .from('player_name_mappings')
        .select('alias, canonical_name')

      if (mappings && mappings.length > 0) {
        for (const mapping of mappings) {
          // Update games table for all player columns
          for (let i = 1; i <= 4; i++) {
            const { data } = await supabase
              .from('games')
              .update({ [`player_${i}_name`]: mapping.canonical_name })
              .eq(`player_${i}_name`, mapping.alias)
              .select('id')
            if (data?.length) standardizationsApplied += data.length
          }

          // Update player_match_participation table
          const { data: pmpData } = await supabase
            .from('player_match_participation')
            .update({ player_name: mapping.canonical_name })
            .eq('player_name', mapping.alias)
            .select('id')
          if (pmpData?.length) standardizationsApplied += pmpData.length

          // Update player_stats table
          const { data: psData } = await supabase
            .from('player_stats')
            .update({ player_name: mapping.canonical_name })
            .eq('player_name', mapping.alias)
            .select('id')
          if (psData?.length) standardizationsApplied += psData.length
        }
        console.log(`[cron/sync-data] Applied ${standardizationsApplied} name standardizations`)
      }
    } catch (error) {
      console.error('[cron/sync-data] Error applying name standardizations:', error)
    }

    // ===== PRE-COMPUTE CACHE TABLES =====
    console.log('[cron/sync-data] Building cache tables...')
    let cacheStats = { teamMachine: 0, playerMachine: 0, topScores: 0 }

    try {
      // Build a player name standardization map from the mappings we just applied
      const nameStdMap = new Map<string, string>()
      {
        const { data: mappings } = await supabase
          .from('player_name_mappings')
          .select('alias, canonical_name')
        if (mappings) {
          for (const m of mappings) {
            nameStdMap.set(m.alias, m.canonical_name)
          }
        }
      }
      const stdName = (name: string | null) => {
        if (!name) return name
        return nameStdMap.get(name) || name
      }

      // Fetch score limits for top-scores filtering
      let scoreLimitsMap: Record<string, number> = {}
      try {
        const { data: slData } = await supabase.from('score_limits').select('machine, max_score')
        if (slData) {
          for (const row of slData) {
            scoreLimitsMap[row.machine.toLowerCase()] = row.max_score
          }
        }
      } catch { /* no score_limits table yet - that's fine */ }

      // ---- Full game-history scan ----
      // All cache tables are rebuilt from a single scan of every game in the
      // table, so they are self-healing every night and never depend on
      // whether this run was incremental ([CURRENT_SEASON]) or a full import.
      // This is what fixes the old "all-time = this-season" bug and the
      // aggregate-cache key mismatch: aggregate rows are written PER SEASON
      // (season_start == season_end == season) and readers sum across the
      // seasons in their requested range.
      let allHistoryGames: any[] = []
      {
        const PAGE_SIZE = 1000
        let lastId = 0
        while (true) {
          const { data: page, error } = await supabase
            .from('games')
            .select('id, machine, venue, season, match_key, week, round_number, player_1_name, player_1_key, player_1_team, player_1_score, player_1_points, player_1_is_pick, player_2_name, player_2_key, player_2_team, player_2_score, player_2_points, player_2_is_pick, player_3_name, player_3_key, player_3_team, player_3_score, player_3_points, player_3_is_pick, player_4_name, player_4_key, player_4_team, player_4_score, player_4_points, player_4_is_pick')
            .gt('id', lastId)
            .order('id', { ascending: true })
            .limit(PAGE_SIZE)
          if (error) throw error
          if (!page || page.length === 0) break
          for (const row of page) allHistoryGames.push(row)
          lastId = page[page.length - 1].id
          if (page.length < PAGE_SIZE) break
        }
      }

      // ---- Accumulate aggregates per season from full history ----

      // Team-machine stats: key = "teamKey|machine|venue|season"
      const teamMachineAgg = new Map<string, {
        team_key: string, machine: string, venue: string | null, season: number,
        totalScore: number, gameCount: number,
        pickCount: number, pickTotalPoints: number,
        respCount: number, respTotalPoints: number,
        totalPoints: number, possiblePoints: number
      }>()

      // Player-machine stats: key = "playerName|machine|venue|season"
      const playerMachineAgg = new Map<string, {
        player_name: string, player_key: string | null, team_key: string | null,
        machine: string, venue: string | null, season: number,
        totalScore: number, gameCount: number,
        totalPoints: number, possiblePoints: number
      }>()

      // Top scores: key = "machine|venue|season" -> sorted score array
      const topScoresAgg = new Map<string, Array<{
        player_name: string, player_key: string | null, team_key: string | null,
        score: number, match_key: string, week: number, round_number: number
      }>>()

      for (const game of allHistoryGames) {
        const rawMachine = (game.machine || '').toLowerCase()
        if (!rawMachine) continue
        // Standardize machine name so aliases (e.g., "king kong" and "kong") use one key
        const machine = (machineMappings[rawMachine] || rawMachine).toLowerCase()
        // Standardize venue so name variations ("Ice Box" vs "Icebox") collapse
        // into ONE cache bucket. Readers query by getVenueVariations(), which
        // includes the canonical, so this stays matchable while removing the
        // duplicate-bucket problem that made the top-10 dialog and achievement
        // card disagree at venues with variant names.
        const venue = standardizeVenueName(game.venue) || null
        const season = game.season
        if (season == null) continue
        const machineLimit = scoreLimitsMap[machine]
        const playerCount = (game.player_1_key ? 1 : 0) + (game.player_2_key ? 1 : 0) +
          (game.player_3_key ? 1 : 0) + (game.player_4_key ? 1 : 0)
        const possiblePts = playerCount === 4 ? 2.5 : 3

        for (let i = 1; i <= 4; i++) {
          const playerKey = game[`player_${i}_key`]
          const playerName = stdName(game[`player_${i}_name`])
          const score = game[`player_${i}_score`]
          const points = game[`player_${i}_points`] || 0
          const teamKey = game[`player_${i}_team`]
          const isPick = game[`player_${i}_is_pick`]

          if (!playerKey || !playerName || !teamKey) continue

          // A score over the machine limit is a glitch: exclude it from score
          // averages (matches the live paths) but still count its points.
          const scoreCounts = score != null && !(machineLimit && score > machineLimit)

          // --- Team-machine aggregation (venue-specific + all-venues), per season ---
          for (const v of [venue, null]) {
            const tmKey = `${teamKey}|${machine}|${v || '__ALL__'}|${season}`
            if (!teamMachineAgg.has(tmKey)) {
              teamMachineAgg.set(tmKey, {
                team_key: teamKey, machine, venue: v, season,
                totalScore: 0, gameCount: 0,
                pickCount: 0, pickTotalPoints: 0,
                respCount: 0, respTotalPoints: 0,
                totalPoints: 0, possiblePoints: 0
              })
            }
            const tm = teamMachineAgg.get(tmKey)!
            if (scoreCounts) {
              tm.totalScore += score
              tm.gameCount++
            }
            tm.totalPoints += points
            tm.possiblePoints += possiblePts
            if (isPick) {
              tm.pickCount++
              tm.pickTotalPoints += points
            } else {
              tm.respCount++
              tm.respTotalPoints += points
            }
          }

          // --- Player-machine aggregation (venue-specific + all-venues), per season ---
          for (const v of [venue, null]) {
            const pmKey = `${playerName}|${machine}|${v || '__ALL__'}|${season}`
            if (!playerMachineAgg.has(pmKey)) {
              playerMachineAgg.set(pmKey, {
                player_name: playerName, player_key: playerKey, team_key: teamKey,
                machine, venue: v, season,
                totalScore: 0, gameCount: 0,
                totalPoints: 0, possiblePoints: 0
              })
            }
            const pm = playerMachineAgg.get(pmKey)!
            if (scoreCounts) {
              pm.totalScore += score
              pm.gameCount++
            }
            pm.totalPoints += points
            pm.possiblePoints += possiblePts
          }

          // --- Top scores aggregation (per machine × venue × season, plus all-venues and all-time) ---
          if (score != null && score > 0 && !(machineLimit && score > machineLimit)) {
            const scoreEntry = {
              player_name: playerName, player_key: playerKey, team_key: teamKey,
              score, match_key: game.match_key, week: game.week, round_number: game.round_number
            }
            // 4 contexts: venue+season, venue+allTime, allVenues+season, allVenues+allTime
            for (const v of [venue, null]) {
              for (const s of [season, null]) {
                const tsKey = `${machine}|${v || '__ALL__'}|${s || '__ALL__'}`
                if (!topScoresAgg.has(tsKey)) {
                  topScoresAgg.set(tsKey, [])
                }
                const arr = topScoresAgg.get(tsKey)!
                arr.push(scoreEntry)
                // Keep only top 10 to save memory
                if (arr.length > 20) {
                  arr.sort((a, b) => b.score - a.score)
                  arr.length = 10
                }
              }
            }
          }
        }
      }

      // Full-history scan succeeded, so we can safely clear every cache table
      // and repopulate from scratch (delete-all is self-healing here because
      // the scan covers all seasons). This also purges any legacy multi-season
      // rows written by older cron versions, avoiding double-counting when
      // readers sum per-season rows across a range.
      await supabase.from('cache_team_machine_stats').delete().neq('machine', '__never_match__')
      await supabase.from('cache_player_machine_stats').delete().neq('machine', '__never_match__')
      await supabase.from('cache_machine_top_scores').delete().neq('machine', '__never_match__')

      // ---- Insert cache_team_machine_stats (one row per season) ----
      const teamMachineRows: any[] = []
      for (const [, agg] of Array.from(teamMachineAgg.entries())) {
        if (agg.gameCount === 0 && agg.possiblePoints === 0) continue
        teamMachineRows.push({
          team_key: agg.team_key,
          machine: agg.machine,
          venue: agg.venue,
          season_start: agg.season,
          season_end: agg.season,
          total_score: agg.totalScore,
          game_count: agg.gameCount,
          avg_score: agg.gameCount > 0 ? Math.round(agg.totalScore / agg.gameCount) : 0,
          pick_count: agg.pickCount,
          pick_total_points: agg.pickTotalPoints,
          resp_count: agg.respCount,
          resp_total_points: agg.respTotalPoints,
          total_points: agg.totalPoints,
          possible_points: agg.possiblePoints
        })
      }
      if (teamMachineRows.length > 0) {
        const batchSz = 500
        for (let i = 0; i < teamMachineRows.length; i += batchSz) {
          const batch = teamMachineRows.slice(i, i + batchSz)
          const { error } = await supabase.from('cache_team_machine_stats').upsert(batch, {
            onConflict: 'team_key,machine,venue,season_start,season_end'
          })
          if (error) console.error('[cron/sync-data] Error inserting cache_team_machine_stats:', error.message)
        }
        cacheStats.teamMachine = teamMachineRows.length
      }

      // ---- Insert cache_player_machine_stats (one row per season) ----
      const playerMachineRows: any[] = []
      for (const [, agg] of Array.from(playerMachineAgg.entries())) {
        if (agg.gameCount === 0 && agg.possiblePoints === 0) continue
        playerMachineRows.push({
          player_name: agg.player_name,
          player_key: agg.player_key,
          team_key: agg.team_key,
          machine: agg.machine,
          venue: agg.venue,
          season_start: agg.season,
          season_end: agg.season,
          total_score: agg.totalScore,
          game_count: agg.gameCount,
          avg_score: agg.gameCount > 0 ? Math.round(agg.totalScore / agg.gameCount) : 0,
          total_points: agg.totalPoints,
          possible_points: agg.possiblePoints
        })
      }
      if (playerMachineRows.length > 0) {
        const batchSz = 500
        for (let i = 0; i < playerMachineRows.length; i += batchSz) {
          const batch = playerMachineRows.slice(i, i + batchSz)
          const { error } = await supabase.from('cache_player_machine_stats').upsert(batch, {
            onConflict: 'player_name,machine,venue,season_start,season_end'
          })
          if (error) console.error('[cron/sync-data] Error inserting cache_player_machine_stats:', error.message)
        }
        cacheStats.playerMachine = playerMachineRows.length
      }

      // ---- Insert cache_machine_top_scores ----
      const topScoreRows: any[] = []
      for (const [key, scores] of Array.from(topScoresAgg.entries())) {
        const [machine, venueStr, seasonStr] = key.split('|')
        const venue = venueStr === '__ALL__' ? null : venueStr
        const season = seasonStr === '__ALL__' ? null : parseInt(seasonStr)

        scores.sort((a: any, b: any) => b.score - a.score)
        const top10 = scores.slice(0, 10)

        for (let rank = 0; rank < top10.length; rank++) {
          const s = top10[rank]
          topScoreRows.push({
            machine,
            venue,
            season,
            rank: rank + 1,
            player_name: s.player_name,
            player_key: s.player_key,
            team_key: s.team_key,
            score: s.score,
            match_key: s.match_key,
            week: s.week,
            round_number: s.round_number
          })
        }
      }
      if (topScoreRows.length > 0) {
        const batchSz = 500
        for (let i = 0; i < topScoreRows.length; i += batchSz) {
          const batch = topScoreRows.slice(i, i + batchSz)
          const { error } = await supabase.from('cache_machine_top_scores').upsert(batch, {
            onConflict: 'machine,venue,season,rank'
          })
          if (error) console.error('[cron/sync-data] Error inserting cache_machine_top_scores:', error.message)
        }
        cacheStats.topScores = topScoreRows.length
      }

      console.log(`[cron/sync-data] Cache built: ${cacheStats.teamMachine} team-machine, ${cacheStats.playerMachine} player-machine, ${cacheStats.topScores} top-scores`)
    } catch (cacheError) {
      console.error('[cron/sync-data] Cache building error (non-fatal):', cacheError)
    }

    return NextResponse.json({
      success: true,
      seasons,
      matchesFound,
      gamesCreated,
      teamsUpdated: teamsMap.size,
      playersUpdated: playerStatsMap.size,
      standardizationsApplied,
      cacheStats
    })

  } catch (error) {
    console.error('[cron/sync-data] Error:', error)
    return NextResponse.json(
      { error: 'Sync failed', details: String(error) },
      { status: 500 }
    )
  }
}
