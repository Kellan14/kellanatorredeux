/**
 * Seed machine_canon from the MNP canon.
 *
 * Source of truth: https://mondaynightpinball.com/machines, mirrored in this
 * repo at mnp-data-archive/machines.json (verified identical, 325 keys).
 *
 * Idempotent: re-running refreshes MNP rows and reports drift (upstream adds,
 * renames, removals) without touching source='local' rows or display_override.
 *
 * Run:  npx tsx scripts/seed-machine-canon.ts            (dry run)
 *       npx tsx scripts/seed-machine-canon.ts --execute
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BATCH_ID = 'machine-canon-seed-2026-07-26'

/**
 * Two published keys are not usable as identifiers (a space, an apostrophe).
 * We normalize the key and keep the published strings in mnp_key/mnp_name so
 * drift detection still matches upstream exactly.
 *   "Future Spa" is also the one row where MNP has key/name inverted (the
 *   "name" is the compressed FutureSpa), so we also restore the readable long
 *   form rather than shipping "FutureSpa" as a display name.
 */
const KEY_NORMALIZATION: Record<string, { key: string; name?: string; note: string }> = {
  'Future Spa': {
    key: 'FutureSpa',
    name: 'Future Spa',
    note: 'MNP publishes key "Future Spa" / name "FutureSpa" — the only inverted row. Key made space-free; long form set to the readable spelling.',
  },
  "Hotdoggin'": {
    key: 'Hotdoggin',
    note: 'MNP publishes key "Hotdoggin\'" — apostrophe removed from the key so it is URL-safe. Long form left exactly as published.',
  },
}

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const i = t.indexOf('=')
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  return env
}

async function main() {
  const execute = process.argv.includes('--execute')
  const env = loadEnv()
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

  const machinesJson = JSON.parse(readFileSync(join(ROOT, 'mnp-data-archive/machines.json'), 'utf8'))
  const upstream = Object.values(machinesJson) as { key: string; name: string }[]

  const rows = upstream.map((m) => {
    const norm = KEY_NORMALIZATION[m.key]
    return {
      key: norm?.key ?? m.key,
      name: norm?.name ?? m.name,
      source: 'mnp' as const,
      mnp_key: m.key,
      mnp_name: m.name,
      note: norm?.note ?? null,
      active: true,
      updated_at: new Date().toISOString(),
    }
  })

  // --- drift against what is already stored ---
  const { data: existing } = await supabase
    .from('machine_canon')
    .select('key, name, source, mnp_key, mnp_name')
  const byKey = new Map((existing || []).map((r: any) => [r.key, r]))
  const upstreamKeys = new Set(rows.map((r) => r.key))

  const added = rows.filter((r) => !byKey.has(r.key))
  const renamed = rows.filter((r) => {
    const e = byKey.get(r.key)
    return e && e.name !== r.name
  })
  const removed = (existing || []).filter((r: any) => r.source === 'mnp' && !upstreamKeys.has(r.key))

  console.log(`Upstream canon: ${rows.length} machines`)
  console.log(`  new:      ${added.length}${added.length ? ' — ' + added.slice(0, 10).map((r) => r.key).join(', ') : ''}`)
  console.log(`  renamed:  ${renamed.length}${renamed.length ? ' — ' + renamed.map((r) => `${r.key}: "${byKey.get(r.key)!.name}" -> "${r.name}"`).join('; ') : ''}`)
  console.log(`  removed upstream: ${removed.length}${removed.length ? ' — ' + removed.map((r: any) => r.key).join(', ') : ''}`)
  for (const [published, norm] of Object.entries(KEY_NORMALIZATION)) {
    console.log(`  normalized key: "${published}" -> "${norm.key}"`)
  }

  if (!execute) {
    console.log('\nDRY RUN — nothing written. Re-run with --execute.')
    return
  }

  // display_override is deliberately NOT in the update list: it is a human
  // decision and must survive re-seeding.
  const { error } = await supabase
    .from('machine_canon')
    .upsert(rows, { onConflict: 'key', ignoreDuplicates: false })
  if (error) {
    console.error('machine_canon upsert:', error.message)
    process.exit(1)
  }

  await supabase.from('data_provenance').insert({
    batch_id: BATCH_ID,
    category: 'machine_canon',
    entity: 'machine_canon',
    description: `Seeded ${rows.length} machines from the MNP canon`,
    transformation_rule:
      'machines.json {key,name} -> machine_canon{key,name,mnp_key,mnp_name,source=mnp}; two keys normalized for URL safety (see note column)',
    reason: 'Establish a single canonical short/long name pair per machine; MNP is the authority',
    source: 'https://mondaynightpinball.com/machines (mirrored: mnp-data-archive/machines.json)',
    rows_affected: rows.length,
    details: {
      added: added.map((r) => r.key),
      renamed: renamed.map((r) => ({ key: r.key, from: byKey.get(r.key)!.name, to: r.name })),
      removed_upstream: removed.map((r: any) => r.key),
      normalized_keys: KEY_NORMALIZATION,
    },
  })

  console.log(`\nDone — machine_canon holds ${rows.length} MNP rows.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
