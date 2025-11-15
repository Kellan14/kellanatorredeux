// Check if new tables exist
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

async function checkTables() {
  console.log('🔍 Checking if tables exist...\n');

  // Try to query games table
  const { data: gamesData, error: gamesError } = await supabase
    .from('games')
    .select('count')
    .limit(1);

  if (gamesError) {
    console.log('❌ games table does not exist');
    console.log(`   Error: ${gamesError.message}\n`);
  } else {
    console.log('✅ games table exists');
  }

  // Try to query player_match_participation table
  const { data: pmpData, error: pmpError } = await supabase
    .from('player_match_participation')
    .select('count')
    .limit(1);

  if (pmpError) {
    console.log('❌ player_match_participation table does not exist');
    console.log(`   Error: ${pmpError.message}\n`);
  } else {
    console.log('✅ player_match_participation table exists');
  }

  if (gamesError || pmpError) {
    console.log('\n📝 To create these tables:');
    console.log('1. Go to Supabase Dashboard > SQL Editor');
    console.log('2. Copy contents of scripts/create-relational-schema.sql');
    console.log('3. Paste and run the SQL');
    console.log('4. Then run: node scripts/migrate-to-relational.js\n');
    process.exit(1);
  }

  console.log('\n✅ All tables exist! Ready to run migration.');
}

checkTables().catch(err => {
  console.error('\n❌ Check failed:', err);
  process.exit(1);
});
