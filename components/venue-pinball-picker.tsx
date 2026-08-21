'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { MapPin, Play, RotateCcw, Smartphone, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { VpxTableScene } from '@/components/vpx-table-scene'
import { getMachineImagePath, getMachineThumbnailPath } from '@/lib/machine-images'
import { VPX_TABLE, type VpxPoint, type VpxSegment, type VpxWall } from '@/lib/vpx-robocop-table'
import {
  applyVpxScatter,
  createVpxFlipperMover,
  getVpxLineSegmentHit,
  resolveVpxBallCollision,
  resolveVpxFlipperContact,
  resolveVpxStaticContact,
  resolveVpxSurfaceContact,
  stepVpxFlipperMover,
  VPX_CONTACT_VELOCITY,
  type VpxFlipperMover,
  type VpxFlipperParameters,
} from '@/lib/vpx-physics'
import { useMachineCanon } from '@/hooks/use-machine-canon'

type Venue = { key: string; name: string; machines: string[] }
type Peg = {
  x: number; y: number; r?: number; kind?: 'post' | 'bumper'
  elasticity?: number; elasticityFalloff?: number; friction?: number; scatter?: number; force?: number
}
type Rail = {
  x1: number; y1: number; x2: number; y2: number
  kind?: 'rubber' | 'wall' | 'slingshot'
  elasticity?: number; elasticityFalloff?: number; friction?: number; scatter?: number; force?: number; thickness?: number
  heightBottom?: number; heightTop?: number
  vpxWall?: boolean
  allowsInvertedEscape?: boolean
}
type Mode = {
  id: string
  name: string
  description: string
  accent: string
}
type Ball = {
  machineKey: string
  label: string
  x: number
  y: number
  vx: number
  vy: number
  angularVelocity: number
  radius: number
  color: string
  z: number
  vz: number
  wireformDistance: number | null
  wireformSpeed: number
  wireformOffset: number
  active: boolean
  launchAt: number
  finished: boolean
}

const WIDTH = 640
// Keep RoboCop's native playfield aspect ratio in the simulation buffer. CSS
// may fit this dashboard to the viewport, but never stretches its geometry.
const HEIGHT = 1518
const BALL_TO_VPX_VELOCITY_SCALE = 10 / 16.667
const PALETTE = ['#ff006e', '#3a86ff', '#06d6a0', '#ffbe0b', '#8338ec', '#fb5607', '#00b4d8', '#ef476f']

const scaleVpxPoint = ([x, y]: VpxPoint) => ({
  x: x * WIDTH / VPX_TABLE.playableWidth,
  y: y * HEIGHT / VPX_TABLE.height,
})

const VPX_DRAIN_CENTER = scaleVpxPoint(VPX_TABLE.drain.center)
const VPX_DRAIN_RADIUS = VPX_TABLE.drain.radius * WIDTH / VPX_TABLE.playableWidth
const FINISH_Y = VPX_DRAIN_CENTER.y
const FINISH_LEFT = VPX_DRAIN_CENTER.x - VPX_DRAIN_RADIUS
const FINISH_RIGHT = VPX_DRAIN_CENTER.x + VPX_DRAIN_RADIUS
const VPX_PLAYFIELD_SCALE = WIDTH / VPX_TABLE.playableWidth
const VPX_BALL_RADIUS = 25 * VPX_PLAYFIELD_SCALE
const RAPID_FIRE_LANE = {
  left: 875 * VPX_PLAYFIELD_SCALE,
  right: 915 * VPX_PLAYFIELD_SCALE,
  top: 1940 * HEIGHT / VPX_TABLE.height,
  bottom: 2020 * HEIGHT / VPX_TABLE.height,
}

function railsFromVpxWall(wall: VpxWall, excludedEdge?: number): Rail[] {
  const isSlingBody = wall.name === 'LeftSlingShot' || wall.name === 'RightSlingShot'
  return wall.points.flatMap((point, index) => {
    if (index === excludedEdge) return []
    const start = scaleVpxPoint(point)
    const end = scaleVpxPoint(wall.points[(index + 1) % wall.points.length])
    return [{
      x1: start.x, y1: start.y, x2: end.x, y2: end.y, kind: 'wall',
      elasticity: wall.elasticity,
      elasticityFalloff: wall.elasticityFalloff,
      friction: wall.friction,
      scatter: wall.scatter,
      thickness: (wall.thickness ?? 0) * VPX_PLAYFIELD_SCALE,
      heightBottom: (isSlingBody ? 26 : 0) * VPX_PLAYFIELD_SCALE,
      heightTop: (isSlingBody ? 36 : 55) * VPX_PLAYFIELD_SCALE,
      vpxWall: true,
      allowsInvertedEscape: wall.name === 'Wall4',
    }]
  })
}

function railsFromVpxSegment(segment: VpxSegment): Rail[] {
  const start = scaleVpxPoint(segment.from)
  const end = scaleVpxPoint(segment.to)
  const rail: Rail = {
    x1: start.x, y1: start.y, x2: end.x, y2: end.y, kind: 'wall',
    elasticity: segment.elasticity, elasticityFalloff: segment.elasticityFalloff,
    friction: segment.friction, scatter: segment.scatter, thickness: 0,
    heightBottom: 0, heightTop: 65 * VPX_PLAYFIELD_SCALE, vpxWall: true,
  }
  return segment.oneWay ? [rail] : [rail, { ...rail, x1: end.x, y1: end.y, x2: start.x, y2: start.y }]
}

const VPX_PLAYFIELD_RAILS: Rail[] = [
  ...VPX_TABLE.walls.flatMap(railsFromVpxWall),
  ...VPX_TABLE.rubbers.flatMap(railsFromVpxWall),
  ...VPX_TABLE.slingBodies.flatMap((wall) => railsFromVpxWall(wall, wall.slingshotEdge)),
  ...VPX_TABLE.contacts.flatMap(railsFromVpxSegment),
  ...VPX_TABLE.slingFaces.map((face) => {
    const start = scaleVpxPoint(face.from)
    const end = scaleVpxPoint(face.to)
    return {
      x1: start.x, y1: start.y, x2: end.x, y2: end.y, kind: 'slingshot' as const,
      elasticity: face.elasticity, elasticityFalloff: face.elasticityFalloff,
      friction: face.friction, scatter: face.scatter, force: face.force, thickness: 4,
      heightBottom: 26 * VPX_PLAYFIELD_SCALE, heightTop: 36 * VPX_PLAYFIELD_SCALE,
    }
  }),
]

