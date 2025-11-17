// Unified Import Script - GitHub → Supabase (all tables)
// Fetches data from GitHub and populates games, teams, player_stats, player_match_participation, and matches tables
// This replaces the 3-step process: import → migrate → add-columns

const { createClient } = require('@supabase/supabase-js')
const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Support importing specific seasons or all seasons
// Usage: node unified-import.js [season1] [season2] ...
// Example: node unified-import.js 22 (imports only season 22)
// Or: node unified-import.js (imports ALL seasons 14-22)
const args = process.argv.slice(2)
const SEASONS = args.length > 0 ? args.map(s => parseInt(s)) : [14, 15, 16, 17, 18, 19, 20, 21, 22]

const TEAM_CODES = [
  'ADB', 'BAD', 'CPO', 'CRA', 'DIH', 'DOG', 'DSV', 'DTP', 'ETB', 'FBP',
  'HHS', 'ICB', 'JMF', 'KNR', 'LAS', 'NLT', 'NMC', 'PBR', 'PGN', 'PKT',
  'POW', 'PYC', 'RMS', 'RTR', 'SCN', 'SHK', 'SKP', 'SSD', 'SSS', 'SWL',
  'TBT', 'TRL', 'TTT', 'TWC'
]

// Fetch match data from GitHub
async function fetchMatchData(season, week, homeTeam, awayTeam) {
  const url = `https://raw.githubusercontent.com/Invader-Zim/mnp-data-archive/main/season-${season}/matches/mnp-${season}-${week}-${homeTeam}-${awayTeam}.json`

  try {
    const response = await fetch(url)
    if (!response.ok) return null
    return await response.json()
  } catch (error) {
    return null
  }
}

// Calculate if a player is a "pick" (playing for their own team)
function isPlayerPick(playerKey, homeTeam, awayTeam, homeLineup, awayLineup) {
  // Find which team this player belongs to in the lineups
  const isHomePlayer = homeLineup.some(p => p.key === playerKey)
  const isAwayPlayer = awayLineup.some(p => p.key === playerKey)

  if (isHomePlayer) return homeTeam
  if (isAwayPlayer) return awayTeam
  return null
}

