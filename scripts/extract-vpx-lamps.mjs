// Bakes the animated lamp inserts out of a VPX glTF export into a small TS
// module, so the runtime never has to load the 30 MB table just to blink.
//
// The picker draws the table as a pre-rendered top-down image
// (scripts/render-vpx-table.mjs). The only thing the live 3D scene ever
// animated was insert emissive/opacity, and its camera was a fixed
// orthographic top-down view, so every insert reduces to a VPX-space centre,
// a radius and a colour. This reads those straight from the glTF JSON chunk
// and the POSITION accessor bounds -- no WebGL context needed.
//
// Usage: node scripts/extract-vpx-lamps.mjs <table.glb> <out.ts>

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [, , glbArgument, outputArgument] = process.argv
if (!glbArgument || !outputArgument) {
  throw new Error('Usage: node scripts/extract-vpx-lamps.mjs <table.glb> <out.ts>')
}

const glb = await readFile(resolve(glbArgument))
if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error('not a binary glTF')
const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'))

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function multiply(a, b) {
  const out = new Array(16)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] = a[row] * b[column * 4]
        + a[4 + row] * b[column * 4 + 1]
        + a[8 + row] * b[column * 4 + 2]
        + a[12 + row] * b[column * 4 + 3]
    }
  }
  return out
}

// glTF stores node transforms either as a full column-major matrix or as
// separate translation/rotation/scale. Compose the TRS form the same way
// three.js does so the baked centres line up with the rendered image.
function localMatrix(node) {
  if (node.matrix) return node.matrix.slice()
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale ?? [1, 1, 1]
  const [tx, ty, tz] = node.translation ?? [0, 0, 0]
  const x2 = x + x, y2 = y + y, z2 = z + z
  const xx = x * x2, xy = x * y2, xz = x * z2
  const yy = y * y2, yz = y * z2, zz = z * z2
  const wx = w * x2, wy = w * y2, wz = w * z2
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ]
}

function transformPoint(matrix, x, y, z) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ]
}

const worldMatrices = new Map()
const walk = (index, parent) => {
  const node = gltf.nodes[index]
  const world = multiply(parent, localMatrix(node))
  worldMatrices.set(index, world)
  ;(node.children ?? []).forEach((child) => walk(child, world))
}
;(gltf.scenes[gltf.scene ?? 0].nodes ?? []).forEach((index) => walk(index, identity()))

// VPX-space bounds of an insert mesh. vpxtool maps VPX x/y/z to glTF x/z/y,
// so the top-down footprint is the glTF x/z extent.
function insertBounds(node, world) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const primitive of gltf.meshes[node.mesh].primitives) {
    const accessor = gltf.accessors[primitive.attributes.POSITION]
    if (!accessor?.min || !accessor?.max) continue
    for (let corner = 0; corner < 8; corner += 1) {
      const [x, y, z] = transformPoint(
        world,
        corner & 1 ? accessor.max[0] : accessor.min[0],
        corner & 2 ? accessor.max[1] : accessor.min[1],
        corner & 4 ? accessor.max[2] : accessor.min[2],
      )
      void y
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minY) minY = z
      if (z > maxY) maxY = z
    }
  }
  if (!Number.isFinite(minX)) return null
  return { minX, maxX, minY, maxY }
}

function insertColor(node) {
  for (const primitive of gltf.meshes[node.mesh].primitives) {
    const factor = gltf.materials[primitive.material]?.pbrMetallicRoughness?.baseColorFactor
    if (!factor) continue
    // glTF base colours are linear; the runtime canvas works in sRGB.
    const channel = (value) => Math.round(255 * (value <= 0.0031308
      ? value * 12.92
      : 1.055 * value ** (1 / 2.4) - 0.055))
    return `#${[factor[0], factor[1], factor[2]].map((v) => channel(Math.min(1, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
  }
  return '#ffffff'
}

const round = (value) => Math.round(value * 100) / 100
const lamps = []
for (const [index, node] of gltf.nodes.entries()) {
  const match = /^(L(\d+)[a-z]?|F\d+[a-z]?)_insert$/i.exec(node.name ?? '')
  if (!match || node.mesh == null) continue
  const bounds = insertBounds(node, worldMatrices.get(index) ?? identity())
  if (!bounds) continue
  lamps.push({
    name: node.name,
    lampNumber: match[2] ? Number(match[2]) : null,
    isFlasher: /^F/i.test(match[1]),
    x: round((bounds.minX + bounds.maxX) / 2),
    y: round((bounds.minY + bounds.maxY) / 2),
    // The 3D scene sized each halo sprite off the insert footprint with a
    // 14-unit floor, and drew it at 2.3x. Keep the same visual weight.
    radius: round(Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 14) / 2 * 2.3),
    color: insertColor(node),
  })
}

lamps.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))

const body = lamps.map((lamp) => `  { name: '${lamp.name}', lampNumber: ${lamp.lampNumber}, isFlasher: ${lamp.isFlasher}, x: ${lamp.x}, y: ${lamp.y}, radius: ${lamp.radius}, color: '${lamp.color}' },`).join('\n')

await writeFile(resolve(outputArgument), `// GENERATED by scripts/extract-vpx-lamps.mjs -- do not edit by hand.
// Source: ${glbArgument}
//
// Animated lamp inserts baked out of the VPX table, in VPX playfield
// coordinates (x across, y down, matching VPX_TABLE). The picker draws these
// as additive glows over the pre-rendered playfield image instead of loading
// the full 30 MB glTF scene.

export type VpxLamp = {
  name: string
  lampNumber: number | null
  isFlasher: boolean
  x: number
  y: number
  radius: number
  color: string
}

export const VPX_LAMPS: readonly VpxLamp[] = [
${body}
]
`, 'utf8')

console.log(`wrote ${lamps.length} lamps to ${outputArgument}`)
