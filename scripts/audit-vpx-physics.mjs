// Reconciles lib/vpx-robocop-table.ts against the original .vpx.
//
// VPX resolves an item's physics the way Surface::SetupHitObject does:
//   MAPH names a physics material AND OVPH is clear -> use that material
//   otherwise                                       -> use the item's own values
// The GameData defaults only apply to items carrying no such tag at all.
//
// Usage: node scripts/audit-vpx-physics.mjs [--json]

import { readFile } from 'node:fs/promises'
import { readCompoundFile, parseBiff, readGameItem, readTableScript } from './lib/vpx-reader.mjs'

const VPX_PATH = 'games/Robocop (Data East 1989)_drakkon(mod_1.2).vpx'
const TABLE_PATH = 'lib/vpx-robocop-table.ts'
const PRIMITIVE_PATH = 'lib/vpx-robocop-primitives.ts'
const WALL_PATH = 'lib/vpx-robocop-walls.ts'
const TRIGGER_PATH = 'lib/vpx-robocop-triggers.ts'
const COLLECTION_PATH = 'lib/vpx-robocop-collections.ts'
const SCRIPT_PHYSICS_PATH = 'lib/vpx-robocop-script-physics.ts'

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

const vector2 = (item, tag) => {
  const record = item.records.find((candidate) => candidate.tag === tag)
  return record && record.data.length >= 8
    ? [record.data.readFloatLE(0), record.data.readFloatLE(4)]
    : [null, null]
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
  // SCAT is DefaultScatter for objects. PFSC belongs only to the implicit
  // playfield plane and must not be substituted for a surface's own value.
  scatter: scalar('SCAT'),
}

