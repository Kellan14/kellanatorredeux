// Reproduces a plunged ball's trip up the shooter wireform outside React, so
// the "ball sticks near the top of the ramp" case can be stepped and printed.
//
// It rebuilds the ramp tracks exactly as venue-pinball-picker.tsx does and
// calls the real lib/vpx-physics.ts friction, so a stall here is a stall in
// the game.
//
// Usage: node scripts/debug-ramp-travel.mjs [launchSpeed]

import { readFile } from 'node:fs/promises'
import { applyVpxSurfaceFriction } from '../lib/vpx-physics.ts'

const WIDTH = 640
const HEIGHT = 1518

const source = await readFile('lib/vpx-robocop-table.ts', 'utf8')
const body = source.slice(source.indexOf('export const VPX_TABLE'))
const VPX_TABLE = eval(`(${body
  .replace(/ as const satisfies [^,\n]*/g, '').replace(/ as const/g, '')
  .slice(body.indexOf('=') + 1).trim().replace(/;\s*$/, '')})`)

const SCALE = WIDTH / VPX_TABLE.playableWidth
const scalePoint = ([x, y]) => ({ x: x * SCALE, y: y * HEIGHT / VPX_TABLE.height })
const TOTAL_GRAVITY = VPX_TABLE.playfield.gravity * SCALE
const SLOPE = VPX_TABLE.playfield.slope * Math.PI / 180
const PLANAR_GRAVITY = TOTAL_GRAVITY * Math.sin(SLOPE)
const NORMAL_GRAVITY = TOTAL_GRAVITY * Math.cos(SLOPE)
const BALL_RADIUS = 25 * SCALE
const BALL_TO_VPX_VELOCITY_SCALE = 10 / 16.667

