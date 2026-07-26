/**
 * Seed the local canon rows and the alias table.
 *
 * Local rows  = machines with real games that MNP does not list (source='local').
 *               They survive re-seeding from machines.json.
 * Aliases     = raw spellings that do NOT resolve by normalization or by
 *               matching a canon long form. Everything reachable by those two
 *               rules is deliberately absent here, which keeps this table a
 *               list of genuine judgements rather than a case-variant dump.
 *
 * Every row carries the reason it exists. Idempotent.
 *
 * Run:  npx tsx scripts/seed-machine-aliases.ts            (dry run)
 *       npx tsx scripts/seed-machine-aliases.ts --execute
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BATCH_ID = 'machine-canon-local-and-aliases-2026-07-26'

/** Machines with games but no MNP canon entry. Approved 2026-07-26. */
const LOCAL_MACHINES: { key: string; name: string; note: string }[] = [
  { key: 'TASM', name: 'The Amazing Spider-Man', note: 'Stern 2007. Confirmed distinct from Spiderman = "Spider-man (Stern)".' },
  { key: '24', name: '24', note: 'Seasons 12-17.' },
  { key: 'Valhalla', name: 'Legends of Valhalla', note: 'Seasons 16-17. Also recorded as "Legends of Valhala".' },
  { key: 'Sharkeys', name: "Sharkey's Shootout", note: 'Season 17.' },
  { key: 'BigGame', name: 'Big Game', note: 'Seasons 16-18.' },
  { key: 'PartyAnimal', name: 'Party Animal', note: 'Add-a-Ball, seasons 14-17. Distinct from PartyZone ("Party Zone"), whose games are seasons 2-7 at other venues; the old machineMappings entry conflating them was wrong.' },
  { key: 'Sorcerer', name: 'Sorcerer', note: 'Seasons 18-19. Also recorded as "Sorcerer - Williams".' },
  { key: 'TimeMachine', name: 'Time Machine', note: 'Time Warp venue, seasons 17-18.' },
  { key: 'TXSector', name: 'TX Sector', note: 'Season 19.' },
  { key: 'Trident', name: 'Trident', note: 'Season 18.' },
  { key: 'TheGames', name: 'The Games', note: 'Season 11.' },
  { key: 'BarryO', name: "Barry O's BBQ Challenge", note: 'Season 19.' },
  { key: 'Torch', name: 'Torch', note: 'Season 8.' },
  { key: 'Pinball', name: 'Pinball (Stern)', note: 'Ice Box, season 16.' },
  { key: '4Aces', name: '4 Aces', note: 'Season 22.' },
]

/** Raw spelling -> canon key, with the reason. Aliases are matched normalized
 *  (lowercase, trimmed, internal whitespace collapsed). */
const ALIASES: { alias: string; key: string; reason: string }[] = [
  // --- key/long-form spellings the resolver cannot reach ---
  { alias: "Hotdoggin'", key: 'Hotdoggin', reason: "MNP's published key; our key drops the apostrophe for URL safety" },
  { alias: 'Godzilla (Stern)', key: 'Godzilla', reason: 'Manufacturer qualifier; canon Godzilla is the Stern machine (SEGAGOD is the Sega one)' },
  { alias: 'FishTales', key: 'FT', reason: 'Long form run together' },
  { alias: 'Junk Yard', key: 'Junkyard', reason: 'Long form split in two' },
  { alias: 'Theater of magic', key: 'TOM', reason: 'American spelling of "Theatre of Magic"' },
  { alias: 'Black Knight SOR', key: 'BKSoR', reason: 'Abbreviated "Sword of Rage"' },
  { alias: 'HighRollerCasino', key: 'HRC', reason: 'Long form run together' },
  { alias: 'Banzai Run', key: 'BanzaiRun', reason: 'Canon key/name are both run together' },
  { alias: 'NightRider', key: 'NR', reason: 'Long form run together' },
  { alias: 'Scooby Doo', key: 'SD', reason: 'Canon long form is hyphenated' },
  { alias: 'Big Lebowski', key: 'TBL', reason: 'Missing leading "The"; canon long form is "The Big Lewbowski"' },
  { alias: 'Lights Camera Action!', key: 'LCA', reason: 'Trailing exclamation mark' },
  { alias: 'Deadpool', key: 'DP', reason: 'Canon long form is two words, "Dead Pool"' },
  { alias: 'Jurrasic', key: 'Jurassic', reason: 'Misspelling' },
  { alias: 'Mandolorian', key: 'Mandalorian', reason: 'Misspelling' },
  { alias: 'The Mandalorian (premium)', key: 'Mandalorian', reason: 'Edition qualifier; MNP tracks one Mandalorian' },
  { alias: 'Stern Rush', key: 'RUSH', reason: 'Manufacturer prefix; canon RUSH is the Stern machine' },
  { alias: 'Can Crusher', key: 'PBR', reason: 'Short for "PBR Can Crusher" — confirmed 2026-07-26' },
  { alias: 'Aliens', key: 'ALIEN', reason: 'Pluralized — confirmed 2026-07-26' },
  { alias: 'Cactus Canyon Remake', key: 'CactusCanyon', reason: 'Remake folded into the original — confirmed 2026-07-26' },
  { alias: 'Woyal Wumble', key: 'RR', reason: 'Joke spelling of Royal Rumble — confirmed 2026-07-26' },
  { alias: 'Sorcerer - Williams', key: 'Sorcerer', reason: 'Manufacturer suffix — confirmed 2026-07-26' },
  { alias: 'Party Animals', key: 'PartyAnimal', reason: 'Pluralized; Add-a-Ball s14-17 — confirmed 2026-07-26' },
  { alias: 'Legends of Valhala', key: 'Valhalla', reason: 'Misspelling' },

  // --- identity judgements backed by season/venue evidence ---
  { alias: 'DND', key: 'BDND', reason: 'Bally 1987. DND runs seasons 8-21 across five venues; SDND (Stern, 2024) only appears from season 21 and supersedes it. The previous mapping to Stern was an era mismatch — confirmed 2026-07-26' },
  { alias: 'Dungeons and Dragons Stern', key: 'SDND', reason: 'Explicitly names the Stern machine' },
  { alias: 'The Godfather', key: 'GF', reason: 'Same venue and season as "The Godfather (JJP)" — one machine — confirmed 2026-07-26' },
  { alias: 'The Godfather (JJP)', key: 'GF', reason: "MNP's Godfather is the Jersey Jack machine — confirmed 2026-07-26" },
  { alias: 'The Incredible Hulk', key: 'Hulk', reason: 'Canon long form is "Incredible Hulk"' },
  { alias: "Marvel's The Incredible Hulk", key: 'Hulk', reason: 'Licensor prefix' },
  { alias: 'James Bond 007', key: '007', reason: 'Canon long form is "James Bond 007 (Thunderball/Dr No)"' },
  { alias: "James Bond '007", key: '007', reason: 'Stray apostrophe' },
  { alias: 'James Bond', key: '007', reason: 'Bare title' },
  { alias: 'Venom Left', key: 'VEN', reason: 'Venue recorded two Venom machines by position; MNP tracks one' },
  { alias: 'Venom Right', key: 'VEN', reason: 'Venue recorded two Venom machines by position; MNP tracks one' },
  { alias: 'Venom (R)', key: 'VEN', reason: 'Venue recorded two Venom machines by position; MNP tracks one' },
]

