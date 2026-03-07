const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fix() {
  // Get all mappings
  const { data: mappings } = await supabase.from('player_name_mappings').select('alias, canonical_name');
  console.log(`Found ${mappings.length} name mappings`);

  for (const { alias, canonical_name } of mappings) {
    // Fix player_match_participation
    const { data: partData, error: partError } = await supabase
      .from('player_match_participation')
      .update({ player_name: canonical_name })
      .eq('player_name', alias)
      .select('id');

    if (partError) {
      console.error(`  Error updating participation for "${alias}":`, partError.message);
    } else if (partData && partData.length > 0) {
      console.log(`  Updated ${partData.length} participation records: "${alias}" -> "${canonical_name}"`);
    }

    // Fix games table - player_1_name through player_4_name
    for (let i = 1; i <= 4; i++) {
      const col = `player_${i}_name`;
      const { data: gameData, error: gameError } = await supabase
        .from('games')
        .update({ [col]: canonical_name })
        .eq(col, alias)
        .select('id');

      if (gameError) {
        console.error(`  Error updating games.${col} for "${alias}":`, gameError.message);
      } else if (gameData && gameData.length > 0) {
        console.log(`  Updated ${gameData.length} games.${col} records: "${alias}" -> "${canonical_name}"`);
      }
    }
  }

  console.log('\nDone!');
}

fix();
