#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function checkDuplicates() {
  console.log('=== Checking for duplicate game records ===\n');

  // Check for Sean Irby's 931,519,020 Iron Maiden score
  const { data: games } = await supabase
    .from('games')
    .select('id, season, week, machine, venue, player_1_key, player_1_name, player_1_score, player_2_key, player_2_name, player_2_score, player_3_key, player_3_name, player_3_score, player_4_key, player_4_name, player_4_score')
    .or('machine.eq.IronMaiden,machine.eq.Iron Maiden')
    .gte('season', 2)
    .lte('season', 22);

  if (!games) {
    console.log('No games found');
    return;
  }

  console.log(`Total Iron Maiden games: ${games.length}\n`);

  // Find all scores for Sean Irby's 931,519,020
  const seanScores = [];
  for (const game of games) {
    for (let i = 1; i <= 4; i++) {
      const key = game[`player_${i}_key`];
      const name = game[`player_${i}_name`];
      const score = game[`player_${i}_score`];

      if (key === 'fa61b290a0084a7041eda2ead297dfeb1ee2ec0e' && score === 931519020) {
        seanScores.push({
          gameId: game.id,
          season: game.season,
          week: game.week,
          venue: game.venue,
          playerSlot: i,
          name,
          score
        });
      }
    }
  }

  console.log(`Found ${seanScores.length} occurrences of Sean Irby's 931,519,020 score:\n`);
  seanScores.forEach((s, i) => {
    console.log(`${i + 1}. Game ID: ${s.gameId}, Season ${s.season} Week ${s.week}, ${s.venue}, Player Slot ${s.playerSlot}`);
  });
}

checkDuplicates().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
