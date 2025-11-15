// Diagnose match data structure to verify migration logic
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose() {
  console.log('📊 Fetching sample matches...\n');

  const { data: matches, error } = await supabase
    .from('matches')
    .select('id, match_key, season, week, venue_name, data')
    .eq('state', 'complete')
    .eq('season', 22)
    .limit(3);

  if (error || !matches || matches.length === 0) {
    console.error('❌ Error fetching matches:', error);
    process.exit(1);
  }

  for (const match of matches) {
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Match ${match.match_key} (Season ${match.season}, Week ${match.week})`);
    console.log('═══════════════════════════════════════════════════════\n');

    // Check home lineup
    const homeLineup = match.data?.home?.lineup || [];
    console.log(`Home Team: ${match.data?.home?.name} (${match.data?.home?.key})`);
    console.log(`Home Lineup (${homeLineup.length} players):`);

    // Check for duplicates in home lineup
    const homeKeys = new Set();
    const homeDupes = [];
    homeLineup.forEach(p => {
      console.log(`  - ${p.name} (${p.key?.substring(0, 8)}...) IPR:${p.IPR || p.ipr} played:${p.num_played} sub:${p.sub || false}`);
      if (homeKeys.has(p.key)) {
        homeDupes.push(p.key);
      }
      homeKeys.add(p.key);
    });
    if (homeDupes.length > 0) {
      console.log(`  ⚠️  DUPLICATES FOUND: ${homeDupes.length} duplicate keys`);
    }
    console.log('');

    // Check away lineup
    const awayLineup = match.data?.away?.lineup || [];
    console.log(`Away Team: ${match.data?.away?.name} (${match.data?.away?.key})`);
    console.log(`Away Lineup (${awayLineup.length} players):`);

    const awayKeys = new Set();
    const awayDupes = [];
    awayLineup.forEach(p => {
      console.log(`  - ${p.name} (${p.key?.substring(0, 8)}...) IPR:${p.IPR || p.ipr} played:${p.num_played} sub:${p.sub || false}`);
      if (awayKeys.has(p.key)) {
        awayDupes.push(p.key);
      }
      awayKeys.add(p.key);
    });
    if (awayDupes.length > 0) {
      console.log(`  ⚠️  DUPLICATES FOUND: ${awayDupes.length} duplicate keys`);
    }
    console.log('');

    // Check for cross-team duplicates
    const crossDupes = [...homeKeys].filter(k => awayKeys.has(k));
    if (crossDupes.length > 0) {
      console.log(`⚠️  CROSS-TEAM DUPLICATES: ${crossDupes.length} players in BOTH lineups!`);
      console.log('');
    }

    // Check games structure
    const rounds = match.data?.rounds || [];
    console.log(`Rounds: ${rounds.length}`);
    let totalGames = 0;
    rounds.forEach(round => {
      const games = round.games || [];
      totalGames += games.length;
      console.log(`  Round ${round.n}: ${games.length} games`);

      // Show first game as example
      if (games.length > 0) {
        const g = games[0];
        console.log(`    Example: ${g.machine}`);
        console.log(`      P1: ${g.player_1?.substring(0, 8)}... = ${g.score_1} (${g.points_1}pts)`);
        console.log(`      P2: ${g.player_2?.substring(0, 8)}... = ${g.score_2} (${g.points_2}pts)`);
        if (g.player_3) {
          console.log(`      P3: ${g.player_3?.substring(0, 8)}... = ${g.score_3} (${g.points_3}pts)`);
        }
        if (g.player_4) {
          console.log(`      P4: ${g.player_4?.substring(0, 8)}... = ${g.score_4} (${g.points_4}pts)`);
        }
      }
    });
    console.log(`Total games: ${totalGames}\n`);
  }

  console.log('\n✅ Diagnosis complete');
}

diagnose().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
