// Install the reviewed transactional canon workflow with a project-scoped PAT
// (Migrations read-write) or the direct database connection, never logging keys.
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
require('dotenv').config({
  path: join(__dirname, '..', '.env.local'),
  quiet: true,
})

async function main() {
  const sql = readFileSync(
    join(__dirname, 'machine-canon-management.sql'),
    'utf8',
  )
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  if (token) {
    const hostname = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
    if (!/^[a-z0-9]+\.supabase\.co$/.test(hostname))
      throw new Error('A hosted Supabase project URL is required')
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${hostname.split('.')[0]}/database/migrations`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'machine_canon_management', query: sql }),
      },
    )
    if (!response.ok)
      throw new Error(
        `Migration failed (${response.status}): ${(await response.text()).split(token).join('[redacted]')}`,
      )
  } else {
    const connectionString =
      process.env.DATABASE_URL || process.env.POSTGRES_CONNECTION_STRING
    if (!connectionString)
      throw new Error('SUPABASE_ACCESS_TOKEN or DATABASE_URL is required')
    const { Client } = require('pg')
    const client = new Client({ connectionString })
    await client.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      await client.end()
    }
  }
  console.log('Transactional machine canon management installed')
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
