import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
dotenv.config({ path: '.env.local', quiet: true })

async function main() {
  // Dynamic import is deliberate: the server-side client reads env at import.
  const { loadMnpMachines, syncMnpCanon } =
    await import('../lib/manage-machine-canon')
  const { planMnpSync } = await import('../lib/machine-canon-plans')
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  if (!process.argv.includes('--execute')) {
    const { data, error } = await client.from('machine_canon').select('*')
    if (error) throw error
    console.log(
      JSON.stringify(
        planMnpSync(await loadMnpMachines(true), data || []),
        null,
        2,
      ),
    )
    console.log(
      'Dry run. Add --execute to apply exact matches and log every change.',
    )
    return
  }
  const result = await syncMnpCanon(client, 'maintenance/sync-machine-canon')
  console.log(JSON.stringify(result, null, 2))
  if (result.review.length) process.exitCode = 1
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
