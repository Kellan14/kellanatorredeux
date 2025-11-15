const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function checkPlayerData() {
  console.log('Checking data for Kellan Kirkland...\n')

  // Check player stats
  const { data: stats, error: statsError } = await supabase
    .from('player_stats')
    .select('*')
    .eq('player_name', 'Kellan Kirkland')
    .eq('season', 22)
    .single()

  console.log('Player Stats:')
  console.log(JSON.stringify(stats, null, 2))
  if (statsError) console.error('Error:', statsError)

  // Check TWC roster
  const { data: roster, error: rosterError } = await supabase
    .from('player_stats')
    .select('*')
    .eq('team', 'TWC')
    .eq('season', 22)
    .order('ipr', { ascending: false })

  console.log('\n\nTWC Roster (Season 22):')
  if (roster && roster.length > 0) {
    roster.forEach(p => {
      console.log(`  ${p.player_name}: IPR ${p.ipr}, Matches ${p.matches_played}`)
    })
  } else {
    console.log('  No roster found')
  }
  if (rosterError) console.error('Error:', rosterError)

  // Check latest TWC match
  const { data: matches, error: matchError } = await supabase
    .from('matches')
    .select('*')
    .eq('season', 22)
    .or('home_team.eq.TWC,away_team.eq.TWC')
    .order('week', { ascending: false })
    .limit(1)

  console.log('\n\nLatest TWC Match:')
  if (matches && matches.length > 0) {
    const match = matches[0]
    console.log(`  Week ${match.week}: ${match.home_team} vs ${match.away_team}`)
    console.log(`  Venue: ${match.venue_name}`)
    console.log(`  Match Key: ${match.match_key}`)
  } else {
    console.log('  No matches found')
  }
  if (matchError) console.error('Error:', matchError)

  // Check total matches for season 22
  const { count: matchCount } = await supabase
    .from('matches')
    .select('*', { count: 'exact', head: true })
    .eq('season', 22)

  console.log(`\n\nTotal Season 22 matches in database: ${matchCount}`)
}

checkPlayerData()
