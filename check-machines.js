// Check what machines actually exist in the database
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkMachines() {
  console.log('=== Checking machines in database ===');
  console.log('');

  // Get all games from season 22, limit to 10 to see structure
  const { data, error } = await supabase
    .from('games')
    .select('season, machine')
    .eq('season', 22)
    .limit(10);

  if (error) {
    console.error('ERROR:', error);
    return;
  }

  console.log('Sample games (first 10):');
  data.forEach((game, i) => {
    console.log(`  ${i+1}. Season: ${game.season}, Machine: "${game.machine}"`);
  });

  console.log('');

  // Get unique machines
  const uniqueMachines = [...new Set(data.map(g => g.machine))];
  console.log('Unique machines in sample:', uniqueMachines);
  console.log('');

  // Now check if "bm66" specifically exists
  const { data: bm66Data, error: bm66Error } = await supabase
    .from('games')
    .select('*')
    .eq('season', 22)
    .eq('machine', 'bm66')
    .limit(1);

  if (bm66Error) {
    console.error('Error checking bm66:', bm66Error);
    return;
  }

  console.log('Games with machine="bm66":', bm66Data.length);
  if (bm66Data.length > 0) {
    console.log('Sample bm66 game:', bm66Data[0]);
  }
}

checkMachines().catch(console.error);