async function unifiedImport() {
  console.log(`🚀 Starting Unified Import for Seasons: ${SEASONS.join(', ')}\n`)
  console.log('📋 This will:')
  console.log('   1. Fetch all matches from GitHub')
  console.log('   2. Clear and rebuild: games, player_match_participation')
  console.log('   3. Update: matches, teams, player_stats')
  console.log('')

  // Step 1: Clear tables that will be fully rebuilt
  console.log('🗑️  Clearing games and player_match_participation tables...')
  await supabase.from('games').delete().neq('id', 0)
  await supabase.from('player_match_participation').delete().neq('id', 0)
  console.log('✓ Cleared\n')

  // Track data for batch inserts
  const matchesBatch = []
  const gamesBatch = []
  const participationsBatch = []
  const teamsMap = new Map() // team_key → team_name
  const playerStatsMap = new Map() // "player_name-season" → stats object

  let matchesFound = 0
  let gamesCreated = 0
  let participationsCreated = 0

  // Step 2: Fetch matches from GitHub for all seasons
  console.log('📥 Fetching matches from GitHub...\n')

  for (const season of SEASONS) {
    console.log(`\n=== SEASON ${season} ===`)

    for (let week = 1; week <= 20; week++) {
      console.log(`Week ${week}...`)
      let weekMatches = 0

      for (const homeTeam of TEAM_CODES) {
        for (const awayTeam of TEAM_CODES) {
          if (homeTeam === awayTeam) continue

          const matchData = await fetchMatchData(season, week, homeTeam, awayTeam)
        if (!matchData) continue

        weekMatches++
        matchesFound++

        // Track teams
        if (matchData.home?.key && matchData.home?.name) {
          teamsMap.set(matchData.home.key, matchData.home.name)
        }
        if (matchData.away?.key && matchData.away?.name) {
          teamsMap.set(matchData.away.key, matchData.away.name)
        }

        // Store match for matches table (backup/reference)
        matchesBatch.push({
          match_key: matchData.key,
          season: season,
          week: week,
          home_team: homeTeam,
          away_team: awayTeam,
          venue_name: matchData.venue?.name,
          state: matchData.state,
          data: matchData
        })

        const homeLineup = matchData.home?.lineup || []
        const awayLineup = matchData.away?.lineup || []

        // Create player lookup map
        const playerMap = new Map()
        const allPlayers = [...homeLineup, ...awayLineup]
        allPlayers.forEach(p => {
          if (p.key && p.name) {
            playerMap.set(p.key, p.name)
          }
        })

        // Track player participation
        const seenPlayers = new Set()

        for (const player of homeLineup) {
          if (!player.name || player.name.toLowerCase().includes('no player')) continue

          const participationKey = `${matchData.key}-${player.key}`
          if (!seenPlayers.has(participationKey)) {
            participationsBatch.push({
              match_key: matchData.key,
              player_key: player.key,
              player_name: player.name,
              season: season,
              week: week,
              team: matchData.home.key,
              ipr_at_match: player.IPR || player.ipr,
              num_played: player.num_played || 0,
              is_sub: player.sub || false
            })
            seenPlayers.add(participationKey)
            participationsCreated++
          }

          // Track player stats (per season)
          const statsKey = `${player.name}-${season}`
          if (!playerStatsMap.has(statsKey)) {
            playerStatsMap.set(statsKey, {
              player_key: player.key,
              player_name: player.name,
              season: season,
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
              season: season,
              week: week,
              team: matchData.away.key,
              ipr_at_match: player.IPR || player.ipr,
              num_played: player.num_played || 0,
              is_sub: player.sub || false
            })
            seenPlayers.add(participationKey)
            participationsCreated++
          }

          // Track player stats (per season)
          const statsKey = `${player.name}-${season}`
          if (!playerStatsMap.has(statsKey)) {
            playerStatsMap.set(statsKey, {
              player_key: player.key,
              player_name: player.name,
              season: season,
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
            if (!game.machine) continue // Skip incomplete games

            // Determine team for each player
            const player1Team = isPlayerPick(game.player_1, homeTeam, awayTeam, homeLineup, awayLineup)
            const player2Team = isPlayerPick(game.player_2, homeTeam, awayTeam, homeLineup, awayLineup)
            const player3Team = isPlayerPick(game.player_3, homeTeam, awayTeam, homeLineup, awayLineup)
            const player4Team = isPlayerPick(game.player_4, homeTeam, awayTeam, homeLineup, awayLineup)

            gamesBatch.push({
              match_key: matchData.key,
              season: season,
              week: week,
              venue: matchData.venue?.name,
              round_number: roundNumber,
              game_number: gameNumber,
              machine: game.machine,

              // Player 1
              player_1_key: game.player_1 || null,
              player_1_name: game.player_1 ? playerMap.get(game.player_1) : null,
              player_1_score: game.score_1 || null,
              player_1_points: game.points_1 !== undefined ? game.points_1 : null,
              player_1_team: player1Team,
              player_1_is_pick: player1Team === homeTeam || player1Team === awayTeam,

              // Player 2
              player_2_key: game.player_2 || null,
              player_2_name: game.player_2 ? playerMap.get(game.player_2) : null,
              player_2_score: game.score_2 || null,
              player_2_points: game.points_2 !== undefined ? game.points_2 : null,
              player_2_team: player2Team,
              player_2_is_pick: player2Team === homeTeam || player2Team === awayTeam,

              // Player 3
              player_3_key: game.player_3 || null,
              player_3_name: game.player_3 ? playerMap.get(game.player_3) : null,
              player_3_score: game.score_3 || null,
              player_3_points: game.points_3 !== undefined ? game.points_3 : null,
              player_3_team: player3Team,
              player_3_is_pick: player3Team === homeTeam || player3Team === awayTeam,

              // Player 4
              player_4_key: game.player_4 || null,
              player_4_name: game.player_4 ? playerMap.get(game.player_4) : null,
              player_4_score: game.score_4 || null,
              player_4_points: game.points_4 !== undefined ? game.points_4 : null,
              player_4_team: player4Team,
              player_4_is_pick: player4Team === homeTeam || player4Team === awayTeam,

              // Team data
              home_team: homeTeam,
              away_team: awayTeam,
              home_points: game.home_points !== undefined ? game.home_points : null,
              away_points: game.away_points !== undefined ? game.away_points : null
            })

            gamesCreated++

            // Track points for player stats
            for (let i = 1; i <= 4; i++) {
              const playerKey = game[`player_${i}`]
              const points = game[`points_${i}`] || 0

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

    if (weekMatches === 0) {
      console.log(`  No matches found, stopping at week ${week}`)
      break
    } else {
      console.log(`  Found ${weekMatches} matches`)
    }
  }
  } // End of season loop

  // Step 3: Insert all data
  console.log(`\n💾 Inserting data into database...\n`)

  // Insert matches (backup/reference)
  if (matchesBatch.length > 0) {
    console.log(`Inserting ${matchesBatch.length} matches...`)
    const { error } = await supabase
      .from('matches')
      .upsert(matchesBatch, { onConflict: 'match_key' })

    if (error) {
      console.error('❌ Error inserting matches:', error.message)
    } else {
      console.log('✓ Matches inserted')
    }
  }

  // Insert games (in batches to avoid memory issues)
  if (gamesBatch.length > 0) {
    console.log(`Inserting ${gamesBatch.length} games...`)
    const batchSize = 500
    for (let i = 0; i < gamesBatch.length; i += batchSize) {
      const batch = gamesBatch.slice(i, i + batchSize)
      const { error } = await supabase.from('games').insert(batch)

      if (error) {
        console.error(`❌ Error inserting games batch ${i / batchSize + 1}:`, error.message)
      } else {
        console.log(`  ✓ Batch ${i / batchSize + 1}/${Math.ceil(gamesBatch.length / batchSize)}`)
      }
    }
    console.log('✓ Games inserted')
  }

  // Insert player participations
  if (participationsBatch.length > 0) {
    console.log(`Inserting ${participationsBatch.length} player participations...`)
    const batchSize = 500
    for (let i = 0; i < participationsBatch.length; i += batchSize) {
      const batch = participationsBatch.slice(i, i + batchSize)
      const { error } = await supabase
        .from('player_match_participation')
        .upsert(batch, { onConflict: 'match_key,player_key' })

      if (error) {
        console.error(`❌ Error inserting participations batch ${i / batchSize + 1}:`, error.message)
      } else {
        console.log(`  ✓ Batch ${i / batchSize + 1}/${Math.ceil(participationsBatch.length / batchSize)}`)
      }
    }
    console.log('✓ Participations inserted')
  }

  // Insert/update teams
  if (teamsMap.size > 0) {
    console.log(`Upserting ${teamsMap.size} teams...`)
    const teamsBatch = Array.from(teamsMap.entries()).map(([key, name]) => ({
      team_key: key,
      team_name: name,
      active: true
    }))

    const { error } = await supabase
      .from('teams')
      .upsert(teamsBatch, { onConflict: 'team_key' })

    if (error) {
      console.error('❌ Error upserting teams:', error.message)
    } else {
      console.log('✓ Teams upserted')
    }
  }

  // Calculate IPR and insert player stats
  if (playerStatsMap.size > 0) {
    console.log(`Calculating and inserting stats for ${playerStatsMap.size} players...`)

    const statsBatch = []
    for (const [name, stats] of playerStatsMap.entries()) {
      const ipr = stats.matches_played > 0
        ? Math.round((stats.total_points / stats.matches_played) * 100) / 100
        : 0

      statsBatch.push({
        player_name: stats.player_name,
        player_key: stats.player_key,
        season: stats.season,
        team: stats.team,
        ipr: ipr,
        matches_played: stats.matches_played,
        last_match_week: stats.last_match_week
      })
    }

    const { error } = await supabase
      .from('player_stats')
      .upsert(statsBatch, { onConflict: 'player_name,season' })

    if (error) {
      console.error('❌ Error upserting player stats:', error.message)
    } else {
      console.log('✓ Player stats inserted')
    }
  }

  console.log('\n✅ Unified Import Complete!\n')
  console.log('📊 Summary:')
  console.log(`   Matches found: ${matchesFound}`)
  console.log(`   Games created: ${gamesCreated}`)
  console.log(`   Player participations: ${participationsCreated}`)
  console.log(`   Teams tracked: ${teamsMap.size}`)
  console.log(`   Players tracked: ${playerStatsMap.size}`)
  console.log('\n🎯 All tables updated with latest data from GitHub!')
}

unifiedImport()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ Import failed:', err)
    process.exit(1)
  })
