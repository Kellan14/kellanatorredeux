// Unified Import Script - GitHub → Supabase (incremental)
// Discovers all seasons from GitHub, compares against Supabase, and only imports new/changed matches.
// Populates: games, teams, player_stats, player_match_participation, and matches tables.

const { createClient } = require('@supabase/supabase-js')
const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const GITHUB_BASE = 'https://raw.githubusercontent.com/Invader-Zim/mnp-data-archive/main'
const GITHUB_API_BASE = 'https://api.github.com/repos/Invader-Zim/mnp-data-archive/contents'

// Stable JSON stringify that sorts keys for consistent comparison
function stableStringify(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj)
  if (typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) {
    return '[' + obj.map(item => stableStringify(item)).join(',') + ']'
  }
  const keys = Object.keys(obj).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
}

// --- Discovery ---

// Discover all available seasons by probing the GitHub API for season-N directories
async function discoverSeasons() {
  const response = await fetch(GITHUB_API_BASE)
  if (!response.ok) throw new Error(`Failed to list repo root: ${response.status}`)
  const contents = await response.json()
  const seasons = contents
    .filter(item => item.type === 'dir' && /^season-\d+$/.test(item.name))
    .map(item => parseInt(item.name.replace('season-', '')))
    .sort((a, b) => a - b)
  return seasons
}

// List all match files for a given season from the GitHub API
async function listMatchFiles(season) {
  const url = `${GITHUB_API_BASE}/season-${season}/matches`
  const response = await fetch(url)
  if (!response.ok) return []
  const contents = await response.json()
  return contents
    .filter(item => item.name.endsWith('.json'))
    .map(item => item.name)
}

// Fetch a single match JSON from GitHub
async function fetchMatchData(season, filename) {
  const url = `${GITHUB_BASE}/season-${season}/matches/${filename}`
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

// --- Comparison ---

// Load existing match data from Supabase for a set of match_keys
// Returns a Map of match_key → JSON stringified data
async function loadExistingMatches(matchKeys) {
  const existing = new Map()
  if (matchKeys.length === 0) return existing

  // Supabase has a limit on IN clause size, batch if needed
  const batchSize = 200
  for (let i = 0; i < matchKeys.length; i += batchSize) {
    const batch = matchKeys.slice(i, i + batchSize)
    const { data, error } = await supabase
      .from('matches')
      .select('match_key, data')
      .in('match_key', batch)

    if (!error && data) {
      for (const row of data) {
        existing.set(row.match_key, stableStringify(row.data))
      }
    }
  }
  return existing
}

// --- Processing (reused from original) ---

function isPlayerPick(playerKey, homeTeam, awayTeam, homeLineup, awayLineup) {
  const isHomePlayer = homeLineup.some(p => p.key === playerKey)
  const isAwayPlayer = awayLineup.some(p => p.key === playerKey)
  if (isHomePlayer) return homeTeam
  if (isAwayPlayer) return awayTeam
  return null
}

// Process a single match into database rows
function processMatch(matchData, season, week, homeTeam, awayTeam) {
  const result = {
    match: null,
    games: [],
    participations: [],
    teams: [],
    playerStats: [] // raw data for aggregation later
  }

  // Teams
  if (matchData.home?.key && matchData.home?.name) {
    result.teams.push({ key: matchData.home.key, name: matchData.home.name })
  }
  if (matchData.away?.key && matchData.away?.name) {
    result.teams.push({ key: matchData.away.key, name: matchData.away.name })
  }

  // Match record
  result.match = {
    match_key: matchData.key,
    season,
    week,
    home_team: homeTeam,
    away_team: awayTeam,
    venue_name: matchData.venue?.name,
    state: matchData.state,
    data: matchData
  }

  const homeLineup = matchData.home?.lineup || []
  const awayLineup = matchData.away?.lineup || []

  // Player lookup
  const playerMap = new Map()
  ;[...homeLineup, ...awayLineup].forEach(p => {
    if (p.key && p.name) playerMap.set(p.key, p.name)
  })

  // Participations
  const seenPlayers = new Set()

  for (const player of homeLineup) {
    if (!player.name || player.name.toLowerCase().includes('no player')) continue
    const pk = `${matchData.key}-${player.key}`
    if (seenPlayers.has(pk)) continue
    seenPlayers.add(pk)
    result.participations.push({
      match_key: matchData.key,
      player_key: player.key,
      player_name: player.name,
      season, week,
      team: matchData.home.key,
      ipr_at_match: player.IPR || player.ipr,
      num_played: player.num_played || 0,
      is_sub: player.sub || false
    })
    result.playerStats.push({
      player_key: player.key,
      player_name: player.name,
      season,
      team: matchData.home.key,
      isSub: player.sub || false,
      week,
      points: 0 // will be summed from games
    })
  }

  for (const player of awayLineup) {
    if (!player.name || player.name.toLowerCase().includes('no player')) continue
    const pk = `${matchData.key}-${player.key}`
    if (seenPlayers.has(pk)) continue
    seenPlayers.add(pk)
    result.participations.push({
      match_key: matchData.key,
      player_key: player.key,
      player_name: player.name,
      season, week,
      team: matchData.away.key,
      ipr_at_match: player.IPR || player.ipr,
      num_played: player.num_played || 0,
      is_sub: player.sub || false
    })
    result.playerStats.push({
      player_key: player.key,
      player_name: player.name,
      season,
      team: matchData.away.key,
      isSub: player.sub || false,
      week,
      points: 0
    })
  }

  // Games
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

      result.games.push({
        match_key: matchData.key,
        season, week,
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

      // Accumulate points for player stats
      for (let i = 1; i <= 4; i++) {
        const playerKey = game[`player_${i}`]
        const points = game[`points_${i}`] || 0
        if (playerKey) {
          const playerName = playerMap.get(playerKey)
          if (playerName) {
            const entry = result.playerStats.find(
              s => s.player_name === playerName && s.season === season
            )
            if (entry) entry.points += points
          }
        }
      }
    }
  }

  return result
}

// --- Database writes ---

async function upsertInBatches(table, data, conflictKey, batchSize = 500) {
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize)
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: conflictKey })
    if (error) {
      console.error(`  Error upserting ${table} batch ${Math.floor(i / batchSize) + 1}:`, error.message)
    }
  }
}

