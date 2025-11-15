const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const SEASON = 22
const TEAM_CODES = [
  'ADB', 'BAD', 'CPO', 'CRA', 'DIH', 'DOG', 'DSV', 'DTP', 'ETB', 'FBP',
  'HHS', 'ICB', 'JMF', 'KNR', 'LAS', 'NLT', 'NMC', 'PBR', 'PGN', 'PKT',
  'POW', 'PYC', 'RMS', 'RTR', 'SCN', 'SHK', 'SKP', 'SSD', 'SSS', 'SWL',
  'TBT', 'TRL', 'TTT', 'TWC'
]

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

async function importSeason22() {
  console.log(`Starting import for Season ${SEASON}...\n`)

  let matchesImported = 0
  let matchesFailed = 0

  // Try up to 20 weeks
  for (let week = 1; week <= 20; week++) {
    console.log(`Week ${week}...`)
    let weekMatches = 0

    // Try all team combinations
    for (const homeTeam of TEAM_CODES) {
      for (const awayTeam of TEAM_CODES) {
        if (homeTeam === awayTeam) continue

        const matchData = await fetchMatchData(SEASON, week, homeTeam, awayTeam)

        if (matchData) {
          // Insert match
          const { error: matchError } = await supabase
            .from('matches')
            .upsert({
              match_key: matchData.key,
              season: SEASON,
              week: week,
              home_team: homeTeam,
              away_team: awayTeam,
              venue_name: matchData.venue?.name,
              state: matchData.state,
              data: matchData
            }, {
              onConflict: 'match_key'
            })

          if (matchError) {
            console.error(`  Error inserting match ${matchData.key}:`, matchError.message)
            matchesFailed++
          } else {
            weekMatches++
            matchesImported++
          }
        }
      }
    }

    if (weekMatches === 0) {
      console.log(`  No matches found, stopping at week ${week}`)
      break
    } else {
      console.log(`  Imported ${weekMatches} matches`)
    }
  }

  console.log(`\n✓ Import complete!`)
  console.log(`  Matches imported: ${matchesImported}`)
  console.log(`  Matches failed: ${matchesFailed}`)

  // Now calculate player stats for Season 22
  console.log(`\nCalculating player stats for Season ${SEASON}...`)

  const { data: matches } = await supabase
    .from('matches')
    .select('data')
    .eq('season', SEASON)

  const playerStats = new Map()

  for (const match of matches || []) {
    const homeLineup = match.data?.home?.lineup || []
    const awayLineup = match.data?.away?.lineup || []
    const homeTeam = match.data?.home?.key
    const awayTeam = match.data?.away?.key
    const week = match.data?.week

    // Process home team
    for (const player of homeLineup) {
      if (!playerStats.has(player.name)) {
        playerStats.set(player.name, {
          player_name: player.name,
          player_key: player.key,
          team: homeTeam,
          ipr: 0,
          matches_played: 0,
          last_match_week: 0,
          total_points: 0
        })
      }
      const stats = playerStats.get(player.name)
      if (!player.sub) {
        stats.matches_played++
        stats.last_match_week = Math.max(stats.last_match_week, week || 0)
      }
    }

    // Process away team
    for (const player of awayLineup) {
      if (!playerStats.has(player.name)) {
        playerStats.set(player.name, {
          player_name: player.name,
          player_key: player.key,
          team: awayTeam,
          ipr: 0,
          matches_played: 0,
          last_match_week: 0,
          total_points: 0
        })
      }
      const stats = playerStats.get(player.name)
      if (!player.sub) {
        stats.matches_played++
        stats.last_match_week = Math.max(stats.last_match_week, week || 0)
      }
    }

    // Process game points
    const rounds = match.data?.rounds || []
    for (const round of rounds) {
      for (const game of round.games || []) {
        for (let i = 1; i <= 4; i++) {
          const playerKey = game[`player_${i}`]
          const points = game[`points_${i}`] || 0

          for (const [name, stats] of playerStats.entries()) {
            if (stats.player_key === playerKey) {
              stats.total_points += points
            }
          }
        }
      }
    }
  }

  // Calculate IPR and save stats
  for (const [name, stats] of playerStats.entries()) {
    if (stats.matches_played > 0) {
      stats.ipr = Math.round((stats.total_points / stats.matches_played) * 100) / 100
    }

    const { error } = await supabase
      .from('player_stats')
      .upsert({
        player_name: stats.player_name,
        player_key: stats.player_key,
        season: SEASON,
        team: stats.team,
        ipr: stats.ipr,
        matches_played: stats.matches_played,
        last_match_week: stats.last_match_week
      }, {
        onConflict: 'player_name,season'
      })

    if (error) {
      console.error(`Error saving stats for ${name}:`, error.message)
    }
  }

  console.log(`✓ Player stats calculated for ${playerStats.size} players`)
}

importSeason22()
