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

async function fixPlayerStats() {
  console.log('Deleting all player_stats records...')

  const { error: deleteError } = await supabase
    .from('player_stats')
    .delete()
    .neq('id', 0) // Delete all records

  if (deleteError) {
    console.error('Error deleting:', deleteError)
    return
  }

  console.log('✓ Deleted all player_stats records\n')
  console.log('Recalculating player stats from matches...\n')

  // Get all matches ordered by week ascending (so highest week is processed last)
  const { data: matches, error: matchError } = await supabase
    .from('matches')
    .select('data, season, week')
    .order('season', { ascending: true })
    .order('week', { ascending: true })

  if (matchError) {
    console.error('Error fetching matches:', matchError)
    return
  }

  const playerStatsMap = new Map()

  for (const match of matches || []) {
    const season = match.season
    const week = match.week

    // Process home team
    if (match.data?.home?.lineup) {
      for (const player of match.data.home.lineup) {
        const key = `${player.name}-${season}`
        if (!playerStatsMap.has(key) || week > (playerStatsMap.get(key).last_match_week || 0)) {
          playerStatsMap.set(key, {
            player_name: player.name,
            player_key: player.key,
            season: season,
            team: match.data.home.key, // Use team KEY not name
            ipr: player.IPR || 0,
            matches_played: player.num_played || 0,
            last_match_week: week
          })
        }
      }
    }

    // Process away team
    if (match.data?.away?.lineup) {
      for (const player of match.data.away.lineup) {
        const key = `${player.name}-${season}`
        if (!playerStatsMap.has(key) || week > (playerStatsMap.get(key).last_match_week || 0)) {
          playerStatsMap.set(key, {
            player_name: player.name,
            player_key: player.key,
            season: season,
            team: match.data.away.key, // Use team KEY not name
            ipr: player.IPR || 0,
            matches_played: player.num_played || 0,
            last_match_week: week
          })
        }
      }
    }
  }

  console.log(`Found ${playerStatsMap.size} unique players across all seasons`)
  console.log('Inserting player stats...\n')

  let inserted = 0
  let errors = 0

  for (const [key, stats] of playerStatsMap.entries()) {
    const { error } = await supabase
      .from('player_stats')
      .insert(stats)

    if (error) {
      console.error(`Error inserting ${key}:`, error.message)
      errors++
    } else {
      inserted++
      if (inserted % 100 === 0) {
        console.log(`  Inserted ${inserted} records...`)
      }
    }
  }

  console.log(`\n✓ Complete!`)
  console.log(`  Inserted: ${inserted}`)
  console.log(`  Errors: ${errors}`)
}

fixPlayerStats()