async function insertInBatches(table, data, batchSize = 500) {
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize)
    const { error } = await supabase
      .from(table)
      .insert(batch)
    if (error) {
      console.error(`  Error inserting ${table} batch ${Math.floor(i / batchSize) + 1}:`, error.message)
    }
  }
}

async function deleteMatchData(matchKey) {
  // Delete games and participations for a match that will be re-imported
  await supabase.from('games').delete().eq('match_key', matchKey)
  await supabase.from('player_match_participation').delete().eq('match_key', matchKey)
}

// --- Main ---

async function unifiedImport() {
  // Support optional CLI args to limit to specific seasons
  const args = process.argv.slice(2)
  const forcedSeasons = args.length > 0 ? args.map(s => parseInt(s)) : null

  console.log('Discovering available seasons from GitHub...')
  const allSeasons = await discoverSeasons()
  const seasons = forcedSeasons || allSeasons
  console.log(`Found seasons: ${allSeasons.join(', ')}`)
  if (forcedSeasons) {
    console.log(`Importing only requested seasons: ${forcedSeasons.join(', ')}`)
  }
  console.log('')

  let matchesChecked = 0
  let matchesImported = 0
  let matchesSkipped = 0
  let gamesImported = 0
  const affectedMatchKeys = []

  const allTeams = new Map()
  const allPlayerStats = new Map() // "player_name-season" → aggregated stats

  for (const season of seasons) {
    console.log(`\n=== SEASON ${season} ===`)

    // List match files from GitHub
    const matchFiles = await listMatchFiles(season)
    if (matchFiles.length === 0) {
      console.log('  No match files found, skipping')
      continue
    }
    console.log(`  ${matchFiles.length} match files on GitHub`)

    // Extract match keys from filenames (e.g., "mnp-22-1-ADB-TBT.json" → "mnp-22-1-ADB-TBT")
    const matchKeys = matchFiles.map(f => f.replace('.json', ''))

    // Load existing data from Supabase for comparison
    const existingMatches = await loadExistingMatches(matchKeys)
    console.log(`  ${existingMatches.size} matches already in Supabase`)

    // Process each match file
    for (const filename of matchFiles) {
      matchesChecked++
      const matchKey = filename.replace('.json', '')

      // Parse season/week/teams from filename: mnp-{season}-{week}-{home}-{away}.json
      const parts = matchKey.split('-')
      const week = parseInt(parts[2])
      const homeTeam = parts[3]
      const awayTeam = parts[4]

      // Fetch from GitHub
      const githubData = await fetchMatchData(season, filename)
      if (!githubData) continue

      // Compare with existing using stable serialization
      const githubJson = stableStringify(githubData)
      const existingJson = existingMatches.get(matchKey)

      if (existingJson === githubJson) {
        matchesSkipped++
        // Still need to collect team/player data for stats even if we skip the import
        if (githubData.home?.key && githubData.home?.name) {
          allTeams.set(githubData.home.key, githubData.home.name)
        }
        if (githubData.away?.key && githubData.away?.name) {
          allTeams.set(githubData.away.key, githubData.away.name)
        }
        continue
      }

      // Data differs or is new - import it
      const isNew = !existingJson
      const processed = processMatch(githubData, season, week, homeTeam, awayTeam)

      // Delete old data for this match if it existed (corrections case)
      if (!isNew) {
        await deleteMatchData(matchKey)
      }

      // Upsert match record and get the match ID
      let matchId = null
      if (processed.match) {
        const { data: upsertedMatch, error: matchError } = await supabase
          .from('matches')
          .upsert(processed.match, { onConflict: 'match_key' })
          .select('id')
          .single()
        if (matchError) {
          console.error(`  Error upserting match ${matchKey}:`, matchError.message)
        } else {
          matchId = upsertedMatch?.id
        }
      }

      // Insert games (old data already deleted above for updates)
      if (processed.games.length > 0) {
        // Add match_id to games
        if (matchId) {
          for (const game of processed.games) {
            game.match_id = matchId
          }
        }
        await insertInBatches('games', processed.games)
        gamesImported += processed.games.length
      }

      // Insert participations (old data already deleted above for updates)
      if (processed.participations.length > 0) {
        // Add match_id to participations
        if (matchId) {
          for (const p of processed.participations) {
            p.match_id = matchId
          }
        }
        await insertInBatches('player_match_participation', processed.participations)
      }

      // Collect teams
      for (const t of processed.teams) {
        allTeams.set(t.key, t.name)
      }

      matchesImported++
      affectedMatchKeys.push(matchKey)
      console.log(`  ${isNew ? 'NEW' : 'UPDATED'}: ${matchKey}`)
    }

    // Collect player stats for this season from ALL matches (need full picture for aggregation)
    // We rebuild player_stats per season from the games table after import
    console.log(`  Season ${season}: ${matchFiles.length} checked, imported/updated this pass`)
  }

  // Upsert teams
  if (allTeams.size > 0) {
    console.log(`\nUpserting ${allTeams.size} teams...`)
    const teamsBatch = Array.from(allTeams.entries()).map(([key, name]) => ({
      team_key: key,
      team_name: name,
      active: true
    }))
    await upsertInBatches('teams', teamsBatch, 'team_key')
    console.log('Teams updated')
  }

  // Rebuild player_stats for any season that had changes
  // Query from games table to get accurate aggregated stats
  if (matchesImported > 0) {
    console.log('\nRebuilding player stats for affected seasons...')
    await rebuildPlayerStats(seasons)
    console.log('Player stats updated')
  }

  // Apply player name standardizations to affected matches
  if (affectedMatchKeys.length > 0) {
    await applyPlayerNameMappings(affectedMatchKeys, seasons)
  }

  console.log('\nImport complete!')
  console.log(`  Matches checked: ${matchesChecked}`)
  console.log(`  Matches imported/updated: ${matchesImported}`)
  console.log(`  Matches unchanged (skipped): ${matchesSkipped}`)
  console.log(`  Games imported: ${gamesImported}`)
  console.log(`  Teams tracked: ${allTeams.size}`)
}

