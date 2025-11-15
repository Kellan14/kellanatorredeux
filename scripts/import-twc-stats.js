const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

// Load .env.local
const envPath = path.join(__dirname, '..', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf-8')
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/)
  if (match) {
    process.env[match[1]] = match[2]
  }
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const CURRENT_SEASON = 22
const TEAM = 'TWC'

async function importTWCStats() {
  console.log(`Importing TWC player stats for Season ${CURRENT_SEASON}...\n`)

  // Delete existing TWC season 22 stats
  const { error: deleteError } = await supabase
    .from('player_stats')
    .delete()
    .eq('season', CURRENT_SEASON)
    .eq('team', TEAM)

  if (deleteError) {
    console.error('Error deleting old stats:', deleteError)
    return
  }

  console.log('✓ Cleared old TWC stats\n')

  // Get all TWC matches for current season, ordered by week
  const { data: matches, error: matchError } = await supabase
    .from('matches')
    .select('data, week')
    .eq('season', CURRENT_SEASON)
    .or(`home_team.eq.${TEAM},away_team.eq.${TEAM}`)
    .order('week', { ascending: true })

  if (matchError) {
    console.error('Error fetching matches:', matchError)
    return
  }

  console.log(`Found ${matches.length} TWC matches in Season ${CURRENT_SEASON}`)

  // Track each player's data from their most recent match
  const playerStatsMap = new Map()

  for (const match of matches || []) {
    const week = match.week

    // Check home team
    if (match.data?.home?.key === TEAM && match.data?.home?.lineup) {
      for (const player of match.data.home.lineup) {
        const key = player.name
        // Always update (since matches are ordered by week, last one wins)
        playerStatsMap.set(key, {
          player_name: player.name,
          player_key: player.key,
          season: CURRENT_SEASON,
          team: TEAM,
          ipr: player.IPR || 0,
          matches_played: player.num_played || 0,
          last_match_week: week
        })
      }
    }

    // Check away team
    if (match.data?.away?.key === TEAM && match.data?.away?.lineup) {
      for (const player of match.data.away.lineup) {
        const key = player.name
        // Always update (since matches are ordered by week, last one wins)
        playerStatsMap.set(key, {
          player_name: player.name,
          player_key: player.key,
          season: CURRENT_SEASON,
          team: TEAM,
          ipr: player.IPR || 0,
          matches_played: player.num_played || 0,
          last_match_week: week
        })
      }
    }
  }

  console.log(`\nFound ${playerStatsMap.size} TWC players`)
  console.log('Inserting player stats...\n')

  // Insert all player stats
  let inserted = 0
  for (const [name, stats] of playerStatsMap.entries()) {
    const { error } = await supabase
      .from('player_stats')
      .insert(stats)

    if (error) {
      console.error(`Error inserting ${name}:`, error.message)
    } else {
      console.log(`  ✓ ${name}: IPR ${stats.ipr}, Matches ${stats.matches_played}, Last Week ${stats.last_match_week}`)
      inserted++
    }
  }

  console.log(`\n✓ Import complete!`)
  console.log(`  Inserted: ${inserted} TWC players`)
}

importTWCStats()
