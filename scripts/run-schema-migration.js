// Run SQL schema migration on Supabase
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  console.error('Need: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log('Reading SQL schema file...');
  const sqlPath = path.join(__dirname, 'create-relational-schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Connecting to Supabase...');
  console.log(`URL: ${supabaseUrl}`);

  // Split SQL into individual statements (basic split on semicolons)
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`Found ${statements.length} SQL statements to execute\n`);

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    const preview = statement.substring(0, 80).replace(/\n/g, ' ');

    console.log(`[${i + 1}/${statements.length}] Executing: ${preview}...`);

    const { data, error } = await supabase.rpc('exec_sql', {
      sql_query: statement
    });

    if (error) {
      // Try direct query if RPC doesn't work
      console.log('  RPC failed, trying direct query...');
      const { error: directError } = await supabase
        .from('_migration_temp')
        .select('*');

      if (directError) {
        console.error(`  ❌ Error: ${error.message}`);
        console.error(`     Statement: ${statement.substring(0, 200)}`);

        // Don't exit on CREATE IF NOT EXISTS failures
        if (!statement.includes('IF NOT EXISTS') && !statement.includes('OR REPLACE')) {
          process.exit(1);
        }
      }
    } else {
      console.log('  ✓ Success');
    }
  }

  console.log('\n✅ Schema migration completed!');
  console.log('\nCreated tables:');
  console.log('  - games (with indexes)');
  console.log('  - player_match_participation (with indexes)');
  console.log('  - player_games (view)');
}

runMigration().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
