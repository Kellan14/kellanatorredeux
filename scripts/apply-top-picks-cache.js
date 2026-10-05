// Install using a project-scoped SUPABASE_ACCESS_TOKEN with Migrations write
// access, or a direct DATABASE_URL / POSTGRES_CONNECTION_STRING.
// Never print credentials.
const { Client } = require('pg')
const { readFileSync } = require('fs')
const { join } = require('path')
require('dotenv').config({ path: join(__dirname, '..', '.env.local'), quiet: true })

async function main() {
  const sql = readFileSync(join(__dirname, 'create-top-picks-cache.sql'), 'utf8')
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  if (token) {
    const projectUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL)
    if (!/^[a-z0-9]+\.supabase\.co$/.test(projectUrl.hostname)) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL must identify a hosted Supabase project')
    }
    const projectRef = projectUrl.hostname.split('.')[0]
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/migrations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'create_all_time_team_pick_cache', query: sql }),
    })
    if (!response.ok) {
      const detail = (await response.text()).split(token).join('[redacted]')
      throw new Error(`Supabase migration failed (${response.status}): ${detail}`)
    }
    console.log('All-time Top Picks cache tables installed')
    return
  }

  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_CONNECTION_STRING
  if (!connectionString) {
    throw new Error('SUPABASE_ACCESS_TOKEN, DATABASE_URL, or POSTGRES_CONNECTION_STRING is required')
  }

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