const VPX_BUMPERS: Peg[] = VPX_TABLE.bumpers.map((bumper) => {
  const center = scaleVpxPoint(bumper.center)
  return {
    x: center.x, y: center.y, r: bumper.radius * VPX_PLAYFIELD_SCALE, kind: 'bumper',
    elasticity: 1, elasticityFalloff: 0, friction: 0, scatter: bumper.scatter, force: bumper.force,
  }
})

type WireformNode = { x: number; y: number; z: number; width: number; distance: number }

const VPX_WIREFORM_ROUTE: readonly WireformNode[] = (() => {
  const route: WireformNode[] = []
  VPX_TABLE.shooterWireform.forEach((ramp) => {
    const sourcePoints = ramp.reverse ? [...ramp.points].reverse() : [...ramp.points]
    const sourceStartHeight = ramp.reverse ? ramp.heightTop : ramp.heightBottom
    const sourceEndHeight = ramp.reverse ? ramp.heightBottom : ramp.heightTop
    const sourceDistances = [0]
    for (let index = 1; index < sourcePoints.length; index += 1) {
      sourceDistances.push(sourceDistances[index - 1] + Math.hypot(
        sourcePoints[index][0] - sourcePoints[index - 1][0],
        sourcePoints[index][1] - sourcePoints[index - 1][1],
      ))
    }
    const sourceLength = sourceDistances[sourceDistances.length - 1] || 1
    sourcePoints.forEach((point, index) => {
      const scaled = scaleVpxPoint(point)
      const previous = route[route.length - 1]
      if (previous && Math.hypot(scaled.x - previous.x, scaled.y - previous.y) < 1) return
      const progress = sourceDistances[index] / sourceLength
      const z = (sourceStartHeight + (sourceEndHeight - sourceStartHeight) * progress) * VPX_PLAYFIELD_SCALE
      const distance = previous ? previous.distance + Math.hypot(scaled.x - previous.x, scaled.y - previous.y) : 0
      route.push({ x: scaled.x, y: scaled.y, z, width: ramp.width * VPX_PLAYFIELD_SCALE, distance })
    })
  })
  return route
})()

const VPX_WIREFORM_LENGTH = VPX_WIREFORM_ROUTE[VPX_WIREFORM_ROUTE.length - 1].distance

function sampleWireform(distance: number) {
  const clamped = Math.max(0, Math.min(VPX_WIREFORM_LENGTH, distance))
  let upperIndex = 1
  while (upperIndex < VPX_WIREFORM_ROUTE.length - 1 && VPX_WIREFORM_ROUTE[upperIndex].distance < clamped) upperIndex += 1
  const from = VPX_WIREFORM_ROUTE[upperIndex - 1]
  const to = VPX_WIREFORM_ROUTE[upperIndex]
  const segmentLength = Math.max(0.0001, to.distance - from.distance)
  const progress = (clamped - from.distance) / segmentLength
  const tangentX = (to.x - from.x) / segmentLength
  const tangentY = (to.y - from.y) / segmentLength
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    z: from.z + (to.z - from.z) * progress,
    width: from.width + (to.width - from.width) * progress,
    tangentX,
    tangentY,
    tangentZ: (to.z - from.z) / segmentLength,
  }
}

const VPX_FLIPPER = VPX_TABLE.flippers.left
const FLIPPER_LENGTH = VPX_FLIPPER.length * VPX_PLAYFIELD_SCALE
const FLIPPER_BASE_RADIUS = VPX_FLIPPER.baseRadius * VPX_PLAYFIELD_SCALE
const FLIPPER_END_RADIUS = VPX_FLIPPER.endRadius * VPX_PLAYFIELD_SCALE
const FLIPPER_RUBBER_THICKNESS = VPX_FLIPPER.rubberThickness * VPX_PLAYFIELD_SCALE
const FLIPPER_REST_ANGLE = (VPX_FLIPPER.startAngle - 90) * Math.PI / 180
const FLIPPER_END_ANGLE = (VPX_FLIPPER.endAngle - 90) * Math.PI / 180
const FLIPPER_LEFT_CENTER = scaleVpxPoint(VPX_TABLE.flippers.left.center)
const FLIPPER_RIGHT_CENTER = scaleVpxPoint(VPX_TABLE.flippers.right.center)
const FLIPPER_PARAMETERS: VpxFlipperParameters = {
  startAngle: FLIPPER_REST_ANGLE,
  endAngle: FLIPPER_END_ANGLE,
  length: FLIPPER_LENGTH,
  mass: VPX_FLIPPER.mass,
  // Torque scales with distance squared so angular acceleration matches VPX
  // after mapping table coordinates into the canvas coordinate system.
  strength: VPX_FLIPPER.strength * VPX_PLAYFIELD_SCALE * VPX_PLAYFIELD_SCALE,
  returnRatio: VPX_FLIPPER.returnStrength,
  rampUp: VPX_FLIPPER.rampUp,
  torqueDamping: VPX_FLIPPER.torqueDamping,
  torqueDampingAngle: VPX_FLIPPER.torqueDampingAngle * Math.PI / 180,
  elasticity: VPX_FLIPPER.elasticity,
  elasticityFalloff: VPX_FLIPPER.elasticityFalloff,
  friction: VPX_FLIPPER.friction,
}

// VPX renders moving objects slightly ahead of the last completed physics
// state to keep input-to-photon latency from adding a whole display frame.
// Keep the real mover/collision state untouched and advance a copy in 1 ms
// increments so this uses the same coil, inertia, damping, and stop model.
const FLIPPER_RENDER_PREDICTION_MS = 8

