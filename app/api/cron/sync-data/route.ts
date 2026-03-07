import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
                player_1_is_pick: player1Team === homeTeam || player1Team === awayTeam,
                player_2_key: game.player_2 || null,
                player_2_name: game.player_2 ? playerMap.get(game.player_2) : null,
                player_2_score: game.score_2 || null,
                player_2_points: game.points_2 !== undefined ? game.points_2 : null,
                player_2_team: player2Team,
                player_2_is_pick: player2Team === homeTeam || player2Team === awayTeam,
                player_3_key: game.player_3 || null,
                player_3_name: game.player_3 ? playerMap.get(game.player_3) : null,
                player_3_score: game.score_3 || null,
                player_3_points: game.points_3 !== undefined ? game.points_3 : null,
                player_3_team: player3Team,
                player_3_is_pick: player3Team === homeTeam || player3Team === awayTeam,
                player_4_key: game.player_4 || null,
                player_4_name: game.player_4 ? playerMap.get(game.player_4) : null,
                player_4_score: game.score_4 || null,
                player_4_points: game.points_4 !== undefined ? game.points_4 : null,
                player_4_team: player4Team,
                player_4_is_pick: player4Team === homeTeam || player4Team === awayTeam,
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

    return NextResponse.json({
      success: true,
      seasons,
      matchesFound,
      gamesCreated,
      teamsUpdated: teamsMap.size,
      playersUpdated: playerStatsMap.size,
      standardizationsApplied
    })

  } catch (error) {
    console.error('[cron/sync-data] Error:', error)
    return NextResponse.json(
      { error: 'Sync failed', details: String(error) },
      { status: 500 }
    )
  }
}
