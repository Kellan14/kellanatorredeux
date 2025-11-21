#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function checkFishTales() {
  console.log('=== Checking Fish Tales machine data in database ===\n');

  // Check for various Fish Tales name variations
  const variations = ['Fish Tales', 'fish tales', 'FishTales', 'fishtales', 'Fish tales'];

  for (const variant of variations) {
    const { data, error } = await supabase
      .from('games')
      .select('machine, venue, season', { count: 'exact' })
      .ilike('machine', variant);

    if (data && data.length > 0) {
      console.log(`Games with machine="${variant}" (case-insensitive):`, data.length);
      const venues = [...new Set(data.map(g => g.venue))];
      console.log('Venues:', venues.join(', '));
      console.log('Sample games:');
      data.slice(0, 5).forEach(g => console.log(`  ${g.machine} at ${g.venue} (Season ${g.season})`));
      console.log('');
    }
  }

  // Also check for any machine containing "fish"
  const { data: fishGames } = await supabase
    .from('games')
    .select('machine, venue, season')
    .ilike('machine', '%fish%');

  if (fishGames && fishGames.length > 0) {
    const uniqueMachines = [...new Set(fishGames.map(g => g.machine))];
    console.log('\nAll machines containing "fish":', uniqueMachines.join(', '));
  }
}

checkFishTales().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
