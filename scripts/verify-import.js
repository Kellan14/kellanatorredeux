const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function verifyImport() {
  console.log('Verifying Supabase data import...\n')

  // Check matches count
  const { count: matchesCount, error: matchesError } = await supabase
    .from('matches')
    .select('*', { count: 'exact', head: true })

  if (matchesError) {
    console.error('Error counting matches:', matchesError)
  } else {
    console.log(`✓ Total matches imported: ${matchesCount}`)
  }

  // Check matches by season
  const { data: matchesBySeason } = await supabase
    .from('matches')
    .select('season')

  if (matchesBySeason) {
    const seasonCounts = {}
    matchesBySeason.forEach(m => {
      seasonCounts[m.season] = (seasonCounts[m.season] || 0) + 1
    })
    console.log('\nMatches by season:')
    Object.keys(seasonCounts).sort().forEach(season => {
      console.log(`  Season ${season}: ${seasonCounts[season]} matches`)
    })
  }

  // Check player stats count
  const { count: statsCount, error: statsError } = await supabase
    .from('player_stats')
    .select('*', { count: 'exact', head: true })

  if (statsError) {
    console.error('Error counting player stats:', statsError)
  } else {
    console.log(`\n✓ Total player stats records: ${statsCount}`)
  }

  // Check current season (22) player stats
  const { data: season22Stats } = await supabase
    .from('player_stats')
    .select('*')
    .eq('season', 22)
    .order('ipr', { ascending: false })
    .limit(10)

  if (season22Stats && season22Stats.length > 0) {
    console.log('\nTop 10 players in Season 22:')
    season22Stats.forEach((player, index) => {
      console.log(`  ${index + 1}. ${player.player_name} (${player.team}) - IPR: ${player.ipr} - Matches: ${player.matches_played}`)
    })
  }

  // Check for TWC team data
  const { data: twcPlayers } = await supabase
    .from('player_stats')
    .select('*')
    .eq('season', 22)
    .eq('team', 'TWC')
    .order('ipr', { ascending: false })

  if (twcPlayers && twcPlayers.length > 0) {
    console.log(`\n✓ TWC team has ${twcPlayers.length} players in Season 22`)
  }

  console.log('\n✓ Data verification complete!')
}

verifyImport()
