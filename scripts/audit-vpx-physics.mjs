// Reconciles lib/vpx-robocop-table.ts against the original .vpx.
//
// VPX resolves an item's physics the way Surface::SetupHitObject does:
//   MAPH names a physics material AND OVPH is clear -> use that material
//   otherwise                                       -> use the item's own values
// The GameData defaults only apply to items carrying no such tag at all.
//
// Usage: node scripts/audit-vpx-physics.mjs [--json]

import { readFile } from 'node:fs/promises'
import { readCompoundFile, parseBiff, readGameItem } from './lib/vpx-reader.mjs'

const VPX_PATH = 'games/Robocop (Data East 1989)_drakkon(mod_1.2).vpx'
const TABLE_PATH = 'lib/vpx-robocop-table.ts'

const ITEM_TYPE = {
  0: 'wall', 1: 'flipper', 3: 'plunger', 5: 'bumper', 6: 'trigger',
  8: 'kicker', 10: 'gate', 11: 'spinner', 12: 'ramp', 19: 'primitive',
  21: 'rubber', 22: 'target',
}

// VPX spells the same quantity differently per item type; these were read
// back off the actual streams rather than assumed.
//   surface  WFCT/WSCT/ELAS/ELFO      rubber  RFCT/RSCT/ELAS/ELFO
//   ramp     RFCT/RSCT/ELAS           gate    GFRC/-/ELAS
//   spinner  -/-/SELA
const FRICTION_TAGS = ['WFCT', 'RFCT', 'GFRC']
const ELASTICITY_TAGS = ['ELAS', 'SELA']
const FALLOFF_TAGS = ['ELFO']
const SCATTER_TAGS = ['WSCT', 'RSCT']

const first = (item, tags) => {
  for (const tag of tags) {
    const record = item.records.find((r) => r.tag === tag)
    if (record && record.data.length >= 4) return record.data.readFloatLE(0)
  }
  return null
}

const flag = (item, tag) => {
  const record = item.records.find((r) => r.tag === tag)
  return record && record.data.length >= 4 ? record.data.readInt32LE(0) : 0
}

// VPX BIFF strings are a 4-byte length followed by 8-bit characters.
const prefixedString = (item, tag) => {
  const record = item.records.find((r) => r.tag === tag)
  if (!record || record.data.length < 4) return ''
  const length = record.data.readUInt32LE(0)
  if (length <= 0 || length + 4 > record.data.length) return ''
  return record.data.subarray(4, 4 + length).toString('latin1').replace(/\0+$/, '')
}

const streams = await readCompoundFile(VPX_PATH)
const gameData = parseBiff(streams.get('GameStg/GameData'))
const scalar = (tag) => {
  const record = gameData.find((r) => r.tag === tag)
  return record && record.data.length >= 4 ? record.data.readFloatLE(0) : null
}

// --- physics materials ------------------------------------------------------
const materialCount = gameData.find((r) => r.tag === 'MASI').data.readInt32LE(0)
const phma = gameData.find((r) => r.tag === 'PHMA').data
const materials = new Map()
for (let index = 0; index < materialCount; index += 1) {
  const offset = index * 48
  const name = phma.subarray(offset, offset + 32).toString('latin1').replace(/\0.*$/, '').trim()
  materials.set(name, {
    elasticity: phma.readFloatLE(offset + 32),
    elasticityFalloff: phma.readFloatLE(offset + 36),
    friction: phma.readFloatLE(offset + 40),
    scatter: phma.readFloatLE(offset + 44),
  })
}

const tableDefaults = {
  elasticity: scalar('ELAS'),
  elasticityFalloff: scalar('ELFA'),
  friction: scalar('FRCT'),
  scatter: scalar('SCAT'),
}

/**
 * Mirrors Surface::SetupHitObject in vpinball: a physics material wins only
 * when one is assigned AND the item is not set to overwrite physics.
 * Otherwise the item's own values apply -- the table defaults are only ever
 * a fallback for items that carry no such tag at all.
 */
function resolvePhysics(item) {
  const materialName = prefixedString(item, 'MAPH')
  const material = materials.get(materialName)
  if (material && !flag(item, 'OVPH')) return { source: `material "${materialName}"`, ...material }
  return {
    source: materialName ? 'own (OVPH set)' : 'own',
    elasticity: first(item, ELASTICITY_TAGS) ?? tableDefaults.elasticity,
    elasticityFalloff: first(item, FALLOFF_TAGS) ?? tableDefaults.elasticityFalloff,
    friction: first(item, FRICTION_TAGS) ?? tableDefaults.friction,
    scatter: first(item, SCATTER_TAGS) ?? tableDefaults.scatter,
  }
}

const items = [...streams.entries()]
  .filter(([key]) => /GameItem\d+$/.test(key))
  .map(([, value]) => readGameItem(value))

const byName = new Map()
for (const item of items) {
  if (item.name) byName.set(item.name, item)
}

// --- compare against the ported table --------------------------------------
const source = await readFile(TABLE_PATH, 'utf8')
const body = source.slice(source.indexOf('export const VPX_TABLE'))
const table = eval(`(${body
  .replace(/ as const satisfies [^,\n]*/g, '')
  .replace(/ as const/g, '')
  .slice(body.indexOf('=') + 1)
  .trim()
  .replace(/;\s*$/, '')})`)

const near = (a, b) => a != null && b != null && Math.abs(a - b) < 5e-4
const show = (value) => (value == null ? '-' : Number(value).toFixed(4))

const rows = []
function compare(group, entries) {
  for (const entry of entries) {
    const item = byName.get(entry.name)
    if (!item) {
      rows.push({ group, name: entry.name, status: 'MISSING IN VPX' })
      continue
    }
    const actual = resolvePhysics(item)
    const fields = ['elasticity', 'elasticityFalloff', 'friction', 'scatter']
    const mismatched = fields.filter((field) => entry[field] !== undefined && !near(entry[field], actual[field]))
    rows.push({
      group,
      name: entry.name,
      type: ITEM_TYPE[item.type] ?? item.type,
      source: actual.source,
      mismatched,
      ported: Object.fromEntries(fields.map((f) => [f, entry[f]])),
      actual: Object.fromEntries(fields.map((f) => [f, actual[f]])),
    })
  }
}

compare('walls', table.walls)
compare('rubbers', table.rubbers)
compare('slingBodies', table.slingBodies)
compare('slingFaces', table.slingFaces)
compare('contacts', table.contacts)
compare('wireGuides', table.wireGuides)
compare('gates', table.gates)
compare('spinners', table.spinners)
for (const track of table.rampTracks) compare(`ramp:${track.name}`, track.parts)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ tableDefaults, slope: scalar('SLOP'), gravity: scalar('GAVT'), rows }, null, 2))
} else {
  console.log(`table defaults: ${JSON.stringify(tableDefaults)}`)
  console.log(`slope: ${scalar('SLOP')}deg (max ${scalar('SLPX')}deg)   gravity: ${scalar('GAVT')}\n`)
  const bad = rows.filter((row) => row.status || row.mismatched?.length)
  console.log(`${rows.length} items compared, ${bad.length} with mismatches\n`)
  for (const row of bad) {
    if (row.status) {
      console.log(`${row.group}/${row.name}: ${row.status}`)
      continue
    }
    console.log(`${row.group}/${row.name} [${row.type}] resolves from ${row.source}`)
    for (const field of row.mismatched) {
      console.log(`   ${field.padEnd(18)} ported ${show(row.ported[field])}  ->  vpx ${show(row.actual[field])}`)
    }
  }
}
