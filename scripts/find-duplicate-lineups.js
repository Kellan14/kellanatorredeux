// Find matches with duplicate players in lineups
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

async function findDuplicates() {
  console.log('🔍 Checking for duplicate players in lineups...\n');

  const { data: matches, error } = await supabase
    .from('matches')
    .select('id, match_key, season, week, data')
    .eq('state', 'complete')
    .order('id', { ascending: true })
    .limit(500);

  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }

  let totalIssues = 0;

  for (const match of matches) {
    const homeLineup = match.data?.home?.lineup || [];
    const awayLineup = match.data?.away?.lineup || [];

    // Check home lineup for duplicates
    const homeKeys = new Map();
    const homeDupes = [];
    homeLineup.forEach(p => {
      if (homeKeys.has(p.key)) {
        homeDupes.push(p);
      } else {
        homeKeys.set(p.key, p.name);
      }
    });

    // Check away lineup for duplicates
    const awayKeys = new Map();
    const awayDupes = [];
    awayLineup.forEach(p => {
      if (awayKeys.has(p.key)) {
        awayDupes.push(p);
      } else {
        awayKeys.set(p.key, p.name);
      }
    });

    // Check cross-team duplicates
    const crossDupes = [];
    for (const [key, name] of homeKeys) {
      if (awayKeys.has(key)) {
        crossDupes.push({ key, name });
      }
    }

    if (homeDupes.length > 0 || awayDupes.length > 0 || crossDupes.length > 0) {
      console.log(`⚠️  Match ID ${match.id}: ${match.match_key} (S${match.season} W${match.week})`);

      if (homeDupes.length > 0) {
        console.log(`   Home duplicates: ${homeDupes.map(p => p.name).join(', ')}`);
      }
      if (awayDupes.length > 0) {
        console.log(`   Away duplicates: ${awayDupes.map(p => p.name).join(', ')}`);
      }
      if (crossDupes.length > 0) {
        console.log(`   Cross-team: ${crossDupes.map(d => d.name).join(', ')}`);
      }
      console.log('');
      totalIssues++;
    }
  }

  if (totalIssues === 0) {
    console.log('✅ No duplicate issues found in first 500 matches');
  } else {
    console.log(`\n⚠️  Found ${totalIssues} matches with duplicate lineups`);
  }
}

findDuplicates().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