// --- ramp tracks (mirrors the picker) ---------------------------------------
function buildTrack(track) {
  const raw = []
  for (const ramp of track.parts) {
    const points = ramp.reverse ? [...ramp.points].reverse() : [...ramp.points]
    const startHeight = ramp.reverse ? ramp.heightTop : ramp.heightBottom
    const endHeight = ramp.reverse ? ramp.heightBottom : ramp.heightTop
    const startWidth = ramp.reverse ? ramp.widthTop : ramp.widthBottom
    const endWidth = ramp.reverse ? ramp.widthBottom : ramp.widthTop
    const distances = [0]
    for (let i = 1; i < points.length; i += 1) {
      distances.push(distances[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
    }
    const length = distances[distances.length - 1] || 1
    points.forEach((point, i) => {
      const progress = distances[i] / length
      const scaled = scalePoint(point)
      const node = {
        x: scaled.x, y: scaled.y,
        z: (startHeight + (endHeight - startHeight) * progress) * SCALE,
        width: (startWidth + (endWidth - startWidth) * progress) * SCALE,
        friction: ramp.friction, elasticity: ramp.elasticity,
        leftWallHeight: ramp.leftWallHeight * SCALE, rightWallHeight: ramp.rightWallHeight * SCALE,
      }
      const previous = raw[raw.length - 1]
      if (previous && Math.hypot(node.x - previous.x, node.y - previous.y, node.z - previous.z) < 0.75) return
      raw.push(node)
    })
  }
  // mirrors removeRampSpurs in venue-pinball-picker.tsx
  if (!process.argv.includes('--no-spur-fix')) {
    for (let i = 1; i < raw.length - 1; i += 1) {
      const p = raw[i - 1], n = raw[i], x = raw[i + 1]
      const inX = n.x - p.x, inY = n.y - p.y, outX = x.x - n.x, outY = x.y - n.y
      const inLen = Math.hypot(inX, inY), outLen = Math.hypot(outX, outY)
      if (inLen < 1e-6 || outLen < 1e-6) continue
      if ((inX * outX + inY * outY) / (inLen * outLen) >= 0) continue
      if (Math.min(inLen, outLen) >= BALL_RADIUS) continue
      raw.splice(i, 1); i -= 1
    }
  }

  let distance = 0
  const nodes = raw.map((node, index) => {
    if (index > 0) {
      const p = raw[index - 1]
      distance += Math.hypot(node.x - p.x, node.y - p.y, node.z - p.z)
    }
    return { ...node, distance }
  })
  return { name: track.name, nodes, length: distance }
}

function sampleRamp(track, distance) {
  const clamped = Math.max(0, Math.min(track.length, distance))
  let upper = 1
  while (upper < track.nodes.length - 1 && track.nodes[upper].distance < clamped) upper += 1
  const from = track.nodes[upper - 1]
  const to = track.nodes[upper]
  const segment = Math.max(0.0001, to.distance - from.distance)
  const progress = (clamped - from.distance) / segment
  const tangentX = (to.x - from.x) / segment
  const tangentY = (to.y - from.y) / segment
  const tangentZ = (to.z - from.z) / segment
  const planar = Math.max(0.0001, Math.hypot(tangentX, tangentY))
  const lerp = (a, b) => a + (b - a) * progress
  return {
    x: lerp(from.x, to.x), y: lerp(from.y, to.y), z: lerp(from.z, to.z),
    width: lerp(from.width, to.width), friction: lerp(from.friction, to.friction),
    elasticity: lerp(from.elasticity, to.elasticity),
    tangentX, tangentY, tangentZ,
    normalX: -tangentY / planar, normalY: tangentX / planar,
    surfaceNormalX: -tangentX * tangentZ / planar,
    surfaceNormalY: -tangentY * tangentZ / planar,
    surfaceNormalZ: planar,
  }
}

const track = buildTrack(VPX_TABLE.rampTracks.find((t) => t.name === 'Shooter wireform'))

// Where each source ramp part ends up along the combined track.
console.log(`track "${track.name}": ${track.nodes.length} nodes, length ${track.length.toFixed(1)} canvas units`)
console.log(`gravity: planar ${PLANAR_GRAVITY.toFixed(5)}  normal ${NORMAL_GRAVITY.toFixed(5)} (slope ${VPX_TABLE.playfield.slope}deg)\n`)

const launchSpeed = Number(process.argv[2] ?? 48)
const ball = {
  vx: 0, vy: 0, vz: 0, radius: BALL_RADIUS,
  angularVelocity: 0, angularVelocityX: 0, angularVelocityY: 0,
  rampSpeed: launchSpeed, rampLateralSpeed: 0, rampDistance: 0, rampOffset: 0,
}

const step = 1 / 12          // one substep at 60Hz with 12 subdivisions
const vpxStep = step / BALL_TO_VPX_VELOCITY_SCALE
console.log(`launch speed ${launchSpeed} canvas units/frame\n`)
console.log('  substep   distance     speed      z    tangentZ   friction  note')

let stalledFor = 0
for (let i = 0; i < 20000; i += 1) {
  const current = sampleRamp(track, ball.rampDistance)
  const tangentAcceleration = -PLANAR_GRAVITY * current.tangentY - NORMAL_GRAVITY * current.tangentZ
  const lateralAcceleration = PLANAR_GRAVITY * current.normalY
  ball.rampSpeed += tangentAcceleration * step
  ball.rampLateralSpeed += lateralAcceleration * step
  ball.vx = current.tangentX * ball.rampSpeed + current.normalX * ball.rampLateralSpeed
  ball.vy = current.tangentY * ball.rampSpeed + current.normalY * ball.rampLateralSpeed
  ball.vz = current.tangentZ * ball.rampSpeed
  applyVpxSurfaceFriction(ball, {
    deltaTime: vpxStep, friction: current.friction,
    normalAcceleration: Math.max(0, NORMAL_GRAVITY * current.surfaceNormalZ
      - PLANAR_GRAVITY * current.surfaceNormalY),
    tangentAcceleration, lateralAcceleration,
    tangentX: current.tangentX, tangentY: current.tangentY, tangentZ: current.tangentZ,
    lateralX: current.normalX, lateralY: current.normalY, lateralZ: 0,
    normalX: current.surfaceNormalX, normalY: current.surfaceNormalY, normalZ: current.surfaceNormalZ,
  })
  ball.rampSpeed = ball.vx * current.tangentX + ball.vy * current.tangentY + ball.vz * current.tangentZ
  ball.rampLateralSpeed = ball.vx * current.normalX + ball.vy * current.normalY
  ball.rampDistance += ball.rampSpeed * step

  if (i % 60 === 0 || Math.abs(ball.rampSpeed) < 0.02) {
    console.log(`  ${String(i).padStart(6)}  ${ball.rampDistance.toFixed(2).padStart(9)} `
      + ` ${ball.rampSpeed.toFixed(4).padStart(9)} ${sampleRamp(track, ball.rampDistance).z.toFixed(1).padStart(7)}`
      + ` ${current.tangentZ.toFixed(4).padStart(9)} ${current.friction.toFixed(3).padStart(9)}`)
  }
  if (Math.abs(ball.rampSpeed) < 0.02) {
    stalledFor += 1
    if (stalledFor > 5) {
      console.log(`\nSTALLED at distance ${ball.rampDistance.toFixed(2)} of ${track.length.toFixed(2)}`
        + ` (${(100 * ball.rampDistance / track.length).toFixed(1)}% along), height ${sampleRamp(track, ball.rampDistance).z.toFixed(1)}`)
      break
    }
  } else stalledFor = 0
  if (ball.rampDistance > track.length) { console.log(`\nCLEARED the track at substep ${i}`); break }
  if (ball.rampDistance < 0) { console.log(`\nRolled back off the bottom at substep ${i}`); break }
}
