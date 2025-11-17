const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

(async () => {
  console.log('Testing player name lookup...\n');

  // Check what player names exist that contain "Kellan"
  const { data: games } = await supabase
    .from('games')
    .select('player_1_name, player_2_name, player_3_name, player_4_name')
    .or('player_1_name.ilike.%Kellan%,player_2_name.ilike.%Kellan%,player_3_name.ilike.%Kellan%,player_4_name.ilike.%Kellan%')
    .limit(5);

  console.log('Games with "Kellan" in player name:');
  games?.forEach(g => {
    console.log('  P1:', g.player_1_name);
    console.log('  P2:', g.player_2_name);
    console.log('  P3:', g.player_3_name);
    console.log('  P4:', g.player_4_name);
    console.log('');
  });

  // Try exact match
  const { data: exactGames } = await supabase
    .from('games')
    .select('player_1_key, player_1_name, player_2_key, player_2_name, player_3_key, player_3_name, player_4_key, player_4_name')
    .or('player_1_name.eq.Kellan,player_2_name.eq.Kellan,player_3_name.eq.Kellan,player_4_name.eq.Kellan')
    .limit(1);

  console.log('Exact match for "Kellan":', exactGames?.length || 0, 'games');
  if (exactGames && exactGames.length > 0) {
    console.log('First game:', exactGames[0]);
  }
})();