function predictedFlipperAngle(mover: VpxFlipperMover, pressed: boolean, enabled: boolean) {
  if (!enabled) return mover.angle
  const predicted = { ...mover }
  for (let millisecond = 0; millisecond < FLIPPER_RENDER_PREDICTION_MS; millisecond += 1) {
    stepVpxFlipperMover(predicted, FLIPPER_PARAMETERS, pressed, 0.1)
  }
  return predicted.angle
}

const MODES: Mode[] = [
  {
    id: 'rapid-fire',
    name: 'Rapid Fire',
    description: 'Every machine is randomized and fired up the plunger lane in quick succession.',
    accent: '#d71920',
  },
]

function collideRail(ball: Ball, rail: Rail) {
  if (ball.z - ball.radius > (rail.heightTop ?? Number.POSITIVE_INFINITY)) return false
  if (ball.z + ball.radius < (rail.heightBottom ?? 0)) return false
  const dx = rail.x2 - rail.x1
  const dy = rail.y2 - rail.y1
  const lengthSquared = dx * dx + dy * dy
  const t = Math.max(0, Math.min(1, ((ball.x - rail.x1) * dx + (ball.y - rail.y1) * dy) / lengthSquared))
  const closestX = rail.x1 + t * dx
  const closestY = rail.y1 + t * dy
  const nxRaw = ball.x - closestX
  const nyRaw = ball.y - closestY
  const distance = Math.hypot(nxRaw, nyRaw)
  const railThickness = rail.thickness ?? 5
  if (distance >= ball.radius + railThickness || distance === 0) return false
  const nx = nxRaw / distance
  const ny = nyRaw / distance
  const overlap = ball.radius + railThickness - distance
  ball.x += nx * overlap
  ball.y += ny * overlap
  const rubber = rail.kind !== 'wall'
  const contact = resolveVpxSurfaceContact(ball, {
    normalX: nx,
    normalY: ny,
    elasticity: rail.elasticity ?? (rubber ? 0.62 : 0.48),
    elasticityFalloff: rail.elasticityFalloff ?? 0,
    friction: rail.friction ?? (rubber ? 0.04 : 0.1),
  })
  if (contact && rail.scatter) applyVpxScatter(ball, rail.scatter, contact.normalImpulse)
  if (contact && rail.kind === 'slingshot') {
    const kick = (rail.force ?? 40) * 0.06125
    ball.vx += nx * kick
    ball.vy += ny * kick
  }
  return true
}

function advanceThroughVpxWalls(
  ball: Ball,
  rails: Rail[],
  step: number,
  externalVelocityDeltaX: number,
  externalVelocityDeltaY: number,
) {
  let remainingTime = step
  for (let iteration = 0; iteration < 4 && remainingTime > 1e-6; iteration += 1) {
    let earliest: { rail: Rail; time: number; normalX: number; normalY: number; penetration: number } | null = null
    for (const rail of rails) {
      if (!rail.vpxWall) continue
      if (ball.z - ball.radius > (rail.heightTop ?? Number.POSITIVE_INFINITY)) continue
      if (ball.z + ball.radius < (rail.heightBottom ?? 0)) continue
      if (rail.allowsInvertedEscape && externalVelocityDeltaY < 0) continue
      const hit = getVpxLineSegmentHit(ball, rail, remainingTime)
      if (hit && (!earliest || hit.time < earliest.time)) earliest = { rail, ...hit }
    }
    if (!earliest) break

    ball.x += ball.vx * earliest.time
    ball.y += ball.vy * earliest.time
    remainingTime -= earliest.time
    if (earliest.penetration > 0) {
      ball.x += earliest.normalX * earliest.penetration
      ball.y += earliest.normalY * earliest.penetration
    }

    const normalSpeed = ball.vx * earliest.normalX + ball.vy * earliest.normalY
    const isStaticContact = Math.abs(normalSpeed * BALL_TO_VPX_VELOCITY_SCALE) <= VPX_CONTACT_VELOCITY
    const contact = isStaticContact
      ? resolveVpxStaticContact(ball, {
          normalX: earliest.normalX,
          normalY: earliest.normalY,
          friction: earliest.rail.friction ?? 0.1,
          externalVelocityDeltaX,
          externalVelocityDeltaY,
        })
      : resolveVpxSurfaceContact(ball, {
          normalX: earliest.normalX,
          normalY: earliest.normalY,
          elasticity: earliest.rail.elasticity ?? 0.48,
          elasticityFalloff: earliest.rail.elasticityFalloff ?? 0,
          friction: earliest.rail.friction ?? 0.1,
        })
    if (contact && !isStaticContact && earliest.rail.scatter) {
      applyVpxScatter(ball, earliest.rail.scatter, contact.normalImpulse)
    }
  }
  ball.x += ball.vx * remainingTime
  ball.y += ball.vy * remainingTime
}

function getFlipperRails(leftAngle: number, rightAngle: number): { left: Rail; right: Rail } {
  return {
    left: {
      x1: FLIPPER_LEFT_CENTER.x,
      y1: FLIPPER_LEFT_CENTER.y,
      x2: FLIPPER_LEFT_CENTER.x + Math.cos(leftAngle) * FLIPPER_LENGTH,
      y2: FLIPPER_LEFT_CENTER.y + Math.sin(leftAngle) * FLIPPER_LENGTH,
    },
    right: {
      x1: FLIPPER_RIGHT_CENTER.x,
      y1: FLIPPER_RIGHT_CENTER.y,
      x2: FLIPPER_RIGHT_CENTER.x - Math.cos(rightAngle) * FLIPPER_LENGTH,
      y2: FLIPPER_RIGHT_CENTER.y + Math.sin(rightAngle) * FLIPPER_LENGTH,
    },
  }
}

