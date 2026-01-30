// Migrate player name mappings from player_name_update_log into the new player_name_mappings table.
// Extracts unique alias → canonical pairs from the log, using the most recent entry if duplicates exist.

const { createClient } = require('@supabase/supabase-js')
const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function migrate() {
  console.log('Reading player_name_update_log...')

  const { data: logs, error } = await supabase
    .from('player_name_update_log')
    .select('old_name, new_name, created_at')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error reading log:', error.message)
    process.exit(1)
  }

  if (!logs || logs.length === 0) {
    console.log('No entries in player_name_update_log, nothing to migrate')
    return
  }

  console.log(`Found ${logs.length} log entries`)

  // Deduplicate: later entries override earlier ones for the same alias
  const mappings = new Map()
  for (const log of logs) {
    // Skip self-mappings
    if (log.old_name === log.new_name) continue
    mappings.set(log.old_name, log.new_name)
  }

  console.log(`${mappings.size} unique alias → canonical mappings`)

  // Insert into player_name_mappings
  const batch = Array.from(mappings.entries()).map(([alias, canonical_name]) => ({
    alias,
    canonical_name
  }))

  if (batch.length === 0) {
    console.log('No mappings to insert')
    return
  }

  const batchSize = 500
  let inserted = 0
  for (let i = 0; i < batch.length; i += batchSize) {
    const chunk = batch.slice(i, i + batchSize)
    const { error: insertError } = await supabase
      .from('player_name_mappings')
      .upsert(chunk, { onConflict: 'alias' })

    if (insertError) {
      console.error(`Error inserting batch ${Math.floor(i / batchSize) + 1}:`, insertError.message)
    } else {
      inserted += chunk.length
    }
  }

  console.log(`Inserted ${inserted} mappings into player_name_mappings`)
}

migrate()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Migration failed:', err)
    process.exit(1)
  })
