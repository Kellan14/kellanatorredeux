// Import MNP data from GitHub into Supabase
// Run this ONCE to populate the database

const { createClient } = require('@supabase/supabase-js')

const GITHUB_BASE = 'https://raw.githubusercontent.com/Invader-Zim/mnp-data-archive/main'
const SEASONS = [14, 15, 16, 17, 18, 19, 20, 21, 22] // Import all seasons
const TEAM_CODES = [
  'ADB', 'BAD', 'CPO', 'CRA', 'DIH', 'DOG', 'DSV', 'DTP', 'ETB', 'FBP',
  'HHS', 'ICB', 'JMF', 'KNR', 'LAS', 'NLT', 'NMC', 'PBR', 'PGN', 'PKT',
  'POW', 'PYC', 'RMS', 'RTR', 'SCN', 'SHK', 'SKP', 'SSD', 'SSS', 'SWL',
  'TBT', 'TRL', 'TTT', 'TWC'
]

// Create Supabase client with service role key for write access
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: Missing Supabase credentials')
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function fetchMatchData(season, week, homeTeam, awayTeam) {
  const url = `${GITHUB_BASE}/season-${season}/matches/mnp-${season}-${week}-${homeTeam}-${awayTeam}.json`

  try {
    const response = await fetch(url)
    if (!response.ok) return null
    return await response.json()
  } catch (error) {
    return null
  }
}

async function importMatches() {
  console.log(`Starting import for all seasons...`)

  let totalMatchCount = 0
  let playerStatsMap = new Map() // Track unique players across all seasons

  // Loop through all seasons
  for (const season of SEASONS) {
    console.log(`\n=== SEASON ${season} ===`)
    let seasonMatchCount = 0

    // Try all weeks and team combinations (up to 13 weeks per season)
    for (let week = 1; week <= 13; week++) {
      console.log(`Processing Season ${season} Week ${week}...`)

      for (let i = 0; i < TEAM_CODES.length; i++) {
        for (let j = 0; j < TEAM_CODES.length; j++) {
          if (i === j) continue

          const homeTeam = TEAM_CODES[i]
          const awayTeam = TEAM_CODES[j]

          const matchData = await fetchMatchData(season, week, homeTeam, awayTeam)

        if (matchData) {
          console.log(`  Found: ${matchData.key}`)

          // Insert match into database
          const { error: matchError } = await supabase
            .from('matches')
            .upsert({
              match_key: matchData.key,
              season: season,
              week: week,
              home_team: matchData.home?.key || homeTeam,
              away_team: matchData.away?.key || awayTeam,
              venue_name: matchData.venue?.name,
              state: matchData.state,
              data: matchData
            }, {
              onConflict: 'match_key'
            })

          if (matchError) {
            console.error(`    Error inserting match: ${matchError.message}`)
          } else {
            seasonMatchCount++
            totalMatchCount++
          }

          // Extract player stats from home team
          if (matchData.home?.lineup) {
            for (const player of matchData.home.lineup) {
              const key = `${player.name}-${season}`
              if (!playerStatsMap.has(key) || week > (playerStatsMap.get(key).last_match_week || 0)) {
                playerStatsMap.set(key, {
                  player_name: player.name,
                  player_key: player.key,
                  season: season,
                  team: matchData.home.key,
                  ipr: player.IPR || 0,
                  matches_played: player.num_played || 0,
                  last_match_week: week
                })
              }
            }
          }

          // Extract player stats from away team
          if (matchData.away?.lineup) {
            for (const player of matchData.away.lineup) {
              const key = `${player.name}-${season}`
              if (!playerStatsMap.has(key) || week > (playerStatsMap.get(key).last_match_week || 0)) {
                playerStatsMap.set(key, {
                  player_name: player.name,
                  player_key: player.key,
                  season: season,
                  team: matchData.away.key,
                  ipr: player.IPR || 0,
                  matches_played: player.num_played || 0,
                  last_match_week: week
                })
              }
            }
          }
        }
      }
    }
  }

    console.log(`Season ${season}: Imported ${seasonMatchCount} matches`)
  }

  console.log(`\n=== TOTAL: Imported ${totalMatchCount} matches across all seasons ===`)

  // Import player stats
  console.log(`\nImporting player stats for ${playerStatsMap.size} players...`)
  const playerStats = Array.from(playerStatsMap.values())

  for (const stats of playerStats) {
    const { error: playerError } = await supabase
      .from('player_stats')
      .upsert(stats, {
        onConflict: 'player_name,season'
      })

    if (playerError) {
      console.error(`Error inserting player ${stats.player_name}: ${playerError.message}`)
    }
  }

  console.log('\n=== Import complete! ===')
  console.log(`Total matches: ${totalMatchCount}`)
  console.log(`Total players (across all seasons): ${playerStatsMap.size}`)
  console.log(`Seasons imported: ${SEASONS.join(', ')}`)
}

// Run the import
importMatches()
  .then(() => {
    console.log('\nDone!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Import failed:', error)
    process.exit(1)
  })
