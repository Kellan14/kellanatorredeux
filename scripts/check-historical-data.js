#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkHistoricalData() {
  console.log('=== Checking Historical Data ===\n');

  // Check games count by season with pagination
  const allGames = [];
  let offset = 0;
  const limit = 1000;
  let hasMore = true;

  while (hasMore && offset < 30000) {
    const { data, error } = await supabase
      .from('games')
      .select('season, venue')
      .order('season', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error:', error);
      break;
    }

    if (data && data.length > 0) {
      allGames.push(...data);
      offset += limit;
      hasMore = data.length === limit;
    } else {
      hasMore = false;
    }
  }

  console.log(`Total games fetched: ${allGames.length}\n`);

  // Count by season
  const seasonCounts = {};
  const seasonVenues = {};

  allGames.forEach(g => {
    seasonCounts[g.season] = (seasonCounts[g.season] || 0) + 1;
    if (!seasonVenues[g.season]) seasonVenues[g.season] = new Set();
    if (g.venue) seasonVenues[g.season].add(g.venue);
  });

  console.log('Games by season:');
  Object.keys(seasonCounts).sort((a,b) => parseInt(a) - parseInt(b)).forEach(s => {
    const venues = seasonVenues[s] ? Array.from(seasonVenues[s]).sort() : [];
    console.log(`  Season ${s}: ${seasonCounts[s]} games`);
    if (venues.length <= 5) {
      console.log(`    Venues: ${venues.join(', ')}`);
    } else {
      console.log(`    Venues (${venues.length}): ${venues.slice(0, 3).join(', ')}...`);
    }
  });

  // Check for Flip Flip Ding Ding
  const flipFlipGames = allGames.filter(g =>
    g.venue && g.venue.toLowerCase().includes('flip')
  );

  console.log(`\nFlip Flip Ding Ding games found: ${flipFlipGames.length}`);
  if (flipFlipGames.length > 0) {
    console.log('Exact venue names:');
    const uniqueFlipVenues = [...new Set(flipFlipGames.map(g => g.venue))];
    uniqueFlipVenues.forEach(v => console.log(`  - "${v}"`));
  }
}

checkHistoricalData()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
