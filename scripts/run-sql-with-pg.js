// Execute SQL using direct PostgreSQL connection
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

// Supabase connection string format:
// postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_CONNECTION_STRING;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('   Need: DATABASE_URL or POSTGRES_CONNECTION_STRING in .env.local');
  console.error('');
  console.error('   Get it from: Supabase Dashboard > Project Settings > Database > Connection string > URI');
  console.error('   Format: postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres');
  process.exit(1);
}

async function runSQL() {
  const client = new Client({ connectionString });

  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected\n');

    console.log('📖 Reading SQL file...');
    const sqlPath = path.join(__dirname, 'create-relational-schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log('✅ SQL file loaded\n');

    console.log('▶️  Executing SQL schema...');
    await client.query(sql);
    console.log('✅ Schema created successfully!\n');

    console.log('📊 Created:');
    console.log('   - games table');
    console.log('   - player_match_participation table');
    console.log('   - player_games view');
    console.log('   - All indexes\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

runSQL().catch(err => {
  console.error('\n❌ Failed:', err);
  process.exit(1);
});
