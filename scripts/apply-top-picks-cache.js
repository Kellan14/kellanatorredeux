// Install the all-time Top Picks tables using DATABASE_URL (or
// POSTGRES_CONNECTION_STRING) from .env.local. Never print the connection URI.
const { Client } = require('pg')
const { readFileSync } = require('fs')
const { join } = require('path')
require('dotenv').config({ path: join(__dirname, '..', '.env.local'), quiet: true })

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_CONNECTION_STRING
  if (!connectionString) {
    throw new Error('DATABASE_URL or POSTGRES_CONNECTION_STRING is required in .env.local')
  }

  const sql = readFileSync(join(__dirname, 'create-top-picks-cache.sql'), 'utf8')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('COMMIT')
    console.log('All-time Top Picks cache tables installed')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

main().catch(error => {
  console.error('Top Picks cache installation failed:', error.message)
  process.exitCode = 1
})