function collideFlipper(
  ball: Ball,
  rail: Rail,
  mover: VpxFlipperMover,
  worldAngularDirection: 1 | -1,
) {
  if (ball.z - ball.radius > 50 * VPX_PLAYFIELD_SCALE) return
  const dx = rail.x2 - rail.x1
  const dy = rail.y2 - rail.y1
  const lengthSquared = dx * dx + dy * dy
  const t = Math.max(0, Math.min(1, ((ball.x - rail.x1) * dx + (ball.y - rail.y1) * dy) / lengthSquared))
  const closestX = rail.x1 + t * dx
  const closestY = rail.y1 + t * dy
  const nxRaw = ball.x - closestX
  const nyRaw = ball.y - closestY
  const distance = Math.hypot(nxRaw, nyRaw)
  // Pinball flippers are tapered bats rather than constant-width rails.
  const flipperRadius = FLIPPER_BASE_RADIUS + (FLIPPER_END_RADIUS - FLIPPER_BASE_RADIUS) * t
  if (distance >= ball.radius + flipperRadius) return

  // If a fast-moving tip reaches the exact ball center, VPX still produces a
  // separating contact normal. Do the same instead of dropping the contact.
  const railLength = Math.sqrt(lengthSquared)
  let nx = distance > 1e-6 ? nxRaw / distance : -dy / railLength
  let ny = distance > 1e-6 ? nyRaw / distance : dx / railLength
  if (distance <= 1e-6 && ball.vx * nx + ball.vy * ny > 0) { nx = -nx; ny = -ny }
  const overlap = ball.radius + flipperRadius - distance
  ball.x += nx * overlap
  ball.y += ny * overlap

  const radiusX = ball.x - ball.radius * nx - rail.x1
  const radiusY = ball.y - ball.radius * ny - rail.y1
  resolveVpxFlipperContact(ball, mover, FLIPPER_PARAMETERS, {
    normalX: nx,
    normalY: ny,
    radiusX,
    radiusY,
    worldAngularDirection,
    ballVelocityScale: BALL_TO_VPX_VELOCITY_SCALE,
  })
}

function collidePeg(ball: Ball, peg: Peg) {
  if (ball.z - ball.radius > 90 * VPX_PLAYFIELD_SCALE) return
  const radius = peg.r ?? 10
  const dx = ball.x - peg.x
  const dy = ball.y - peg.y
  const distance = Math.hypot(dx, dy)
  if (distance >= ball.radius + radius || distance === 0) return
  const nx = dx / distance
  const ny = dy / distance
  const overlap = ball.radius + radius - distance
  ball.x += nx * overlap
  ball.y += ny * overlap
  const isBumper = peg.kind === 'bumper' || (peg.kind !== 'post' && radius > 20)
  const contact = resolveVpxSurfaceContact(ball, {
    normalX: nx,
    normalY: ny,
    elasticity: peg.elasticity ?? (isBumper ? 0.58 : 0.68),
    elasticityFalloff: peg.elasticityFalloff ?? 0,
    friction: peg.friction ?? (isBumper ? 0.025 : 0.075),
  })
  if (contact && peg.scatter) applyVpxScatter(ball, peg.scatter, contact.normalImpulse)
  if (isBumper) {
    const kick = peg.force == null ? (radius >= 45 ? 3.8 : 3.1) : peg.force * 0.06125
    ball.vx += nx * kick
    ball.vy += ny * kick
  }
}

function collideBalls(first: Ball, second: Ball) {
  if (!first.active || !second.active || first.finished || second.finished) return
  if (Math.abs(first.z - second.z) >= first.radius + second.radius) return
  const dx = second.x - first.x
  const dy = second.y - first.y
  const distance = Math.hypot(dx, dy)
  const minimum = first.radius + second.radius
  if (distance === 0 || distance >= minimum) return
  const nx = dx / distance
  const ny = dy / distance
  const overlap = minimum - distance
  first.x -= nx * overlap * 0.5
  first.y -= ny * overlap * 0.5
  second.x += nx * overlap * 0.5
  second.y += ny * overlap * 0.5
  resolveVpxBallCollision(first, second, nx, ny)
}

function traceVpxFlipperProfile(ctx: CanvasRenderingContext2D, length: number, baseRadius: number, endRadius: number) {
  // Direct port of Flipper::SetVertices in VPX. The straight sides touch both
  // circles tangentially instead of merely connecting their widest points.
  const faceAngle = Math.asin((baseRadius - endRadius) / length)
  const normalX = Math.sin(faceAngle)
  const normalY = Math.cos(faceAngle)
  const baseTangentX = baseRadius * normalX
  const endTangentX = length + endRadius * normalX
  const upperAngle = faceAngle - Math.PI / 2
  const lowerAngle = Math.PI / 2 - faceAngle

  ctx.beginPath()
  ctx.moveTo(baseTangentX, -baseRadius * normalY)
  ctx.lineTo(endTangentX, -endRadius * normalY)
  ctx.arc(length, 0, endRadius, upperAngle, lowerAngle)
  ctx.lineTo(baseTangentX, baseRadius * normalY)
  ctx.arc(0, 0, baseRadius, lowerAngle, upperAngle)
  ctx.closePath()
}

function drawFlipper(ctx: CanvasRenderingContext2D, flipper: Rail, fill: string) {
  const dx = flipper.x2 - flipper.x1
  const dy = flipper.y2 - flipper.y1
  const angle = Math.atan2(dy, dx)
  const length = Math.hypot(dx, dy)
  ctx.save()
  ctx.translate(flipper.x1, flipper.y1)
  ctx.rotate(angle)
  traceVpxFlipperProfile(ctx, length, FLIPPER_BASE_RADIUS, FLIPPER_END_RADIUS)
  ctx.fillStyle = '#b52f27'
  ctx.fill()
  ctx.strokeStyle = '#111827'
  ctx.lineWidth = 2
  ctx.stroke()
  traceVpxFlipperProfile(
    ctx,
    length,
    FLIPPER_BASE_RADIUS - FLIPPER_RUBBER_THICKNESS,
    FLIPPER_END_RADIUS - FLIPPER_RUBBER_THICKNESS,
  )
  ctx.fillStyle = fill
  ctx.fill()
  ctx.restore()
}

function shortName(name: string) {
  return name.length > 16 ? `${name.slice(0, 14)}…` : name
}