function normalize(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase()
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

  const { data: canonRows } = await supabase.from('machine_canon').select('key')
  const canonKeys = new Set((canonRows || []).map((r: any) => r.key))
  for (const m of LOCAL_MACHINES) canonKeys.add(m.key)

  const orphans = ALIASES.filter((a) => !canonKeys.has(a.key))
  if (orphans.length) {
    console.error('Aliases pointing at keys that do not exist:')
    for (const o of orphans) console.error(`  ${o.alias} -> ${o.key}`)
    process.exit(1)
  }

  // An alias must not collide with a key or long form the resolver already handles.
  const dupes = new Map<string, number>()
  for (const a of ALIASES) dupes.set(normalize(a.alias), (dupes.get(normalize(a.alias)) || 0) + 1)
  const collisions = Array.from(dupes.entries()).filter(([, n]) => n > 1)
  if (collisions.length) {
    console.error('Duplicate aliases:', collisions.map(([a]) => a).join(', '))
    process.exit(1)
  }

  console.log(`Local canon rows: ${LOCAL_MACHINES.length}`)
  console.log(`Aliases:          ${ALIASES.length}`)
  if (!execute) {
    console.log('\nDRY RUN — nothing written. Re-run with --execute.')
    return
  }

  const localRows = LOCAL_MACHINES.map((m) => ({
    key: m.key,
    name: m.name,
    source: 'local' as const,
    note: m.note,
    active: true,
    updated_at: new Date().toISOString(),
  }))
  const { error: canonErr } = await supabase.from('machine_canon').upsert(localRows, { onConflict: 'key' })
  if (canonErr) {
    console.error('machine_canon local upsert:', canonErr.message)
    process.exit(1)
  }
  console.log(`  machine_canon: +${localRows.length} local rows`)

  const aliasRows = ALIASES.map((a) => ({
    alias: normalize(a.alias),
    alias_raw: a.alias,
    canon_key: a.key,
    origin: 'seed' as const,
    reason: a.reason,
  }))
  const { error: aliasErr } = await supabase.from('machine_aliases').upsert(aliasRows, { onConflict: 'alias' })
  if (aliasErr) {
    console.error('machine_aliases upsert:', aliasErr.message)
    process.exit(1)
  }
  console.log(`  machine_aliases: ${aliasRows.length} rows`)

  await supabase.from('data_provenance').insert([
    {
      batch_id: BATCH_ID,
      category: 'machine_canon',
      entity: 'machine_canon',
      description: `Added ${localRows.length} machines that have games but no MNP canon entry`,
      transformation_rule: "source='local' rows, excluded from upstream re-sync overwrites",
      reason: 'MNP publishes 325 machines; league play includes these 15 others. Without canon rows their games cannot be attributed to a machine.',
      source: 'games table (season/venue evidence), approved by Kellan 2026-07-26',
      rows_affected: localRows.length,
      details: { machines: LOCAL_MACHINES },
    },
    {
      batch_id: BATCH_ID,
      category: 'machine_aliases',
      entity: 'machine_aliases',
      description: `Seeded ${aliasRows.length} alias -> canon key mappings`,
      transformation_rule: 'normalize(raw) = lower/trim/collapse-whitespace, then exact match against this table; only spellings unreachable by key or long-form matching are listed',
      reason: 'Resolve raw machine spellings to one canon key without the direction-dependent, fuzzy-matching behavior of the old machineMappings table',
      source: 'scripts/seed-machine-aliases.ts, approved by Kellan 2026-07-26',
      rows_affected: aliasRows.length,
      details: { aliases: ALIASES },
    },
  ])

  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
