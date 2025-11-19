#!/usr/bin/env node

/**
 * Import historical MNP data from MNP history.csv into matches and games tables
 *
 * This script:
 * 1. Parses the CSV file
 * 2. Groups games by match to create match records
 * 3. Derives player teams from round number + position (using MNP rules)
 * 4. Calculates is_pick based on position and round
 * 5. Generates player keys from names
 * 6. Inserts into matches table first, then games table with match_id
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Supabase configuration - use service role key to bypass RLS policies
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: Missing Supabase environment variables');
  console.error('Please ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Generate player key from name
 * Uses lowercase-hyphenated format: "David Rauschenberg" -> "david-rauschenberg"
 */
function generatePlayerKey(playerName) {
  if (!playerName) return null;
  return playerName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Fetch all existing players from player_stats table
 * Returns a Map of player_name -> player_key for lookups
 */
async function fetchExistingPlayers() {
  console.log('\nFetching existing players from database...');

  const playerKeyMap = new Map();
  let offset = 0;
  const limit = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('player_stats')
      .select('player_name, player_key')
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching existing players:', error);
      throw error;
    }

    if (data && data.length > 0) {
      data.forEach(player => {
        if (player.player_name && player.player_key) {
          playerKeyMap.set(player.player_name, player.player_key);
        }
      });
      offset += limit;
      hasMore = data.length === limit;
    } else {
      hasMore = false;
    }
  }

  console.log(`✓ Found ${playerKeyMap.size} existing players`);
  return playerKeyMap;
}

/**
 * Get or generate player key
 * First checks if player exists in database, otherwise generates new key
 */
function getPlayerKey(playerName, existingPlayersMap) {
  if (!playerName) return null;

  // Check if player already exists
  if (existingPlayersMap.has(playerName)) {
    return existingPlayersMap.get(playerName);
  }

  // Generate new key for unknown player
  return generatePlayerKey(playerName);
}

/**
 * Determine player team based on round number and position
 * Rules from "Match Rules for Monday Night Pinball.htm":
 * - Round 1 (doubles): p1/p3 = away, p2/p4 = home
 * - Round 2 (singles): p1 = home, p2 = away
 * - Round 3 (singles): p1 = away, p2 = home
 * - Round 4 (doubles): p1/p3 = home, p2/p4 = away
 */
function getPlayerTeam(playerPosition, round, homeTeam, awayTeam) {
  if (round === 1) {
    return (playerPosition === 1 || playerPosition === 3) ? awayTeam : homeTeam;
  } else if (round === 2) {
    return playerPosition === 1 ? homeTeam : awayTeam;
  } else if (round === 3) {
    return playerPosition === 1 ? awayTeam : homeTeam;
  } else if (round === 4) {
    return (playerPosition === 1 || playerPosition === 3) ? homeTeam : awayTeam;
  }
  return null;
}

/**
 * Determine if player is a "pick" (responding team's player)
 * - Doubles rounds (1 & 4): positions 2 and 4
 * - Singles rounds (2 & 3): position 2
 */
function getIsPick(playerPosition, round) {
  if (round === 1 || round === 4) {
    return playerPosition === 2 || playerPosition === 4;
  } else if (round === 2 || round === 3) {
    return playerPosition === 2;
  }
  return false;
}

/**
 * Parse CSV line handling quoted fields
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Parse date from "M/D/YYYY" format to ISO timestamp
 */
