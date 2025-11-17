// Check if matches table has week 11 data for season 22
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkWeek11Data() {
  console.log('Checking matches table for season 22 data...\n')

  // Get all matches for season 22
  const { data: allMatches, error: allError } = await supabase
    .from('matches')
    .select('match_key, week, home_team, away_team, state')
    .eq('season', 22)
    .order('week', { ascending: true })

  if (allError) {
    console.error('Error querying matches:', allError)
    return
  }

  console.log(`Total matches in season 22: ${allMatches?.length || 0}`)

  if (allMatches && allMatches.length > 0) {
    const weeks = [...new Set(allMatches.map(m => m.week))].sort((a, b) => a - b)
    console.log(`Weeks present: ${weeks.join(', ')}`)

    const twcMatches = allMatches.filter(m =>
      m.home_team === 'TWC' || m.away_team === 'TWC'
    )
    console.log(`\nTWC matches found: ${twcMatches.length}`)

    for (const match of twcMatches) {
      const opponent = match.home_team === 'TWC' ? match.away_team : match.home_team
      console.log(`  Week ${match.week}: TWC vs ${opponent} (${match.state})`)
    }

    // Check specifically for week 11
    const week11Matches = allMatches.filter(m => m.week === 11)
    console.log(`\nWeek 11 matches: ${week11Matches.length}`)

    const week11TWC = week11Matches.filter(m =>
      m.home_team === 'TWC' || m.away_team === 'TWC'
    )

    if (week11TWC.length > 0) {
      console.log('✓ Week 11 TWC match found in matches table')
      for (const match of week11TWC) {
        const opponent = match.home_team === 'TWC' ? match.away_team : match.home_team
        console.log(`  ${match.match_key}: TWC vs ${opponent} (${match.state})`)
      }
    } else {
      console.log('✗ Week 11 TWC match NOT found in matches table')
    }
  } else {
    console.log('No matches found for season 22')
  }

  // Also check games table for comparison
  console.log('\n--- Checking games table for comparison ---')
  const { data: gamesData, error: gamesError } = await supabase
    .from('games')
    .select('week')
    .eq('season', 22)
    .or('home_team.eq.TWC,away_team.eq.TWC')
    .order('week', { ascending: true })

  if (!gamesError && gamesData) {
    const gameWeeks = [...new Set(gamesData.map(g => g.week))].sort((a, b) => a - b)
    console.log(`Weeks in games table for TWC: ${gameWeeks.join(', ')}`)
    console.log(`Latest week in games: ${Math.max(...gameWeeks)}`)
  }
}

checkWeek11Data()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err)
    process.exit(1)
  })
