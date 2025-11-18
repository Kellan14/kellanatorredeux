// Debug script to test stats calculator logic
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function debugStatsCalculator() {
  console.log('=== Testing Stats Calculator Logic ===');
  console.log('');

  const playerNames = ['Douglas Hansen', 'Jordan Shankle'];
  const machines = ['bm66'];
  const seasonStart = 22;
  const seasonEnd = 22;

  console.log('Looking for:');
  console.log('  Players:', playerNames);
  console.log('  Machines:', machines);
  console.log('  Seasons:', seasonStart, 'to', seasonEnd);
  console.log('');

  // Fetch games
  const { data: gamesData, error } = await supabase
    .from('games')
    .select('*')
    .gte('season', seasonStart)
    .lte('season', seasonEnd)
    .in('machine', machines);

  if (error) {
    console.error('ERROR:', error);
    return;
  }

  console.log('Total games fetched:', gamesData.length);
  console.log('');

  if (gamesData.length === 0) {
    console.log('No games found!');
    return;
  }

  console.log('First game structure:');
  console.log('  Keys:', Object.keys(gamesData[0]));
  console.log('  Season:', gamesData[0].season);
  console.log('  Machine:', gamesData[0].machine);
  console.log('');

  // Process like the stats calculator does
  let matchCount = 0;
  let skipCount = 0;
  const reasons = {};

  for (const game of gamesData) {
    for (let i = 1; i <= 4; i++) {
      const playerName = game[`player_${i}_name`];
      const playerScore = game[`player_${i}_score`];
      const playerPoints = game[`player_${i}_points`];

      // Check each condition
      if (!playerName) {
        skipCount++;
        reasons['no_name'] = (reasons['no_name'] || 0) + 1;
        continue;
      }

      if (!playerNames.includes(playerName)) {
        skipCount++;
        reasons['not_in_list'] = (reasons['not_in_list'] || 0) + 1;
        continue;
      }

      if (playerScore == null) {
        skipCount++;
        reasons['no_score'] = (reasons['no_score'] || 0) + 1;
        console.log(`  Player ${playerName} has null score in game`);
        continue;
      }

      if (!machines.includes(game.machine)) {
        skipCount++;
        reasons['wrong_machine'] = (reasons['wrong_machine'] || 0) + 1;
        continue;
      }

      // If we got here, it's a match!
      matchCount++;
      console.log(`MATCH ${matchCount}: ${playerName} on ${game.machine}`);
      console.log(`  Score: ${playerScore}, Points: ${playerPoints}`);
    }
  }

  console.log('');
  console.log('=== Summary ===');
  console.log('Total player slots checked:', gamesData.length * 4);
  console.log('Matches found:', matchCount);
  console.log('Skipped:', skipCount);
  console.log('Skip reasons:', reasons);
}

debugStatsCalculator().catch(console.error);