function parseDate(dateStr) {
  if (!dateStr) return null;

  const [month, day, year] = dateStr.split('/');
  if (!month || !day || !year) return null;

  // Create date at noon UTC to avoid timezone issues
  return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T12:00:00Z`).toISOString();
}

/**
 * Generate match_key from match string
 * Example: "S2 WK1 ELL @ SWL" -> "s2-wk1-ell-swl"
 */
function generateMatchKey(matchStr) {
  return matchStr
    .toLowerCase()
    .replace(/\s+@\s+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Main import function
 */
async function importHistoricalData(dryRun = true) {
  // Fetch existing players from database first
  const existingPlayersMap = await fetchExistingPlayers();

  const csvPath = path.join(__dirname, '..', 'MNP-seasons-3-12.csv');

  console.log('\nReading CSV file:', csvPath);
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').filter(line => line.trim());

  console.log(`Found ${lines.length} lines (including header)`);

  // Parse header
  const headers = parseCSVLine(lines[0]);
  console.log('CSV Headers:', headers);

  // Parse all game records
  const gameRecords = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < headers.length) continue; // Skip incomplete lines

    const record = {};
    headers.forEach((header, idx) => {
      record[header] = values[idx] || null;
    });

    gameRecords.push(record);
  }

  console.log(`Parsed ${gameRecords.length} game records`);

  // Group by match
  const matchGroups = new Map();

  for (const record of gameRecords) {
    const matchKey = generateMatchKey(record.match);

    if (!matchGroups.has(matchKey)) {
      matchGroups.set(matchKey, {
        matchKey,
        matchStr: record.match,
        season: parseInt(record.season),
        week: parseInt(record.week),
        venue: record.venue,
        homeTeam: record.home_team,
        awayTeam: record.away_team,
        date: parseDate(record.date),
        games: []
      });
    }

    matchGroups.get(matchKey).games.push(record);
  }

  console.log(`\nGrouped into ${matchGroups.size} matches`);

  // Process each match
  const matchesToInsert = [];
  const gamesToInsert = [];

  for (const [matchKey, matchData] of matchGroups) {
    // Create match record (venue is only stored in games table, not matches table)
    const matchRecord = {
      match_key: matchData.matchKey,
      season: matchData.season,
      week: matchData.week,
      home_team: matchData.homeTeam,
      away_team: matchData.awayTeam,
      created_at: matchData.date,
      data: {
        home: {
          team: matchData.homeTeam,
          lineup: [],
          rounds: []
        },
        away: {
          team: matchData.awayTeam,
          lineup: [],
          rounds: []
        }
      }
    };

    matchesToInsert.push(matchRecord);

    // Process games for this match
    matchData.games.forEach((game, gameIdx) => {
      const round = parseInt(game.round);

      // Build game record
      const gameRecord = {
        match_key: matchData.matchKey,
        season: matchData.season,
        week: matchData.week,
        venue: matchData.venue,
        round_number: round,
        game_number: gameIdx + 1,
        machine: game.machine,
        home_team: matchData.homeTeam,
        away_team: matchData.awayTeam,
        away_points: parseFloat(game.away_points) || 0,
        home_points: parseFloat(game.home_points) || 0,
        created_at: matchData.date
      };

      // Process players (up to 4)
      for (let pos = 1; pos <= 4; pos++) {
        const playerName = game[`p${pos}`];
        const playerScore = game[`p${pos}_score`];
        const playerPoints = game[`p${pos}_points`];

        if (!playerName || !playerScore) continue;

        const playerKey = getPlayerKey(playerName, existingPlayersMap);
        const playerTeam = getPlayerTeam(pos, round, matchData.homeTeam, matchData.awayTeam);
        const isPick = getIsPick(pos, round);

        gameRecord[`player_${pos}_key`] = playerKey;
        gameRecord[`player_${pos}_name`] = playerName;
        gameRecord[`player_${pos}_score`] = parseInt(playerScore) || 0;
        gameRecord[`player_${pos}_points`] = parseFloat(playerPoints) || 0;
        gameRecord[`player_${pos}_team`] = playerTeam;
        gameRecord[`player_${pos}_is_pick`] = isPick;
      }

      gamesToInsert.push(gameRecord);
    });
  }

  console.log(`\nPrepared ${matchesToInsert.length} match records`);
  console.log(`Prepared ${gamesToInsert.length} game records`);

  // Show sample data
  console.log('\n=== SAMPLE MATCH RECORD ===');
  console.log(JSON.stringify(matchesToInsert[0], null, 2));

  console.log('\n=== SAMPLE GAME RECORD ===');
  console.log(JSON.stringify(gamesToInsert[0], null, 2));

  if (dryRun) {
    console.log('\n✓ DRY RUN COMPLETE - No data inserted');
    console.log('\nTo perform actual import, run with --execute flag');
    return;
  }

  // Actual import
  console.log('\n=== STARTING DATABASE IMPORT ===');

  // Step 1: Insert matches
  console.log('\nInserting matches...');
  const { data: insertedMatches, error: matchError } = await supabase
    .from('matches')
    .insert(matchesToInsert)
    .select('id, match_key');

  if (matchError) {
    console.error('Error inserting matches:', matchError);
    throw matchError;
  }

  console.log(`✓ Inserted ${insertedMatches.length} matches`);

  // Create match_key -> id mapping
  const matchIdMap = new Map();
  insertedMatches.forEach(m => {
    matchIdMap.set(m.match_key, m.id);
  });

  // Step 2: Add match_id to game records
  for (const game of gamesToInsert) {
    game.match_id = matchIdMap.get(game.match_key);
    if (!game.match_id) {
      console.error(`ERROR: No match_id found for match_key: ${game.match_key}`);
    }
  }

  // Step 3: Insert games in batches (Supabase has a limit)
  console.log('\nInserting games in batches...');
  const batchSize = 500;
  let totalInserted = 0;

  for (let i = 0; i < gamesToInsert.length; i += batchSize) {
    const batch = gamesToInsert.slice(i, i + batchSize);

    const { data: insertedGames, error: gamesError } = await supabase
      .from('games')
      .insert(batch);

    if (gamesError) {
      console.error(`Error inserting games batch ${i / batchSize + 1}:`, gamesError);
      throw gamesError;
    }

    totalInserted += batch.length;
    console.log(`  Batch ${Math.floor(i / batchSize) + 1}: Inserted ${batch.length} games (total: ${totalInserted})`);
  }

  console.log(`\n✓ Successfully inserted ${totalInserted} games`);
  console.log('\n=== IMPORT COMPLETE ===');
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');

if (dryRun) {
  console.log('=== DRY RUN MODE ===');
  console.log('This will parse the CSV and show sample data without inserting into database\n');
} else {
  console.log('=== EXECUTE MODE ===');
  console.log('This will insert data into the database\n');
}

// Run import
importHistoricalData(dryRun)
  .then(() => {
    console.log('\n✓ Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n✗ Script failed:', error);
    process.exit(1);
  });