const playfield = {
  gravity: scalar('GAVT'),
  slope: scalar('SLOP'),
  friction: scalar('FRCT'),
  elasticity: scalar('ELAS'),
  elasticityFalloff: scalar('ELFA'),
  scatter: scalar('PFSC'),
  defaultScatter: scalar('SCAT'),
  difficulty: scalar('TDFT'),
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
const primitiveSource = await readFile(PRIMITIVE_PATH, 'utf8')
const primitiveBody = primitiveSource.slice(primitiveSource.indexOf('export const VPX_COLLISION_PRIMITIVES'))
const collisionPrimitives = eval(`(${primitiveBody
  .slice(primitiveBody.indexOf('=') + 1)
  .trim()
  .replace(/ as const satisfies[^\n]*/g, '')
  .replace(/;\s*$/, '')})`)
const wallSource = await readFile(WALL_PATH, 'utf8')
const wallBody = wallSource.slice(wallSource.indexOf('export const VPX_COLLISION_WALLS'))
const collisionWalls = eval(`(${wallBody
  .slice(wallBody.indexOf('=') + 1)
  .trim()
  .replace(/ as const satisfies[^\n]*/g, '')
  .replace(/;\s*$/, '')})`)
const triggerSource = await readFile(TRIGGER_PATH, 'utf8')
const triggerBody = triggerSource.slice(triggerSource.indexOf('export const VPX_TRIGGER_VOLUMES'))
const triggerVolumes = eval(`(${triggerBody
  .slice(triggerBody.indexOf('=') + 1)
  .trim()
  .replace(/ as const satisfies[^\n]*/g, '')
  .replace(/;\s*$/, '')})`)
const collectionSource = await readFile(COLLECTION_PATH, 'utf8')
const collectionBody = collectionSource.slice(collectionSource.indexOf('export const VPX_COLLECTIONS'))
const collections = eval(`(${collectionBody
  .slice(collectionBody.indexOf('=') + 1)
  .trim()
  .replace(/ as const satisfies[^\n]*/g, '')
  .replace(/;\s*$/, '')})`)
const scriptPhysicsSource = await readFile(SCRIPT_PHYSICS_PATH, 'utf8')
const scriptPhysicsBody = scriptPhysicsSource.slice(scriptPhysicsSource.indexOf('export const VPX_ROBOCOP_SCRIPT_PHYSICS'))
const scriptPhysics = eval(`(${scriptPhysicsBody
  .slice(scriptPhysicsBody.indexOf('=') + 1)
  .trim()
  .replace(/ as const\s*$/, '')})`)

const near = (a, b) => a != null && b != null && Math.abs(a - b) < 5e-4
const show = (value) => (value == null ? '-' : Number(value).toFixed(4))
const playfieldMismatches = Object.keys(playfield).filter((field) => !near(table.playfield[field], playfield[field]))

const rows = []

function compareScriptPhysics() {
  const raw = readTableScript(streams).replace(/\r/g, '')
  const active = raw.split('\n').map((line) => line.replace(/'.*$/, '')).join('\n')
  const scriptNumber = (name) => {
    const match = active.match(new RegExp(`^\\s*(?:Const\\s+)?${name}\\s*=\\s*(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+))`, 'im'))
    return match ? Number(match[1]) : null
  }
  const expected = {
    gameTimerIntervalMilliseconds: Number(raw.match(/The game timer interval is\s+(\d+)\s*ms/i)?.[1]),
    endOfStrokeTorque: scriptNumber('EOSTnew'),
    endOfStrokeAngleDegrees: scriptNumber('EOSAnew'),
    endOfStrokeRampUp: scriptNumber('EOSRampup'),
    startOfStrokeRampUp: scriptNumber('SOSRampup'),
    liveCatchMilliseconds: scriptNumber('LiveCatch'),
    liveElasticity: scriptNumber('LiveElasticity'),
    restElasticityMultiplier: scriptNumber('SOSEM'),
    returnTorqueRatio: scriptNumber('EOSReturn'),
    liveCatchDistanceMin: scriptNumber('LiveDistanceMin'),
    liveCatchDistanceMax: scriptNumber('LiveDistanceMax'),
    standupAnimationStep: scriptNumber('STAnimStep'),
    standupMaximumOffset: scriptNumber('STMaxOffset'),
    standupMass: scriptNumber('STMass'),
    targetBouncerFactor: scriptNumber('TargetBouncerFactor'),
  }
  const ported = {
    gameTimerIntervalMilliseconds: scriptPhysics.gameTimerIntervalMilliseconds,
    endOfStrokeTorque: scriptPhysics.flipper.endOfStrokeTorque,
    endOfStrokeAngleDegrees: scriptPhysics.flipper.endOfStrokeAngleDegrees,
    endOfStrokeRampUp: scriptPhysics.flipper.endOfStrokeRampUp,
    startOfStrokeRampUp: scriptPhysics.flipper.startOfStrokeRampUp,
    liveCatchMilliseconds: scriptPhysics.flipper.liveCatchMilliseconds,
    liveElasticity: scriptPhysics.flipper.liveElasticity,
    restElasticityMultiplier: scriptPhysics.flipper.restElasticityMultiplier,
    returnTorqueRatio: scriptPhysics.flipper.returnTorqueRatio,
    liveCatchDistanceMin: scriptPhysics.flipper.liveCatchDistanceMin,
    liveCatchDistanceMax: scriptPhysics.flipper.liveCatchDistanceMax,
    standupAnimationStep: scriptPhysics.standup.animationStep,
    standupMaximumOffset: scriptPhysics.standup.maximumOffset,
    standupMass: scriptPhysics.standup.mass,
    targetBouncerFactor: scriptPhysics.targetBouncer.factor,
  }
  for (const field of Object.keys(expected)) {
    rows.push({
      group: 'script-physics', name: field, type: 'VBScript', source: 'embedded CODE',
      mismatched: near(ported[field], expected[field]) ? [] : ['value'],
      ported: { value: ported[field] }, actual: { value: expected[field] },
    })
  }
}

function compare(group, entries) {
  for (const entry of entries) {
    const item = byName.get(entry.name)
    if (!item) {
      rows.push({ group, name: entry.name, status: 'MISSING IN VPX' })
      continue
    }
    const actual = resolvePhysics(item)
    const fields = ['elasticity', 'elasticityFalloff', 'friction', 'scatter']
    const portedValues = Object.fromEntries(fields.map((field) => [field, entry[field]]))
    const actualValues = Object.fromEntries(fields.map((field) => [field, actual[field]]))
    if (group === 'gates') {
      fields.push('twoWay')
      portedValues.twoWay = entry.twoWay
      actualValues.twoWay = Boolean(flag(item, 'TWWA'))
    }
    if (group === 'contacts' && entry.threshold != null) {
      fields.push('threshold')
      portedValues.threshold = entry.threshold
      actualValues.threshold = first(item, ['THRS'])
    }
    const mismatched = fields.filter((field) => entry[field] !== undefined && !near(entry[field], actualValues[field]))
    rows.push({
      group,
      name: entry.name,
      type: ITEM_TYPE[item.type] ?? item.type,
      source: actual.source,
      mismatched,
      ported: portedValues,
      actual: actualValues,
    })
  }
}

function compareHeightBands(group, entries, rubber = false, compareSolidBottom = false) {
  for (const entry of entries) {
    const item = byName.get(entry.name)
    if (!item) continue
    const portedBand = entry.heightBottom != null && entry.heightTop != null
      ? [entry.heightBottom, entry.heightTop]
      : table.collisionHeightBands[entry.name] ?? [0, 50]
    const actualBand = rubber
      ? (() => {
          const hitHeight = first(item, ['HTHI'])
          const halfThickness = (entry.thickness ?? 0) / 2
          return [hitHeight - halfThickness, hitHeight + halfThickness]
        })()
      : [first(item, ['HTBT']), first(item, ['HTTP'])]
    const fields = ['heightBottom', 'heightTop']
    const ported = { heightBottom: portedBand[0], heightTop: portedBand[1] }
    const actual = { heightBottom: actualBand[0], heightTop: actualBand[1] }
    if (compareSolidBottom) {
      fields.push('solidBottom')
      ported.solidBottom = entry.solidBottom ?? table.solidBottomWalls.includes(entry.name)
      actual.solidBottom = Boolean(flag(item, 'ISBS'))
    }
    const mismatched = fields.filter((field) => !near(ported[field], actual[field]))
    rows.push({ group, name: entry.name, type: ITEM_TYPE[item.type] ?? item.type, source: 'geometry', mismatched, ported, actual })
  }
}

function compareBumpers(entries) {
  for (const entry of entries) {
    const item = byName.get(entry.name)
    if (!item) {
      rows.push({ group: 'bumpers', name: entry.name, status: 'MISSING IN VPX' })
      continue
    }
    const fields = ['radius', 'force', 'threshold', 'scatter']
    const ported = {
      radius: entry.radius,
      force: entry.force,
      threshold: entry.threshold,
      scatter: entry.scatter,
    }
    const actual = {
      radius: first(item, ['RADI']),
      force: first(item, ['FORC']),
      threshold: first(item, ['THRS']),
      scatter: first(item, ['BSCT']),
    }
    const mismatched = fields.filter((field) => !near(ported[field], actual[field]))
    rows.push({ group: 'bumpers', name: entry.name, type: 'bumper', source: 'geometry', mismatched, ported, actual })
  }
}

function compareKickers(entries) {
  for (const entry of entries) {
    const item = byName.get(entry.name)
    if (!item) {
      rows.push({ group: 'kickers', name: entry.name, status: 'MISSING IN VPX' })
      continue
    }
    const fields = ['radius', 'hitAccuracy', 'hitHeight']
    const ported = {
      radius: entry.radius,
      hitAccuracy: entry.hitAccuracy,
      hitHeight: entry.hitHeight,
    }
    const actual = {
      radius: first(item, ['RADI']),
      hitAccuracy: first(item, ['KHAC']),
      hitHeight: first(item, ['KHHI']),
    }
    const mismatched = fields.filter((field) => !near(ported[field], actual[field]))
    rows.push({ group: 'kickers', name: entry.name, type: 'kicker', source: 'geometry', mismatched, ported, actual })
  }
}

function compareFlipper(group, entry, itemName) {
  const item = byName.get(itemName)
  if (!item) {
    rows.push({ group, name: itemName, status: 'MISSING IN VPX' })
    return
  }
  const fields = [
    'baseRadius', 'endRadius', 'length', 'rubberThickness', 'startAngle', 'endAngle',
    'returnStrength', 'mass', 'strength', 'elasticity', 'elasticityFalloff',
    'friction', 'rampUp', 'scatter', 'torqueDamping', 'torqueDampingAngle',
  ]
  const actual = {
    baseRadius: first(item, ['BASR']), endRadius: first(item, ['ENDR']),
    length: first(item, ['FLPR']), rubberThickness: first(item, ['RTHF']),
    startAngle: first(item, ['ANGS']), endAngle: first(item, ['ANGE']),
    returnStrength: first(item, ['FRTN']), mass: first(item, ['FORC']),
    strength: first(item, ['STRG']), elasticity: first(item, ['ELAS']),
    elasticityFalloff: first(item, ['ELFO']), friction: first(item, ['FRIC']),
    rampUp: first(item, ['RPUP']), scatter: first(item, ['SCTR']),
    torqueDamping: first(item, ['TODA']), torqueDampingAngle: first(item, ['TDAA']),
  }
  const ported = Object.fromEntries(fields.map((field) => [field, entry[field]]))
  const mismatched = fields.filter((field) => !near(ported[field], actual[field]))
  rows.push({ group, name: itemName, type: 'flipper', source: 'mechanism', mismatched, ported, actual })
}

function comparePlunger(group, entry, itemName) {
  const item = byName.get(itemName)
  if (!item) {
    rows.push({ group, name: itemName, status: 'MISSING IN VPX' })
    return
  }
  const [centerX, centerY] = vector2(item, 'VCEN')
  const fields = [
    'centerX', 'centerY', 'width', 'stroke', 'speedFire', 'mechStrength',
    'parkPosition', 'momentumTransfer', 'scatterVelocity',
  ]
  if (entry.speedPull != null) fields.push('speedPull')
  const ported = {
    centerX: entry.center[0], centerY: entry.center[1], width: entry.width,
    stroke: entry.stroke, speedFire: entry.speedFire, mechStrength: entry.mechStrength,
    parkPosition: entry.parkPosition, speedPull: entry.speedPull,
    momentumTransfer: entry.momentumTransfer, scatterVelocity: entry.scatterVelocity,
  }
  const actual = {
    centerX, centerY, width: first(item, ['WDTH']), stroke: first(item, ['HPSL']),
    speedFire: first(item, ['SPDF']), mechStrength: first(item, ['MEST']),
    parkPosition: first(item, ['MPRK']), speedPull: first(item, ['SPDP']),
    momentumTransfer: first(item, ['MOMX']), scatterVelocity: first(item, ['PSCV']),
  }
  const mismatched = fields.filter((field) => !near(ported[field], actual[field]))
  rows.push({ group, name: itemName, type: 'plunger', source: 'mechanism', mismatched, ported, actual })
}

function triggerDragPoints(item) {
  const points = []
  const smooth = []
  for (let index = 0; index < item.records.length; index += 1) {
    if (item.records[index].tag !== 'DPNT') continue
    const nested = []
    for (let recordIndex = index + 1; recordIndex < item.records.length; recordIndex += 1) {
      nested.push(item.records[recordIndex])
      if (item.records[recordIndex].tag === 'ENDB') break
    }
    const center = nested.find((candidate) => candidate.tag === 'VCEN')
    const smoothRecord = nested.find((candidate) => candidate.tag === 'SMTH')
    if (center?.data.length >= 8) points.push([center.data.readFloatLE(0), center.data.readFloatLE(4)])
    smooth.push(Boolean(smoothRecord?.data.length >= 4 && smoothRecord.data.readInt32LE(0)))
  }
  return { points, smooth }
}

function compareTriggerVolumes(entries) {
  for (const entry of entries) {
    const item = byName.get(entry.name)
    if (!item) {
      rows.push({ group: 'triggers', name: entry.name, status: 'MISSING IN VPX' })
      continue
    }
    const [centerX, centerY] = vector2(item, 'VCEN')
    const actualGeometry = triggerDragPoints(item)
    const fields = ['centerX', 'centerY', 'radius', 'hitHeight', 'shape', 'enabled', 'points', 'smooth']
    const ported = {
      centerX: entry.center[0], centerY: entry.center[1], radius: entry.radius,
      hitHeight: entry.hitHeight, shape: entry.shape, enabled: entry.enabled,
      points: entry.points.length, smooth: entry.smooth.filter(Boolean).length,
    }
    const actual = {
      centerX, centerY, radius: first(item, ['RADI']), hitHeight: first(item, ['THOT']),
      shape: flag(item, 'SHAP'), enabled: Boolean(flag(item, 'EBLD')),
      points: actualGeometry.points.length, smooth: actualGeometry.smooth.filter(Boolean).length,
    }
    const pointMismatch = entry.points.some((point, index) => (
      !near(point[0], actualGeometry.points[index]?.[0]) || !near(point[1], actualGeometry.points[index]?.[1])
      || entry.smooth[index] !== actualGeometry.smooth[index]
    ))
    const mismatched = fields.filter((field) => !near(ported[field], actual[field]))
    if (pointMismatch && !mismatched.includes('points')) mismatched.push('points')
    rows.push({ group: 'triggers', name: entry.name, type: 'trigger', source: 'geometry', mismatched, ported, actual })
  }
}

const collectionWideString = (record) => {
  if (!record || record.data.length < 4) return ''
  const byteLength = record.data.readUInt32LE(0)
  return record.data.subarray(4, 4 + byteLength).toString('utf16le').replace(/\0+$/, '')
}

function compareCollections(entries) {
  const actualCollections = [...streams.entries()]
    .filter(([path]) => /GameStg\/Collection\d+$/.test(path))
    .map(([, value]) => {
      const records = parseBiff(value, 0, false)
      return {
        name: collectionWideString(records.find((record) => record.tag === 'NAME')),
        items: records.filter((record) => record.tag === 'ITEM').map(collectionWideString),
        fireEvents: Boolean(records.find((record) => record.tag === 'EVNT')?.data.readInt32LE(0)),
        stopSingleEvents: Boolean(records.find((record) => record.tag === 'SSNG')?.data.readInt32LE(0)),
        groupElements: Boolean(records.find((record) => record.tag === 'GREL')?.data.readInt32LE(0)),
      }
    })
  const actualByName = new Map(actualCollections.map((collection) => [collection.name, collection]))
  for (const entry of entries) {
    const actualCollection = actualByName.get(entry.name)
    if (!actualCollection) {
      rows.push({ group: 'collections', name: entry.name, status: 'MISSING IN VPX' })
      continue
    }
    const ported = {
      items: entry.items.length, fireEvents: entry.fireEvents,
      stopSingleEvents: entry.stopSingleEvents, groupElements: entry.groupElements,
    }
    const actual = {
      items: actualCollection.items.length, fireEvents: actualCollection.fireEvents,
      stopSingleEvents: actualCollection.stopSingleEvents, groupElements: actualCollection.groupElements,
    }
    const mismatched = ['items', 'fireEvents', 'stopSingleEvents', 'groupElements']
      .filter((field) => !near(ported[field], actual[field]))
    if (entry.items.some((name, index) => name !== actualCollection.items[index])
      && !mismatched.includes('items')) mismatched.push('items')
    rows.push({ group: 'collections', name: entry.name, type: 'collection', source: 'membership', mismatched, ported, actual })
  }
  const portedNames = new Set(entries.map((entry) => entry.name))
  actualCollections.forEach((collection) => {
    if (!portedNames.has(collection.name)) {
      rows.push({ group: 'collection-coverage', name: collection.name, status: 'VPX COLLECTION NOT PORTED' })
    }
  })
}

compare('walls', collisionWalls)
compareScriptPhysics()
compare('rubbers', table.rubbers)
compare('slingBodies', table.slingBodies)
compare('slingFaces', table.slingFaces)
compare('contacts', table.contacts)
compare('wireGuides', table.wireGuides)
compare('gates', table.gates)
compare('spinners', table.spinners)
compareBumpers(table.bumpers)
compareKickers(table.kickers)
compareFlipper('flippers', table.flippers.left, 'LeftFlipper')
compareFlipper('flippers', table.flippers.right, 'RightFlipper')
comparePlunger('plungers', table.plunger, 'Plunger')
comparePlunger('plungers', table.kickback, 'KickBack')
compareTriggerVolumes(triggerVolumes)
compareCollections(collections)
compare('primitives', collisionPrimitives)
const portedPrimitiveNames = new Set(collisionPrimitives.map((primitive) => primitive.name))
for (const item of items.filter((candidate) => candidate.type === 19 && flag(candidate, 'CLDR'))) {
  if (!portedPrimitiveNames.has(item.name)) {
    rows.push({ group: 'primitive-coverage', name: item.name, status: 'COLLIDABLE VPX PRIMITIVE NOT PORTED' })
  }
}
for (const track of table.rampTracks) compare(`ramp:${track.name}`, track.parts)
const portedWallNames = new Set(collisionWalls.map((wall) => wall.name))
for (const item of items.filter((candidate) => candidate.type === 0 && flag(candidate, 'CLDW'))) {
  if (!portedWallNames.has(item.name)) {
    rows.push({ group: 'wall-coverage', name: item.name, status: 'COLLIDABLE VPX WALL NOT PORTED' })
  }
}
const portedTriggerNames = new Set(triggerVolumes.map((trigger) => trigger.name))
for (const item of items.filter((candidate) => candidate.type === 6)) {
  if (!portedTriggerNames.has(item.name)) {
    rows.push({ group: 'trigger-coverage', name: item.name, status: 'VPX TRIGGER NOT PORTED' })
  }
}
compareHeightBands('wall-heights', collisionWalls, false, true)
compareHeightBands('sling-heights', table.slingBodies, false, true)
compareHeightBands('rubber-heights', table.rubbers, true)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ playfield, playfieldMismatches, tableDefaults, rows }, null, 2))
} else {
  console.log(`playfield: ${JSON.stringify(playfield)}`)
  console.log(`table defaults: ${JSON.stringify(tableDefaults)}`)
  console.log(`maximum slope: ${scalar('SLPX')}deg\n`)
  const bad = rows.filter((row) => row.status || row.mismatched?.length)
  console.log(`${rows.length} items compared, ${bad.length + playfieldMismatches.length} with mismatches\n`)
  for (const field of playfieldMismatches) {
    console.log(`playfield/${field}: ported ${show(table.playfield[field])}  ->  vpx ${show(playfield[field])}`)
  }
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

if (playfieldMismatches.length || rows.some((row) => row.status || row.mismatched?.length)) process.exitCode = 1
