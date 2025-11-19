#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSeason22Venues() {
  console.log('Checking venues in player_stats for season 22...\n');

  // Fetch distinct venues from player_stats for season 22
  const { data, error } = await supabase
    .from('player_stats')
    .select('venue')
    .eq('season', 22)
    .limit(1000);

  if (error) {
    console.error('Error fetching player_stats:', error);
    return;
  }

  // Get unique venues
  const venueSet = new Set();
  if (data) {
    data.forEach(stat => {
      if (stat.venue) {
        venueSet.add(stat.venue);
      }
    });
  }

  console.log(`Total player_stats records for season 22: ${data.length}`);
  console.log(`Unique venues: ${venueSet.size}\n`);

  if (venueSet.size > 0) {
    console.log('Venue names:');
    Array.from(venueSet).sort().forEach(v => console.log(`  - ${v}`));
  } else {
    console.log('No venues found in player_stats for season 22');
  }
}

checkSeason22Venues()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
