const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: teams } = await supabase.from('teams').select('team_key, team_name').ilike('team_name', '%wrecking%');
  console.log('TWC teams:', teams);
  const twcKey = teams[0].team_key;

  const { data: roster } = await supabase
    .from('player_match_participation')
    .select('player_name, is_sub, season')
    .eq('team', twcKey)
    .in('season', [22, 23])
    .order('player_name');

  const names = new Map();
  for (const r of roster) {
    const key = r.player_name + '|' + r.season;
    if (!names.has(key)) {
      names.set(key, { name: r.player_name, season: r.season, is_sub: r.is_sub, count: 0 });
    }
    names.get(key).count++;
  }
  console.log('\nTWC roster entries (season 22-23):');
  for (const [, v] of names) {
    console.log('  ', v.name, '| season', v.season, '| sub:', v.is_sub, '| entries:', v.count);
  }

  const { data: mappings } = await supabase.from('player_name_mappings').select('alias, canonical_name');
  console.log('\nName mappings:');
  for (const m of (mappings || [])) {
    console.log('  ', m.alias, '->', m.canonical_name);
  }

  const rosterNames = new Set(roster.map(r => r.player_name));
  console.log('\nRoster names that are aliases (should have been standardized):');
  let found = false;
  for (const m of (mappings || [])) {
    if (rosterNames.has(m.alias)) {
      console.log('  !!', m.alias, 'should be', m.canonical_name);
      found = true;
    }
  }
  if (!found) console.log('  (none found)');

  // Also check games table for unstandardized names
  const { data: games } = await supabase
    .from('games')
    .select('player_1_name, player_2_name, player_3_name, player_4_name, season')
    .in('season', [22, 23])
    .limit(500);

  const gameNames = new Set();
  for (const g of (games || [])) {
    for (let i = 1; i <= 4; i++) {
      const name = g[`player_${i}_name`];
      if (name) gameNames.add(name);
    }
  }

  console.log('\nGame player names that are aliases:');
  found = false;
  for (const m of (mappings || [])) {
    if (gameNames.has(m.alias)) {
      console.log('  !!', m.alias, 'should be', m.canonical_name);
      found = true;
    }
  }
  if (!found) console.log('  (none found)');
}

check();