// Rebuild player_stats from games + player_match_participation tables
async function rebuildPlayerStats(seasons) {
  for (const season of seasons) {
    // Get all participations for this season
    const { data: participations, error: partError } = await supabase
      .from('player_match_participation')
      .select('player_key, player_name, team, is_sub, week')
      .eq('season', season)

    if (partError || !participations || participations.length === 0) continue

    // Get all games for this season to sum points
    const { data: games, error: gamesError } = await supabase
      .from('games')
      .select('player_1_key, player_1_points, player_2_key, player_2_points, player_3_key, player_3_points, player_4_key, player_4_points')
      .eq('season', season)

    // Build points map: player_key → total_points
    const pointsMap = new Map()
    if (games) {
      for (const game of games) {
        for (let i = 1; i <= 4; i++) {
          const key = game[`player_${i}_key`]
          const pts = game[`player_${i}_points`] || 0
          if (key) {
            pointsMap.set(key, (pointsMap.get(key) || 0) + pts)
          }
        }
      }
    }

    // Aggregate by player
    const playerMap = new Map()
    for (const p of participations) {
      if (!playerMap.has(p.player_name)) {
        playerMap.set(p.player_name, {
          player_key: p.player_key,
          player_name: p.player_name,
          season,
          team: p.team,
          matches_played: 0,
          last_match_week: 0
        })
      }
      const entry = playerMap.get(p.player_name)
      if (!p.is_sub) {
        entry.matches_played++
        entry.last_match_week = Math.max(entry.last_match_week, p.week)
      }
    }

    const statsBatch = []
    for (const [, stats] of playerMap) {
      const totalPoints = pointsMap.get(stats.player_key) || 0
      const ipr = stats.matches_played > 0
        ? Math.round((totalPoints / stats.matches_played) * 100) / 100
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

    if (statsBatch.length > 0) {
      await upsertInBatches('player_stats', statsBatch, 'player_name,season')
      console.log(`  Season ${season}: ${statsBatch.length} player stats`)
    }
  }
}

// Apply player name mappings from the player_name_mappings table to affected matches
async function applyPlayerNameMappings(matchKeys, affectedSeasons) {
  // Load all mappings from the table
  const { data: mappings, error } = await supabase
    .from('player_name_mappings')
    .select('alias, canonical_name')

  if (error) {
    console.log('\nSkipping player name standardization (table may not exist yet):', error.message)
    return
  }

  if (!mappings || mappings.length === 0) {
    console.log('\nNo player name mappings configured, skipping standardization')
    return
  }

  console.log(`\nApplying ${mappings.length} player name mappings to ${matchKeys.length} affected matches...`)

  let totalUpdated = 0

  // Process in batches of match keys to avoid query size limits
  const keyBatchSize = 200

  for (const mapping of mappings) {
    const { alias, canonical_name } = mapping
    let mappingTotal = 0

    for (let i = 0; i < matchKeys.length; i += keyBatchSize) {
      const keyBatch = matchKeys.slice(i, i + keyBatchSize)

      // Update player_match_participation
      const { data: pmpData } = await supabase
        .from('player_match_participation')
        .update({ player_name: canonical_name })
        .eq('player_name', alias)
        .in('match_key', keyBatch)
        .select('id')
      mappingTotal += pmpData?.length || 0

      // Update games - all 4 player positions
      for (const col of ['player_1_name', 'player_2_name', 'player_3_name', 'player_4_name']) {
        const { data: gData } = await supabase
          .from('games')
          .update({ [col]: canonical_name })
          .eq(col, alias)
          .in('match_key', keyBatch)
          .select('id')
        mappingTotal += gData?.length || 0
      }
    }

    // Update player_stats for affected seasons
    const uniqueSeasons = [...new Set(affectedSeasons)]
    for (const season of uniqueSeasons) {
      const { data: psData } = await supabase
        .from('player_stats')
        .update({ player_name: canonical_name })
        .eq('player_name', alias)
        .eq('season', season)
        .select('id')
      mappingTotal += psData?.length || 0
    }

    if (mappingTotal > 0) {
      console.log(`  "${alias}" → "${canonical_name}": ${mappingTotal} records`)
      totalUpdated += mappingTotal

      // Log to player_name_update_log
      await supabase
        .from('player_name_update_log')
        .insert({
          old_name: alias,
          new_name: canonical_name,
          records_updated: mappingTotal
        })
    }
  }

  if (totalUpdated > 0) {
    console.log(`Player name standardization: ${totalUpdated} total records updated`)
  } else {
    console.log('No player name changes needed for imported data')
  }
}

unifiedImport()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\nImport failed:', err)
    process.exit(1)
  })
