// Migrate JSONB data to relational tables
// Flattens matches.data into games and player_match_participation tables

const { createClient } = require('@supabase/supabase-js');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function migrateData() {
  console.log('🚀 Starting migration: JSONB → Relational tables\n');

  // Clear existing data
  console.log('🗑️  Clearing existing data in new tables...');
  await supabase.from('games').delete().neq('id', 0);
  await supabase.from('player_match_participation').delete().neq('id', 0);
  console.log('✓ Cleared\n');

  // Fetch all matches
  console.log('📥 Fetching all matches from database...');
  const { data: matches, error } = await supabase
    .from('matches')
    .select('id, match_key, season, week, venue_name, data')
    .eq('state', 'complete')
    .order('season', { ascending: true })
    .order('week', { ascending: true });

  if (error) {
    console.error('❌ Error fetching matches:', error);
    process.exit(1);
  }

  console.log(`✓ Fetched ${matches.length} completed matches\n`);

  let totalGames = 0;
  let totalParticipations = 0;
  const gamesBatch = [];
  const participationsBatch = [];

  console.log('🔄 Processing matches...\n');

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];

    if ((i + 1) % 10 === 0) {
      console.log(`  Progress: ${i + 1}/${matches.length} matches...`);
    }

    // Extract player participation from lineups
    const homeLineup = match.data?.home?.lineup || [];
    const awayLineup = match.data?.away?.lineup || [];

    // Track which players we've already added for this match (to handle data quality issues)
    const seenPlayers = new Set();

    // Process home team lineup
    for (const player of homeLineup) {
      // Skip placeholder entries (empty roster slots)
      if (!player.name || player.name.toLowerCase().includes('no player')) continue;

      const playerKey = `${match.id}-${player.key}`;
      if (!seenPlayers.has(playerKey)) {
        participationsBatch.push({
          match_id: match.id,
          player_key: player.key,
          player_name: player.name,
          season: match.season,
          week: match.week,
          team: match.data.home.key,
          match_key: match.match_key,
          ipr_at_match: player.IPR || player.ipr,
          num_played: player.num_played || 0,
          is_sub: player.sub || false
        });
        seenPlayers.add(playerKey);
        totalParticipations++;
      }
    }

    // Process away team lineup
    for (const player of awayLineup) {
      // Skip placeholder entries (empty roster slots)
      if (!player.name || player.name.toLowerCase().includes('no player')) continue;

      const playerKey = `${match.id}-${player.key}`;
      if (!seenPlayers.has(playerKey)) {
        participationsBatch.push({
          match_id: match.id,
          player_key: player.key,
          player_name: player.name,
          season: match.season,
          week: match.week,
          team: match.data.away.key,
          match_key: match.match_key,
          ipr_at_match: player.IPR || player.ipr,
          num_played: player.num_played || 0,
          is_sub: player.sub || false
        });
        seenPlayers.add(playerKey);
        totalParticipations++;
      }
    }

    // Create a player lookup map for this match
    const playerMap = new Map();
    [...homeLineup, ...awayLineup].forEach(p => {
      playerMap.set(p.key, p.name);
    });

    // Extract games from rounds
    const rounds = match.data?.rounds || [];
    for (const round of rounds) {
      const roundNumber = round.n || 0;
      const games = round.games || [];

      for (const game of games) {
        const gameNumber = game.n || 0;

        // Skip games without machine (incomplete data)
        if (!game.machine) continue;

        gamesBatch.push({
          match_id: match.id,
          season: match.season,
          week: match.week,
          venue: match.venue_name,
          match_key: match.match_key,
          round_number: roundNumber,
          game_number: gameNumber,
          machine: game.machine,

          // Player 1
          player_1_key: game.player_1 || null,
          player_1_name: game.player_1 ? playerMap.get(game.player_1) : null,
          player_1_score: game.score_1 || null,
          player_1_points: game.points_1 !== undefined ? game.points_1 : null,

          // Player 2
          player_2_key: game.player_2 || null,
          player_2_name: game.player_2 ? playerMap.get(game.player_2) : null,
          player_2_score: game.score_2 || null,
          player_2_points: game.points_2 !== undefined ? game.points_2 : null,

          // Player 3
          player_3_key: game.player_3 || null,
          player_3_name: game.player_3 ? playerMap.get(game.player_3) : null,
          player_3_score: game.score_3 || null,
          player_3_points: game.points_3 !== undefined ? game.points_3 : null,

          // Player 4
          player_4_key: game.player_4 || null,
          player_4_name: game.player_4 ? playerMap.get(game.player_4) : null,
          player_4_score: game.score_4 || null,
          player_4_points: game.points_4 !== undefined ? game.points_4 : null,

          // Team points
          away_points: game.away_points !== undefined ? game.away_points : null,
          home_points: game.home_points !== undefined ? game.home_points : null,
        });

        totalGames++;
      }
    }

    // Insert in batches of 100 matches to avoid memory issues
    if ((i + 1) % 100 === 0) {
      console.log(`  💾 Inserting batch (${gamesBatch.length} games, ${participationsBatch.length} participations)...`);

      if (gamesBatch.length > 0) {
        const { error: gamesError } = await supabase
          .from('games')
          .insert(gamesBatch);

        if (gamesError) {
          console.error('❌ Error inserting games:', gamesError);
          process.exit(1);
        }
        gamesBatch.length = 0;
      }

      if (participationsBatch.length > 0) {
        const { error: partError } = await supabase
          .from('player_match_participation')
          .upsert(participationsBatch, { onConflict: 'match_id,player_key' });

        if (partError) {
          console.error('❌ Error inserting participations:', partError);
          process.exit(1);
        }
        participationsBatch.length = 0;
      }
    }
  }

  // Insert remaining data
  console.log('\n💾 Inserting final batch...');

  if (gamesBatch.length > 0) {
    const { error: gamesError } = await supabase
      .from('games')
      .insert(gamesBatch);

    if (gamesError) {
      console.error('❌ Error inserting games:', gamesError);
      process.exit(1);
    }
  }

  if (participationsBatch.length > 0) {
    const { error: partError } = await supabase
      .from('player_match_participation')
      .upsert(participationsBatch, { onConflict: 'match_id,player_key' });

    if (partError) {
      console.error('❌ Error inserting participations:', partError);
      process.exit(1);
    }
  }

  console.log('\n✅ Migration completed successfully!\n');
  console.log('📊 Summary:');
  console.log(`   Matches processed: ${matches.length}`);
  console.log(`   Games created: ${totalGames}`);
  console.log(`   Player participations: ${totalParticipations}`);
  console.log('\n🎯 New tables are ready for SQL queries!');
}

migrateData().catch(err => {
  console.error('\n❌ Migration failed:', err);
  process.exit(1);
});
