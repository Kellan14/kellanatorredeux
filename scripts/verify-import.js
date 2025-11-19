#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Fetch all records with pagination to get around Supabase limit
 */
async function fetchAllRecords(table, columns = '*') {
  const allRecords = [];
  let offset = 0;
  const limit = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order('season', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error(`Error fetching ${table}:`, error);
      throw error;
    }

    if (data && data.length > 0) {
      allRecords.push(...data);
      offset += limit;
      hasMore = data.length === limit;
    } else {
      hasMore = false;
    }
  }

  return allRecords;
}

async function verifyImport() {
  console.log('=== Verifying Historical Data Import ===\n');

  // Check matches by season (with pagination)
  console.log('Fetching all matches...');
  const matches = await fetchAllRecords('matches', 'season');

  // Count matches by season
  const matchCounts = {};
  matches.forEach(m => {
    matchCounts[m.season] = (matchCounts[m.season] || 0) + 1;
  });

  console.log('\nMatches by Season:');
  Object.keys(matchCounts).sort((a, b) => parseInt(a) - parseInt(b)).forEach(season => {
    console.log(`  Season ${season}: ${matchCounts[season]} matches`);
  });

  console.log(`\nTotal matches: ${matches.length}`);

  // Check games by season (with pagination)
  console.log('\nFetching all games...');
  const games = await fetchAllRecords('games', 'season');

  // Count games by season
  const gameCounts = {};
  games.forEach(g => {
    gameCounts[g.season] = (gameCounts[g.season] || 0) + 1;
  });

  console.log('\nGames by Season:');
  Object.keys(gameCounts).sort((a, b) => parseInt(a) - parseInt(b)).forEach(season => {
    console.log(`  Season ${season}: ${gameCounts[season]} games`);
  });

  console.log(`\nTotal games: ${games.length}`);
}

verifyImport()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