function shuffled<T>(values: readonly T[]) {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

function randomBetween(minimum: number, maximum: number) {
  return minimum + Math.random() * (maximum - minimum)
}

function tryEnterShooterWireform(ball: Ball, step: number) {
  if (ball.wireformDistance != null || ball.vy >= 0 || ball.z > 0) return false
  const entry = sampleWireform(0)
  const nextY = ball.y + ball.vy * step
  if (ball.y < entry.y - ball.radius || nextY > entry.y + ball.radius) return false
  const normalX = -entry.tangentY
  const normalY = entry.tangentX
  const offset = (ball.x - entry.x) * normalX + (ball.y - entry.y) * normalY
  const maximumOffset = Math.max(0, entry.width / 2 - ball.radius)
  if (Math.abs(offset) > entry.width / 2 + ball.radius) return false
  ball.wireformDistance = 0
  ball.wireformSpeed = Math.max(1, ball.vx * entry.tangentX + ball.vy * entry.tangentY)
  ball.wireformOffset = Math.max(-maximumOffset, Math.min(maximumOffset, offset))
  ball.z = entry.z
  ball.vz = 0
  return true
}

function advanceShooterWireform(ball: Ball, step: number, forceX: number, forceY: number) {
  if (ball.wireformDistance == null) return false
  const current = sampleWireform(ball.wireformDistance)
  // Project playfield tilt and vertical gravity onto the 3D ramp tangent.
  ball.wireformSpeed += forceX * current.tangentX
    + forceY * current.tangentY
    - 0.28 * current.tangentZ * step
  ball.wireformSpeed *= Math.pow(0.999, step)
  ball.wireformDistance += ball.wireformSpeed * step

  const leftRoute = ball.wireformDistance < 0
  const leftTop = ball.wireformDistance > VPX_WIREFORM_LENGTH
  const sampled = sampleWireform(ball.wireformDistance)
  const normalX = -sampled.tangentY
  const normalY = sampled.tangentX
  ball.x = sampled.x + normalX * ball.wireformOffset
  ball.y = sampled.y + normalY * ball.wireformOffset
  ball.z = sampled.z
  ball.vx = sampled.tangentX * ball.wireformSpeed
  ball.vy = sampled.tangentY * ball.wireformSpeed
  ball.vz = sampled.tangentZ * ball.wireformSpeed

  if (leftRoute || leftTop) {
    ball.wireformDistance = null
    return false
  }
  return true
}

function advanceBallHeight(ball: Ball, step: number) {
  if (ball.z <= 0 && ball.vz <= 0) return
  ball.vz -= 0.28 * step
  ball.z += ball.vz * step
  if (ball.z >= 0) return
  ball.z = 0
  ball.vz = Math.abs(ball.vz) > 0.8 ? -ball.vz * 0.2 : 0
}

export function VenuePinballPicker() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ballsRef = useRef<Ball[]>([])
  const frameRef = useRef<number | null>(null)
  const lastTimeRef = useRef(0)
  const runningRef = useRef(false)
  const finishingRef = useRef<string[]>([])
  const tiltRef = useRef(0)
  const verticalGravityRef = useRef(1)
  const motionBaselineRef = useRef<number | null>(null)
  const lastNudgeRef = useRef(0)
  const nudgeHistoryRef = useRef<number[]>([])
  const motionNoticeTimerRef = useRef<number | null>(null)
  const tiltedRef = useRef(false)
  const flipperPressedRef = useRef({ left: false, right: false })
  const drawRef = useRef<() => void>(() => {})
  const flipperMoversRef = useRef({
    left: createVpxFlipperMover(FLIPPER_PARAMETERS),
    right: createVpxFlipperMover(FLIPPER_PARAMETERS),
  })
  const { display } = useMachineCanon()
  const [venues, setVenues] = useState<Venue[]>([])
  const [venueKey, setVenueKey] = useState('')
  const [modeId, setModeId] = useState(MODES[0].id)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [ranking, setRanking] = useState<string[]>([])
  const [celebration, setCelebration] = useState<string | null>(null)
  const [motionEnabled, setMotionEnabled] = useState(false)
  const [motionNotice, setMotionNotice] = useState<string | null>(null)
  const [tilted, setTilted] = useState(false)

  const venue = venues.find((item) => item.key === venueKey) ?? venues.find((item) => item.name === venueKey)
  const mode = MODES.find((item) => item.id === modeId) ?? MODES[0]
  const playfieldRails = VPX_PLAYFIELD_RAILS
  const playfieldPegs = VPX_BUMPERS
  // Venue lists speak canonical short keys. Preserve those keys through the
  // entire race; long names are display-only and must never be fed back into
  // image or data lookups.
  const machineKeys = useMemo(() => venue?.machines ?? [], [venue])

  useEffect(() => {
    fetch('/api/venues')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Could not load venues')))
      .then((data) => {
        const next = (data.venues ?? []).filter((item: Venue) => item.machines?.length)
        setVenues(next)
        const defaultVenue = next.find((item: Venue) => item.name === 'Georgetown Pizza and Arcade') ?? next[0]
        if (defaultVenue) setVenueKey(defaultVenue.key || defaultVenue.name)
      })
      .finally(() => setLoading(false))
  }, [])

  const showMotionNotice = useCallback((message: string, duration = 500) => {
    setMotionNotice(message)
    if (motionNoticeTimerRef.current) window.clearTimeout(motionNoticeTimerRef.current)
    motionNoticeTimerRef.current = window.setTimeout(() => setMotionNotice(null), duration)
  }, [])

  useEffect(() => {
    if (!motionEnabled) return

    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (tiltedRef.current) return
      if (event.gamma != null) {
        if (motionBaselineRef.current == null) motionBaselineRef.current = event.gamma
        const relativeTilt = event.gamma - motionBaselineRef.current
        tiltRef.current = Math.max(-1, Math.min(1, relativeTilt / 24))
      }
      // beta is ~90° when a portrait phone is upright, ~0° when it is
      // face-up and flat, and ~-90° when it is inverted. Projecting earth
      // gravity with sin(beta) gives exactly the requested 1g → 0g → -1g.
      if (event.beta != null) {
        const projectedGravity = Math.sin(event.beta * Math.PI / 180)
        verticalGravityRef.current = Math.abs(projectedGravity) < 0.025 ? 0 : projectedGravity
      }
    }

    const handleMotion = (event: DeviceMotionEvent) => {
      if (tiltedRef.current) return
      const acceleration = event.acceleration
      if (!acceleration) return
      const magnitude = Math.hypot(acceleration.x ?? 0, acceleration.y ?? 0, acceleration.z ?? 0)
      const now = performance.now()
      if (magnitude < 7.5 || now - lastNudgeRef.current < 550) return
      lastNudgeRef.current = now
      nudgeHistoryRef.current = [...nudgeHistoryRef.current.filter((time) => now - time < 2400), now]

      if (nudgeHistoryRef.current.length >= 3) {
        tiltedRef.current = true
        setTilted(true)
        tiltRef.current = 0
        nudgeHistoryRef.current = []
        showMotionNotice('TILT', 1800)
        window.setTimeout(() => {
          tiltedRef.current = false
          setTilted(false)
        }, 1800)
        return
      }

      const direction = (acceleration.x ?? 0) >= 0 ? 1 : -1
      ballsRef.current.forEach((ball) => {
        if (ball.active && !ball.finished) {
          ball.vx += direction * 2.2
          ball.vy -= 0.65
        }
      })
      showMotionNotice('NUDGE')
    }

    window.addEventListener('deviceorientation', handleOrientation)
    window.addEventListener('devicemotion', handleMotion)
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation)
      window.removeEventListener('devicemotion', handleMotion)
      tiltRef.current = 0
      verticalGravityRef.current = 1
    }
  }, [motionEnabled, showMotionNotice, tilted])

  useEffect(() => () => {
    if (motionNoticeTimerRef.current) window.clearTimeout(motionNoticeTimerRef.current)
  }, [])

  const setFlipperInput = useCallback((side: 'left' | 'right', pressed: boolean) => {
    if (flipperPressedRef.current[side] === pressed) return
    flipperPressedRef.current[side] = pressed
    // Drawing directly from the input event lets the browser include the
    // predicted flipper pose in its next paint instead of waiting for our
    // already-scheduled animation callback.
    drawRef.current()
  }, [])

  useEffect(() => {
    const setKey = (event: KeyboardEvent, pressed: boolean) => {
      if (event.key === 'ArrowLeft' || event.key === 'Shift') {
        setFlipperInput('left', pressed)
        event.preventDefault()
      }
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        setFlipperInput('right', pressed)
        event.preventDefault()
      }
    }
    const keyDown = (event: KeyboardEvent) => setKey(event, true)
    const keyUp = (event: KeyboardEvent) => setKey(event, false)
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
    }
  }, [setFlipperInput])

  const enableMotion = async () => {
    try {
      const orientationApi = DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }
      const motionApi = DeviceMotionEvent as typeof DeviceMotionEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }
      const orientationPermission = orientationApi.requestPermission ? await orientationApi.requestPermission() : 'granted'
      const motionPermission = motionApi.requestPermission ? await motionApi.requestPermission() : 'granted'
      if (orientationPermission !== 'granted' || motionPermission !== 'granted') {
        showMotionNotice('MOTION DENIED', 1400)
        return
      }
      motionBaselineRef.current = null
      verticalGravityRef.current = 1
      nudgeHistoryRef.current = []
      setMotionEnabled(true)
      showMotionNotice('MOTION READY', 1000)
    } catch {
      showMotionNotice('MOTION UNAVAILABLE', 1400)
    }
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, WIDTH, HEIGHT)

    const flippers = getFlipperRails(
      predictedFlipperAngle(flipperMoversRef.current.left, flipperPressedRef.current.left, runningRef.current),
      predictedFlipperAngle(flipperMoversRef.current.right, flipperPressedRef.current.right, runningRef.current),
    )
    ;([flippers.left, flippers.right] as Rail[]).forEach((flipper, index) => {
      drawFlipper(ctx, flipper, flipperPressedRef.current[index === 0 ? 'left' : 'right'] ? '#fff36a' : '#ffd92f')
    })

    ctx.setLineDash([14, 10]); ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 4
    ctx.beginPath(); ctx.moveTo(FINISH_LEFT, FINISH_Y); ctx.lineTo(FINISH_RIGHT, FINISH_Y); ctx.stroke(); ctx.setLineDash([])
    ctx.font = '700 14px sans-serif'; ctx.fillStyle = '#f8fafc'; ctx.textAlign = 'center'
    ctx.fillText('FINISH', VPX_DRAIN_CENTER.x, FINISH_Y + 28)

    ballsRef.current.forEach((ball, index) => {
      if (!ball.active || ball.finished) return
      ctx.shadowColor = ball.color; ctx.shadowBlur = 15
      ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2)
      ctx.fillStyle = ball.color; ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); ctx.shadowBlur = 0
      ctx.fillStyle = '#fff'; ctx.font = '700 10px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(String(index + 1), ball.x, ball.y + 3)
      ctx.font = '600 11px sans-serif'
      ctx.fillText(shortName(ball.label), Math.max(52, Math.min(WIDTH - 52, ball.x)), ball.y - ball.radius - 8)
    })
  }, [])

  useEffect(() => {
    drawRef.current = draw
    return () => { drawRef.current = () => {} }
  }, [draw])

  const stop = useCallback(() => {
    runningRef.current = false
    setRunning(false)
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }, [])

  const animate = useCallback((time: number) => {
    if (!runningRef.current) return
    const elapsed = Math.min(32, time - (lastTimeRef.current || time)) / 16.667
    lastTimeRef.current = time
    const balls = ballsRef.current
    // VPX targets a 1 ms physics step. Twelve subdivisions per nominal 60 Hz
    // frame keep the moving flipper tip from tunneling through a ball.
    const substeps = Math.max(1, Math.ceil(elapsed * 12))
    const step = elapsed / substeps
    for (let substep = 0; substep < substeps; substep += 1) {
      const vpxStep = step / BALL_TO_VPX_VELOCITY_SCALE
      stepVpxFlipperMover(flipperMoversRef.current.left, FLIPPER_PARAMETERS, flipperPressedRef.current.left, vpxStep)
      stepVpxFlipperMover(flipperMoversRef.current.right, FLIPPER_PARAMETERS, flipperPressedRef.current.right, vpxStep)
      const flippers = getFlipperRails(flipperMoversRef.current.left.angle, flipperMoversRef.current.right.angle)
      balls.forEach((ball) => {
        if (ball.finished) return
        if (!ball.active) {
          if (time < ball.launchAt) return
          ball.active = true
        }
        const gravityDeltaY = 0.115 * (motionEnabled ? verticalGravityRef.current : 1) * step
        const tiltDeltaX = motionEnabled && !tiltedRef.current ? tiltRef.current * 0.035 * step : 0
        tryEnterShooterWireform(ball, step)
        if (advanceShooterWireform(ball, step, tiltDeltaX, gravityDeltaY)) return
        advanceBallHeight(ball, step)
        ball.vy += gravityDeltaY
        ball.vx += tiltDeltaX
        ball.vx *= Math.pow(0.997, step)
        ball.vy *= Math.pow(0.999, step)
        advanceThroughVpxWalls(ball, playfieldRails, step, tiltDeltaX, gravityDeltaY)
        playfieldPegs.forEach((peg) => collidePeg(ball, peg))
        playfieldRails.forEach((rail) => { if (!rail.vpxWall) collideRail(ball, rail) })
        collideFlipper(ball, flippers.left, flipperMoversRef.current.left, 1)
        collideFlipper(ball, flippers.right, flipperMoversRef.current.right, -1)
        if (ball.x < ball.radius) { ball.x = ball.radius; ball.vx = Math.abs(ball.vx) * 0.78 }
        if (ball.x > WIDTH - ball.radius) { ball.x = WIDTH - ball.radius; ball.vx = -Math.abs(ball.vx) * 0.78 }
        if (ball.y > FINISH_Y && ball.x > FINISH_LEFT && ball.x < FINISH_RIGHT) {
          ball.finished = true
          finishingRef.current = [...finishingRef.current, ball.machineKey]
          setRanking([...finishingRef.current])
        }
        if (ball.y > HEIGHT + 40) {
          ball.y = 130; ball.x = VPX_DRAIN_CENTER.x; ball.z = 0
          ball.vy = 0; ball.vz = 0; ball.wireformDistance = null
        }
      })
      for (let first = 0; first < balls.length; first += 1) {
        for (let second = first + 1; second < balls.length; second += 1) collideBalls(balls[first], balls[second])
      }
    }
    draw()
    if (finishingRef.current.length >= balls.length) stop()
    else frameRef.current = requestAnimationFrame(animate)
  }, [draw, motionEnabled, playfieldPegs, playfieldRails, stop])

  const reset = useCallback(() => {
    stop()
    finishingRef.current = []
    setRanking([])
    flipperPressedRef.current = { left: false, right: false }
    flipperMoversRef.current = {
      left: createVpxFlipperMover(FLIPPER_PARAMETERS),
      right: createVpxFlipperMover(FLIPPER_PARAMETERS),
    }
    const machines = shuffled(machineKeys.slice(0, 30))
    ballsRef.current = machines.map((machineKey, index) => ({
      machineKey,
      label: display(machineKey),
      x: randomBetween(RAPID_FIRE_LANE.left, RAPID_FIRE_LANE.right),
      y: randomBetween(RAPID_FIRE_LANE.top, RAPID_FIRE_LANE.bottom),
      vx: randomBetween(-0.4, 0.25),
      vy: -randomBetween(24, 30),
      angularVelocity: 0,
      radius: VPX_BALL_RADIUS,
      color: PALETTE[index % PALETTE.length],
      z: 0,
      vz: 0,
      wireformDistance: null,
      wireformSpeed: 0,
      wireformOffset: 0,
      active: false,
      launchAt: Number.POSITIVE_INFINITY,
      finished: false,
    }))
    requestAnimationFrame(draw)
  }, [display, draw, machineKeys, stop])

  useEffect(() => { reset(); return stop }, [reset, stop])

  const start = () => {
    reset()
    const launchStart = performance.now()
    let nextLaunch = launchStart
    ballsRef.current.forEach((ball) => {
      nextLaunch += randomBetween(80, 150)
      ball.launchAt = nextLaunch
    })
    runningRef.current = true
    setRunning(true)
    lastTimeRef.current = launchStart
    frameRef.current = requestAnimationFrame(animate)
  }

  const winner = ranking[0]

  useEffect(() => {
    if (!winner) return
    setCelebration(winner)
    const timer = window.setTimeout(() => setCelebration(null), 1000)
    return () => window.clearTimeout(timer)
  }, [winner])

  return (
    <div className="container h-[calc(100dvh-3.5rem)] overflow-hidden px-2 py-2 pb-20 md:px-4 xl:h-auto xl:overflow-visible xl:px-6 xl:py-8">
      {celebration && (
        <div className="winner-backglass-overlay" aria-hidden="true">
          <Image
            src={getMachineImagePath(celebration)}
            alt=""
            fill
            priority
            className="object-contain"
            unoptimized
            onError={() => setCelebration(null)}
          />
        </div>
      )}
      <Card className="mb-2 xl:hidden">
        <CardContent className="grid grid-cols-2 gap-2 p-2">
          <label className="min-w-0 text-[11px] font-semibold text-muted-foreground">
            Venue
            <select disabled={loading || running} value={venueKey} onChange={(event) => setVenueKey(event.target.value)} className="mt-1 block h-9 w-full truncate rounded-md border bg-background px-2 text-sm text-foreground">
              {venues.map((item) => <option key={item.key || item.name} value={item.key || item.name}>{item.name} ({item.machines.length})</option>)}
            </select>
          </label>
          <label className="min-w-0 text-[11px] font-semibold text-muted-foreground">
            Mode
            <select disabled={running} value={modeId} onChange={(event) => setModeId(event.target.value)} className="mt-1 block h-9 w-full truncate rounded-md border bg-background px-2 text-sm text-foreground">
              {MODES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </CardContent>
      </Card>

      <div className="grid h-[calc(100%-4.25rem)] gap-6 xl:h-auto xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="relative aspect-[952/2256] h-full w-auto max-w-full justify-self-center xl:h-[900px]">
          <Card className="h-full w-full overflow-hidden border-slate-700 bg-slate-950 text-white shadow-2xl">
            <CardContent className="relative flex h-full items-center justify-center p-0">
              <VpxTableScene className="absolute inset-0" />
              <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="relative z-10 block h-full w-full" aria-label="Virtual pinball machine race" />
              {motionNotice && (
                <div className={`pointer-events-none absolute z-20 rounded-lg border px-5 py-2 text-lg font-black tracking-[.18em] shadow-2xl ${motionNotice === 'TILT' ? 'border-red-400 bg-red-600 text-white' : 'border-neon-blue/60 bg-slate-950/90 text-neon-blue'}`}>
                  {motionNotice}
                </div>
              )}
            </CardContent>
          </Card>
          <button
            type="button"
            aria-label="Left flipper"
            className="group absolute -left-14 bottom-[7%] z-30 flex h-[25%] min-h-36 max-h-52 w-24 touch-none select-none items-center justify-center border-0 bg-transparent xl:hidden"
            onPointerDown={(event) => { setFlipperInput('left', true); event.currentTarget.setPointerCapture(event.pointerId) }}
            onPointerUp={() => { setFlipperInput('left', false) }}
            onPointerCancel={() => { setFlipperInput('left', false) }}
            onLostPointerCapture={() => { setFlipperInput('left', false) }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <span className="pointer-events-none relative block h-[4.5rem] w-[4.5rem] overflow-hidden rounded-full drop-shadow-[0_0_14px_rgba(239,68,68,.65)] transition-transform duration-75 group-active:scale-90 group-active:brightness-125">
              <Image src="/flipper-button.png" alt="" fill sizes="72px" className="scale-[1.24] object-cover" priority />
            </span>
          </button>
          <button
            type="button"
            aria-label="Right flipper"
            className="group absolute -right-14 bottom-[7%] z-30 flex h-[25%] min-h-36 max-h-52 w-24 touch-none select-none items-center justify-center border-0 bg-transparent xl:hidden"
            onPointerDown={(event) => { setFlipperInput('right', true); event.currentTarget.setPointerCapture(event.pointerId) }}
            onPointerUp={() => { setFlipperInput('right', false) }}
            onPointerCancel={() => { setFlipperInput('right', false) }}
            onLostPointerCapture={() => { setFlipperInput('right', false) }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <span className="pointer-events-none relative block h-[4.5rem] w-[4.5rem] overflow-hidden rounded-full drop-shadow-[0_0_14px_rgba(239,68,68,.65)] transition-transform duration-75 group-active:scale-90 group-active:brightness-125">
              <Image src="/flipper-button.png" alt="" fill sizes="72px" className="scale-[1.24] object-cover" priority />
            </span>
          </button>
        </div>

        <div className="hidden space-y-5 xl:block">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg"><MapPin className="h-5 w-5" /> Set up the race</CardTitle>
              <CardDescription>Machine lists come from the current venue data.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="block text-sm font-medium">Venue</label>
              <select disabled={loading || running} value={venueKey} onChange={(event) => setVenueKey(event.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                {venues.map((item) => <option key={item.key || item.name} value={item.key || item.name}>{item.name} ({item.machines.length})</option>)}
              </select>
              <div>
                <div className="mb-2 text-sm font-medium">Game mode</div>
                <div className="grid gap-2">
                  {MODES.map((item) => (
                    <button key={item.id} disabled={running} onClick={() => setModeId(item.id)} className={`rounded-lg border p-3 text-left transition ${mode.id === item.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted'}`}>
                      <span className="flex items-center gap-2 font-semibold"><span className="h-3 w-3 rounded-full" style={{ background: item.accent }} />{item.name}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{item.description}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="hidden grid-cols-2 gap-2 pt-1 xl:grid">
                <Button onClick={start} disabled={loading || running || machineKeys.length < 2}><Play className="mr-2 h-4 w-4" /> Start Rapid Fire</Button>
                <Button variant="outline" onClick={reset}><RotateCcw className="mr-2 h-4 w-4" /> Reset</Button>
              </div>
              {machineKeys.length > 30 && <p className="text-xs text-muted-foreground">This venue has {machineKeys.length} machines. The race uses the first 30.</p>}
            </CardContent>
          </Card>

          {winner && (
            <Card className="overflow-hidden border-neon-yellow/50 bg-gradient-to-br from-neon-yellow/15 to-neon-pink/10">
              <CardContent className="flex items-center gap-4 p-4">
                <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-md bg-slate-900">
                  <Image src={getMachineThumbnailPath(winner)} alt="" fill className="object-cover" unoptimized onError={(event) => { (event.target as HTMLImageElement).style.display = 'none' }} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400"><Trophy className="h-4 w-4" /> Your machine</div>
                  <div className="mt-1 truncate text-xl font-bold">{display(winner)}</div>
                  <div className="text-sm text-muted-foreground">at {venue?.name}</div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Race order</CardTitle></CardHeader>
            <CardContent>
              {ranking.length === 0 ? <p className="text-sm text-muted-foreground">Start the table to see the finish order.</p> : (
                <ol className="max-h-52 space-y-2 overflow-y-auto">
                  {ranking.map((machineKey, index) => <li key={machineKey} className="flex items-center gap-3 text-sm"><span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${index === 0 ? 'bg-amber-400 text-slate-950' : 'bg-muted'}`}>{index + 1}</span><span className="truncate">{display(machineKey)}</span></li>)}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(0,0,0,.18)] backdrop-blur xl:hidden">
        <div className="mx-auto grid max-w-md grid-cols-[1fr_auto_auto] gap-2">
          <Button size="lg" onClick={start} disabled={loading || running || machineKeys.length < 2}>
            <Play className="mr-2 h-5 w-5" /> Rapid Fire
          </Button>
          <Button size="lg" variant={motionEnabled ? 'default' : 'outline'} onClick={enableMotion} disabled={motionEnabled} aria-label={motionEnabled ? 'Motion controls enabled' : 'Enable motion controls'} title={motionEnabled ? 'Motion controls enabled' : 'Enable motion controls'}>
            <Smartphone className={`h-5 w-5 ${motionEnabled ? 'text-neon-green' : ''}`} />
          </Button>
          <Button size="lg" variant="outline" onClick={reset} aria-label="Reset race">
            <RotateCcw className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
