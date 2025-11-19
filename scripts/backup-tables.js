#!/usr/bin/env node

/**
 * Backup matches and games tables to JSON files
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Supabase configuration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Fetch all records from a table with pagination
 */
async function fetchAllRecords(tableName) {
  console.log(`\nFetching all records from ${tableName}...`);

  const allRecords = [];
  let offset = 0;
  const limit = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .range(offset, offset + limit - 1);

    if (error) {
      console.error(`Error fetching ${tableName}:`, error);
      throw error;
    }

    if (data && data.length > 0) {
      allRecords.push(...data);
      offset += limit;
      hasMore = data.length === limit;
      console.log(`  Fetched ${allRecords.length} records so far...`);
    } else {
      hasMore = false;
    }
  }

  console.log(`✓ Total records fetched from ${tableName}: ${allRecords.length}`);
  return allRecords;
}

/**
 * Main backup function
 */
async function backupTables() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const backupDir = path.join(__dirname, 'backups');

  // Create backups directory if it doesn't exist
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    console.log(`Created backup directory: ${backupDir}`);
  }

  console.log('\n=== STARTING TABLE BACKUP ===');
  console.log(`Timestamp: ${timestamp}\n`);

  // Backup matches table
  const matches = await fetchAllRecords('matches');
  const matchesFile = path.join(backupDir, `matches_backup_${timestamp}.json`);
  fs.writeFileSync(matchesFile, JSON.stringify(matches, null, 2));
  console.log(`✓ Matches backup saved to: ${matchesFile}`);

  // Backup games table
  const games = await fetchAllRecords('games');
  const gamesFile = path.join(backupDir, `games_backup_${timestamp}.json`);
  fs.writeFileSync(gamesFile, JSON.stringify(games, null, 2));
  console.log(`✓ Games backup saved to: ${gamesFile}`);

  // Create backup manifest
  const manifest = {
    timestamp,
    created_at: new Date().toISOString(),
    tables: {
      matches: {
        file: path.basename(matchesFile),
        records: matches.length
      },
      games: {
        file: path.basename(gamesFile),
        records: games.length
      }
    }
  };

  const manifestFile = path.join(backupDir, `backup_manifest_${timestamp}.json`);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`✓ Backup manifest saved to: ${manifestFile}`);

  console.log('\n=== BACKUP COMPLETE ===');
  console.log(`\nBackup Summary:`);
  console.log(`  Matches: ${matches.length} records`);
  console.log(`  Games: ${games.length} records`);
  console.log(`  Location: ${backupDir}`);
}

// Run backup
backupTables()
  .then(() => {
    console.log('\n✓ Backup completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n✗ Backup failed:', error);
    process.exit(1);
  });
