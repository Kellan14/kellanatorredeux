// Extracts the visible collidable primitive meshes used by the RoboCop table.
// Geometry comes from the vpxtool GLB export; material physics comes directly
// from the original VPX GameItem streams.

import { readFile, writeFile } from 'node:fs/promises'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { parseBiff, readCompoundFile, readGameItem } from './lib/vpx-reader.mjs'

const GLB_PATH = 'public/vpx/robocop/Robocop (Data East 1989)_drakkon(mod_1.2).glb'
const VPX_PATH = 'games/Robocop (Data East 1989)_drakkon(mod_1.2).vpx'
const OUTPUT_PATH = 'lib/vpx-robocop-primitives.ts'

const CUSTOM_PRIMITIVE_NAMES = new Set([
  'Primitive109', 'Primitive152', 'Primitive211', 'Primitive212',
  'Primitive213', 'Primitive214', 'Primitive220', 'Primitive221',
  'Primitive223', 'Primitive224', 'Primitive233', 'Primitive246',
])
const BUILTIN_PRIMITIVE_NAMES = new Set([
  'zCol_Rubber_Corner_009', 'zCol_Rubber_Corner_008', 'zCol_Rubber_Corner_007',
  'zCol_Rubber_Corner_011', 'zCol_Rubber_Corner_010', 'zCol_Rubber_Corner_012',
  'zCol_Rubber_Corner_005', 'zCol_Rubber_Corner_003', 'zCol_Rubber_Corner_001',
  'sw33o', 'sw34o', 'sw35o', 'sw36o', 'sw41o', 'sw42o', 'sw43o', 'sw23o',
])
const PRIMITIVE_NAMES = new Set([...CUSTOM_PRIMITIVE_NAMES, ...BUILTIN_PRIMITIVE_NAMES])

function readGlb(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'glTF') throw new Error('Not a GLB file')
  let json = null
  let binary = null
  for (let offset = 12; offset < buffer.length;) {
    const length = buffer.readUInt32LE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'JSON') json = JSON.parse(data.toString('utf8'))
    if (type === 'BIN\0') binary = data
    offset += 8 + length
  }
  if (!json || !binary) throw new Error('GLB is missing JSON or BIN chunk')
  return { json, binary }
}

const COMPONENT_BYTES = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

function readAccessor(gltf, binary, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex]
  const view = gltf.bufferViews[accessor.bufferView]
  const componentCount = TYPE_COMPONENTS[accessor.type]
  const componentBytes = COMPONENT_BYTES[accessor.componentType]
  if (!componentCount || !componentBytes) throw new Error(`Unsupported accessor ${accessorIndex}`)
  const stride = view.byteStride ?? componentCount * componentBytes
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const values = new Array(accessor.count * componentCount)
  const read = accessor.componentType === 5121
    ? (offset) => binary.readUInt8(offset)
    : accessor.componentType === 5123
      ? (offset) => binary.readUInt16LE(offset)
      : accessor.componentType === 5125
        ? (offset) => binary.readUInt32LE(offset)
        : (offset) => binary.readFloatLE(offset)
  for (let index = 0; index < accessor.count; index += 1) {
    const offset = base + index * stride
    for (let component = 0; component < componentCount; component += 1) {
      values[index * componentCount + component] = read(offset + component * componentBytes)
    }
  }
  return values
}

function localMatrix(node) {
  if (node.matrix) return new Matrix4().fromArray(node.matrix)
  return new Matrix4().compose(
    new Vector3(...(node.translation ?? [0, 0, 0])),
    new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
    new Vector3(...(node.scale ?? [1, 1, 1])),
  )
}

function worldMatrices(gltf) {
  const parents = new Map()
  gltf.nodes.forEach((node, index) => node.children?.forEach((child) => parents.set(child, index)))
  const cache = new Map()
  const world = (index) => {
    if (cache.has(index)) return cache.get(index)
    const local = localMatrix(gltf.nodes[index])
    const parent = parents.get(index)
    const matrix = parent == null ? local : world(parent).clone().multiply(local)
    cache.set(index, matrix)
    return matrix
  }
  return world
}

