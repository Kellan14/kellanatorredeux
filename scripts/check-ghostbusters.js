#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function checkGhostbusters() {
  console.log('=== Checking Ghostbusters/Ghost machine data in database ===\n');

  // Check for exact "Ghost" match
  const { data: ghostExact, error: ghostExactError } = await supabase
    .from('games')
    .select('machine, venue, season', { count: 'exact' })
    .eq('machine', 'Ghost');

  console.log('Games with machine="Ghost" (exact):',  ghostExact?.length || 0);

  // Check for exact "Ghostbusters" match
  const { data: gbExact, error: gbExactError } = await supabase
    .from('games')
    .select('machine, venue, season', { count: 'exact' })
    .eq('machine', 'Ghostbusters');

  console.log('Games with machine="Ghostbusters" (exact):', gbExact?.length || 0);
  console.log('');

  // Get unique venues for each
  if (ghostExact && ghostExact.length > 0) {
    const venues = [...new Set(ghostExact.map(g => g.venue))];
    console.log('Venues with "Ghost":', venues.join(', '));
    console.log('Sample Ghost games:');
    ghostExact.slice(0, 5).forEach(g => console.log(`  ${g.machine} at ${g.venue} (Season ${g.season})`));
  }

  console.log('');

  if (gbExact && gbExact.length > 0) {
    const venues = [...new Set(gbExact.map(g => g.venue))];
    console.log('Venues with "Ghostbusters":', venues.join(', '));
    console.log('Sample Ghostbusters games:');
    gbExact.slice(0, 5).forEach(g => console.log(`  ${g.machine} at ${g.venue} (Season ${g.season})`));
  }
}

checkGhostbusters().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
