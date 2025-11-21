#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function checkIronMaiden() {
  console.log('=== Checking Iron Maiden machine data in database ===\n');

  // Check for any machine containing "iron" or "maiden"
  const { data: ironGames } = await supabase
    .from('games')
    .select('machine, venue, season, player_1_name, player_1_score, player_2_name, player_2_score, player_3_name, player_3_score, player_4_name, player_4_score')
    .or('machine.ilike.%iron%,machine.ilike.%maiden%');

  if (ironGames && ironGames.length > 0) {
    const uniqueMachines = [...new Set(ironGames.map(g => g.machine))];
    console.log('All machine name variations containing "iron" or "maiden":');
    uniqueMachines.forEach(m => {
      const count = ironGames.filter(g => g.machine === m).length;
      console.log(`  "${m}": ${count} games`);
    });
    console.log('');

    // Get top scores for Iron Maiden league-wide
    const allScores = [];
    for (const game of ironGames) {
      if (game.player_1_name && game.player_1_score != null) {
        allScores.push({ player: game.player_1_name, score: game.player_1_score, machine: game.machine });
      }
      if (game.player_2_name && game.player_2_score != null) {
        allScores.push({ player: game.player_2_name, score: game.player_2_score, machine: game.machine });
      }
      if (game.player_3_name && game.player_3_score != null) {
        allScores.push({ player: game.player_3_name, score: game.player_3_score, machine: game.machine });
      }
      if (game.player_4_name && game.player_4_score != null) {
        allScores.push({ player: game.player_4_name, score: game.player_4_score, machine: game.machine });
      }
    }

    // Sort by score descending
    allScores.sort((a, b) => b.score - a.score);

    console.log('Top 10 Iron Maiden scores (all variations):');
    allScores.slice(0, 10).forEach((s, i) => {
      const isKellan = s.player === 'Kellan Kirkland' ? ' <-- KELLAN' : '';
      console.log(`  ${i + 1}. ${s.player}: ${s.score.toLocaleString()} (${s.machine})${isKellan}`);
    });
  }
}

checkIronMaiden().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