const floatTag = (item, tag, fallback) => {
  const record = item.records.find((candidate) => candidate.tag === tag)
  return record?.data.length >= 4 ? record.data.readFloatLE(0) : fallback
}
const intTag = (item, tag, fallback) => {
  const record = item.records.find((candidate) => candidate.tag === tag)
  return record?.data.length >= 4 ? record.data.readInt32LE(0) : fallback
}
const stringTag = (item, tag) => {
  const record = item.records.find((candidate) => candidate.tag === tag)
  if (!record || record.data.length < 4) return ''
  const length = record.data.readUInt32LE(0)
  if (length <= 0 || length + 4 > record.data.length) return ''
  return record.data.subarray(4, 4 + length).toString('latin1').replace(/\0+$/, '')
}
const vectorTag = (item, tag) => {
  const record = item.records.find((candidate) => candidate.tag === tag)
  if (!record || record.data.length < 12) throw new Error(`${item.name} is missing ${tag}`)
  return [record.data.readFloatLE(0), record.data.readFloatLE(4), record.data.readFloatLE(8)]
}
const rounded = (value) => Math.round(value * 10000) / 10000
const radians = (degrees) => degrees * Math.PI / 180

function primitiveMatrix(item) {
  const position = vectorTag(item, 'VPOS')
  const size = vectorTag(item, 'VSIZ')
  const transform = Array.from({ length: 9 }, (_, index) => floatTag(item, `RTV${index}`, 0))
  // Column-vector equivalent of Primitive::RecalculateMatrices. This order is
  // verified against the final world bounds of the rotated custom GLB meshes.
  return new Matrix4().makeTranslation(...position)
    .multiply(new Matrix4().makeRotationX(radians(transform[6])))
    .multiply(new Matrix4().makeRotationY(radians(transform[7])))
    .multiply(new Matrix4().makeRotationZ(radians(transform[8])))
    .multiply(new Matrix4().makeRotationX(radians(transform[0])))
    .multiply(new Matrix4().makeRotationY(radians(transform[1])))
    .multiply(new Matrix4().makeRotationZ(radians(transform[2])))
    .multiply(new Matrix4().makeTranslation(transform[3], transform[4], transform[5]))
    .multiply(new Matrix4().makeScale(...size))
}

function builtinPrimitiveMesh(item) {
  const sides = intTag(item, 'SIDS', 4)
  const outerRadius = -0.5 / Math.cos(Math.PI / sides)
  const vertices = [0, 0, 0.5, 0, 0, -0.5]
  for (let index = 0; index < sides; index += 1) {
    const angle = 2 * Math.PI * index / sides + Math.PI / sides
    const x = Math.sin(angle) * outerRadius
    const y = Math.cos(angle) * outerRadius
    vertices.push(x, y, 0.5, x, y, -0.5)
  }
  const indices = []
  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides
    const top = 2 + index * 2
    const bottom = top + 1
    const nextTop = 2 + next * 2
    const nextBottom = nextTop + 1
    indices.push(0, nextTop, top)
    indices.push(1, bottom, nextBottom)
    indices.push(top, nextTop, nextBottom, top, nextBottom, bottom)
  }
  const matrix = primitiveMatrix(item)
  for (let index = 0; index < vertices.length; index += 3) {
    const point = new Vector3(vertices[index], vertices[index + 1], vertices[index + 2]).applyMatrix4(matrix)
    vertices[index] = rounded(point.x)
    vertices[index + 1] = rounded(point.y)
    vertices[index + 2] = rounded(point.z)
  }
  return { vertices, indices }
}

const glb = readGlb(await readFile(GLB_PATH))
const world = worldMatrices(glb.json)
const streams = await readCompoundFile(VPX_PATH)
const gameData = parseBiff(streams.get('GameStg/GameData'))
const materialCount = gameData.find((record) => record.tag === 'MASI').data.readInt32LE(0)
const materialData = gameData.find((record) => record.tag === 'PHMA').data
const physicsMaterials = new Map()
for (let index = 0; index < materialCount; index += 1) {
  const offset = index * 48
  const name = materialData.subarray(offset, offset + 32).toString('latin1').replace(/\0.*$/, '').trim()
  physicsMaterials.set(name, {
    elasticity: materialData.readFloatLE(offset + 32),
    elasticityFalloff: materialData.readFloatLE(offset + 36),
    friction: materialData.readFloatLE(offset + 40),
    scatter: materialData.readFloatLE(offset + 44),
  })
}
const gameItems = new Map([...streams.entries()]
  .filter(([key]) => /GameItem\d+$/.test(key))
  .map(([, value]) => readGameItem(value))
  .map((item) => [item.name, item]))

