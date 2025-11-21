#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function mergeSubPlayers() {
  console.log('=== Merging (sub) Player Identities ===\n');

  // Since .or() doesn't work with .ilike, we'll query each position separately with pagination
  const allGames = new Map(); // Use Map to deduplicate by game id

  for (let i = 1; i <= 4; i++) {
    console.log(`Fetching (sub) players from player_${i}...`);
    let offset = 0;
    const limit = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: games, error } = await supabase
        .from('games')
        .select('*')
        .ilike(`player_${i}_name`, '%(sub)%')
        .range(offset, offset + limit - 1);

      if (error) {
        console.error(`  Error fetching games for player_${i} at offset ${offset}:`, error);
        break;
      }

      if (games && games.length > 0) {
        // Add games to the map, using game id as key to avoid duplicates
        games.forEach(game => allGames.set(game.id, game));

        offset += limit;
        hasMore = games.length === limit; // Continue if we got a full batch
      } else {
        hasMore = false;
      }
    }

    console.log(`  Found ${offset} total (sub) games for player_${i}`);
  }

  const games = Array.from(allGames.values());
  console.log(`\nTotal unique games with (sub) players: ${games.length}\n`);

  // Build map of sub names to main names and keys
  const subMappings = new Map();

  for (const game of games) {
    for (let i = 1; i <= 4; i++) {
      const name = game[`player_${i}_name`];
      const key = game[`player_${i}_key`];

      if (name && name.includes('(sub)')) {
        const mainName = name.replace(/\s*\(sub\)\s*/gi, '').trim();

        if (!subMappings.has(name)) {
          subMappings.set(name, { subName: name, mainName, subKey: key, count: 0 });
        }
        subMappings.get(name).count++;
      }
    }
  }

  console.log('Players with (sub) suffix:');
  console.log('─'.repeat(80));

  for (const [subName, info] of subMappings.entries()) {
    console.log(`\nSub name:  "${info.subName}"`);
    console.log(`Main name: "${info.mainName}"`);
    console.log(`Sub key:   ${info.subKey}`);
    console.log(`Games:     ${info.count}`);

    // Find the main player's key
    const { data: mainPlayerGames } = await supabase
      .from('games')
      .select('player_1_key, player_1_name, player_2_key, player_2_name, player_3_key, player_3_name, player_4_key, player_4_name')
      .or(`player_1_name.eq.${info.mainName},player_2_name.eq.${info.mainName},player_3_name.eq.${info.mainName},player_4_name.eq.${info.mainName}`)
      .limit(1);

    if (mainPlayerGames && mainPlayerGames.length > 0) {
      const mainGame = mainPlayerGames[0];
      let mainKey = null;

      for (let i = 1; i <= 4; i++) {
        if (mainGame[`player_${i}_name`] === info.mainName) {
          mainKey = mainGame[`player_${i}_key`];
          break;
        }
      }

      if (mainKey) {
        console.log(`Main key:  ${mainKey}`);
        info.mainKey = mainKey;
      } else {
        console.log('Main key:  NOT FOUND');
      }
    } else {
      console.log('Main key:  NO GAMES FOUND (will keep sub key)');
      info.mainKey = info.subKey; // Keep the sub key if no main player exists
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('\nTo merge these players, run with --execute flag');
  console.log('This will update all (sub) player records to use the main player key\n');

  // If --execute flag is provided, perform the merge
  if (process.argv.includes('--execute')) {
    console.log('\n🔄 Executing merge...\n');

    for (const [subName, info] of subMappings.entries()) {
      if (!info.mainKey) {
        console.log(`⏭️  Skipping "${subName}" - no main key found`);
        continue;
      }

      console.log(`\n📝 Merging "${info.subName}" → "${info.mainName}"`);
      console.log(`   Key: ${info.subKey} → ${info.mainKey}`);

      let updatedCount = 0;

      // Update each player position separately
      for (let i = 1; i <= 4; i++) {
        const { data, error } = await supabase
          .from('games')
          .update({ [`player_${i}_key`]: info.mainKey })
          .eq(`player_${i}_name`, info.subName)
          .select('id');

        if (error) {
          console.error(`   ❌ Error updating player_${i}:`, error.message);
        } else if (data && data.length > 0) {
          updatedCount += data.length;
          console.log(`   ✓ Updated ${data.length} games for player_${i}`);
        }
      }

      console.log(`   ✅ Total: ${updatedCount} game records updated`);
    }

    console.log('\n✨ Merge complete!\n');
  }
}

mergeSubPlayers()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