function primitivePhysics(item) {
  const material = physicsMaterials.get(stringTag(item, 'MAPH'))
  if (material && !intTag(item, 'OVPH', 0)) return material
  return {
    elasticity: floatTag(item, 'ELAS', 0.3),
    elasticityFalloff: floatTag(item, 'ELFO', 0),
    friction: floatTag(item, 'RFCT', 0.3),
    scatter: floatTag(item, 'RSCT', 0),
  }
}

const primitives = []
for (let nodeIndex = 0; nodeIndex < glb.json.nodes.length; nodeIndex += 1) {
  const node = glb.json.nodes[nodeIndex]
  if (!CUSTOM_PRIMITIVE_NAMES.has(node.name) || node.mesh == null) continue
  const item = gameItems.get(node.name)
  if (!item) throw new Error(`Missing VPX item ${node.name}`)
  const physics = primitivePhysics(item)
  const matrix = world(nodeIndex)
  const vertices = []
  const indices = []
  for (const meshPart of glb.json.meshes[node.mesh].primitives) {
    if ((meshPart.mode ?? 4) !== 4) throw new Error(`${node.name} is not a triangle mesh`)
    const positions = readAccessor(glb.json, glb.binary, meshPart.attributes.POSITION)
    const vertexOffset = vertices.length / 3
    for (let index = 0; index < positions.length; index += 3) {
      const point = new Vector3(positions[index], positions[index + 1], positions[index + 2]).applyMatrix4(matrix)
      // vpxtool maps VPX x/y/z to glTF x/z/y.
      vertices.push(rounded(point.x), rounded(point.z), rounded(point.y))
    }
    const partIndices = meshPart.indices == null
      ? Array.from({ length: positions.length / 3 }, (_, index) => index)
      : readAccessor(glb.json, glb.binary, meshPart.indices)
    indices.push(...partIndices.map((index) => index + vertexOffset))
  }
  primitives.push({
    name: node.name,
    elasticity: rounded(physics.elasticity),
    elasticityFalloff: rounded(physics.elasticityFalloff),
    friction: rounded(physics.friction),
    scatter: rounded(physics.scatter),
    vertices,
    indices,
  })
}

for (const name of BUILTIN_PRIMITIVE_NAMES) {
  const item = gameItems.get(name)
  if (!item) throw new Error(`Missing VPX item ${name}`)
  const { vertices, indices } = builtinPrimitiveMesh(item)
  const physics = primitivePhysics(item)
  primitives.push({
    name,
    elasticity: rounded(physics.elasticity),
    elasticityFalloff: rounded(physics.elasticityFalloff),
    friction: rounded(physics.friction),
    scatter: rounded(physics.scatter),
    vertices,
    indices,
  })
}

const missing = [...PRIMITIVE_NAMES].filter((name) => !primitives.some((primitive) => primitive.name === name))
if (missing.length) throw new Error(`Missing GLB primitives: ${missing.join(', ')}`)

const output = `// Generated by scripts/extract-vpx-collision-primitives.mjs.\n`
  + `// Do not hand-edit: regenerate from the RoboCop VPX and GLB.\n\n`
  + `export type VpxCollisionPrimitive = {\n`
  + `  name: string\n  elasticity: number\n  elasticityFalloff: number\n`
  + `  friction: number\n  scatter: number\n  vertices: readonly number[]\n  indices: readonly number[]\n}\n\n`
  + `export const VPX_COLLISION_PRIMITIVES = ${JSON.stringify(primitives)} as const satisfies readonly VpxCollisionPrimitive[]\n`

await writeFile(OUTPUT_PATH, output)
console.log(`wrote ${OUTPUT_PATH}: ${primitives.length} primitives, ${primitives.reduce((sum, primitive) => sum + primitive.indices.length / 3, 0)} triangles`)
